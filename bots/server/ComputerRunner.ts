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
import * as Sentry from '@sentry/node';
import type { AdminApiService } from './AdminApiService';
import type { CloseAttempt, RefusalNotes, Since } from './ComputerRefusals';
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
    /** "Try again" (piece 8): the ended job this one carries on from, in the same agent conversation. Its first words say so (`continuePrompt`). Absent for every other job. */
    continuesJobId?: string;
}

/** Whose fault a failed job is, as Orbit's finish call takes it: `ours` is given back to the person, `agent` is the person's. */
export type FinishCause = 'ours' | 'agent';

export type TurnOpened = { ok: true; events: AsyncIterable<RunnerEvent> } | { ok: false; reason: string; responseId?: string; superseded?: true };

/** What the bot server tells Orbit with a prepare, besides the relay's address: the run of this runner the job's turns are numbered in, and the ownership epoch it holds the job under. */
export interface PrepareFacts {
    run?: string;
    epoch?: number;
}

/** What a cancel names: the owner's epoch, and the provider turn (response id) the runner saw. Orbit cancels exactly that turn, and only for the current owner. */
export interface CancelFacts {
    epoch?: number;
    responseId?: string;
}

/**
 * The end Orbit has been told a job is committed to (its finish intent): kept by Orbit before the runner that decided it abandoned the job, so that no other runner (a replacement worker,
 * a fresh process after a restart) opens a turn or admits a paid call on the job: any runner that reads it completes the finish with exactly these values.
 */
export interface FinishPending {
    outcome: 'done' | 'failed';
    cause?: FinishCause;
    why?: string;
    turns?: number[];
    run?: string;
    generation?: number;
}

/** What the person told a job after it started (Orbit's `computer_job_notes`): given to the agent in order, each once, and said back to Orbit by its number (`notes-sent`). */
export interface JobNote {
    seq: number;
    text: string;
}

/** The job as Orbit has it, as the runner reads it. */
export interface RunnerJobState {
    status: string;
    control: string;
    generation?: number;
    ownerEpoch?: number;
    finishPending?: FinishPending | null;
    /** The job was paused before (and resumed): the agent carries on in the same conversation, told it was paused. */
    resumed?: boolean;
    /** The pause that resumed took the screen back from the person (they held it when the month or a limit was reached): the agent asks them for their step again before touching the page. */
    askAgain?: boolean;
    /** What the person told the job that the agent has not been given yet, in order. */
    notes?: JobNote[];
}

export interface RunnerOrbit {
    running(): Promise<RunnableJob[]>;
    /**
     * The job as Orbit has it, or null when it is gone. `generation` is the job's control generation: it moves when the person takes the machine
     * or gives it back, and when the job pauses or resumes. Absent from an Orbit that does not give it (nothing is then sent or checked).
     */
    job(botId: string, jobId: string): Promise<RunnerJobState | null>;
    action(botId: string, jobId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** `extra` goes along with the address (see `PrepareFacts`). */
    prepare(jobId: string, relay: string, extra?: PrepareFacts): Promise<{ ok: true } | { ok: false; reason: string }>;
    turn(jobId: string, input: string, signal: AbortSignal, epoch?: number): Promise<TurnOpened>;
    stream(jobId: string, signal: AbortSignal, epoch?: number): Promise<TurnOpened>;
    cancel(jobId: string, facts?: CancelFacts): Promise<void>;
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
    /** The most a turn that ends waits for the give-up that was still writing to the shared store (a close, or taking one back) to finish: it is bounded, never open-ended. */
    cleanupMs?: number;
    /** How often the worker that owns a job renews its lease at Orbit, in every state it holds the job (GPT's sixth answer, finding 3). */
    beatMs?: number;
    /** How long a lease lasts at Orbit: how long a job another worker holds is left alone when Orbit's `held` answer names no time. */
    leaseMs?: number;
}

export const RUNNER_TIMING: RunnerTiming = { waitMs: 5000, progressMs: 4000, reconnectMs: [1000, 3000, 8000, 20_000], prepareMs: [2000, 6000], poolCheckMs: 5000, poolGiveUpMs: 90_000, cleanupMs: 10_000, beatMs: 30_000, leaseMs: 90_000 };

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
    // The text is redacted BEFORE it is split: a stop or a line break inside a quoted secret value is no end of a sentence, and a fragment of the value must never
    // be left to stand as the sentence
    // and BEFORE the standalone markers are taken out: a marker written inside a value (`PASSWORD=[[note]]demo-value`) is part of the value, and taking it out first
    // would leave the value cut in two, with its second half no pattern can tell from a word
    const before = redactSecrets(words.slice(0, at)).replace(/\[\[[^\]]*\]\]/g, ' ');
    // A stop inside a name or number ("passport.pdf", "3.5", "e.g. the form") is no end of a sentence: only a stop followed by a space and a capital, a digit or an opening quote is
    const sentences = before.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"'(])/).map((one) => one.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const last = sentences[sentences.length - 1] ?? '';
    // The computer's own sentence may quote a command it ran: nothing secret goes on to Orbit or the person (redacted before the cut: a cut at 300 characters
    // through `PASSWORD=hunter2` would leave a value no pattern can tell from a word, so the limit is kept on the redacted result)
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

/**
 * The first turn of a job that carries on an ended one ("try again", piece 8): it is in the SAME conversation, so the agent knows what it did; it is told this is a new try, to look at the
 * screen first, not to redo what is done, and that this try's files go in ITS folder (a file the earlier try kept for the person is moved there). Then the job's own words and rules, as for
 * any job. If the computer no longer had the conversation, the same words still hold: the screen and the files are where they were.
 */
export function continuePrompt(job: { jobId: string; title: string; brief: string | null; writes: boolean; continuesJobId: string }): string {
    return [
        'This is a new try of a job you worked on before in this conversation. The earlier try stopped before it was finished. Look at the computer as it is now first (the page may have changed), then carry on from where it stopped. Do not redo what is already done.',
        ...(job.writes ? [`If the earlier try saved a file for the person in the folder ${outputFolderOf(job.continuesJobId)}, move it into ${outputFolderOf(job.jobId)}: only that folder is given to the person now.`] : []),
        '',
        jobPrompt(job),
    ].join('\n');
}

export const RESUME_PROMPT =
    'The person used this computer and has handed it back. Look at the current page first, since it may have changed, then carry on with the job from where it stands. Remember how to end your reply: [[done]], [[failed]] or [[handover KIND | what | where]].';

export const CONTINUE_PROMPT = 'Carry on with the job. If it is finished, end your reply with [[done]]. If you need the person, end with [[handover KIND | what | where]]. If you cannot go on, end with [[failed]].';

/** The first words after a pause: the job and its rules again (the agent may never have had a turn of it), and where it stands. */
export const RESUMED_HEAD =
    'This job was paused for a while and is carrying on now, on the same computer. Look at the current page first: it may have changed, and a site may have signed you out (if so, ask the person to sign in with the handover line). Carry on from where the job stands, without doing again what is already done. If you were waiting for the person when it paused, ask them again. The job and its rules, as a reminder:';

/** The first words after a pause that took the screen back from the person: their step was cut off halfway, so the agent asks them before it touches the page. */
export const ASK_AGAIN_HEAD =
    'This job was paused for a while and is carrying on now, on the same computer. When it paused, the person was using this computer themselves and it was taken back from them partway through what they were doing. Do not change anything on the page yet: look at it, then ask the person, with the handover line, what they were doing and whether they want to finish that step themselves. The job and its rules, as a reminder:';

/** A resumed job's first turn: told it was paused (and, when the pause took the screen from the person, to ask them first), then the job as at its start. */
export const resumedPrompt = (job: { jobId: string; title: string; brief: string | null; writes: boolean }, askAgain = false): string => `${askAgain ? ASK_AGAIN_HEAD : RESUMED_HEAD}\n\n${jobPrompt(job)}`;

/** The turn after one that was cut short so the person's new words reach the agent at once. */
export const NOTE_PROMPT =
    'You were stopped in the middle of a step so you could read what the person said, below. Look at the current page first, since the step may have been cut short, then carry on with the job with this in mind. Remember how to end your reply: [[done]], [[failed]] or [[handover KIND | what | where]].';

/** The turn after the person answered in the chat while the job waited for them (they did not use the computer). */
export const ANSWERED_PROMPT =
    'The person answered you in the chat instead of on the computer: their words are below. Look at the current page first, then carry on with the job using what they said. If a step still needs them on the computer (signing in, paying, submitting), ask again with the handover line. Remember how to end your reply: [[done]], [[failed]] or [[handover KIND | what | where]].';

/**
 * The person's notes as the agent reads them, after the words of the turn: each one quoted, oldest first. They are the person's own words for THEIR job, and they come after
 * everything the agent was told before, so they win over it.
 */
export function notesBlock(notes: JobNote[]): string {
    const quoted = notes.map((note) => note.text.trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n'));
    return [notes.length === 1 ? 'The person has told you this about the job since it started. It is from them, and it goes before anything you were told earlier:' : 'The person has told you these about the job since it started, oldest first. They are from them, and they go before anything you were told earlier:', '', quoted.join('\n\n')].join('\n');
}

const over = (status: string) => status === 'done' || status === 'stopped' || status === 'failed';

/** How many jobs the runner remembers the note numbers of (the oldest is forgotten first): far more than it ever works on at once. */
const NOTES_KEPT = 5000;

/** How many jobs the runner remembers another worker's lease for (finding 3). The oldest is forgotten first; a job forgotten early is read again and held off afresh. */
const HELD_KEPT = 5000;

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
    refusals?: Pick<RefusalNotes, 'sawSince'> & Partial<Pick<RefusalNotes, 'endedOnFault' | 'turn' | 'turnPublished' | 'flush' | 'confirmedSince' | 'mark' | 'record' | 'calledSince' | 'calledAnywhereSince' | 'onlyPoolBusySince' | 'acceptedAnywhereSince' | 'closeTurn' | 'reopenTurn' | 'commitTurn' | 'releaseTurn'>>;
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

/** The most of an answer the probe reads: what is past it is never read (the stream is cancelled), so an address that streams without end costs no more than this. */
const PROBE_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * The first `limit` bytes of an answer's body as text, and the rest of the stream cancelled unread. An answer without a body (a 204) is the empty string; a
 * response that has no stream to read (a stand-in that only has `text()`) is read whole and cut, as it is already in memory.
 */
async function readUpTo(answer: Response, limit: number): Promise<string> {
    if (!answer.body) return answer.bodyUsed ? '' : typeof answer.text === 'function' ? (await answer.text()).slice(0, limit) : '';
    const reader = answer.body.getReader();
    const parts: Buffer[] = [];
    let size = 0;
    try {
        while (size < limit) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            const room = limit - size;
            const kept = value.byteLength > room ? value.subarray(0, room) : value;
            parts.push(Buffer.from(kept.buffer, kept.byteOffset, kept.byteLength));
            size += kept.byteLength;
        }
    } finally {
        // What is not read is not wanted: the connection is let go of rather than drained. The cancel is asked and NOT waited for (a stream whose cancel never
        // settles would hold the probe for ever, whatever was read): its refusal is handled, the reader is let go, and the bytes already read are parsed
        try {
            reader.cancel().catch(() => undefined);
        } catch {
            /* a stream that cannot be cancelled is not read any more either way */
        }
        try {
            reader.releaseLock();
        } catch {
            /* a reader that is already released has nothing to let go of */
        }
    }
    return new TextDecoder().decode(Buffer.concat(parts));
}

/**
 * Asks an address for the relay's model list WITHOUT a key and reads who answers: the relay answers with a JSON error (401 `invalid_api_key`, or 503
 * while Orbit is away) or the list. An error page (an HTML 404 from the wrong host, a proxy's 502) or a body that is not the relay's is `wrong`, but only
 * with a status that says something else is THERE: a 2xx, a 404 or a 5xx. A redirect (http to https) and a challenge or block (401, 403, 429 from a WAF or
 * a proxy) are what an address in front of the relay may answer a caller that is not the machine: they prove nothing either way, so they are `unknown`
 * and Orbit's own check from the machine decides. An address that does not answer at all is `unknown` too: from the bot server's own side that proves
 * nothing about the machine's way in (a server cannot always reach its own public name), so only an answer from something else counts against the address.
 */
export async function probeRelay(relay: string, fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<RelayProbeResult> {
    try {
        const answer = await fetcher(`${relay}/v1/models`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        const status = answer.status;
        const text = await readUpTo(answer, PROBE_BODY_LIMIT_BYTES);
        // What is not the relay's way of answering says "something else is there" only with a status that a service says it with
        const elseIsThere = (status >= 200 && status < 300) || status === 404 || status >= 500;
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return { answer: elseIsThere ? 'wrong' : 'unknown', status };
        }
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
        if (record && (typeof record.error === 'object' || record.object === 'list')) return { answer: 'relay', status };
        return { answer: elseIsThere ? 'wrong' : 'unknown', status };
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

/**
 * Whether an answer says the run it came from is no longer the job's current run (Orbit's run fence), as against a turn of an old control generation. Both are `stale`; this one
 * says `run: 'superseded'`, in a 200 or in the body of a 409.
 */
function runStaleOf(body: unknown): boolean {
    if (typeof body !== 'object' || body === null) return false;
    const answer = body as { ok?: unknown; reason?: unknown; run?: unknown; response?: { data?: unknown } };
    if (answer.response) return runStaleOf(answer.response.data);
    return answer.reason === 'stale' && answer.run === 'superseded';
}

/** An action for Orbit, with the control generation the turn started on when Orbit gave one (so an action from an older turn changes nothing), and the ownership epoch the runner holds the job under. */
function fenced(body: Record<string, unknown>, generation: number | undefined, epoch?: number): Record<string, unknown> {
    const withEpoch = epoch === undefined ? body : { ...body, epoch };
    return generation === undefined ? withEpoch : { ...withEpoch, generation };
}

/** The numbers a turn's requests to Orbit are made under: the turn, the run it is numbered in, and the ownership epoch the runner holds the job under (absent with an Orbit that has none). */
interface TurnIds {
    turn: number;
    run: string;
    epoch?: number;
}

/**
 * An answer from Orbit that says no to what a job told it, as opposed to one that is ours to answer for. Orbit's job route (#981) answers
 * 200 for everything it does, 404 when the job is gone, 400 when the request does not fit (a bug of ours), 401 when our own key is not
 * accepted (ours) and 500 when it failed itself (ours). So only a 404, or another 4xx a later Orbit may give for a no, is a refusal.
 */
const orbitSaidNo = (error: unknown): boolean => refusedByOrbit(error) && statusOf(error) !== 400 && statusOf(error) !== 401 && statusOf(error) !== 403;

type TurnResult =
    /** The turn ended and what the agent said is here (it may be empty). */
    | { kind: 'ended'; words: string; failed: boolean; fenced: boolean; responseId?: string }
    /**
     * Orbit or the job changed under it: look at the job again. `cancelled`: this turn was stopped here (its room was gone, or a report
     * was refused as stale), so it is not there to reconnect to, and the page may have changed since: the next turn is told to look first.
     */
    | { kind: 'look'; cancelled?: true }
    /** Every call of the turn was refused for want of room in the shared pool for as long as the runner waits: the turn was stopped here and the machine is given up. */
    | { kind: 'poolBusy'; attempt?: CloseAttempt }
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
    /**
     * The pool-busy give-ups Orbit has not accepted yet, by job: what the finish says (its turn and run, the control generation it began on) and the close whose committed fence is
     * taken back once Orbit accepts it. They belong to the runner, not to a worker: a worker that is stopped leaves its give-up for the next worker of the job.
     */
    const giveUps = new Map<string, { turnNo: number; run: string; generation: number | undefined; epoch?: number; attempt?: CloseAttempt }>();
    /**
     * The highest note number the agent of each job has been given (its words reached it), whatever worker gave it: a note is given once even when Orbit's `notes-sent` answer
     * was lost, and a worker after a pause carries on from it (the agent's conversation is the same one). Forgotten when the job is over.
     */
    const notesGiven = new Map<string, number>();
    /**
     * The highest note number the agent of a job has had and Orbit was not told (its answer was lost, or it was never asked): kept with `notesGiven`, by job, so a worker after a pause
     * or a replacement tells Orbit under its own epoch, and never gives the agent the text again. Forgotten when the job is over.
     */
    const notesUntold = new Map<string, number>();
    /**
     * Jobs another worker holds with a lease that was still alive when this runner asked for them (Orbit's `held`, GPT's sixth answer, finding 3): when its lease ends, by `now()`. The
     * runner leaves such a job alone until then and claims NOTHING in between, so a healthy owner is never claimed over and no worker goes round a claim loop. An owner that dies leaves
     * its lease to lapse, and the job is taken up on the first look after it.
     */
    const heldUntil = new Map<string, number>();
    const holdOff = (jobId: string, until: number): void => {
        heldUntil.set(jobId, until);
        if (heldUntil.size > HELD_KEPT) heldUntil.delete(heldUntil.keys().next().value as string);
    };
    // Counts each start and stop, so a poll that was asked before a stop can tell it was
    let generation = 0;
    // Whether a 400 for the finish intent has been reported to Sentry by this runner (once)
    let reportedBadIntent = false;
    /**
     * Orbit orders the runs of a job (the run fence): what a run sends (a finish, a finish intent, a renew) is answered stale, saying so, once another run of the same job has prepared
     * its machine since. A run so answered is over: it ends its loop and cancels nothing, since the machine and the job are the replacement's now. Kept by run (a run names itself once).
     */
    const superseded = new Set<string>();
    /** Notes a stale answer as the end of THIS run when Orbit says another run holds the job (not an old control generation: that one is read again as usual). */
    const noteRunStale = (run: string | undefined, body: unknown): void => {
        if (run && runStaleOf(body)) superseded.add(run);
    };

    // What a failure says can hold what a request held (an address, a header): nothing secret reaches a log
    const say = (message: string, error?: unknown) => log.warn(`[ComputerRunner] ${message}`, error instanceof Error ? redactSecrets(error.message) : '');

    /**
     * The jobs this runner's workers own right now (GPT's sixth answer, finding 3): the run that owns each, the epoch it holds, and whether the job is over as far as that worker knows.
     * While a job is here its lease at Orbit is renewed every `beatMs`, in every state the worker holds it, so another worker never claims over a healthy owner. When the worker stops
     * gracefully the lease is given back at once, so a replacement takes the job up without waiting for it to lapse.
     */
    const owned = new Map<string, { run: string; epoch: number; over?: true }>();
    /** What ends the reading of the turn a worker has open for a job, cancelling nothing (the provider turn is the replacement's): set by the worker while it works, called when a beat finds its run replaced. */
    const turnStoppers = new Map<string, () => void>();
    const beats = new Map<string, ReturnType<typeof setInterval>>();
    const stopBeating = (jobId: string): void => {
        const beat = beats.get(jobId);
        if (beat) clearInterval(beat);
        beats.delete(jobId);
    };
    /** Renews the lease of a job this runner owns. A stale answer says another run holds it: that run is over (as it is anywhere else) and the beat stops. */
    const beatOnce = async (job: RunnableJob): Promise<void> => {
        const mine = owned.get(job.jobId);
        if (!mine || mine.over || superseded.has(mine.run)) return;
        try {
            const answer = await orbit.action(job.botId, job.jobId, { action: 'beat', run: mine.run, epoch: mine.epoch });
            if (answer.ok === false && runStaleOf(answer)) {
                superseded.add(mine.run);
                stopBeating(job.jobId);
                // The turn this run has open stops too, as it does for a superseded answer to the notes: nothing is cancelled and nothing is ended
                turnStoppers.get(job.jobId)?.();
            }
        } catch (error) {
            if (staleForOrbit(error) && runStaleOf(error)) {
                superseded.add(mine.run);
                stopBeating(job.jobId);
                turnStoppers.get(job.jobId)?.();
            } else if (statusOf(error) === 404) mine.over = true;
            else say('Could not renew the lease of a job:', error);
        }
    };
    /** A worker owns the job under this epoch: its lease is kept alive from now until the worker stops. */
    const takeLease = (job: RunnableJob, run: string, epoch: number): void => {
        owned.set(job.jobId, { run, epoch });
        if (beats.has(job.jobId)) return;
        const beat = setInterval(() => void beatOnce(job), timing.beatMs ?? 30_000);
        beat.unref?.();
        beats.set(job.jobId, beat);
    };
    /** The job is over as far as this worker knows (it ended it, or Orbit's finalizer did): there is no lease left to give back. */
    const leaseOver = (jobId: string): void => {
        const mine = owned.get(jobId);
        if (mine) mine.over = true;
        stopBeating(jobId);
    };
    /** Gives the lease back as the worker stops (the server is stopping, a deploy, the job went back in line), so a replacement does not wait for it to lapse. Never throws. */
    const giveLeaseBack = async (job: RunnableJob): Promise<void> => {
        stopBeating(job.jobId);
        const mine = owned.get(job.jobId);
        owned.delete(job.jobId);
        if (!mine || mine.over || superseded.has(mine.run)) return;
        await orbit.action(job.botId, job.jobId, { action: 'release', run: mine.run, epoch: mine.epoch }).catch((error) => {
            if (statusOf(error) !== 404) say('Could not give a job back as its worker stopped:', error);
        });
    };

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
        options: { cause?: FinishCause; generation?: number; why?: string | null; turns?: number[]; run?: string; epoch?: number; signal?: AbortSignal } = {}
    ): Promise<'ended' | 'stale' | 'stopped' | 'unsent'> {
        const { cause, generation, why, turns, run, epoch, signal } = options;
        let stale = false;
        let unsent = false;
        // Orbit judges a failure from the call rows it holds, so what the relay recorded for this job reaches it BEFORE the finish does (a moment of
        // retry at most: a record that cannot be sent never keeps a job from ending, and Orbit then has the cause below as its only hint)
        if (outcome === 'failed') await deps.refusals?.flush?.(job.jobId)?.catch(() => false);
        // The flush can take a while: a worker that was stopped meanwhile (the job was taken over, the person took the machine, the server is stopping) does not end the
        // job for whoever has it now. A flush that failed with the worker still active still sends the failure
        if (signal?.aborted) return 'stopped';
        const body = {
            action: 'finish',
            outcome,
            ...(outcome === 'failed' && cause ? { cause } : {}),
            ...(outcome === 'failed' && why ? { why } : {}),
            // The turns this runner judged failed (the ones the streak was made of), which Orbit reads against the call rows of each
            // `run` says which run of this runner they were numbered in: turns start again from 1 after a restart, so Orbit reads a named turn
            // only against the rows of that run
            ...(outcome === 'failed' && turns && turns.length > 0 ? { turns: [...turns] } : {}),
            // Every finish names the run it comes from, a done one too: Orbit answers a run that another run has replaced stale, so a delayed end of an old run never ends the work of the replacement
            ...(run ? { run } : {}),
        };
        await orbit
            .action(job.botId, job.jobId, fenced(body, generation, epoch))
            .then((answer) => {
                // Orbit says "stale" in a 200 too (an older generation than the job's own): nothing was ended
                if (answer.ok === false && answer.reason === 'stale') {
                    stale = true;
                    noteRunStale(run, answer);
                }
                // Only Orbit's own word that it ended the job (the job as it stands, or `ok: true`) says so: an empty 200, or a body that says nothing of the job, came from something on the way (or
                // an Orbit that did not do it), and the end is not taken as made: whatever waited for it (a committed fence, a pending give-up) waits on
                else if (!(answer.ok === true || (typeof answer.job === 'object' && answer.job !== null))) {
                    unsent = true;
                    say('Could not end a job: Orbit answered without saying it was ended');
                }
            })
            .catch((error) => {
            if (staleForOrbit(error)) {
                stale = true;
                noteRunStale(run, error);
            } else {
                unsent = true;
                say('Could not end a job:', error);
            }
        });
        if (!stale && !unsent) leaseOver(job.jobId);
        return stale ? 'stale' : unsent ? 'unsent' : 'ended';
    }

    /**
     * Waits while the person has the machine or the job waits for them. 'back' when it is Brick's again, 'answered' when it is Brick's again on the same control generation with
     * notes the agent has not had (the person answered in the chat, not on the computer), 'over' when it is not coming back. 'left' when the job is no longer this worker's to wait
     * for: it went back in line (paused, or put behind a job done first) or another worker owns it now. A paused job is never waited on: its worker leaves, and the job's next
     * stretch is taken up by a fresh claim when it runs again.
     */
    async function waitForBrick(job: RunnableJob, signal: AbortSignal, held: { epoch?: number; generation?: number; delivered: () => number } = { delivered: () => 0 }): Promise<'back' | 'answered' | 'over' | 'stopped' | 'left'> {
        for (;;) {
            if (signal.aborted) return 'stopped';
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            // undefined: Orbit could not be asked; null: the job is gone
            if (state === null || (state && over(state.status))) return 'over';
            if (state && leftUs(state, held.epoch)) return 'left';
            if (state && state.status === 'running' && state.control === 'brick') {
                const answered = held.generation !== undefined && state.generation === held.generation && newNotes(state, held.delivered()).length > 0;
                return answered ? 'answered' : 'back';
            }
            await sleep(timing.waitMs, signal);
        }
    }

    /** The job went back in line (paused, or put behind a job done first), or another worker claimed it since this one did (and no end is held that is still to be completed). */
    function leftUs(state: RunnerJobState, epoch: number | undefined): boolean {
        if (state.status === 'queued') return true;
        return epoch !== undefined && state.ownerEpoch !== undefined && state.ownerEpoch !== epoch && !state.finishPending;
    }

    /** The notes of a read that the agent has not had: past the highest number given to it. */
    const newNotes = (state: RunnerJobState | null | undefined, through: number): JobNote[] => (state?.notes ?? []).filter((note) => note.seq > through).sort((a, b) => a.seq - b.seq);

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
    async function prepared(job: RunnableJob, relay: string, run: string, epoch: number | undefined, signal: AbortSignal): Promise<'ready' | 'look' | 'failed' | 'unreachable' | 'stopped' | 'superseded'> {
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
                answer = await orbit.prepare(job.jobId, relay, { run, ...(epoch === undefined ? {} : { epoch }) }).catch(() => ({ ok: false as const, reason: 'failed' }));
                if ('reason' in answer && answer.reason === 'relay_unreachable') unreachable = true;
            }
            // A stop that came while Orbit was being asked is no failure of the job: nothing is ended on it
            if (signal.aborted) return 'stopped';
            if (!unreachable) {
                if (!('reason' in answer)) return 'ready';
                // Another worker owns the job (its claim is newer than ours): this run is over, and nothing is ended or cancelled for it
                if (answer.reason === 'superseded') return 'superseded';
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
        /** Called once when the agent took THIS turn's own input (a turn it started with these words, not one it was already on): what was in the words reached it. */
        onSent?: () => void;
        /** Set by `turnOf` while it reads a turn: ends the reading (the run was found superseded by an answer to something else than the turn's own requests) and cancels nothing. */
        stop?: () => void;
    }

    /** Sends one turn (or reconnects to the one going) and reads it to its end, renewing the job's room as Orbit says while it does. */
    async function oneTurn(job: RunnableJob, input: string | null, signal: AbortSignal, renewing: Renewing, accepted: Accepted, generation: number | undefined, since: Since | null, seenFromStart: () => boolean, ids: TurnIds): Promise<TurnResult> {
        // A give-up whose finish intent Orbit took while the turn was ending by its own terminal event: the intent cannot be taken back, so the turn is read as the give-up it became
        const late: { result?: TurnResult } = {};
        const result = await turnOf(job, input, signal, renewing, accepted, generation, since, seenFromStart, ids, late);
        return late.result && result.kind !== 'stopped' ? late.result : result;
    }

    async function turnOf(job: RunnableJob, input: string | null, signal: AbortSignal, renewing: Renewing, accepted: Accepted, generation: number | undefined, since: Since | null, seenFromStart: () => boolean, ids: TurnIds, late: { result?: TurnResult }): Promise<TurnResult> {
        // A stop that came while the machine was being made ready has already fired: its listener would never be told
        if (signal.aborted) return { kind: 'stopped' };
        const turnController = new AbortController();
        const onStop = () => turnController.abort();
        signal.addEventListener('abort', onStop, { once: true });
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let lost = false;
        // A superseded answer to a request outside this turn's own (the note acknowledgement) stops the reader the same way one to a renew does: the provider turn is the replacement's
        accepted.stop = () => {
            lost = true;
            turnController.abort();
        };
        // The provider turn (response id) this runner saw the agent on: what a cancel and a handover name, so Orbit acts on exactly this turn and never on whichever turn the job is on when
        // the request arrives (a delayed request of an old worker never reaches the replacement's turn)
        let responseId: string | undefined;
        const cancelTurn = (): Promise<void> => orbit.cancel(job.jobId, { ...(ids.epoch === undefined ? {} : { epoch: ids.epoch }), ...(responseId ? { responseId } : {}) }).catch(() => undefined);
        // Every call of this turn refused for want of room in the shared pool, for as long as the runner waits: Hermes would go on trying for minutes with the
        // machine awake and costing, so the turn is stopped here and the machine given up
        let poolTimer: ReturnType<typeof setTimeout> | undefined;
        let poolWatch: ReturnType<typeof setTimeout> | undefined;
        let gaveUp = false;
        // Orbit answered the intent of THIS turn stale (the turn moved on: a funded call was admitted on it first, the job is over or gone, another generation holds it): this turn is never
        // given up again, so the tentative close cannot keep flapping the relay for a turn Orbit has said is no pool-only turn. A new turn has its own
        let stalled = false;
        // The close the give-up went on with, so its fence can be taken back once Orbit has accepted the finish
        let gaveUpOn: CloseAttempt | undefined;
        // The give-up that is writing to the shared store right now (the close of the turn, or the taking of it back): the end of the turn waits for it, bounded
        let watchdog: Promise<void> | undefined;
        // The turn's own end was read (a terminal event that needs no reconnection): nothing is given up on after it, whatever the pool answers
        let turnOver = false;
        // Only for a turn this process saw from its beginning: after a restart the notes know nothing of a call that was taken up before it, so a turn taken up
        // by reconnecting is not judged pool-only from the refusals seen since (the turns it starts itself, and Orbit's own record, still are)
        const poolBusy = () => since !== null && seenFromStart() && deps.refusals?.onlyPoolBusySince?.(job.jobId, since) === true;
        // Looked at again at the end of the wait: a call taken up meanwhile means the pool has room again, and that includes a call taken up by the relay of
        // ANOTHER bot server (the machine's calls reach whichever one the load balancer picks, and this server's own notes know only its own)
        const poolBusyResult = (): TurnResult => ({ kind: 'poolBusy', ...(gaveUpOn ? { attempt: gaveUpOn } : {}) });
        const giveUpIfStill = async () => {
            if (turnOver || turnController.signal.aborted || !poolBusy()) return;
            // The close is TENTATIVE until Orbit holds the finish intent: it can be taken back, and a runner never stops work unless Orbit already holds the end (a runner lost
            // before that has abandoned nothing, and its replacement carries the job on through Orbit and the pool as usual)
            let tentative: CloseAttempt | undefined;
            const takeBack = async () => {
                if (!tentative) return;
                try {
                    await deps.refusals?.reopenTurn(job.jobId, tentative);
                } catch {
                    /* the fence expires on its own */
                }
            };
            if (since !== null && deps.refusals?.closeTurn) {
                // The turn is CLOSED, not just read: as one step on the shared store, no call of it was taken up by any bot server's relay, and from then on none is (a relay
                // on another server that takes one up after this is refused, and forwards nothing). A read of what was taken up, and a cancel after it, would stop a turn
                // whose call another server took up and forwarded in between
                let closed = false;
                // What names THIS close, so that exactly this one can be taken back
                const attempt: CloseAttempt = {};
                try {
                    closed = await deps.refusals.closeTurn(job.jobId, since, attempt);
                } catch {
                    closed = false;
                }
                // Not closed: a call was taken up (the pool has room again), or it cannot be told: the turn goes on
                if (!closed) return;
                tentative = attempt;
                // The close took a moment, and the turn is NOT given up when it ended meanwhile (its terminal event was read, or the worker stopped), or when a refusal of
                // another kind arrived meanwhile (a provider's error, the person's allowance...: the turn is no pool-only turn after all; a call the close itself had the
                // relay refuse is not such evidence). Then the close is taken back, and the turn goes on
                if (turnOver || turnController.signal.aborted || !poolBusy()) {
                    await takeBack();
                    return;
                }
            }
            // THEN Orbit is told the job is committed to ending (the finish intent), BEFORE anything is committed or stopped: Orbit ends every key of the job in the same step, so no
            // other runner (a replacement worker, a fresh process after a restart) can open a turn or admit a paid call on it, whatever becomes of this process. It cannot be taken
            // back. An intent Orbit did not keep (it could not be reached, a server error, a 400, anything it did not say) is NO give-up: the tentative close is taken back, nothing is
            // aborted or cancelled, the turn goes on and the watch tries again later. Stale (the job is over, moved on, or gone): nothing to end, the close is taken back too
            const kept = await sendIntent(job, generation, ids);
            if (kept !== 'kept') {
                await takeBack();
                if (kept === 'stale') stalled = true;
                // Another run holds the job now: this turn is not the job's any more, it stops (nothing is cancelled: the machine is the replacement's)
                if (kept === 'stale' && superseded.has(ids.run)) turnController.abort();
                return;
            }
            // Orbit holds the end: the fence is COMMITTED now (it holds for as long as the cancel and the finish take). A commit that is refused or never confirmed does not stop the
            // give-up (the intent already bars new work, and Orbit refuses the turn's calls), and the fence of this close is NOT taken back either: a call Orbit took up before it kept the
            // intent could still be on its way to the provider, and a fence that is reopened here would let the relay forward it. It stands (a fence that was never committed clears
            // itself after its own short life, one whose commit was not confirmed is held like a committed one) until Orbit has accepted the finish
            if (tentative && deps.refusals?.commitTurn) {
                try {
                    await deps.refusals.commitTurn(job.jobId, tentative);
                } catch {
                    tentative.unconfirmed = true;
                }
            }
            if (tentative) gaveUpOn = tentative;
            gaveUp = true;
            // The turn ended by its own terminal event while the intent was on its way: Orbit holds the end now, nothing is left to stop here, and the machine is not cancelled (a cancel
            // is the job's, not this turn's). The end is completed from what Orbit holds
            if (turnOver) return;
            turnController.abort();
            void cancelTurn();
        };
        const watchPool = () => {
            if (turnOver || turnController.signal.aborted) return;
            if (!stalled && poolBusy()) {
                // One give-up at a time: while one is still writing to the shared store (its close, or taking it back) no other is armed, and the one that is
                // pending is never replaced, so the end of the turn waits for THE give-up that holds a fence. When it has settled, the next look arms again if the
                // turn is still going and still pool-only
                if (watchdog === undefined) poolTimer ??= setTimeout(() => {
                    poolTimer = undefined;
                    // Kept: the turn does not end (and the worker does not report that it is idle) while this is still writing to the shared store
                    const running = giveUpIfStill().catch(() => undefined);
                    watchdog = running;
                    void running.then(() => {
                        if (watchdog === running) watchdog = undefined;
                    });
                }, timing.poolGiveUpMs ?? RUNNER_TIMING.poolGiveUpMs);
            } else if (poolTimer) {
                clearTimeout(poolTimer);
                poolTimer = undefined;
            }
            poolWatch = setTimeout(watchPool, timing.poolCheckMs ?? RUNNER_TIMING.poolCheckMs);
        };
        // The turn ended by its own terminal event: the give-up timer and the pool watch are put down at once, and a give-up that is waiting on its read stands down
        const overNow = () => {
            turnOver = true;
            if (poolTimer) clearTimeout(poolTimer);
            if (poolWatch) clearTimeout(poolWatch);
            poolTimer = undefined;
            poolWatch = undefined;
        };
        if (since !== null && deps.refusals?.onlyPoolBusySince) watchPool();
        const renew = async () => {
            if (turnController.signal.aborted) return;
            try {
                const answer = await orbit.action(job.botId, job.jobId, fenced({ action: 'renew', run: ids.run }, generation, ids.epoch));
                // An answer that comes after its turn ended is not this turn's to use: a newer turn may hold a newer deadline by now
                if (turnController.signal.aborted) return;
                if (answer.ok === false && runStaleOf(answer)) {
                    // Another run holds the job: this turn stops and this run is over, and nothing is cancelled (the machine is the replacement's)
                    superseded.add(ids.run);
                    lost = true;
                    turnController.abort();
                    return;
                }
                if (answer.ok === false && answer.reason === 'paused') {
                    // Orbit paused the job (the month's computer time or the person's own limit ran out, or the person paused it): Orbit owns the pause, its turn cancel and the
                    // time it charged. Like `ending`: the turn stops, nothing is cancelled or finished here, and it is no bad turn; the job is read again and this run leaves it
                    lost = true;
                    turnController.abort();
                    return;
                }
                if (answer.ok === false && answer.reason === 'ending') {
                    // Orbit holds this job's end already (a kept finish intent, or a pool cutoff it decided): its finalizer owns the ending and the cancel, so the renewal adds nothing and
                    // writes nothing. This turn stops and nothing is cancelled here; the job is read again, and the end it holds is completed
                    lost = true;
                    turnController.abort();
                    return;
                }
                if (answer.ok === false) {
                    // Its room is gone and Orbit has stopped it: the agent stops too
                    lost = true;
                    turnController.abort();
                    await cancelTurn();
                    return;
                }
                const next = typeof answer.renewInSeconds === 'number' && answer.renewInSeconds >= 5 ? answer.renewInSeconds : 120;
                renewing.nextAt = now() + next * 1000;
                renewTimer = setTimeout(() => void renew(), next * 1000);
            } catch (error) {
                if (turnController.signal.aborted) return;
                if (staleForOrbit(error) && runStaleOf(error)) {
                    superseded.add(ids.run);
                    lost = true;
                    turnController.abort();
                    return;
                }
                // Orbit answered and refused (the job is over or gone): the agent stops, as when it says the room is gone
                if (refusedByOrbit(error)) {
                    lost = true;
                    turnController.abort();
                    await cancelTurn();
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
                await orbit
                    .action(job.botId, job.jobId, fenced({ action: 'progress', stepDone, label }, generation, ids.epoch))
                    .then((answer) => {
                        // Another worker owns the job: this turn stops, and nothing is cancelled (the machine and the turn are the replacement's)
                        if (answer.ok === false && runStaleOf(answer) && !turnController.signal.aborted) {
                            superseded.add(ids.run);
                            lost = true;
                            turnController.abort();
                        }
                    })
                    .catch(async (error) => {
                        if (turnController.signal.aborted) return;
                        if (staleForOrbit(error) && runStaleOf(error)) {
                            superseded.add(ids.run);
                            lost = true;
                            turnController.abort();
                            return;
                        }
                        // This turn is an old one (the job changed hands or paused): it stops being acted on, and the job is read again
                        if (!staleForOrbit(error)) return;
                        lost = true;
                        turnController.abort();
                        await cancelTurn();
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
            const stoppedHere = (): TurnResult => (signal.aborted ? { kind: 'stopped' } : gaveUp ? poolBusyResult() : { kind: 'look', cancelled: true });
            // A turn taken up with no input is one that was already going: this process has not seen its beginning
            if (input === null) accepted.joined = true;
            const first = await opening(() => (input === null ? orbit.stream(job.jobId, turnController.signal, ids.epoch) : orbit.turn(job.jobId, input, turnController.signal, ids.epoch)));
            if (first === STOPPED_HERE) return stoppedHere();
            let opened: TurnOpened = first;
            // The agent is still on a turn of its own (we lost it, or Orbit restarted): read that one instead of starting another
            // The agent took the words of THIS turn (it was not already on a turn of its own): whatever they carried has reached it
            if (input !== null && !('reason' in opened)) accepted.onSent?.();
            if ('reason' in opened && opened.reason === 'busy') {
                // The agent was on a turn that this process did not start
                accepted.joined = true;
                if (opened.responseId) responseId = opened.responseId;
                const again = await opening(() => orbit.stream(job.jobId, turnController.signal, ids.epoch));
                if (again === STOPPED_HERE) return stoppedHere();
                opened = again;
            }
            if ('reason' in opened) {
                // Another worker owns the job: this run is over (it ends its loop, and nothing is cancelled)
                if (opened.superseded) {
                    superseded.add(ids.run);
                    return { kind: 'look' };
                }
                // A turn that is gone is no silence of the agent's: it counts as a failed turn, like one lost on a reconnect
                if (opened.reason === 'no_turn') return { kind: 'ended', words: '', failed: true, fenced: false };
                return opened.reason === 'failed' ? { kind: 'ended', words: '', failed: true, fenced: false } : { kind: 'look' };
            }

            accepted.turn = true;
            // The run was found superseded (by the note acknowledgement) while this turn was being opened: there is nothing to read, and nothing is cancelled
            if (lost) return { kind: 'look', cancelled: true };
            let reconnects = 0;
            for (;;) {
                let terminal: { failed: boolean; fenced: boolean; code: string } | null = null;
                try {
                    for await (const event of opened.events) {
                        // A reader that was stopped reads no more (the stream is let go of: the provider turn is the replacement's, and nothing is cancelled)
                        if (lost) break;
                        if (event.type === 'created') {
                            if (event.id) responseId = event.id;
                        } else if (event.type === 'text') words = (words + event.text).slice(-RUNNER_GUARDS.maxWords);
                        else if (event.type === 'tool') {
                            if (event.state === 'started' && event.label) label = safeStepLabel(event.label);
                            if (event.state === 'completed') {
                                stepDone += 1;
                                await report();
                            }
                        } else if (event.type === 'completed') {
                            words = event.outputText ? event.outputText.slice(-RUNNER_GUARDS.maxWords) : words;
                            terminal = { failed: false, fenced: false, code: '' };
                            overNow();
                        } else if (event.type === 'failed') {
                            terminal = { failed: true, fenced: event.code === 'fenced', code: event.code };
                            // A failure that is a broken stream is read again after a reconnection: the turn is not over then
                            if (terminal.code !== 'stream_broke' && terminal.code !== 'stream_ended') overNow();
                        }
                    }
                } catch (error) {
                    if (!turnController.signal.aborted) say('A turn stream broke:', error);
                    terminal = terminal ?? { failed: true, fenced: false, code: 'stream_broke' };
                }
                if (signal.aborted) return { kind: 'stopped' };
                if (gaveUp) return poolBusyResult();
                if (lost) return { kind: 'look', cancelled: true };
                await report(true);
                // The last report can be the first one the job answers as stale: the turn is lost then, and is not read as ended. It can also be a long one: a stop, or the
                // pool's watchdog giving the turn up (a broken stream on the last reconnect leaves it armed), can come while it is pending, and is read as what it is
                if (signal.aborted) return { kind: 'stopped' };
                if (gaveUp) return poolBusyResult();
                if (lost) return { kind: 'look', cancelled: true };
                if (terminal && terminal.code !== 'stream_broke' && terminal.code !== 'stream_ended') return { kind: 'ended', words, failed: terminal.failed, fenced: terminal.fenced, ...(responseId ? { responseId } : {}) };
                // The connection ended before the turn did: reconnect to it, a few times, then let the next look decide
                if (reconnects >= timing.reconnectMs.length) return { kind: 'ended', words, failed: true, fenced: false };
                await sleep(timing.reconnectMs[reconnects], turnController.signal);
                reconnects += 1;
                const again = await opening(() => orbit.stream(job.jobId, turnController.signal, ids.epoch));
                if (again === STOPPED_HERE) return stoppedHere();
                // A turn that is gone without its end having been seen is not a turn that ended well: what was said before is not taken as its ending
                if ('reason' in again && again.superseded) {
                    superseded.add(ids.run);
                    return { kind: 'look' };
                }
                if ('reason' in again) return again.reason === 'no_turn' ? { kind: 'ended', words, failed: true, fenced: false } : { kind: 'look' };
                opened = again;
            }
        } finally {
            if (renewTimer) clearTimeout(renewTimer);
            if (poolTimer) clearTimeout(poolTimer);
            if (poolWatch) clearTimeout(poolWatch);
            signal.removeEventListener('abort', onStop);
            accepted.stop = undefined;
            turnController.abort();
            // A close that was being written when the turn ended (a stop of the worker, the turn's own end) is taken back by the give-up itself, which sees the
            // turn over: the end of the turn waits for that (bounded), so a worker that reports it is idle has not left a fence in the store that makes the relays
            // of other servers refuse the calls of a turn that is still going. A give-up that goes on keeps its fence
            const pending = watchdog;
            if (pending) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                await Promise.race([pending, new Promise<void>((resolve) => (timer = setTimeout(resolve, timing.cleanupMs ?? RUNNER_TIMING.cleanupMs)))]);
                if (timer) clearTimeout(timer);
            }
            if (gaveUp) late.result = poolBusyResult();
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

    /**
     * Tells Orbit this job is committed to ending (the finish intent), with what the finish will say. 'kept': Orbit holds it (first one wins, or it already did), or the pool cutoff Orbit
     * decided itself already ends the job the same way (the finish is the same and idempotent). 'stale': the job is over or gone, never started, or on another control generation than this
     * runner holds: nothing is ended and a newer generation never has an old give-up resurrected. 'unsent': anything else, and that includes a 400 (an Orbit that does not know the intent: in
     * a supported rollout Orbit ships first, so a 400 means a body of ours it does not accept, and it is reported once): nothing is given up on, the turn goes on, the give-up is tried again later.
     */
    async function sendIntent(job: RunnableJob, generation: number | undefined, ids: TurnIds): Promise<'kept' | 'stale' | 'unsent'> {
        try {
            const answer = await orbit.action(job.botId, job.jobId, fenced({ action: 'finish-intent', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, basis: 'pool', turns: [ids.turn], run: ids.run }, generation, ids.epoch));
            if (answer.ok === true) return 'kept';
            if (answer.ok === false && answer.reason === 'cutoff') return 'kept';
            if (answer.ok === false && answer.reason === 'stale') {
                noteRunStale(ids.run, answer);
                return 'stale';
            }
            return 'unsent';
        } catch (error) {
            const status = statusOf(error);
            if (status === 404) return 'stale';
            if (staleForOrbit(error)) {
                noteRunStale(ids.run, error);
                return 'stale';
            }
            if (status === 400) {
                // Said in the log every time, and to Sentry once (no words of anyone's): the stop protection is not silently dropped
                say('Orbit answered the finish intent with 400: no give-up is made, the job goes on.');
                if (!reportedBadIntent) {
                    reportedBadIntent = true;
                    try {
                        Sentry.captureMessage('Orbit answered a computer finish intent with 400', { level: 'error', tags: { area: 'computer-finish-intent' } });
                    } catch {
                        /* a report is never in the way of a job */
                    }
                }
                return 'unsent';
            }
            say('Could not keep the finish intent of a job:', error);
            return 'unsent';
        }
    }

    /**
     * Sends a finish until Orbit has taken it (or says it is stale, or the job is no longer going, or the worker is stopped). A finish Orbit did not take is sent again after a wait.
     * 'ended': settled. 'stale': the job moved on. 'stopped': the worker was stopped and nothing is ended for whoever has the job now.
     */
    async function sendFinishUntilTaken(job: RunnableJob, send: () => Promise<'ended' | 'stale' | 'stopped' | 'unsent'>, signal: AbortSignal): Promise<'ended' | 'stale' | 'stopped'> {
        let finished = await send();
        while (finished === 'unsent') {
            await sleep(timing.waitMs, signal);
            if (signal.aborted) return 'stopped';
            const standing = await orbit.job(job.botId, job.jobId).then(
                (read) => read,
                () => undefined
            );
            if (signal.aborted) return 'stopped';
            // Orbit does not have the job going any more (a finish whose answer was lost, or any other end): there is nothing left to end
            if (standing === null || (standing !== undefined && over(standing.status))) return 'ended';
            finished = await send();
        }
        return finished;
    }

    /** Completes the end Orbit holds for a job (its finish intent) with exactly the values it holds: no turn, no prepare, no call is made for the job. */
    function completePending(job: RunnableJob, pending: FinishPending, signal: AbortSignal, current: number | undefined, owner?: number): Promise<'ended' | 'stale' | 'stopped'> {
        return sendFinishUntilTaken(
            job,
            () =>
                finish(job, pending.outcome, {
                    signal,
                    ...(pending.cause ? { cause: pending.cause } : {}),
                    ...(pending.why ? { why: pending.why } : {}),
                    ...(pending.turns && pending.turns.length > 0 ? { turns: pending.turns } : {}),
                    ...(pending.run ? { run: pending.run } : {}),
                    // The kept intent is the committed word and is accepted from any worker: the epoch sent is the owner's as the job shows it now (never one this worker has not claimed)
                    ...(owner !== undefined && owner > 0 ? { epoch: owner } : {}),
                    // The generation the job is on NOW (Orbit ends the job as the intent said whatever the generation of the finish: the intent holds over a newer one, and a finish
                    // that named the older one would only be answered "stale" for ever)
                    ...((current ?? pending.generation) === undefined ? {} : { generation: (current ?? pending.generation) as number }),
                }),
            signal
        );
    }

    /**
     * Sends the give-up a pool-busy turn owes Orbit (`giveUps`) until Orbit settles it. A finish Orbit did not take (it could not be reached, or it did not answer) keeps the give-up
     * PENDING: it is sent again, after a wait, until Orbit has accepted it or says the turn is a stale one, or the job is no longer going (a finish whose answer was lost got there,
     * or the job ended otherwise). No new turn begins meanwhile (the caller is the one that would begin it), and the committed fence stays in the store over the turn that was
     * given up until Orbit has accepted. 'ended': settled, and the fence is taken back. 'stale': Orbit found the turn an old one (the fence stays where it is: the next turn has a
     * number of its own). 'stopped': the worker was stopped (the job was taken over, the person took the machine, the server is stopping): nothing is ended for whoever has it
     * now, and the give-up stays owed for the next worker of the job.
     */
    async function settleGiveUp(job: RunnableJob, signal: AbortSignal): Promise<'ended' | 'stale' | 'stopped'> {
        const owed = giveUps.get(job.jobId);
        if (!owed) return 'ended';
        const finished = await sendFinishUntilTaken(job, () => finish(job, 'failed', { signal, cause: 'ours', generation: owed.generation, turns: [owed.turnNo], run: owed.run, ...(owed.epoch === undefined ? {} : { epoch: owed.epoch }), why: POOL_BUSY_WHY }), signal);
        if (finished === 'stopped') return 'stopped';
        // Orbit has ACCEPTED the finish: the give-up is over, and its committed fence is taken back. A finish that was refused as stale leaves it where it is
        // (the next turn has a number of its own, and a job that is still going is not given calls of the turn it gave up)
        if (finished === 'ended' && owed.attempt) await deps.refusals?.releaseTurn?.(job.jobId, owed.attempt).catch(() => undefined);
        giveUps.delete(job.jobId);
        return finished === 'stale' ? 'stale' : 'ended';
    }

    /**
     * Takes ownership of the job: the first thing a worker does before it sends Orbit anything that changes the job. `seen` is the owner epoch the worker read. Orbit gives the job to this run
     * (and ends every model key of it) only when no other worker claimed since: 'owned' with the epoch every later request carries; 'pending' when Orbit holds the job's end already (a kept
     * finish intent or a pool cutoff: no ownership is taken, the end is completed or awaited); 'over' when the job is gone; 'superseded' when another worker kept claiming ahead of this one
     * (a delayed claim always lands there); 'unsent' when Orbit could not be asked or answered something else (asked again after a wait).
     */
    /**
     * When the lease of the worker that holds a job ends, from what Orbit's `held` answer says (`until`: an ISO time or a count of milliseconds). An answer that names none, or names
     * something that cannot be read or is already past, is taken as a whole lease from now; one that names a time far ahead is held to one lease, so a wrong answer cannot park a job.
     */
    function leaseEndsAt(until: unknown): number {
        const lease = timing.leaseMs ?? 90_000;
        const at = now();
        const read = typeof until === 'number' ? until : typeof until === 'string' ? Date.parse(until) : Number.NaN;
        if (!Number.isFinite(read) || read <= at) return at + lease;
        return Math.min(read, at + lease);
    }

    async function claimJob(job: RunnableJob, run: string, seen: number, signal: AbortSignal): Promise<{ kind: 'owned'; epoch: number } | { kind: 'held'; until: number } | { kind: 'pending' | 'over' | 'superseded' | 'unsent' | 'stopped' | 'left' }> {
        let at = seen;
        // Read again and claim on what the job shows AT MOST ONCE (finding 3): a worker that lands behind another's claim twice leaves the job to it instead of going round again
        for (let attempt = 0; attempt < 2; attempt++) {
            if (signal.aborted) return { kind: 'stopped' };
            let answer: Record<string, unknown>;
            try {
                answer = await orbit.action(job.botId, job.jobId, { action: 'claim', run, seen: at });
            } catch (error) {
                const body = typeof error === 'object' && error !== null && 'response' in error ? (error as { response?: { data?: unknown } }).response?.data : undefined;
                if (statusOf(error) === 404) return { kind: 'over' };
                // A 409 carries the same answer a 200 does
                if (staleForOrbit(error) && typeof body === 'object' && body !== null) answer = body as Record<string, unknown>;
                else {
                    say('Could not claim a job:', error);
                    return { kind: 'unsent' };
                }
            }
            if (answer.ok === true && typeof answer.epoch === 'number' && Number.isInteger(answer.epoch) && answer.epoch > 0) return { kind: 'owned', epoch: answer.epoch };
            if (answer.reason === 'finish_pending' || answer.reason === 'cutoff') return { kind: 'pending' };
            if (answer.reason === 'over') return { kind: 'over' };
            // The job has a healthy owner: its lease was still alive. Nothing is claimed, nothing is read again, and the job is left alone until the lease ends (finding 3)
            if (answer.reason === 'held') return { kind: 'held', until: leaseEndsAt(answer.until) };
            // The job went back in line (paused, or put behind a job done first) before this worker could claim it: it is not this worker's, and its next stretch is claimed afresh
            if (answer.reason === 'not_running') return { kind: 'left' };
            if (answer.reason !== 'stale' && answer.reason !== 'superseded') return { kind: 'unsent' };
            // Someone claimed since this worker read the job: the job is read again and claimed on what it shows (a few times only: another worker that keeps winning owns it)
            const next = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            if (signal.aborted) return { kind: 'stopped' };
            if (next === null || (next && over(next.status))) return { kind: 'over' };
            if (!next) return { kind: 'unsent' };
            if (next.status === 'queued') return { kind: 'left' };
            if (next.finishPending) return { kind: 'pending' };
            if (next.ownerEpoch === undefined) return { kind: 'unsent' };
            at = next.ownerEpoch;
        }
        return { kind: 'superseded' };
    }

    async function work(job: RunnableJob, signal: AbortSignal): Promise<void> {
        // This run of the job's work: turns are numbered from 1 in each run, and a run begins again when the bot server restarts and takes the job up
        // (or when the job is taken up again in this process), so the rows of the calls and the finish name the run along with the turns
        const run = (deps.runId ?? newRunId)();
        // The ownership epoch this worker holds the job under (Orbit gives it at a claim): every request that changes the job carries it. Undefined for an Orbit that has no epochs
        let epoch: number | undefined;
        const held = (): { epoch?: number } => (epoch === undefined ? {} : { epoch });
        // This bot server has no model relay of its own, so it cannot run ANY job (GPT's sixth answer, finding 3): it claims nothing and ends nothing, and leaves the job where it is, so a
        // server that has a relay takes it up (at once when no one owns it, after the owner's lease otherwise). A job no server can run is given back by Orbit when its reservation lapses.
        // Ending it here would end the jobs of a whole deployment from one misconfigured server, and claiming it would take it from a worker that is running it.
        if (!deps.relayUrl) {
            log.error('[ComputerRunner] A job cannot run here and was left for another server: no address is set for the model relay (COMPUTER_RELAY_URL or BOT_SERVER_URL).');
            return;
        }
        // A give-up this runner owes Orbit for this job (a worker of it was stopped while Orbit had not taken the finish): it is finished BEFORE anything else, so no new turn opens until
        // Orbit has accepted it. A stale answer means the job moved on: it is read again as usual
        if (giveUps.has(job.jobId)) {
            const settled = await settleGiveUp(job, signal);
            if (settled !== 'stale') return;
        }
        // The job's own first words stay the ones to send until the agent has taken a turn: a turn that could not be started, or a take-over
        // before it, must not leave the agent with only "carry on" and no brief
        // A job that carries on an ended one ("try again") starts with the words that say so, in the same conversation
        let pending: string | null = job.hasTurn ? null : job.continuesJobId ? continuePrompt({ ...job, continuesJobId: job.continuesJobId }) : jobPrompt(job);
        let input: string | null = pending;
        const follow = (prompt: string) => pending ?? prompt;
        // Whether this worker has read that the job was paused before (its first words are then the resumed ones), so it is read once
        let resumedRead = false;
        // The person's notes: the highest number the agent has had (for this job, across workers), and the highest offered in the words of the turn being read
        const given = (): number => notesGiven.get(job.jobId) ?? 0;
        let offered = 0;
        // Orbit not told yet that the agent had the notes up to this number (its answer was lost): told again before the next turn, never given to the agent again
        const untoldOf = (): number | null => notesUntold.get(job.jobId) ?? null;
        const setUntold = (through: number | null): void => {
            if (through === null) notesUntold.delete(job.jobId);
            else {
                notesUntold.set(job.jobId, through);
                if (notesUntold.size > NOTES_KEPT) notesUntold.delete(notesUntold.keys().next().value as string);
            }
        };
        const forget = () => {
            notesGiven.delete(job.jobId);
            notesUntold.delete(job.jobId);
        };
        /** Tells Orbit the agent has had every note up to `through`, as the job's owner. A replaced worker is told so (its run ends); a lost answer is told again later. */
        const tellNotesSent = async (through: number): Promise<void> => {
            try {
                const answer = await orbit.action(job.botId, job.jobId, { action: 'notes-sent', through, ...held() });
                if (answer.ok === false && runStaleOf(answer)) {
                    // Another run holds the job: this run is over, and the reader of its turn (the acknowledgement can come while the turn is open) stops, nothing is cancelled
                    superseded.add(run);
                    accepted.stop?.();
                }
                const untold = untoldOf();
                // A superseded answer recorded nothing: the acknowledgement is still owed (to the owner that comes next, under its epoch)
                if (answer.ok === false && runStaleOf(answer)) setUntold(Math.max(untold ?? 0, through));
                else if (answer.ok === true || answer.ok === false) setUntold(untold !== null && untold > through ? untold : null);
                else setUntold(Math.max(untold ?? 0, through));
            } catch (error) {
                if (staleForOrbit(error) && runStaleOf(error)) {
                    superseded.add(run);
                    setUntold(Math.max(untoldOf() ?? 0, through));
                    accepted.stop?.();
                } else if (statusOf(error) === 404) setUntold(null);
                else {
                    setUntold(Math.max(untoldOf() ?? 0, through));
                    say('Could not tell Orbit a job had its notes:', error);
                }
            }
        };
        const renewing: Renewing = { nextAt: 0 };
        const accepted: Accepted = { turn: false };
        turnStoppers.set(job.jobId, () => accepted.stop?.());
        let turns = 0;
        let bad = 0;
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
            // Another run of this job holds it now (Orbit said so): this run does nothing more, and cancels nothing. (This process never has two workers on one job: a worker is
            // taken up again only after the one before it has ended, so a replaced run in this process is told by Orbit's answer, never by a second worker)
            if (superseded.has(run)) return;
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            if (state === null || (state && over(state.status))) {
                forget();
                leaseOver(job.jobId);
                return;
            }
            if (state === undefined) {
                // Orbit could not be asked: wait a moment and ask again
                await sleep(timing.waitMs, signal);
                continue;
            }
            // A job that went back in line (paused, or put behind a job done first) is left by `waitForBrick` with nothing ended or cancelled: it is never waited on
            if (state.status !== 'running' || state.control !== 'brick') {
                const back = await waitForBrick(job, signal, { epoch, generation: state.generation, delivered: given });
                if (back !== 'back' && back !== 'answered') return;
                // The person had the machine: what came before is no part of the job's next streak, nor of the next turn's window
                turnStartedAt = null;
                bad = 0;
                notOurs = false;
                confirmed = false;
                badTurns = [];
                input = follow(back === 'answered' ? ANSWERED_PROMPT : RESUME_PROMPT);
                continue;
            }
            // Orbit holds a finish intent for this job (a runner decided to abandon it and could not finish): the end is completed with the values it holds, and no turn is
            // opened, no machine is prepared and no call is admitted for the job. Whichever runner reads this (a replacement worker, a fresh process) does the same
            if (state.finishPending) {
                const completed = await completePending(job, state.finishPending, signal, state.generation, state.ownerEpoch);
                if (completed === 'stale') {
                    await sleep(timing.waitMs, signal);
                    continue;
                }
                return;
            }
            // Ownership comes first (before a machine is prepared, a turn opened or a failure reported): a worker that does not hold the job's current epoch is told it was superseded by
            // every request it makes, so it claims at the start, and a job another worker claimed since is no longer this worker's. An Orbit with no epochs asks for nothing of the kind
            if (state.ownerEpoch !== undefined && state.ownerEpoch !== epoch) {
                if (epoch !== undefined) {
                    superseded.add(run);
                    return;
                }
                const claimed = await claimJob(job, run, state.ownerEpoch, signal);
                if (claimed.kind === 'over') {
                    leaseOver(job.jobId);
                    return;
                }
                if (claimed.kind === 'stopped' || claimed.kind === 'left') return;
                // The job has a healthy owner (its lease is alive): this worker leaves it alone until the lease ends, and claims nothing in between (finding 3)
                if (claimed.kind === 'held') {
                    holdOff(job.jobId, claimed.until);
                    log.info?.(`[ComputerRunner] A job is already being run by another worker and was left to it until its lease ends.`);
                    return;
                }
                if (claimed.kind === 'superseded') {
                    superseded.add(run);
                    return;
                }
                if (claimed.kind !== 'owned') {
                    // The job's end is held (it is completed on the next read), or Orbit could not be asked: read again after a wait
                    await sleep(timing.waitMs, signal);
                    continue;
                }
                epoch = claimed.epoch;
                takeLease(job, run, epoch);
            }
            // A job that was paused and carries on: the agent is told so in its first words (the same conversation goes on), and is given the job again, since it may never have
            // had a turn of it. Only while its first words are still to be taken: a turn of this stretch already going is reconnected to as usual
            if (state.resumed && !resumedRead) {
                resumedRead = true;
                if (pending !== null) {
                    pending = resumedPrompt(job, state.askAgain === true);
                    if (input !== null) input = pending;
                }
            }
            // Orbit was not told the agent had its notes (the answer was lost): told now, before anything else of the turn
            const untold = untoldOf();
            if (untold !== null) await tellNotesSent(untold);
            if (superseded.has(run)) return;
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
                if ((await finish(job, 'failed', { signal, cause: 'agent', generation, run, ...held() })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            const ready = await prepared(job, deps.relayUrl, run, epoch, signal);
            if (ready === 'stopped') return;
            if (ready === 'superseded') {
                superseded.add(run);
                return;
            }
            if (ready === 'look') {
                // Waiting for the machine is not a turn: it must not use up the turns a job is allowed
                turns--;
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (ready === 'failed') {
                if ((await finish(job, 'failed', { signal, cause: 'ours', generation, run, ...held() })) === 'stale') {
                    await readAgain();
                    continue;
                }
                return;
            }
            if (ready === 'unreachable') {
                // The machine cannot reach our own model service: a confirmed fault of ours (nothing the job or the person did can cause it), noted on
                // a turn of this run so Orbit reads it against the turn it is told of, and said to the person in plain words
                // The row takes a number of its own, so the number is spent and the window (kept for a turn that was only to be reconnected to) goes with it: the turn that
                // comes after a finish refused as stale begins with its own number and its own window, never the one this row is noted on with the window of an earlier turn
                turnStartedAt = null;
                turnNo += 1;
                deps.refusals?.turn?.(job.jobId, turnNo, run);
                say('A job ended: the machine could not reach the model relay (check COMPUTER_RELAY_URL).');
                noteNoRelay(job, turnNo, run, 'prepare');
                if ((await finish(job, 'failed', { signal, cause: 'ours', generation, turns: [turnNo], run, ...held(), why: RELAY_UNREACHABLE_WHY })) === 'stale') {
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
            // The turn is told to the other bot servers before it is worked: a call of it that reaches another server is then tied to it, never to the turn before
            // (bounded: with the store failing it waits out the promise of the lists before it, a few seconds at most)
            await deps.refusals?.turnPublished?.(job.jobId)?.catch(() => undefined);
            if (signal.aborted) return;
            accepted.joined = false;
            // What the person told the job since the agent last heard from them goes with these words, after them; once the agent took the words, Orbit is told by the notes'
            // highest number (a retry never gives a note twice, a lost answer never drops one). A turn only reconnected to carries none: its words were sent before
            const fresh = input === null ? [] : newNotes(state, given());
            offered = Math.max(given(), ...fresh.map((note) => note.seq));
            let telling: Promise<void> | undefined;
            accepted.onSent =
                fresh.length > 0
                    ? () => {
                          notesGiven.set(job.jobId, Math.max(given(), offered));
                          if (notesGiven.size > NOTES_KEPT) notesGiven.delete(notesGiven.keys().next().value as string);
                          telling = tellNotesSent(offered);
                      }
                    : undefined;
            const words = input !== null && fresh.length > 0 ? `${input}\n\n${notesBlock(fresh)}` : input;
            const result = await oneTurn(job, words, signal, renewing, accepted, generation, turnStartedAt, () => seenFromStart && !(freshWindow && accepted.joined), { turn: turnNo, run, ...held() });
            accepted.onSent = undefined;
            if (telling) await telling;
            if (freshWindow && accepted.joined) seenFromStart = false;
            if (accepted.turn) pending = null;
            if (result.kind === 'stopped') return;
            // Orbit said another run holds the job while the turn went on (its intent or a renew was answered so): nothing of this turn is judged or ended, and nothing is cancelled
            if (superseded.has(run)) return;
            if (result.kind === 'poolBusy') {
                // Every call of the turn was refused for want of room: a confirmed fault of ours (nothing the job or the person did can cause it), noted on
                // this turn of this run, and the job is ended in plain words without waiting out the retries of the machine
                turnStartedAt = null;
                say('A job ended: every model call of its turn was refused for want of room in the shared pool.');
                notePoolBusy(job, turnNo, run);
                // The give-up is OWED to Orbit from here until Orbit has accepted it (or says the turn is a stale one, or the job is over): it is kept in the runner, not in this
                // worker, so a stop and a start of the runner (a replacement worker for the same job) finishes it before any new turn begins
                giveUps.set(job.jobId, { turnNo, run, generation, ...(epoch === undefined ? {} : { epoch }), ...(result.attempt ? { attempt: result.attempt } : {}) });
                const finished = await settleGiveUp(job, signal);
                if (finished === 'stopped') return;
                if (finished === 'stale') {
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
            if (after === null || over(after.status)) {
                forget();
                return;
            }
            // Another worker claimed the job while the turn went on, or it was paused (which moves the epoch too): it is not this worker's, and nothing this turn said is acted on, nothing
            // is cancelled and it is no bad turn (an end Orbit holds is still completed below, by whoever reads it). A job back in line on an Orbit with no epochs is left by `waitForBrick`
            if (epoch !== undefined && after.ownerEpoch !== undefined && after.ownerEpoch !== epoch && !after.finishPending) {
                superseded.add(run);
                return;
            }
            // An end Orbit holds for the job is completed from THIS read (the intent and the generation it showed), with no turn begun first: a later read that came from a replica that
            // had not seen the intent yet would let a prepare or a turn go out first
            if (after.finishPending) {
                const completed = await completePending(job, after.finishPending, signal, after.generation, after.ownerEpoch);
                if (completed === 'stale') {
                    // The job moved on meanwhile: it is read again
                    await sleep(timing.waitMs, signal);
                    continue;
                }
                return;
            }
            if (after.status !== 'running' || after.control !== 'brick') {
                const back = await waitForBrick(job, signal, { epoch, generation: after.generation, delivered: given });
                if (back !== 'back' && back !== 'answered') return;
                input = follow(back === 'answered' ? ANSWERED_PROMPT : RESUME_PROMPT);
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
            // The person told the job something while this turn went on (Orbit cut the turn short for it, or it came as the turn ended): the turn's words are not acted on (an
            // ending they said may be what the person just changed), it is neither a failure nor a refusal, it does not count in the streak or in the job's turns, and the next turn
            // gives the agent the person's words at once. A note that was in this turn's own words is no new one: a turn that could not even take them is judged as usual
            if (newNotes(after, Math.max(offered, given())).length > 0) {
                input = follow(NOTE_PROMPT);
                turns--;
                continue;
            }
            if (result.fenced) {
                input = follow(RESUME_PROMPT);
                continue;
            }

            // A turn that was cut off may have said its marker, but the machine's turn may still be running: no ending is taken from it
            const ending = result.failed ? ({ kind: 'none' } as const) : endingOf(result.words);
            if (ending.kind === 'done' || ending.kind === 'failed') {
                const ended = ending.kind === 'done' ? await finish(job, 'done', { generation, signal, run, ...held() }) : await finish(job, 'failed', { signal, cause: 'agent', generation, run, ...held(), why: whyOf(result.words) });
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
                    // The wait ends when the worker is stopped: a handover is never sent after that (Orbit would put the job in waiting for a worker that was stopped)
                    if (signal.aborted) return;
                    handed = await orbit
                        .action(
                            job.botId,
                            job.jobId,
                            fenced(
                                {
                                    action: 'handover',
                                    waitingFor: ending.waitingFor,
                                    ...(ending.waitingFor === 'details' && ending.what && ending.where ? { ready: { what: ending.what, where: ending.where } } : {}),
                                    // The provider turn this handover comes from: Orbit lands it only while the job is still on that turn (a delayed handover of an old worker never holds the replacement's job)
                                    ...(result.responseId ? { responseId: result.responseId } : {}),
                                },
                                generation,
                                epoch
                            )
                        )
                        // An answer that says it was refused (ok false) is no handover
                        .then((answer) => {
                            // Another worker owns the job: this run is over, nothing is ended for it
                            if (answer.ok === false && runStaleOf(answer)) {
                                superseded.add(run);
                                stale = true;
                                return false;
                            }
                            // The turn the handover names is no longer the job's (`not_current`), or the job is on another control generation (`stale`): the job is read again, nothing is ended on it
                            if (answer.ok === false && (answer.reason === 'stale' || answer.reason === 'not_current')) {
                                stale = true;
                                return false;
                            }
                            if (answer.ok === false) refusedHandover = true;
                            return answer.ok !== false;
                        })
                        .catch((error) => {
                            if (staleForOrbit(error) && runStaleOf(error)) superseded.add(run);
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
                if (superseded.has(run)) return;
                if (stale) {
                    await readAgain();
                    continue;
                }
                if (!handed) {
                    if ((await finish(job, 'failed', { signal, cause: refusedHandover ? 'agent' : 'ours', generation, run, ...held() })) === 'stale') {
                        await readAgain();
                        continue;
                    }
                    return;
                }
                const back = await waitForBrick(job, signal, { epoch, generation, delivered: given });
                if (back !== 'back' && back !== 'answered') return;
                input = follow(back === 'answered' ? ANSWERED_PROMPT : RESUME_PROMPT);
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
                if ((await finish(job, 'failed', { signal, cause, generation, turns: badTurns, run, ...held() })) === 'stale') {
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
            // A job another worker holds with a live lease is left alone until that lease ends: nothing is claimed for it in between (finding 3)
            const until = heldUntil.get(job.jobId);
            if (until !== undefined) {
                if (until > now()) continue;
                heldUntil.delete(job.jobId);
            }
            const controller = new AbortController();
            const done = work(job, controller.signal)
                .catch((error) => say('A job stopped on an error:', error))
                // A worker that stops while it still owns a job gives its lease back at once, so a replacement takes the job up without waiting for the lease to lapse
                .finally(() => giveLeaseBack(job))
                .finally(() => {
                    turnStoppers.delete(job.jobId);
                    workers.delete(job.jobId);
                });
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
    const opened = async (jobId: string, step: 'turn' | 'stream', input: string | null, signal: AbortSignal, epoch?: number): Promise<TurnOpened> => {
        const answer = await admin.computerOpenTurn(jobId, step, input, signal, epoch);
        if ('body' in answer) return { ok: true, events: readRunnerEvents(answer.body) };
        return { ok: false, reason: answer.status >= 500 ? 'failed' : answer.reason, ...(answer.responseId ? { responseId: answer.responseId } : {}), ...(answer.superseded ? { superseded: true as const } : {}) };
    };
    return {
        running: () => admin.computerRunningJobs(),
        job: async (botId, jobId) => {
            const job = await admin.getComputerJob(botId, jobId);
            return job
                ? {
                      status: job.status,
                      control: job.control,
                      ...(job.generation === undefined ? {} : { generation: job.generation }),
                      ...(job.ownerEpoch === undefined ? {} : { ownerEpoch: job.ownerEpoch }),
                      ...(job.finishPending ? { finishPending: job.finishPending } : {}),
                      ...(job.resumed ? { resumed: true } : {}),
                      ...(job.askAgain ? { askAgain: true } : {}),
                      ...(job.notes && job.notes.length > 0 ? { notes: job.notes } : {}),
                  }
                : null;
        },
        action: (botId, jobId, body) => admin.computerJobAction(botId, jobId, body),
        prepare: async (jobId, relay, extra) => {
            const answer = await admin.computerBroker(jobId, 'prepare', { relay, ...extra });
            if (answer.status === 200 && answer.data.ok === true) return { ok: true };
            // Another worker owns the job (409 stale, run superseded): said apart from the other refusals, since this run is over
            if (answer.data.reason === 'stale' && answer.data.run === 'superseded') return { ok: false, reason: 'superseded' };
            return { ok: false, reason: answer.status >= 500 || typeof answer.data.reason !== 'string' ? 'failed' : answer.data.reason };
        },
        turn: (jobId, input, signal, epoch) => opened(jobId, 'turn', input, signal, epoch),
        stream: (jobId, signal, epoch) => opened(jobId, 'stream', null, signal, epoch),
        cancel: async (jobId, facts) => {
            await admin.computerBroker(jobId, 'cancel', { ...(facts?.epoch === undefined ? {} : { epoch: facts.epoch }), ...(facts?.responseId ? { responseId: facts.responseId } : {}) });
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
