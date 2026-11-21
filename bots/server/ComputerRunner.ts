/**
 * The runner for a Brick's real computer (build handoff v2, section 6). Orbit decides which jobs are running and keeps the machine, the
 * keys, the take-over fence and the meter; this module is the one thing that talks to the agent on the machine, through Orbit's broker:
 *
 *   find a running job -> get its machine ready for a model (a new key) -> send the agent the job as a turn -> read what it says
 *   -> act on how the turn ended (done, failed, needs the person, or carry on) -> repeat
 *
 * What it keeps to:
 *  - It never decides who has the machine. Before it acts on how a turn ended it asks Orbit again: a job the person took over, or one that
 *    is over, is left alone, and the agent's words from before are not acted on.
 *  - The agent is told once, in the first turn, how to say it is done, cannot go on, or needs the person (a line at the end of its reply).
 *    Paying, submitting and the person's own details are never its alone.
 *  - It renews the job's room as often as Orbit says, so a job that goes on is not stopped and one that does not is let go.
 *  - It stops reading when it is stopped (a restart), and the turn goes on on the machine: the next runner reconnects to it.
 *  - What the agent was given never reaches a log, and neither do its tool arguments (Orbit never sends them).
 */

import { randomBytes } from 'node:crypto';
import type { AdminApiService } from './AdminApiService';
import type { RefusalNotes, Since } from './ComputerRefusals';
import { readRunnerEvents } from './ComputerTurnStream';
import { redactSecrets, safeStepLabel } from './redactSecrets';

export type RunnerEvent =
    | { type: 'created'; id: string; sessionId: string | null }
    | { type: 'text'; text: string }
    | { type: 'tool'; state: 'generating' | 'started' | 'completed' | 'failed'; tool: string; label?: string; durationMs?: number; error?: string }
    | { type: 'completed'; outputText: string; usage: { inputTokens: number | null; outputTokens: number | null } | null }
    | { type: 'failed'; code: string; message: string }
    | { type: 'keepalive' };

/** A run of the runner on a job: the time it began, and four random bytes, so two runs never share one (not even in the same millisecond). */
const newRunId = (): string => `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

export interface RunnableJob {
    jobId: string;
    botId: string;
    title: string;
    brief: string | null;
    writes: boolean;
    hasTurn: boolean;
}

/** Whose fault a failed job is, as Orbit's finish call takes it: `ours` is given back to the person, `agent` is the person's. */
export type FinishCause = 'ours' | 'agent';

export type TurnOpened = { ok: true; events: AsyncIterable<RunnerEvent> } | { ok: false; reason: string; responseId?: string };

/** What the bot server tells Orbit with a prepare, besides the relay's address: the run of this runner the job's turns are numbered in. */
export interface PrepareFacts {
    run?: string;
}

export interface RunnerOrbit {
    running(): Promise<RunnableJob[]>;
    /**
     * The job as Orbit has it, or null when it is gone. `generation` is the job's control generation: it moves when the person takes the machine
     * or gives it back, and when the job pauses or resumes. Absent from an Orbit that does not give it (nothing is then sent or checked).
     */
    job(botId: string, jobId: string): Promise<{ status: string; control: string; generation?: number } | null>;
    action(botId: string, jobId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** `extra` goes along with the address (see `PrepareFacts`). */
    prepare(jobId: string, relay: string, extra?: PrepareFacts): Promise<{ ok: true } | { ok: false; reason: string }>;
    turn(jobId: string, input: string, signal: AbortSignal): Promise<TurnOpened>;
    stream(jobId: string, signal: AbortSignal): Promise<TurnOpened>;
    cancel(jobId: string): Promise<void>;
}

export interface RunnerTiming {
    /** How long to wait before looking at a job again while the person has it. */
    waitMs: number;
    /** The least time between two progress reports of one job. */
    progressMs: number;
    /** How long to wait before each try to reconnect to a turn whose stream broke. */
    reconnectMs: number[];
    /** How long to wait before each try to get a machine ready. */
    prepareMs: number[];
    /** How often a turn that is going on is looked at for calls that were all refused for want of room in the shared pool. */
    poolCheckMs?: number;
    /** How long the calls of a turn may ALL be refused for want of room before the machine is given up (Hermes tries a turn for about 6 minutes). */
    poolGiveUpMs?: number;
}

export const RUNNER_TIMING: RunnerTiming = { waitMs: 5000, progressMs: 4000, reconnectMs: [1000, 3000, 8000, 20_000], prepareMs: [2000, 6000], poolCheckMs: 5000, poolGiveUpMs: 90_000 };

export const RUNNER_GUARDS = {
    /** Jobs the runner works on at once. */
    maxJobs: 20,
    /** Turns one job may take before it is ended as failed (a job that never says it is done must not run for ever). */
    maxTurns: 60,
    /** Turns in a row that ended badly before the job is ended as failed. */
    maxBadTurns: 3,
    /** The most of the agent's words kept to read the ending from. */
    maxWords: 20_000,
};

export type Ending =
    | { kind: 'done' }
    | { kind: 'failed' }
    | { kind: 'handover'; waitingFor: 'details' | 'signin' | 'upload' | 'pay' | 'submit' | 'answer'; what: string | null; where: string | null }
    | { kind: 'none' };

const KINDS = ['details', 'signin', 'upload', 'pay', 'submit', 'answer'] as const;
const clean = (value: string | undefined) => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

/** How the agent said its turn ended: the LAST marker in its words counts. `[[done]]`, `[[failed]]` or `[[handover kind | what | where]]`. */
export function endingOf(words: string): Ending {
    let last: Ending = { kind: 'none' };
    const pattern = /\[\[\s*(done|failed|handover)\s*([^\]]*)\]\]/gi;
    for (let match = pattern.exec(words); match; match = pattern.exec(words)) {
        const word = match[1].toLowerCase();
        if (word === 'done') last = { kind: 'done' };
        else if (word === 'failed') last = { kind: 'failed' };
        else {
            const parts = match[2].replace(/^\s*[|:]?/, '').split('|');
            const asked = (parts[0] ?? '').trim().toLowerCase();
            const kind = (KINDS as readonly string[]).includes(asked) ? (asked as (typeof KINDS)[number]) : null;
            const what = clean(parts[1]) || null;
            const where = clean(parts[2]) || null;
            // "details" is only ever asked with what and where named, so the person's one tap fills in exactly that; otherwise it is a question
            if (kind === 'details' && (!what || !where)) last = { kind: 'handover', waitingFor: 'answer', what: null, where: null };
            else last = { kind: 'handover', waitingFor: kind ?? 'answer', what: kind === 'details' ? what : null, where: kind === 'details' ? where : null };
        }
    }
    return last;
}

/**
 * The one sentence the agent gave for why it could not go on: the last sentence before its `[[failed]]` marker, at most 300 characters. Orbit cleans it
 * (no links or markup) before Brick says it, and says it apart from what the record proves. Null when it said nothing before the marker.
 */
export function whyOf(words: string): string | null {
    const marker = /\[\[\s*failed\s*[^\]]*\]\]/gi;
    let at = -1;
    for (let match = marker.exec(words); match; match = marker.exec(words)) at = match.index;
    if (at < 0) return null;
    // A line of its own ends a sentence too, so it is split before the spaces are made one
    const before = words.slice(0, at).replace(/\[\[[^\]]*\]\]/g, ' ');
    // A stop inside a name or number ("passport.pdf", "3.5", "e.g. the form") is no end of a sentence: only a stop followed by a space and a capital, a digit or an opening quote is
    const sentences = before.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"'(])/).map((one) => one.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const last = sentences[sentences.length - 1] ?? '';
    // The computer's own sentence may quote a command it ran: nothing secret goes on to Orbit or the person
    // (the whole sentence is redacted first: a cut at 300 characters through `PASSWORD=hunter2` would leave a value no pattern can tell from a word)
    return last ? redactSecrets(last).slice(-300) : null;
}

/**
 * The folder, from the home folder, where a job saves what it makes for the person. It is the job's own (its id is in the name): Orbit hands over what is in it and
 * nothing else, so which job made a file never depends on when the file was touched. Orbit uses the same name (`outputFolder` in lib/computer-file-cards).
 */
export const outputFolderOf = (jobId: string): string => `Outputs/${jobId}`;

/** The first turn of a job: the job in the person's words, and how to say how it ended. */
export function jobPrompt(job: { jobId: string; title: string; brief: string | null; writes: boolean }): string {
    return [
        'You are working on a computer that belongs to a person. Do this job for them, in the browser and on this computer:',
        '',
        `Job: ${job.title}`,
        ...(job.brief ? ['', 'In their words:', job.brief] : []),
        '',
        ...(job.writes ? [] : ['This job is only to look: do not fill in, send, buy or change anything anywhere.', '']),
        'Rules:',
        '- Paying, submitting a form for good, and the person\'s own details (names, numbers, documents, passwords, card numbers) are never yours alone. Stop and ask for them.',
        '- When you need the person (their details, to sign in, to upload a file, to pay, to submit, or an answer), stop and end your reply with one line: [[handover KIND | what | where]]. KIND is one of details, signin, upload, pay, submit, answer. For details, say exactly what you are ready to put in and the site it goes on; for the rest `what` and `where` can be left out.',
        ...(job.writes
            ? [`- If the job makes a file for the person (a receipt, a report, a picture, a document), save it in the folder ${outputFolderOf(job.jobId)} in your home folder, and make that folder if it is not there. Only what is in that folder is given to the person, so put nothing else in it.`]
            : []),
        '- When the job is finished, end your reply with [[done]].',
        '- If you cannot go on, say why in one plain sentence and end your reply with [[failed]].',
        '- Keep your replies short. Do not repeat what you did. Never write a password, key or number the person gave you in your reply.',
    ].join('\n');
}

export const RESUME_PROMPT =
    'The person used this computer and has handed it back. Look at the current page first, since it may have changed, then carry on with the job from where it stands. Remember how to end your reply: [[done]], [[failed]] or [[handover KIND | what | where]].';

export const CONTINUE_PROMPT = 'Carry on with the job. If it is finished, end your reply with [[done]]. If you need the person, end with [[handover KIND | what | where]]. If you cannot go on, end with [[failed]].';

const over = (status: string) => status === 'done' || status === 'stopped' || status === 'failed';

export interface RunnerDeps {
    orbit: RunnerOrbit;
    /** Where the model relay is (an https address ending where /v1 begins). Without it no job can run, and each is ended as failed. */
    relayUrl: string | null;
    timing?: RunnerTiming;
    /** Waits; stops waiting when the signal ends. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    log?: Pick<Console, 'warn' | 'error' | 'info'>;
    /** What the model relay refused for the person's allowance or a rule of theirs: a turn that ended on one is not Universe's failure. */
    /** Names a run of the runner on a job (tests give fixed ones); each run of a job has its own. */
    runId?: () => string;
    refusals?: Pick<RefusalNotes, 'sawSince'> & Partial<Pick<RefusalNotes, 'endedOnFault' | 'turn' | 'flush' | 'confirmedSince' | 'mark' | 'record' | 'calledSince' | 'calledAnywhereSince' | 'onlyPoolBusySince' | 'acceptedAnywhereSince'>>;
    /**
     * Asks the relay's own address whether it answers as the relay (see `probeRelay`): `wrong` when something else answers there (an error page,
     * another service), `unknown` when it could not be asked from here at all (no proof either way). Without it nothing is asked.
     */
    relayProbe?: (relay: string) => Promise<RelayProbeResult>;
}

/** What the relay's address answered: `relay` (it is the relay), `wrong` (something else is there), `unknown` (no answer to read from here). */
export type RelayProbe = 'relay' | 'wrong' | 'unknown';
/** The reading, and the HTTP status seen (null when there was no answer). */
export interface RelayProbeResult {
    answer: RelayProbe;
    status: number | null;
}

/** The one line said to the person when the machine could not reach our own model service: nothing was taken. */
export const RELAY_UNREACHABLE_WHY = "We couldn't reach our own service, you weren't charged.";

/** What opening a turn's stream answers when the turn was stopped here while it was being opened. */
const STOPPED_HERE = Symbol('stopped here');

/** The one line said to the person when every model call of a turn was refused for want of room: the machine is given up, and nothing was taken. */
export const POOL_BUSY_WHY = "Computers are busy right now, so we stopped this and you weren't charged.";

/**
 * Asks an address for the relay's model list WITHOUT a key and reads who answers: the relay answers with a JSON error (401 `invalid_api_key`, or 503
 * while Orbit is away) or the list; an error page (an HTML 404 from the wrong host, a proxy's 502) or any other body is not the relay. An address that
 * does not answer at all is `unknown`: from the bot server's own side that proves nothing about the machine's way in (a server cannot always reach
 * its own public name), so only an answer from something else counts against the address.
 */
export async function probeRelay(relay: string, fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<RelayProbeResult> {
    try {
        const answer = await fetcher(`${relay}/v1/models`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        const status = answer.status;
        const text = (await answer.text()).slice(0, 4000);
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return { answer: 'wrong', status };
        }
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
        return { answer: record && (typeof record.error === 'object' || record.object === 'list') ? 'relay' : 'wrong', status };
    } catch {
        return { answer: 'unknown', status: null };
    }
}

const realSleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done, { once: true });
    });

const statusOf = (error: unknown): number | undefined => {
    const status = typeof error === 'object' && error !== null && 'response' in error ? (error as { response?: { status?: unknown } }).response?.status : undefined;
    return typeof status === 'number' ? status : undefined;
};

/** An answer from Orbit that says no (a 4xx, other than "slow down" or "try again"), as opposed to an Orbit that could not be reached. */
function refusedByOrbit(error: unknown): boolean {
    const status = statusOf(error);
    return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429;
}

/** An answer from Orbit that says the action came from an older turn than the job is on now (409 `stale`): the job changed hands or paused meanwhile. */
function staleForOrbit(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('response' in error)) return false;
    const response = (error as { response?: { status?: unknown; data?: { reason?: unknown } } }).response;
    return response?.status === 409 && response.data?.reason === 'stale';
}

/** An action for Orbit, with the control generation the turn started on when Orbit gave one (so an action from an older turn changes nothing). */
function fenced(body: Record<string, unknown>, generation: number | undefined): Record<string, unknown> {
    return generation === undefined ? body : { ...body, generation };
}

/**
 * An answer from Orbit that says no to what a job told it, as opposed to one that is ours to answer for. Orbit's job route (#981) answers
 * 200 for everything it does, 404 when the job is gone, 400 when the request does not fit (a bug of ours), 401 when our own key is not
 * accepted (ours) and 500 when it failed itself (ours). So only a 404, or another 4xx a later Orbit may give for a no, is a refusal.
 */
const orbitSaidNo = (error: unknown): boolean => refusedByOrbit(error) && statusOf(error) !== 400 && statusOf(error) !== 401 && statusOf(error) !== 403;

type TurnResult =
    /** The turn ended and what the agent said is here (it may be empty). */
    | { kind: 'ended'; words: string; failed: boolean; fenced: boolean }
    /**
     * Orbit or the job changed under it: look at the job again. `cancelled`: this turn was stopped here (its room was gone, or a report
     * was refused as stale), so it is not there to reconnect to, and the page may have changed since: the next turn is told to look first.
     */
    | { kind: 'look'; cancelled?: true }
    /** Every call of the turn was refused for want of room in the shared pool for as long as the runner waits: the turn was stopped here and the machine is given up. */
    | { kind: 'poolBusy' }
    /** Stopped (a restart): nothing more is done, and the turn goes on on the machine. */
    | { kind: 'stopped' };

export interface ComputerRunner {
    /** Looks for running jobs and starts a worker on each new one. Never throws. */
    tick(): Promise<void>;
    start(everyMs: number): void;
    /** Stops reading every job. Turns on machines go on; the next runner reconnects to them. */
    stop(): void;
    /** Job ids worked on now. */
    active(): string[];
    /** Resolves when no worker is left (for tests and for a clean stop). */
    idle(): Promise<void>;
}

export function createComputerRunner(deps: RunnerDeps): ComputerRunner {
    const { orbit } = deps;
    const timing = deps.timing ?? RUNNER_TIMING;
    const sleep = deps.sleep ?? realSleep;
    const now = deps.now ?? Date.now;
    const log = deps.log ?? console;
    const workers = new Map<string, { controller: AbortController; done: Promise<void> }>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    // Counts each start and stop, so a poll that was asked before a stop can tell it was
    let generation = 0;

    // What a failure says can hold what a request held (an address, a header): nothing secret reaches a log
    const say = (message: string, error?: unknown) => log.warn(`[ComputerRunner] ${message}`, error instanceof Error ? redactSecrets(error.message) : '');

    /**
     * Ends the job at Orbit. A failure says whose it was: `ours` (no relay, a machine that would not get ready, turns that kept going wrong,
     * a handover Orbit would not take) is given back to the person by Orbit; `agent` (the agent gave up in its own words, or the job used up
     * every turn it may take) is not. Orbit reads a failure with no cause as the person's, so every failure here names one.
     * The computer's own sentence about why it could not go on (`why`) goes with a failure, for the message that tells the person: Orbit cleans it before it keeps it.
     * With the control generation the turn started on, 'stale' says Orbit found the turn an old one: nothing was ended, and the job is to be read again.
     */
    async function finish(
        job: RunnableJob,
        outcome: 'done' | 'failed',
        options: { cause?: FinishCause; generation?: number; why?: string | null; turns?: number[]; run?: string } = {}
    ): Promise<'ended' | 'stale'> {
        const { cause, generation, why, turns, run } = options;
        let stale = false;
        // Orbit judges a failure from the call rows it holds, so what the relay recorded for this job reaches it BEFORE the finish does (a moment of
        // retry at most: a record that cannot be sent never keeps a job from ending, and Orbit then has the cause below as its only hint)
        if (outcome === 'failed') await deps.refusals?.flush?.(job.jobId)?.catch(() => false);
        const body = {
            action: 'finish',
            outcome,
            ...(outcome === 'failed' && cause ? { cause } : {}),
            ...(outcome === 'failed' && why ? { why } : {}),
            // The turns this runner judged failed (the ones the streak was made of), which Orbit reads against the call rows of each
            // `run` says which run of this runner they were numbered in: turns start again from 1 after a restart, so Orbit reads a named turn
            // only against the rows of that run
            ...(outcome === 'failed' && turns && turns.length > 0 ? { turns: [...turns], ...(run ? { run } : {}) } : {}),
        };
        await orbit.action(job.botId, job.jobId, fenced(body, generation)).catch((error) => {
            if (staleForOrbit(error)) stale = true;
            else say('Could not end a job:', error);
        });
        return stale ? 'stale' : 'ended';
    }

    /** Waits while the person has the machine or the job waits for them. 'back' when it is Brick's again, 'over' when it is not coming back. */
    async function waitForBrick(job: RunnableJob, signal: AbortSignal): Promise<'back' | 'over' | 'stopped'> {
        for (;;) {
            if (signal.aborted) return 'stopped';
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            // undefined: Orbit could not be asked; null: the job is gone
            if (state === null || (state && over(state.status))) return 'over';
            if (state && state.status === 'running' && state.control === 'brick') return 'back';
            await sleep(timing.waitMs, signal);
        }
    }

    /** The relay's address, asked once in a while and not for every turn: what it answered and when. */
    let probed: { relay: string; at: number; result: RelayProbeResult } | null = null;
    const PROBE_KEEP_MS = 60_000;
    async function relayAnswer(relay: string, afresh = false): Promise<RelayProbeResult> {
        if (!deps.relayProbe) return { answer: 'unknown', status: null };
        // A try again is asked of the relay itself: what was kept is for the turns that come one after the other, not for a relay that may have come back
        if (!afresh && probed && probed.relay === relay && now() - probed.at < (probed.result.answer === 'relay' ? PROBE_KEEP_MS : PROBE_KEEP_MS / 6)) return probed.result;
        const result = await deps.relayProbe(relay).catch(() => ({ answer: 'unknown', status: null }) as RelayProbeResult);
        probed = { relay, at: now(), result };
        return result;
    }

    /**
     * Gets the machine ready. `unreachable` when the machine's own way to the relay is proven closed: the address answers as something that is not
     * the relay, or Orbit (which asks the machine itself to call the relay with its own key) says the relay could not be reached. It is tried again
     * as a failure is, since a relay may be coming back up, and only then said. Orbit is told the run with each prepare.
     */
    async function prepared(job: RunnableJob, relay: string, run: string, signal: AbortSignal): Promise<'ready' | 'look' | 'failed' | 'unreachable' | 'stopped'> {
        for (let attempt = 0; ; attempt++) {
            if (signal.aborted) return 'stopped';
            let unreachable = false;
            let answer: { ok: true } | { ok: false; reason: string } = { ok: true };
            const seen = await relayAnswer(relay, attempt > 0);
            // A stop that came while the address was being asked: no prepare is sent for a job that is no longer being worked on
            if (signal.aborted) return 'stopped';
            if (seen.answer === 'wrong') {
                // The job ends here (its own fault row says so): Orbit is not asked to prepare a machine for it
                unreachable = true;
            } else {
                answer = await orbit.prepare(job.jobId, relay, { run }).catch(() => ({ ok: false as const, reason: 'failed' }));
                if ('reason' in answer && answer.reason === 'relay_unreachable') unreachable = true;
            }
            // A stop that came while Orbit was being asked is no failure of the job: nothing is ended on it
            if (signal.aborted) return 'stopped';
            if (!unreachable) {
                if (!('reason' in answer)) return 'ready';
                // The job is not Brick's to work on now (taken over, over, no machine awake): look at it again, do not retry
                if (answer.reason !== 'failed') return 'look';
            }
            if (attempt >= timing.prepareMs.length) return unreachable ? 'unreachable' : 'failed';
            await sleep(timing.prepareMs[attempt], signal);
        }
    }

    /** When a job's room is next asked to be renewed. Each renewal holds more room, so it is by the clock across turns, never once per turn. */
    interface Renewing {
        nextAt: number;
    }

    /** Whether the agent has taken a turn of this job yet: until it has, the job's own first words are still the ones to send. */
    interface Accepted {
        turn: boolean;
        /** Set by `oneTurn` when it took up a turn that was already going (a reconnect to it, or Orbit said the agent was busy with one) instead of starting it. */
        joined?: boolean;
    }

    /** Sends one turn (or reconnects to the one going) and reads it to its end, renewing the job's room as Orbit says while it does. */
    async function oneTurn(job: RunnableJob, input: string | null, signal: AbortSignal, renewing: Renewing, accepted: Accepted, generation: number | undefined, since: Since | null, seenFromStart: () => boolean): Promise<TurnResult> {
        // A stop that came while the machine was being made ready has already fired: its listener would never be told
        if (signal.aborted) return { kind: 'stopped' };
        const turnController = new AbortController();
        const onStop = () => turnController.abort();
        signal.addEventListener('abort', onStop, { once: true });
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let lost = false;
        // Every call of this turn refused for want of room in the shared pool, for as long as the runner waits: Hermes would go on trying for minutes with the
        // machine awake and costing, so the turn is stopped here and the machine given up
        let poolTimer: ReturnType<typeof setTimeout> | undefined;
        let poolWatch: ReturnType<typeof setTimeout> | undefined;
        let gaveUp = false;
        // Only for a turn this process saw from its beginning: after a restart the notes know nothing of a call that was taken up before it, so a turn taken up
        // by reconnecting is not judged pool-only from the refusals seen since (the turns it starts itself, and Orbit's own record, still are)
        const poolBusy = () => since !== null && seenFromStart() && deps.refusals?.onlyPoolBusySince?.(job.jobId, since) === true;
        // Looked at again at the end of the wait: a call taken up meanwhile means the pool has room again, and that includes a call taken up by the relay of
        // ANOTHER bot server (the machine's calls reach whichever one the load balancer picks, and this server's own notes know only its own)
        const giveUpIfStill = async () => {
            if (turnController.signal.aborted || !poolBusy()) return;
            if (since !== null && deps.refusals?.acceptedAnywhereSince) {
                let taken = true;
                try {
                    taken = await deps.refusals.acceptedAnywhereSince(job.jobId, since);
                } catch {
                    taken = true;
                }
                if (taken) return;
                // The read took a moment: the turn may have ended, or a call been taken up here, meanwhile
                if (turnController.signal.aborted || !poolBusy()) return;
            }
            gaveUp = true;
            turnController.abort();
            void orbit.cancel(job.jobId).catch(() => undefined);
        };
        const watchPool = () => {
            if (turnController.signal.aborted) return;
            if (poolBusy()) {
                poolTimer ??= setTimeout(() => {
                    poolTimer = undefined;
                    void giveUpIfStill();
                }, timing.poolGiveUpMs ?? RUNNER_TIMING.poolGiveUpMs);
            } else if (poolTimer) {
                clearTimeout(poolTimer);
                poolTimer = undefined;
            }
            poolWatch = setTimeout(watchPool, timing.poolCheckMs ?? RUNNER_TIMING.poolCheckMs);
        };
        if (since !== null && deps.refusals?.onlyPoolBusySince) watchPool();
        const renew = async () => {
            if (turnController.signal.aborted) return;
            try {
                const answer = await orbit.action(job.botId, job.jobId, fenced({ action: 'renew' }, generation));
                // An answer that comes after its turn ended is not this turn's to use: a newer turn may hold a newer deadline by now
                if (turnController.signal.aborted) return;
                if (answer.ok === false) {
                    // Its room is gone and Orbit has stopped it: the agent stops too
                    lost = true;
                    turnController.abort();
                    await orbit.cancel(job.jobId).catch(() => undefined);
                    return;
                }
                const next = typeof answer.renewInSeconds === 'number' && answer.renewInSeconds >= 5 ? answer.renewInSeconds : 120;
                renewing.nextAt = now() + next * 1000;
                renewTimer = setTimeout(() => void renew(), next * 1000);
            } catch (error) {
                if (turnController.signal.aborted) return;
                // Orbit answered and refused (the job is over or gone): the agent stops, as when it says the room is gone
                if (refusedByOrbit(error)) {
                    lost = true;
                    turnController.abort();
                    await orbit.cancel(job.jobId).catch(() => undefined);
                    return;
                }
                // Orbit could not be reached: try again soon, the room is held for a while yet
                say('Could not renew a job:', error);
                renewing.nextAt = now() + 15_000;
                renewTimer = setTimeout(() => void renew(), 15_000);
            }
        };
        try {
            if (now() >= renewing.nextAt) await renew();
            else renewTimer = setTimeout(() => void renew(), Math.max(1000, renewing.nextAt - now()));
            if (lost) return { kind: 'look', cancelled: true };

            let words = '';
            let stepDone = 0;
            let label: string | null = null;
            let lastReport = 0;
            let reported = -1;
            const report = async (force = false) => {
                const at = Date.now();
                if (!force && at - lastReport < timing.progressMs) return;
                if (stepDone === reported && !label) return;
                lastReport = at;
                reported = stepDone;
                await orbit.action(job.botId, job.jobId, fenced({ action: 'progress', stepDone, label }, generation)).catch(async (error) => {
                    // This turn is an old one (the job changed hands or paused): it stops being acted on, and the job is read again
                    if (!staleForOrbit(error) || turnController.signal.aborted) return;
                    lost = true;
                    turnController.abort();
                    await orbit.cancel(job.jobId).catch(() => undefined);
                });
            };

            // A turn that was stopped here (the pool had no room, the job's room was gone, a stop) before its stream opened, or while it waited to
            // reconnect, makes the call to open it fail with the abort itself: that is the stop, never an error that leaves the turn
            const opening = async <T>(open: () => Promise<T>): Promise<T | typeof STOPPED_HERE> => {
                try {
                    return await open();
                } catch (error) {
                    if (turnController.signal.aborted) return STOPPED_HERE;
                    throw error;
                }
            };
            const stoppedHere = (): TurnResult => (signal.aborted ? { kind: 'stopped' } : gaveUp ? { kind: 'poolBusy' } : { kind: 'look', cancelled: true });
            // A turn taken up with no input is one that was already going: this process has not seen its beginning
            if (input === null) accepted.joined = true;
            const first = await opening(() => (input === null ? orbit.stream(job.jobId, turnController.signal) : orbit.turn(job.jobId, input, turnController.signal)));
            if (first === STOPPED_HERE) return stoppedHere();
            let opened: TurnOpened = first;
            // The agent is still on a turn of its own (we lost it, or Orbit restarted): read that one instead of starting another
            if ('reason' in opened && opened.reason === 'busy') {
                // The agent was on a turn that this process did not start
                accepted.joined = true;
                const again = await opening(() => orbit.stream(job.jobId, turnController.signal));
                if (again === STOPPED_HERE) return stoppedHere();
                opened = again;
            }
            if ('reason' in opened) {
                // A turn that is gone is no silence of the agent's: it counts as a failed turn, like one lost on a reconnect
                if (opened.reason === 'no_turn') return { kind: 'ended', words: '', failed: true, fenced: false };
                return opened.reason === 'failed' ? { kind: 'ended', words: '', failed: true, fenced: false } : { kind: 'look' };
            }

            accepted.turn = true;
            let reconnects = 0;
            for (;;) {
                let terminal: { failed: boolean; fenced: boolean; code: string } | null = null;
                try {
                    for await (const event of opened.events) {
                        if (event.type === 'text') words = (words + event.text).slice(-RUNNER_GUARDS.maxWords);
                        else if (event.type === 'tool') {
                            if (event.state === 'started' && event.label) label = safeStepLabel(event.label);
                            if (event.state === 'completed') {
                                stepDone += 1;
                                await report();
                            }
                        } else if (event.type === 'completed') {
                            words = event.outputText ? event.outputText.slice(-RUNNER_GUARDS.maxWords) : words;
                            terminal = { failed: false, fenced: false, code: '' };
                        } else if (event.type === 'failed') {
                            terminal = { failed: true, fenced: event.code === 'fenced', code: event.code };
                        }
                    }
                } catch (error) {
                    if (!turnController.signal.aborted) say('A turn stream broke:', error);
                    terminal = terminal ?? { failed: true, fenced: false, code: 'stream_broke' };
                }
                if (signal.aborted) return { kind: 'stopped' };
                if (gaveUp) return { kind: 'poolBusy' };
                if (lost) return { kind: 'look', cancelled: true };
                await report(true);
                // The last report can be the first one the job answers as stale: the turn is lost then, and is not read as ended
                if (lost) return { kind: 'look', cancelled: true };
                if (terminal && terminal.code !== 'stream_broke' && terminal.code !== 'stream_ended') return { kind: 'ended', words, failed: terminal.failed, fenced: terminal.fenced };
                // The connection ended before the turn did: reconnect to it, a few times, then let the next look decide
                if (reconnects >= timing.reconnectMs.length) return { kind: 'ended', words, failed: true, fenced: false };
                await sleep(timing.reconnectMs[reconnects], turnController.signal);
                reconnects += 1;
                const again = await opening(() => orbit.stream(job.jobId, turnController.signal));
                if (again === STOPPED_HERE) return stoppedHere();
                // A turn that is gone without its end having been seen is not a turn that ended well: what was said before is not taken as its ending
                if ('reason' in again) return again.reason === 'no_turn' ? { kind: 'ended', words, failed: true, fenced: false } : { kind: 'look' };
                opened = again;
            }
        } finally {
            if (renewTimer) clearTimeout(renewTimer);
            if (poolTimer) clearTimeout(poolTimer);
            if (poolWatch) clearTimeout(poolWatch);
            signal.removeEventListener('abort', onStop);
            turnController.abort();
        }
    }

    /** True only when no call of the job's turn reached the relay of ANY bot server (this one's notes first, then the others'). Without the notes to tell: false. */
    async function noCallReachedAnyRelay(jobId: string, since: Since): Promise<boolean> {
        const refusals = deps.refusals;
        if (!refusals) return false;
        try {
            if (refusals.calledAnywhereSince) return !(await refusals.calledAnywhereSince(jobId, since));
            return refusals.calledSince ? !refusals.calledSince(jobId, since) : false;
        } catch {
            return false;
        }
    }

    /** A confirmed fault of ours on a turn: the machine could not get to the relay (nothing of the job's can cause that). Noted for Orbit's record and for this runner. */
    function noteNoRelay(job: RunnableJob, turn: number, run: string, why: 'prepare' | 'no_call'): void {
        deps.refusals?.record?.(job.botId, job.jobId, {
            callId: `${why === 'prepare' ? 'relay_unreachable' : 'no_call'}_${run}_${turn}`,
            kind: 'fault',
            reason: 'relay_down',
            source: 'universe-ai',
            route: 'unknown',
            providerStatus: null,
            turn,
            run,
        });
    }

    /** A confirmed fault of ours on a turn: the shared pool had no room for any call of it. Noted for Orbit's record and for this runner. */
    function notePoolBusy(job: RunnableJob, turn: number, run: string): void {
        deps.refusals?.record?.(job.botId, job.jobId, {
            callId: `pool_busy_gave_up_${run}_${turn}`,
            kind: 'fault',
            reason: 'pool_busy',
            source: 'universe-ai',
            route: 'unknown',
            providerStatus: 503,
            turn,
            run,
        });
    }

    async function work(job: RunnableJob, signal: AbortSignal): Promise<void> {
        if (!deps.relayUrl) {
            log.error('[ComputerRunner] A job cannot run: no address is set for the model relay (COMPUTER_RELAY_URL or BOT_SERVER_URL).');
            await finish(job, 'failed', { cause: 'ours' });
            return;
        }
        // The job's own first words stay the ones to send until the agent has taken a turn: a turn that could not be started, or a take-over
        // before it, must not leave the agent with only "carry on" and no brief
        let pending: string | null = job.hasTurn ? null : jobPrompt(job);
        let input: string | null = pending;
        const follow = (prompt: string) => pending ?? prompt;
        const renewing: Renewing = { nextAt: 0 };
        const accepted: Accepted = { turn: false };
        let turns = 0;
        let bad = 0;
        // This run of the job's work: turns are numbered from 1 in each run, and a run begins again when the bot server restarts and takes the job up
        // (or when the job is taken up again in this process), so the rows of the calls and the finish name the run along with the turns
        const run = (deps.runId ?? newRunId)();
        // The generation the last turn started on: a job that was taken and given back between two turns is read on a later one
        let lastGeneration: number | undefined;
        // Whether any turn of the bad streak was not a failure of ours (the agent said nothing, or the person's allowance or a rule stopped it)
        let notOurs = false;
        // Whether a bad turn of the streak had a confirmed fault of Universe's (kind `fault` in the relay's record), and which turns the streak was made of
        let confirmed = false;
        let badTurns: number[] = [];
        // The number of the turn being read (see where a turn begins)
        let turnNo = 0;
        // Where the turn being read began. It is kept while the same turn is read again after a reconnect that could not be made (a refusal
        // that came before it must still be seen), and starts again with the next turn or after the person had the machine
        let turnStartedAt: Since | null = null;
        // Whether this process saw the turn being read from its beginning: it sent the turn's input itself (and the agent was not already on one). The relay's
        // notes of the calls live in this process, so after a restart of the bot server a turn that is taken up by reconnecting has calls this process
        // never saw: nothing is concluded from their absence
        let seenFromStart = false;
        for (;;) {
            if (signal.aborted) return;
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            if (state === null || (state && over(state.status))) return;
            if (state === undefined) {
                // Orbit could not be asked: wait a moment and ask again
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (state.status !== 'running' || state.control !== 'brick') {
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                // The person had the machine: what came before is no part of the job's next streak, nor of the next turn's window
                turnStartedAt = null;
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
                input = follow(RESUME_PROMPT);
                continue;
            }
            // The control generation this turn starts on: every action it takes for the job carries it, so one from an older turn changes nothing
            const generation = state.generation;
            // The person took the machine and gave it back after the last turn's closing read: this is not a plain "carry on", the agent looks at the page first
            if (lastGeneration !== undefined && generation !== undefined && generation !== lastGeneration) {
                input = follow(RESUME_PROMPT);
                // Control changed hands between two turns: the streak before it, and the turn's number and window, are not carried over
                turnStartedAt = null;
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
            }
            lastGeneration = generation;
            // An action refused as stale: the job changed hands or paused meanwhile. It is read again, and this turn's words are not acted on
            const readAgain = async () => {
                input = follow(RESUME_PROMPT);
                await sleep(timing.waitMs, signal);
            };
            if (++turns > RUNNER_GUARDS.maxTurns) {
                say('A job took more turns than allowed and was ended.');
                if ((await finish(job, 'failed', { cause: 'agent', generation })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            const ready = await prepared(job, deps.relayUrl, run, signal);
            if (ready === 'stopped') return;
            if (ready === 'look') {
                // Waiting for the machine is not a turn: it must not use up the turns a job is allowed
                turns--;
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (ready === 'failed') {
                if ((await finish(job, 'failed', { cause: 'ours', generation })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            if (ready === 'unreachable') {
                // The machine cannot reach our own model service: a confirmed fault of ours (nothing the job or the person did can cause it), noted on
                // a turn of this run so Orbit reads it against the turn it is told of, and said to the person in plain words
                turnNo += 1;
                deps.refusals?.turn?.(job.jobId, turnNo, run);
                say('A job ended: the machine could not reach the model relay (check COMPUTER_RELAY_URL).');
                noteNoRelay(job, turnNo, run, 'prepare');
                if ((await finish(job, 'failed', { cause: 'ours', generation, turns: [turnNo], run, why: RELAY_UNREACHABLE_WHY })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }

            // A turn is numbered when it begins, and keeps its number while it is read again after a reconnect: the relay stamps the rows of the calls
            // made in it with the number, and the number is what the finish names, so both must mean the same turn
            let freshWindow = false;
            if (turnStartedAt === null) {
                // A point in the order of events when the notes can give one (events of the same millisecond are told apart), else the moment
                turnStartedAt = deps.refusals?.mark?.() ?? now();
                turnNo += 1;
                freshWindow = true;
                seenFromStart = true;
            }
            deps.refusals?.turn?.(job.jobId, turnNo, run);
            accepted.joined = false;
            const result = await oneTurn(job, input, signal, renewing, accepted, generation, turnStartedAt, () => seenFromStart && !(freshWindow && accepted.joined));
            if (freshWindow && accepted.joined) seenFromStart = false;
            if (accepted.turn) pending = null;
            if (result.kind === 'stopped') return;
            if (result.kind === 'poolBusy') {
                // Every call of the turn was refused for want of room: a confirmed fault of ours (nothing the job or the person did can cause it), noted on
                // this turn of this run, and the job is ended in plain words without waiting out the retries of the machine
                turnStartedAt = null;
                say('A job ended: every model call of its turn was refused for want of room in the shared pool.');
                notePoolBusy(job, turnNo, run);
                if ((await finish(job, 'failed', { cause: 'ours', generation, turns: [turnNo], run, why: POOL_BUSY_WHY })) === 'stale') {
                    input = follow(RESUME_PROMPT);
                    await sleep(timing.waitMs, signal);
                    continue;
                }
                return;
            }
            if (result.kind === 'look') {
                // A turn that was stopped here is not reconnected to: the agent is told to look at the page again before it goes on
                // A turn the agent has taken is not sent again: the next try reconnects to it (a turn that is gone says so there)
                if (result.cancelled) {
                    input = follow(RESUME_PROMPT);
                    // The turn was stopped: the replacement is a new turn, with its own number and its own window (it must not inherit a fault noted in
                    // the one that was cancelled). Only a reconnect to the same turn keeps them
                    turnStartedAt = null;
                } else if (accepted.turn) input = null;
                await sleep(timing.waitMs, signal);
                continue;
            }

            // The turn has ended: its refusal window is read once, and the next turn starts its own
            const readFrom = turnStartedAt;
            const sawItAll = seenFromStart;
            turnStartedAt = null;

            // Only what Orbit still says is Brick's is acted on: if the person took over meanwhile, their hands win and the words are dropped.
            // An Orbit that cannot be asked is not a yes: the words wait for it, and the agent is nudged on instead
            let after: Awaited<ReturnType<RunnerOrbit['job']>> | undefined;
            for (let attempt = 0; attempt < RUNNER_GUARDS.maxBadTurns && after === undefined; attempt++) {
                if (attempt > 0) await sleep(timing.waitMs, signal);
                after = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            }
            if (signal.aborted) return;
            if (after === undefined) {
                input = follow(CONTINUE_PROMPT);
                continue;
            }
            if (after === null || over(after.status)) return;
            if (after.status !== 'running' || after.control !== 'brick') {
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                input = follow(RESUME_PROMPT);
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
                continue;
            }
            // The job changed hands or paused while the turn went on (even if it is Brick's again): the turn is an old one, so its words are
            // not acted on, and the agent is told to look at where things stand
            if (generation !== undefined && after.generation !== undefined && after.generation !== generation) {
                input = follow(RESUME_PROMPT);
                // Every reset of the streak clears all of it: a silent or refused turn from before the person had the machine must not make
                // the next streak "not ours"
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
                continue;
            }
            if (result.fenced) {
                input = follow(RESUME_PROMPT);
                continue;
            }

            // A turn that was cut off may have said its marker, but the machine's turn may still be running: no ending is taken from it
            const ending = result.failed ? ({ kind: 'none' } as const) : endingOf(result.words);
            if (ending.kind === 'done' || ending.kind === 'failed') {
                const ended = ending.kind === 'done' ? await finish(job, 'done', { generation }) : await finish(job, 'failed', { cause: 'agent', generation, why: whyOf(result.words) });
                if (ended === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            if (ending.kind === 'handover') {
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
                // The person is only told to come when Orbit took the handover: if it did not, waiting would take the job straight
                // back to Brick as if they had finished, so it is asked again, and a job that cannot be handed over is ended
                let handed = false;
                let stale = false;
                // Orbit answered no at least once: then it is not Orbit that could not be reached, and the failure is not ours to answer for
                let refusedHandover = false;
                for (let attempt = 0; attempt < RUNNER_GUARDS.maxBadTurns && !handed && !stale; attempt++) {
                    if (signal.aborted) return;
                    if (attempt > 0) await sleep(timing.waitMs, signal);
                    handed = await orbit
                        .action(
                            job.botId,
                            job.jobId,
                            fenced(
                                {
                                    action: 'handover',
                                    waitingFor: ending.waitingFor,
                                    ...(ending.waitingFor === 'details' && ending.what && ending.where ? { ready: { what: ending.what, where: ending.where } } : {}),
                                },
                                generation
                            )
                        )
                        // An answer that says it was refused (ok false) is no handover
                        .then((answer) => {
                            if (answer.ok === false) refusedHandover = true;
                            return answer.ok !== false;
                        })
                        .catch((error) => {
                            // An old turn's handover is no failure to hand over: the job is read again, and not ended
                            if (staleForOrbit(error)) {
                                stale = true;
                                return false;
                            }
                            say('Could not hand over:', error);
                            // A refusal Orbit gave as an error status is a no all the same; only an Orbit that could not be reached is ours
                            if (orbitSaidNo(error)) refusedHandover = true;
                            return false;
                        });
                }
                if (stale) {
                    await readAgain();
                    continue;
                }
                if (!handed) {
                    if ((await finish(job, 'failed', { cause: refusedHandover ? 'agent' : 'ours', generation })) === 'stale') {
                        await readAgain();
                        continue;
                    }
                    return;
                }
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                input = follow(RESUME_PROMPT);
                continue;
            }
            // No ending said: carry on, but not for ever when turns keep going wrong
            // A bad turn is one that failed, said nothing, or ended on a fault of ours. It is Universe's failure only when the turn really failed
            // (a model or transport error, a stream that broke) and nothing of the person's (their allowance, a rule of theirs) stopped it: a
            // turn with no words at all can be what the job asked for ("never reply in text"), so it is the agent's, and the streak is ours
            // only when every turn of it was ours. A refusal only decides whose a bad turn is: a turn that went on and said something after one
            // call was refused is no bad turn (the agent got round it), so a job is never ended for refusals it recovered from.
            // Hermes can hand an error of ours back as a finished turn, with the error as its words or with none: the relay says whether the
            // turn's last call failed for a fault of ours (nothing answered after it), and then the turn is a bad one that is ours, words or not
            const silent = !result.failed && result.words.trim() === '';
            const endedOnOurFault = () => (!result.failed && readFrom !== null && deps.refusals?.endedOnFault?.(job.jobId, readFrom)) || false;
            let ourFault = endedOnOurFault();
            let badTurn = result.failed || silent || ourFault;
            // A turn that failed or said nothing and in which no call of the job ever reached the relay: the machine could not get to it (or never
            // tried), and the model is ours, so no word of the job's made it fail. A confirmed fault of ours, noted before the streak is read
            // Only for a turn this process saw from its beginning: one taken up by reconnecting (after a restart of the bot server) may have made calls before
            // Calls land on whichever bot server the load balancer picks, so "none reached this server" is not "none reached the relay": the other servers are
            // asked too (through the shared store), and when that cannot be told nothing is concluded
            let noCall = false;
            if (badTurn && sawItAll && readFrom !== null) {
                noCall = await noCallReachedAnyRelay(job.jobId, readFrom);
                // The job was stopped while the other servers were asked: nothing of this turn is recorded or ended on, and no finish is sent for it
                if (signal.aborted) return;
                // The asking took a moment, in which a call of the turn may have been answered (a recovery): the turn is judged, and attributed below, by the
                // state of the notes NOW, one state for both
                ourFault = endedOnOurFault();
                badTurn = result.failed || silent || ourFault;
            }
            if (badTurn) {
                const refused = (readFrom !== null && deps.refusals?.sawSince(job.jobId, readFrom)) || false;
                if (noCall && readFrom !== null) noteNoRelay(job, turnNo, run, 'no_call');
                bad += 1;
                badTurns.push(turnNo);
                // A confirmed fault of Universe's in any turn of the streak (our key refused, no route, no room, a model gone) makes the ending ours, whatever
                // else the streak held: a silent turn followed by two documented failures on our key must not become the person's expense
                if (readFrom !== null && deps.refusals?.confirmedSince?.(job.jobId, readFrom)) confirmed = true;
                if (refused || (silent && !ourFault)) notOurs = true;
            } else {
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
            }
            if (bad >= RUNNER_GUARDS.maxBadTurns) {
                say('A job kept failing to answer and was ended.');
                // The cause is a hint: Orbit reads the call rows of each turn named here. A confirmed fault anywhere in the streak is ours; else the person's
                // side (a silent turn, their allowance or a rule) makes it the agent's; else it is unresolved, for Orbit's bounded goodwill
                const cause: FinishCause = confirmed ? 'ours' : notOurs ? 'agent' : 'ours';
                if ((await finish(job, 'failed', { cause, generation, turns: badTurns, run })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            input = follow(CONTINUE_PROMPT);
        }
    }

    async function tick(): Promise<void> {
        if (stopped) return;
        const mine = generation;
        let jobs: RunnableJob[];
        try {
            jobs = await orbit.running();
        } catch (error) {
            say('Could not read the running jobs:', error);
            return;
        }
        // The runner was stopped (or stopped and started again) while Orbit was asked: this answer is from before, and starts nothing
        if (stopped || mine !== generation) return;
        for (const job of jobs) {
            if (workers.has(job.jobId) || workers.size >= RUNNER_GUARDS.maxJobs) continue;
            const controller = new AbortController();
            const done = work(job, controller.signal)
                .catch((error) => say('A job stopped on an error:', error))
                .finally(() => workers.delete(job.jobId));
            workers.set(job.jobId, { controller, done });
        }
    }

    return {
        tick,
        start(everyMs) {
            stopped = false;
            generation += 1;
            if (timer) clearInterval(timer);
            timer = setInterval(() => void tick(), everyMs);
            timer.unref?.();
            void tick();
        },
        stop() {
            stopped = true;
            generation += 1;
            if (timer) clearInterval(timer);
            timer = undefined;
            for (const { controller } of workers.values()) controller.abort();
        },
        active: () => [...workers.keys()],
        idle: async () => {
            while (workers.size > 0) await Promise.all([...workers.values()].map((worker) => worker.done));
        },
    };
}

/** The runner's view of Orbit, over the bot server's own calls to it. */
export function runnerOrbitFor(admin: Pick<AdminApiService, 'computerRunningJobs' | 'getComputerJob' | 'computerJobAction' | 'computerBroker' | 'computerOpenTurn'>): RunnerOrbit {
    const opened = async (jobId: string, step: 'turn' | 'stream', input: string | null, signal: AbortSignal): Promise<TurnOpened> => {
        const answer = await admin.computerOpenTurn(jobId, step, input, signal);
        if ('body' in answer) return { ok: true, events: readRunnerEvents(answer.body) };
        return { ok: false, reason: answer.status >= 500 ? 'failed' : answer.reason, ...(answer.responseId ? { responseId: answer.responseId } : {}) };
    };
    return {
        running: () => admin.computerRunningJobs(),
        job: async (botId, jobId) => {
            const job = await admin.getComputerJob(botId, jobId);
            return job ? { status: job.status, control: job.control, ...(job.generation === undefined ? {} : { generation: job.generation }) } : null;
        },
        action: (botId, jobId, body) => admin.computerJobAction(botId, jobId, body),
        prepare: async (jobId, relay, extra) => {
            const answer = await admin.computerBroker(jobId, 'prepare', { relay, ...extra });
            if (answer.status === 200 && answer.data.ok === true) return { ok: true };
            return { ok: false, reason: answer.status >= 500 || typeof answer.data.reason !== 'string' ? 'failed' : answer.data.reason };
        },
        turn: (jobId, input, signal) => opened(jobId, 'turn', input, signal),
        stream: (jobId, signal) => opened(jobId, 'stream', null, signal),
        cancel: async (jobId) => {
            await admin.computerBroker(jobId, 'cancel', {});
        },
    };
}

/**
 * Where the model relay is, for the machine to call, in this order: the address chosen for it (COMPUTER_RELAY_URL), the bot server's public
 * address (BOT_SERVER_URL), else the one the play server's public address implies (its first name replaced by `bot-server`, the same rule
 * the game's own front uses). The last is only used when it is an https address; an internal one (http, or a bare host) is no door a machine
 * outside could use. Null when none fits, and the job then ends with a clear line rather than hand the machine an address it cannot reach.
 */
export function relayUrlFromEnv(env: NodeJS.ProcessEnv = process.env, log: Pick<Console, 'error'> = console): string | null {
    const clean = (text: string) => text.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    const chosen = clean(env.COMPUTER_RELAY_URL || env.BOT_SERVER_URL || '');
    if (chosen) {
        // A bare host or a path is no address a machine can call: it is refused here rather than handed to the machine
        try {
            return /^https?:$/.test(new URL(chosen).protocol) ? chosen : null;
        } catch {
            return null;
        }
    }
    try {
        const pusher = new URL((env.PUSHER_URL || env.WORKADVENTURE_URL || '').trim());
        const labels = pusher.hostname.split('.');
        if (pusher.protocol !== 'https:' || labels.length < 3 || /^[0-9.]+$/.test(pusher.hostname)) return null;
        labels[0] = 'bot-server';
        const derived = `https://${labels.join('.')}${pusher.port ? `:${pusher.port}` : ''}`;
        // A guess, and one that can be another environment's host (a development server derives the production name): said once, with the host only
        log.error(`[ComputerRunner] Neither COMPUTER_RELAY_URL nor BOT_SERVER_URL is set: the model relay is assumed to be at ${new URL(derived).host}, taken from the play address. If that is not THIS environment's bot server, machines cannot reach the relay and every job fails: set COMPUTER_RELAY_URL.`);
        return derived;
    } catch {
        return null;
    }
}
