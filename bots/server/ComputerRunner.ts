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

import type { AdminApiService } from './AdminApiService';
import { readRunnerEvents } from './ComputerTurnStream';

export type RunnerEvent =
    | { type: 'created'; id: string; sessionId: string | null }
    | { type: 'text'; text: string }
    | { type: 'tool'; state: 'generating' | 'started' | 'completed' | 'failed'; tool: string; label?: string; durationMs?: number; error?: string }
    | { type: 'completed'; outputText: string; usage: { inputTokens: number | null; outputTokens: number | null } | null }
    | { type: 'failed'; code: string; message: string }
    | { type: 'keepalive' };

export interface RunnableJob {
    jobId: string;
    botId: string;
    title: string;
    brief: string | null;
    writes: boolean;
    hasTurn: boolean;
}

export type TurnOpened = { ok: true; events: AsyncIterable<RunnerEvent> } | { ok: false; reason: string; responseId?: string };

export interface RunnerOrbit {
    running(): Promise<RunnableJob[]>;
    /**
     * The job as Orbit has it, or null when it is gone. `generation` is the job's control generation: it moves when the person takes the machine
     * or gives it back, and when the job pauses or resumes. Absent from an Orbit that does not give it (nothing is then sent or checked).
     */
    job(botId: string, jobId: string): Promise<{ status: string; control: string; generation?: number } | null>;
    action(botId: string, jobId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    prepare(jobId: string, relay: string): Promise<{ ok: true } | { ok: false; reason: string }>;
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
}

export const RUNNER_TIMING: RunnerTiming = { waitMs: 5000, progressMs: 4000, reconnectMs: [1000, 3000, 8000, 20_000], prepareMs: [2000, 6000] };

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
    return last ? last.slice(-300) : null;
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

/** An answer from Orbit that says no (a 4xx, other than "slow down" or "try again"), as opposed to an Orbit that could not be reached. */
function refusedByOrbit(error: unknown): boolean {
    const status = typeof error === 'object' && error !== null && 'response' in error ? (error as { response?: { status?: unknown } }).response?.status : undefined;
    return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429;
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

type TurnResult =
    /** The turn ended and what the agent said is here (it may be empty). */
    | { kind: 'ended'; words: string; failed: boolean; fenced: boolean }
    /** Orbit or the job changed under it: look at the job again. */
    | { kind: 'look' }
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

    const say = (message: string, error?: unknown) => log.warn(`[ComputerRunner] ${message}`, error instanceof Error ? error.message : '');

    /** Ends the job. 'stale' when Orbit says the turn this comes from is an old one: nothing was ended, and the job is to be read again. */
    async function finish(job: RunnableJob, outcome: 'done' | 'failed', generation?: number, why?: string | null): Promise<'ended' | 'stale'> {
        let stale = false;
        // The computer's own sentence about why it could not go on goes with a failure, for the message that tells the person: Orbit cleans it before it keeps it
        const body = { action: 'finish', outcome, ...(outcome === 'failed' && why ? { why } : {}) };
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

    async function prepared(job: RunnableJob, relay: string, signal: AbortSignal): Promise<'ready' | 'look' | 'failed' | 'stopped'> {
        for (let attempt = 0; ; attempt++) {
            if (signal.aborted) return 'stopped';
            const answer = await orbit.prepare(job.jobId, relay).catch(() => ({ ok: false as const, reason: 'failed' }));
            // A stop that came while Orbit was being asked is no failure of the job: nothing is ended on it
            if (signal.aborted) return 'stopped';
            if (!('reason' in answer)) return 'ready';
            // The job is not Brick's to work on now (taken over, over, no machine awake): look at it again, do not retry
            if (answer.reason !== 'failed') return 'look';
            if (attempt >= timing.prepareMs.length) return 'failed';
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
    }

    /** Sends one turn (or reconnects to the one going) and reads it to its end, renewing the job's room as Orbit says while it does. */
    async function oneTurn(job: RunnableJob, input: string | null, signal: AbortSignal, renewing: Renewing, accepted: Accepted, generation: number | undefined): Promise<TurnResult> {
        // A stop that came while the machine was being made ready has already fired: its listener would never be told
        if (signal.aborted) return { kind: 'stopped' };
        const turnController = new AbortController();
        const onStop = () => turnController.abort();
        signal.addEventListener('abort', onStop, { once: true });
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let lost = false;
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
            if (lost) return { kind: 'look' };

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

            let opened: TurnOpened = input === null ? await orbit.stream(job.jobId, turnController.signal) : await orbit.turn(job.jobId, input, turnController.signal);
            // The agent is still on a turn of its own (we lost it, or Orbit restarted): read that one instead of starting another
            if ('reason' in opened && opened.reason === 'busy') opened = await orbit.stream(job.jobId, turnController.signal);
            if ('reason' in opened) {
                if (opened.reason === 'no_turn') return { kind: 'ended', words: '', failed: false, fenced: false };
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
                            if (event.state === 'started' && event.label) label = event.label;
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
                if (lost) return { kind: 'look' };
                await report(true);
                if (terminal && terminal.code !== 'stream_broke' && terminal.code !== 'stream_ended') return { kind: 'ended', words, failed: terminal.failed, fenced: terminal.fenced };
                // The connection ended before the turn did: reconnect to it, a few times, then let the next look decide
                if (reconnects >= timing.reconnectMs.length) return { kind: 'ended', words, failed: true, fenced: false };
                await sleep(timing.reconnectMs[reconnects], turnController.signal);
                reconnects += 1;
                const again = await orbit.stream(job.jobId, turnController.signal);
                // A turn that is gone without its end having been seen is not a turn that ended well: what was said before is not taken as its ending
                if ('reason' in again) return again.reason === 'no_turn' ? { kind: 'ended', words, failed: true, fenced: false } : { kind: 'look' };
                opened = again;
            }
        } finally {
            if (renewTimer) clearTimeout(renewTimer);
            signal.removeEventListener('abort', onStop);
            turnController.abort();
        }
    }

    async function work(job: RunnableJob, signal: AbortSignal): Promise<void> {
        if (!deps.relayUrl) {
            log.error('[ComputerRunner] A job cannot run: no address is set for the model relay (COMPUTER_RELAY_URL or BOT_SERVER_URL).');
            await finish(job, 'failed');
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
                input = follow(RESUME_PROMPT);
                continue;
            }
            // The control generation this turn starts on: every action it takes for the job carries it, so one from an older turn changes nothing
            const generation = state.generation;
            // An action refused as stale: the job changed hands or paused meanwhile. It is read again, and this turn's words are not acted on
            const readAgain = async () => {
                input = follow(RESUME_PROMPT);
                await sleep(timing.waitMs, signal);
            };
            if (++turns > RUNNER_GUARDS.maxTurns) {
                say('A job took more turns than allowed and was ended.');
                if ((await finish(job, 'failed', generation)) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            const ready = await prepared(job, deps.relayUrl, signal);
            if (ready === 'stopped') return;
            if (ready === 'look') {
                // Waiting for the machine is not a turn: it must not use up the turns a job is allowed
                turns--;
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (ready === 'failed') {
                if ((await finish(job, 'failed', generation)) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }

            const result = await oneTurn(job, input, signal, renewing, accepted, generation);
            if (accepted.turn) pending = null;
            if (result.kind === 'stopped') return;
            if (result.kind === 'look') {
                // A turn the agent has taken is not sent again: the next try reconnects to it (a turn that is gone says so there)
                if (accepted.turn) input = null;
                await sleep(timing.waitMs, signal);
                continue;
            }

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
                continue;
            }
            // The job changed hands or paused while the turn went on (even if it is Brick's again): the turn is an old one, so its words are
            // not acted on, and the agent is told to look at where things stand
            if (generation !== undefined && after.generation !== undefined && after.generation !== generation) {
                input = follow(RESUME_PROMPT);
                bad = 0;
                continue;
            }
            if (result.fenced) {
                input = follow(RESUME_PROMPT);
                continue;
            }

            // A turn that was cut off may have said its marker, but the machine's turn may still be running: no ending is taken from it
            const ending = result.failed ? ({ kind: 'none' } as const) : endingOf(result.words);
            if (ending.kind === 'done' || ending.kind === 'failed') {
                if ((await finish(job, ending.kind, generation, ending.kind === 'failed' ? whyOf(result.words) : undefined)) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            if (ending.kind === 'handover') {
                bad = 0;
                // The person is only told to come when Orbit took the handover: if it did not, waiting would take the job straight
                // back to Brick as if they had finished, so it is asked again, and a job that cannot be handed over is ended
                let handed = false;
                let stale = false;
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
                        .then((answer) => answer.ok !== false)
                        .catch((error) => {
                            // An old turn's handover is no failure to hand over: the job is read again, and not ended
                            if (staleForOrbit(error)) stale = true;
                            else say('Could not hand over:', error);
                            return false;
                        });
                }
                if (stale) {
                    await readAgain();
                    continue;
                }
                if (!handed) {
                    if ((await finish(job, 'failed', generation)) === 'stale') {
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
            bad = result.failed || result.words.trim() === '' ? bad + 1 : 0;
            if (bad >= RUNNER_GUARDS.maxBadTurns) {
                say('A job kept failing to answer and was ended.');
                if ((await finish(job, 'failed', generation)) === 'stale') {
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
        prepare: async (jobId, relay) => {
            const answer = await admin.computerBroker(jobId, 'prepare', { relay });
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
export function relayUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
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
        return `https://${labels.join('.')}${pusher.port ? `:${pusher.port}` : ''}`;
    } catch {
        return null;
    }
}
