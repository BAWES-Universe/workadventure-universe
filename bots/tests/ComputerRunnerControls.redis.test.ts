import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { AdminApiService } from '../server/AdminApiService';
import { RedisSharedCalls } from '../server/ComputerEvidenceStore';
import { createRefusalNotes, type RefusalNotes } from '../server/ComputerRefusals';
import {
    ANSWERED_PROMPT,
    ASK_AGAIN_HEAD,
    CONTINUE_PROMPT,
    createComputerRunner,
    NOTE_PROMPT,
    RESUME_PROMPT,
    RESUMED_HEAD,
    RUNNER_GUARDS,
    runnerOrbitFor,
    type ComputerRunner,
    type RunnableJob,
    type RunnerEvent,
    type RunnerJobState,
    type RunnerOrbit,
    type TurnOpened,
} from '../server/ComputerRunner';

/**
 * The computers full plan, piece 6 (the runner's side of the job controls), against Opus's acceptance cases C5.6 and C8.3 to C8.5:
 *  - a job that pauses (the person's Pause, "do this first", or Orbit pausing it when the month or the person's own limit runs out) is left by its worker at once: no cancel, no
 *    finish, no bad turn, and no worker kept polling a paused job. Orbit owns the pause, its turn cancel and the stretch it charged;
 *  - a paused job that carries on is taken up by a FRESH claim (a new epoch) and its agent is told it was paused, in the same conversation, with the job again;
 *  - a renewal answered `paused` is handled like `ending`;
 *  - the person's notes reach the agent in order, each once, by their number (`notes-sent` names the highest one given, with the owner's epoch); a turn Orbit cut short for a note
 *    is never a failure, never a refusal and never a bad turn; a note to a job that waits for the person answers it; a note during a take-over waits for the hand back.
 *
 * Orbit here is a double that keeps to the contract pieces 1 and 2 froze (interfaces.md, SUMMARY.md of each), including Rule C: a pause or a note writes first, then cancels the
 * provider turn it read. The relay's refusal notes are the real ones, on a real Redis.
 */
const REAL_REDIS = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(process.env.BOTS_REQUIRE_REDIS === '1' && !REAL_REDIS)('the real Redis for the runner controls tests', () => {
    it('is given when the run requires it (CI): the controls are never left untested', () => {
        expect(REAL_REDIS, 'BOTS_TEST_REDIS_URL is not set while BOTS_REQUIRE_REDIS=1').toBeTruthy();
    });
});

const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
const RELAY = 'https://bot-server.example.test';
const TIMING = { waitMs: 5, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0], poolCheckMs: 10_000, poolGiveUpMs: 600_000, cleanupMs: 200 };
const quiet = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (what: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!what()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await pause(2);
    }
};
const http = (status: number, data: unknown) => Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });

/** How a turn goes: `done`/`failed`/`silent`/`handover` end by themselves; `hang` runs until Orbit cancels it (then ends the way `cut` says) or the runner lets go of it. */
type Script =
    | { kind: 'done' | 'failed-words' | 'silent' | 'handover' | 'broken'; words?: string }
    | { kind: 'hang'; cut?: 'completed' | 'failed'; words?: string; onOpen?: () => void; /** The turn ends BY ITSELF when this settles, and Orbit's cancel (a note, a pause) does not end it: a turn that finishes on its own while a note is pending. */ gate?: Promise<void> };

interface Request {
    kind: string;
    epoch?: number;
    body?: Record<string, unknown>;
    answer: string;
}

/** Orbit, as pieces 1 and 2 froze it, for one job. */
function controlsOrbit(options: { afterListing?: () => void; noEpochs?: boolean; laggingReads?: boolean; renew?: (n: number) => Record<string, unknown>; notesSent?: (n: number) => 'ok' | 'lost' | 'down' | 'conflict'; claim?: (n: number) => Record<string, unknown> | null; turnOpen?: (n: number) => 'ok' | 'failed' | 'busy' } = {}) {
    const state = {
        status: 'running' as 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped',
        queuedFor: null as null | 'paused' | 'turn',
        control: 'brick' as 'brick' | 'person',
        generation: 1,
        ownerEpoch: 0,
        leaseVersion: 0,
        pauses: 0,
        /** The last pause took the screen back from the person (Orbit piece 3's held-screen limit pause): GET job says `askAgain` once the job carries on. */
        askAgain: false,
        responseId: null as string | null,
        noteSeq: 0,
        notes: [] as Array<{ seq: number; text: string; state: 'pending' | 'sent' }>,
        inputs: [] as string[],
        requests: [] as Request[],
        finishes: [] as Array<Record<string, unknown>>,
        /** Turn cancels the RUNNER asked for (Orbit's own, after a pause or a note, are `providerCancels`). */
        runnerCancels: [] as Array<Record<string, unknown>>,
        providerCancels: [] as string[],
        reads: 0,
        counts: {} as Record<string, number>,
    };
    const scripts: Script[] = [];
    const live = new Map<string, () => void>();
    let turnN = 0;
    const isOver = () => state.status === 'done' || state.status === 'failed' || state.status === 'stopped';
    const owns = (epoch: number | undefined) => options.noEpochs === true || (epoch === undefined ? state.ownerEpoch === 0 : epoch === state.ownerEpoch);
    /** The epoch this worker claimed: a lagging replica shows it whatever the job is on now. */
    let claimed: number | undefined;
    const count = (kind: string) => (state.counts[kind] = (state.counts[kind] ?? 0) + 1);
    const log = (kind: string, answer: string, epoch?: number, body?: Record<string, unknown>) => state.requests.push({ kind, answer, ...(epoch === undefined ? {} : { epoch }), ...(body ? { body } : {}) });
    const superseded = { ok: false, reason: 'stale', run: 'superseded' };
    /** Orbit's provider cancel, AFTER its own write (Rule C), of exactly the turn the write read. */
    const providerCancel = (responseId: string | null) => {
        if (!responseId) return;
        state.providerCancels.push(responseId);
        live.get(responseId)?.();
    };

    const turnOf = (id: string, script: Script, signal: AbortSignal): AsyncGenerator<RunnerEvent> =>
        (async function* () {
            yield { type: 'created', id, sessionId: 'agent-session-1' };
            if (script.kind === 'done') return yield { type: 'completed', outputText: script.words ?? 'All fine. [[done]]', usage: null };
            if (script.kind === 'failed-words') return yield { type: 'completed', outputText: script.words ?? 'I cannot. [[failed]]', usage: null };
            if (script.kind === 'silent') return yield { type: 'completed', outputText: '', usage: null };
            if (script.kind === 'handover') return yield { type: 'completed', outputText: script.words ?? 'Which date? [[handover answer]]', usage: null };
            if (script.kind !== 'hang') return yield { type: 'failed', code: 'server_error', message: 'the model broke' };
            // A hanging turn: it ends when Orbit cancels it (a pause, a note) or when the runner lets go of it
            let cut!: () => void;
            const cancelled = new Promise<'cut'>((resolve) => (cut = () => resolve('cut')));
            // A gated turn is ended by its gate alone: Orbit's cancel finds nothing to cut
            if (!script.gate) live.set(id, cut);
            script.onOpen?.();
            // (a stream that is opened on a signal that has already fired ends at once, as a real one does)
            const letGo = new Promise<'gone'>((resolve) => (signal.aborted ? resolve('gone') : signal.addEventListener('abort', () => resolve('gone'), { once: true })));
            const how = await Promise.race([script.gate ? script.gate.then(() => 'cut' as const) : cancelled, letGo]);
            live.delete(id);
            if (how === 'gone') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            if (script.cut === 'failed') yield { type: 'failed', code: 'cancelled', message: 'The turn was cancelled' };
            else yield { type: 'completed', outputText: script.words ?? 'Working on the form', usage: null };
        })();

    const orbit: RunnerOrbit = {
        // Orbit lists the jobs running under Brick's hands (not waiting, not taken over)
        running: async () => {
            const listed = state.status === 'running' && state.control === 'brick' ? [{ ...JOB, hasTurn: state.responseId !== null }] : [];
            options.afterListing?.();
            return listed;
        },
        job: async (): Promise<RunnerJobState | null> => {
            state.reads += 1;
            return {
                status: state.status,
                control: state.control,
                generation: state.generation,
                ...(options.noEpochs ? {} : { ownerEpoch: options.laggingReads && claimed !== undefined ? claimed : state.ownerEpoch }),
                finishPending: null,
                ...(state.pauses > 0 ? { resumed: true } : {}),
                ...(state.pauses > 0 && state.askAgain ? { askAgain: true } : {}),
                ...(state.notes.some((note) => note.state === 'pending') ? { notes: state.notes.filter((note) => note.state === 'pending').map(({ seq, text }) => ({ seq, text })) } : {}),
            };
        },
        action: async (_botId, _jobId, body) => {
            const kind = String(body.action);
            const n = count(kind);
            const epoch = typeof body.epoch === 'number' ? body.epoch : undefined;
            if (kind === 'claim') {
                const forced = options.claim?.(n);
                if (forced) {
                    log(kind, String(forced.reason ?? 'forced'), epoch, body);
                    return forced;
                }
                if (isOver()) return log(kind, 'over', epoch, body), { ok: false, reason: 'over' };
                if (state.status === 'queued') return log(kind, 'not_running', epoch, body), { ok: false, reason: 'not_running' };
                if (body.seen !== state.ownerEpoch) return log(kind, 'superseded', epoch, body), { ok: false, reason: 'superseded', ownerEpoch: state.ownerEpoch };
                state.ownerEpoch += 1;
                state.leaseVersion += 1;
                claimed = state.ownerEpoch;
                log(kind, 'claimed', state.ownerEpoch, body);
                return { ok: true, epoch: state.ownerEpoch };
            }
            // What notes-sent does is decided as it arrives (a test may move the world first)
            const mode = kind === 'notes-sent' ? (options.notesSent?.(n) ?? 'ok') : 'ok';
            if (isOver()) return log(kind, 'over', epoch, body), kind === 'notes-sent' ? { ok: false, reason: 'over' } : { ok: true, already: true };
            if (!owns(epoch)) return log(kind, 'superseded', epoch, body), superseded;
            if (kind === 'renew') {
                // Piece 1: a job in line (paused under its worker) is never "renew in a minute" for an old worker; the epoch check above answers it first
                const answer = options.renew?.(n) ?? { ok: true, renewInSeconds: 240 };
                log(kind, answer.ok === false ? String(answer.reason) : 'ok', epoch, body);
                return answer;
            }
            if (kind === 'progress') return log(kind, 'ok', epoch, body), { ok: true };
            if (kind === 'handover') {
                if (state.status !== 'running' || state.control !== 'brick') return log(kind, 'stale', epoch, body), { ok: false, reason: 'stale' };
                if (typeof body.responseId === 'string' && body.responseId !== state.responseId) return log(kind, 'not_current', epoch, body), { ok: false, reason: 'not_current' };
                state.status = 'waiting';
                state.leaseVersion += 1;
                return log(kind, 'handed', epoch, body), { ok: true };
            }
            if (kind === 'finish') {
                state.finishes.push(body);
                state.status = body.outcome === 'done' ? 'done' : 'failed';
                return log(kind, 'ended', epoch, body), { ok: true };
            }
            if (kind === 'notes-sent') {
                if (mode === 'down') {
                    log(kind, 'down', epoch, body);
                    throw http(503, {});
                }
                // Orbit's answer is a 409 whose body says another run holds the job
                if (mode === 'conflict') {
                    log(kind, 'superseded', epoch, body);
                    throw http(409, superseded);
                }
                let sent = 0;
                for (const note of state.notes) {
                    if (note.state === 'pending' && note.seq <= Number(body.through)) {
                        note.state = 'sent';
                        sent += 1;
                    }
                }
                log(kind, mode === 'lost' ? 'lost' : 'ok', epoch, body);
                // Done at Orbit, but the answer never came back
                if (mode === 'lost') throw http(502, {});
                return { ok: true, sent };
            }
            return log(kind, 'ok', epoch, body), { ok: true };
        },
        prepare: async (_jobId, _relay, extra) => {
            const epoch = extra?.epoch;
            if (!owns(epoch)) return log('prepare', 'superseded', epoch), { ok: false, reason: 'superseded' };
            if (state.status !== 'running' || state.control !== 'brick') return log('prepare', 'not_brick', epoch), { ok: false, reason: 'not_running' };
            return log('prepare', 'ok', epoch), { ok: true };
        },
        turn: async (_jobId, input, signal, epoch): Promise<TurnOpened> => {
            count('turn');
            if (!owns(epoch)) return log('turn', 'superseded', epoch), { ok: false, reason: 'stale', superseded: true };
            if (state.status !== 'running' || state.control !== 'brick') return log('turn', 'not_brick', epoch), { ok: false, reason: 'not_running' };
            turnN += 1;
            const opening = options.turnOpen?.(turnN) ?? 'ok';
            if (opening === 'failed') return log('turn', 'failed', epoch), { ok: false, reason: 'failed' };
            if (opening === 'busy') {
                // The agent is still on a turn of its own: this input is NOT taken
                return log('turn', 'busy', epoch), { ok: false, reason: 'busy', responseId: state.responseId ?? 'resp-own' };
            }
            state.inputs.push(input);
            const id = `resp-${turnN}`;
            state.responseId = id;
            log('turn', 'opened', epoch, { input });
            const script = scripts.shift() ?? { kind: 'done' };
            return { ok: true, events: turnOf(id, script, signal) };
        },
        stream: async (_jobId, signal, epoch): Promise<TurnOpened> => {
            count('stream');
            if (!owns(epoch)) return log('stream', 'superseded', epoch), { ok: false, reason: 'stale', superseded: true };
            log('stream', 'no_turn', epoch);
            // The busy turn of the agent's own: it ends as it would
            if (state.responseId === 'resp-own' || !state.responseId) {
                const script = scripts.shift() ?? { kind: 'silent' };
                return { ok: true, events: turnOf('resp-own', script, signal) };
            }
            return { ok: false, reason: 'no_turn' };
        },
        cancel: async (_jobId, facts) => {
            state.runnerCancels.push({ ...(facts ?? {}) });
            log('cancel', 'ok', facts?.epoch, { ...(facts ?? {}) });
        },
    };

    /** The person's controls, as piece 1 and piece 2 write them: the write first, then the provider cancel of the turn it read (Rule C). */
    const person = {
        /** Pause (or, with `backInLine`, "do this first" putting this job back in line as waiting): the epoch moves, the turn is cut. */
        pause(backInLine = false) {
            if (isOver() || state.control !== 'brick') return false;
            const read = state.responseId;
            if (state.status === 'running' || state.status === 'waiting') {
                state.pauses += 1;
                state.ownerEpoch += 1;
            }
            state.status = 'queued';
            state.queuedFor = backInLine ? 'turn' : 'paused';
            state.responseId = null;
            state.leaseVersion += 1;
            providerCancel(read);
            return true;
        },
        /** Resume (or the line taking up the job put back): tryStart makes it running with a new reservation; the runner claims it afresh. */
        resume() {
            state.status = 'running';
            state.queuedFor = null;
        },
        note(text: string) {
            state.noteSeq += 1;
            state.notes.push({ seq: state.noteSeq, text, state: 'pending' });
            if (state.status === 'running' && state.control === 'brick' && state.responseId) {
                // The lease version moves, the epoch does NOT: the same worker carries on
                const read = state.responseId;
                state.leaseVersion += 1;
                providerCancel(read);
            } else if (state.status === 'waiting' && state.control === 'brick') {
                // Their words are the answer: the wait ends at once, on the same control generation
                state.status = 'running';
                state.leaseVersion += 1;
            }
            return state.noteSeq;
        },
        takeOver() {
            state.control = 'person';
            state.generation += 1;
            providerCancel(state.responseId);
        },
        handBack() {
            state.control = 'brick';
            state.status = 'running';
            state.generation += 1;
        },
    };
    return { orbit, state, scripts, person, live };
}

const SINGLE_RUN = () => 'run-a';

describe.runIf(!!REAL_REDIS)('the runner and the computer job controls (piece 6), on a real Redis', () => {
    let client!: ReturnType<typeof createClient>;
    let opened = false;
    const runners: ComputerRunner[] = [];
    beforeAll(async () => {
        client = createClient({ url: REAL_REDIS, socket: { reconnectStrategy: false } });
        client.on('error', () => undefined);
        await client.connect();
        opened = true;
    });
    afterAll(async () => {
        if (opened) await client.quit().catch(() => undefined);
    });
    afterEach(async () => {
        for (const runner of runners.splice(0)) {
            runner.stop();
            await runner.idle();
        }
    });
    const notesOf = (): RefusalNotes => createRefusalNotes(Date.now, { sink: async () => true, shared: new RedisSharedCalls(() => client as never, `controls-${randomUUID()}`) });
    const runnerOf = (orbit: RunnerOrbit, notes: RefusalNotes = notesOf(), runId: () => string = (() => {
        let n = 0;
        return () => `run-${++n}`;
    })()) => {
        const runner = createComputerRunner({ orbit, relayUrl: RELAY, timing: TIMING, log: quiet(), refusals: notes, runId });
        runners.push(runner);
        return runner;
    };
    const idleWithin = async (runner: ComputerRunner, ms = 2000) => {
        await Promise.race([runner.idle(), pause(ms).then(() => Promise.reject(new Error(`the worker did not leave within ${ms} ms`)))]);
    };
    const kinds = (state: { requests: Request[] }, from = 0) => state.requests.slice(from).map((one) => one.kind);

    describe('a job that pauses is left by its worker at once (C1.2, C5.6): no cancel, no finish, no bad turn, no polling of a paused job', () => {
        it('the person pauses mid-turn: the worker leaves with nothing ended or cancelled, and its old epoch sends nothing more', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed', words: 'Filled in page 1 [[done]]' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            const before = state.requests.length;
            expect(person.pause()).toBe(true);
            await idleWithin(runner);
            // Orbit cut the turn (its own cancel, after its write); the runner neither cancelled nor finished, and the words "[[done]]" of the cut turn were not acted on
            expect(state.providerCancels).toEqual(['resp-1']);
            expect(state.runnerCancels).toEqual([]);
            expect(state.finishes).toEqual([]);
            expect(state.status).toBe('queued');
            // Nothing the old epoch sent after the pause changed anything (a progress report may be answered superseded): no handover, no finish, no prepare, no turn
            expect(kinds(state, before).filter((kind) => !['progress', 'job'].includes(kind))).toEqual([]);
            // And it does not poll the paused job: no reads once it left
            const reads = state.reads;
            await pause(60);
            expect(state.reads).toBe(reads);
            expect(runner.active()).toEqual([]);
        });

        it('a renewal answered `paused` before the turn opens (the month or the person`s own limit ran out): NO cancel, NO finish, no turn, and the worker leaves', async () => {
            const box: { person?: ReturnType<typeof controlsOrbit>['person'] } = {};
            const made = controlsOrbit({
                renew: (n) => {
                    if (n > 1) return { ok: true, renewInSeconds: 240 };
                    // Orbit pauses the job in the renewal's own transaction (it holds no room any more), then answers `paused`
                    box.person?.pause();
                    return { ok: false, reason: 'paused', why: 'allowance' };
                },
            });
            box.person = made.person;
            const { orbit, state } = made;
            const runner = runnerOf(orbit);
            await runner.tick();
            await idleWithin(runner);
            expect(state.runnerCancels).toEqual([]);
            expect(state.finishes).toEqual([]);
            expect(state.inputs).toEqual([]);
            expect(state.status).toBe('queued');
            // When more time arrives it carries on by itself (Orbit flips it and starts it): a fresh claim, the resumed words, and the end on the new epoch
            made.person.resume();
            await runner.tick();
            await idleWithin(runner);
            expect(state.inputs).toHaveLength(1);
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done', epoch: state.ownerEpoch })]);
        });

        it('a renewal answered `paused` in the middle of a turn: the turn stops at once with NO cancel and NO finish (Orbit owns the cancel), and the run exits on the moved epoch', async () => {
            const box: { person?: ReturnType<typeof controlsOrbit>['person'] } = {};
            const made = controlsOrbit({
                renew: (n) => {
                    if (n < 2) return { ok: true, renewInSeconds: 5 };
                    box.person?.pause();
                    return { ok: false, reason: 'paused', why: 'rule' };
                },
            });
            box.person = made.person;
            const { orbit, state, scripts, live } = made;
            scripts.push({ kind: 'hang', cut: 'completed', words: 'half way [[done]]' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            // Orbit's own cancel of the turn is held back here, so it is the runner's answer to `paused` alone that is tested
            live.delete('resp-1');
            await until(() => (state.counts.renew ?? 0) >= 2, 8000);
            await idleWithin(runner);
            expect(state.runnerCancels).toEqual([]);
            expect(state.finishes).toEqual([]);
            expect(state.requests.filter((one) => one.kind === 'handover')).toEqual([]);
        }, 15_000);

        it('a job paused while it waits for the person (not taken over): the waiting worker leaves at once instead of polling the paused job for days', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'handover' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.status === 'waiting');
            await pause(20);
            expect(runner.active()).toEqual(['job-1']);
            person.pause();
            await idleWithin(runner);
            const reads = state.reads;
            await pause(60);
            expect(state.reads).toBe(reads);
            expect(state.finishes).toEqual([]);
            expect(state.runnerCancels).toEqual([]);
            // Resumed: the agent is asked again (the resumed words say so) on a fresh claim
            person.resume();
            scripts.push({ kind: 'done' });
            await runner.tick();
            await idleWithin(runner);
            expect(state.inputs[1].startsWith(RESUMED_HEAD)).toBe(true);
            expect(state.inputs[1]).toContain('If you were waiting for the person when it paused, ask them again.');
            expect(state.finishes).toHaveLength(1);
        });

        it('"do this first" puts the running job back in line as waiting (not paused): the worker leaves the same way, and the job carries on later on a fresh claim', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'failed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            const firstEpoch = state.ownerEpoch;
            person.pause(true);
            await idleWithin(runner);
            expect(state.queuedFor).toBe('turn');
            expect(state.finishes).toEqual([]);
            expect(state.runnerCancels).toEqual([]);
            person.resume();
            scripts.push({ kind: 'done' });
            await runner.tick();
            await idleWithin(runner);
            const claims = state.requests.filter((one) => one.kind === 'claim' && one.answer === 'claimed');
            expect(claims).toHaveLength(2);
            expect(claims[1].epoch).toBeGreaterThan(firstEpoch + 1);
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done', epoch: state.ownerEpoch })]);
        });

        it('a claim answered `not_running` (the job went back in line before this worker could claim it): the worker leaves, sends nothing else and does not keep asking', async () => {
            const { orbit, state } = controlsOrbit({ claim: () => ({ ok: false, reason: 'not_running' }) });
            const runner = runnerOf(orbit);
            await runner.tick();
            await idleWithin(runner);
            expect(kinds(state)).toEqual(['claim']);
            expect(state.finishes).toEqual([]);
        });
    });

    describe('a paused job carries on (C3.1): a fresh claim, the same conversation, told it was paused', () => {
        it('its first turn after resume is the resumed words with the job again, sent on the NEW epoch, and the job ends on that epoch', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            expect(state.inputs[0].startsWith('You are working on a computer')).toBe(true);
            const oldEpoch = state.ownerEpoch;
            person.pause();
            await idleWithin(runner);
            person.resume();
            scripts.push({ kind: 'done' });
            await runner.tick();
            await idleWithin(runner);
            expect(state.inputs).toHaveLength(2);
            expect(state.inputs[1].startsWith(RESUMED_HEAD)).toBe(true);
            expect(state.inputs[1]).toContain('Job: Visa form');
            const opened = state.requests.filter((one) => one.kind === 'turn' && one.answer === 'opened');
            expect(opened[1].epoch).toBe(state.ownerEpoch);
            expect(state.ownerEpoch).toBeGreaterThan(oldEpoch + 1);
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done', epoch: state.ownerEpoch })]);
            expect(state.runnerCancels).toEqual([]);
        });

        it('a pause that took the screen back from the person (askAgain): the first turn after resume asks the person for their step before touching the page, on the new epoch', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            // Orbit's held-screen limit pause, as the runner sees it: the job paused like any other, and on carrying on GET job says askAgain
            state.askAgain = true;
            person.pause();
            await idleWithin(runner);
            expect(state.runnerCancels).toEqual([]);
            person.resume();
            scripts.push({ kind: 'handover', words: 'Were you in the middle of paying? [[handover answer | what you were doing | this computer]]' });
            await runner.tick();
            await until(() => state.inputs.length === 2);
            expect(state.inputs[1].startsWith(ASK_AGAIN_HEAD)).toBe(true);
            expect(state.inputs[1]).not.toContain(RESUMED_HEAD);
            expect(state.inputs[1]).toContain('Job: Visa form');
            const opened = state.requests.filter((one) => one.kind === 'turn' && one.answer === 'opened');
            expect(opened[1].epoch).toBe(state.ownerEpoch);
        });

        it('a resumed job whose turn of this stretch is already going (a restart) is reconnected to, not sent the resumed words again', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.pause();
            await idleWithin(runner);
            person.resume();
            scripts.push({ kind: 'hang', cut: 'completed' });
            await runner.tick();
            await until(() => state.inputs.length === 2);
            // The bot server restarts while the resumed stretch's first turn goes on
            runner.stop();
            await runner.idle();
            const second = runnerOf(orbit);
            scripts.push({ kind: 'done' });
            second.start(60_000);
            await until(() => (state.counts.stream ?? 0) >= 1);
            // It reconnects to the turn (here gone, so the next turn is a plain "carry on"): the resumed words are not sent twice
            await until(() => state.inputs.length === 3);
            expect(state.inputs[2]).toBe(CONTINUE_PROMPT);
        });
    });

    describe('the person`s notes reach the agent in order, each once (C8.3, C8.4, C8.5)', () => {
        it('a note mid-turn: Orbit cuts the turn, the next turn gives the note at once, notes-sent names its number with the owner`s epoch, and the job carries on to its end', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed', words: 'Filling the form, page 2 [[done]]' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            const epoch = state.ownerEpoch;
            person.note('Use 12 March instead');
            await idleWithin(runner);
            expect(state.ownerEpoch).toBe(epoch);
            expect(state.inputs).toHaveLength(2);
            expect(state.inputs[1].startsWith(NOTE_PROMPT)).toBe(true);
            expect(state.inputs[1]).toContain('> Use 12 March instead');
            const sent = state.requests.filter((one) => one.kind === 'notes-sent');
            expect(sent).toEqual([expect.objectContaining({ epoch, body: expect.objectContaining({ through: 1, epoch }) })]);
            expect(state.notes.every((note) => note.state === 'sent')).toBe(true);
            // The cut turn's "[[done]]" was not taken: the job ended on the turn after the note
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done' })]);
            expect(state.runnerCancels).toEqual([]);
        });

        it('a turn cut for a note is never a bad turn and never the person`s refusal: two broken turns, a note (with an allowance refusal noted in its turn), then a broken turn is a streak of three of OURS, and the note was given first', async () => {
            const notes = notesOf();
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push(
                { kind: 'broken' },
                { kind: 'broken' },
                {
                    kind: 'hang',
                    cut: 'failed',
                    onOpen: () => notes.record(JOB.botId, JOB.jobId, { callId: `allow-${randomUUID()}`, kind: 'not_ours', reason: 'allowance', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 429 }),
                },
                { kind: 'broken' }
            );
            const runner = runnerOf(orbit, notes, SINGLE_RUN);
            await runner.tick();
            await until(() => state.inputs.length === 3);
            await pause(10);
            person.note('Skip the hotel');
            await idleWithin(runner, 3000);
            expect(state.inputs).toHaveLength(4);
            expect(state.inputs[3].startsWith(NOTE_PROMPT)).toBe(true);
            expect(state.finishes).toHaveLength(1);
            // The streak is the three broken turns 1, 2 and 4, ours: the cut turn 3 is not in it, and its refusal did not make the streak the person's
            expect(state.finishes[0]).toMatchObject({ outcome: 'failed', cause: 'ours', turns: [1, 2, 4] });
        });

        it('a note that arrives as a turn ends with "[[done]]": the job is not ended on words the person just changed, the note is given, and the agent ends it again', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            let finishNaturally!: () => void;
            const gate = new Promise<void>((resolve) => (finishNaturally = resolve));
            scripts.push({ kind: 'hang', cut: 'completed', words: 'Sent it. [[done]]', gate }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            // The note is kept pending while the first turn is still going: Orbit's cancel did not end it (it ends by itself, below)
            person.note('Also add my wife');
            await pause(100);
            expect(state.inputs).toHaveLength(1);
            expect(state.finishes).toEqual([]);
            expect(state.notes[0].state).toBe('pending');
            // the turn then ends by itself with its [[done]]: the note it never saw is not lost, and the job is not ended on those words
            finishNaturally();
            await idleWithin(runner);
            expect(state.inputs).toHaveLength(2);
            expect(state.inputs[1]).toContain('> Also add my wife');
            expect(state.finishes).toHaveLength(1);
        });

        it('two notes during one turn: both are given in order in the next turn, once, and notes-sent says the highest number', async () => {
            const { orbit, state, scripts, person, live } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            // Both kept before the turn's end is read (the second note finds no turn to cancel any more)
            const cut = live.get('resp-1');
            live.delete('resp-1');
            person.note('First: use 12 March');
            person.note('Second: two passports');
            cut?.();
            await idleWithin(runner);
            const second = state.inputs[1];
            expect(second.indexOf('> First: use 12 March')).toBeGreaterThan(-1);
            expect(second.indexOf('> Second: two passports')).toBeGreaterThan(second.indexOf('> First: use 12 March'));
            expect(state.inputs.filter((one) => one.includes('First: use 12 March'))).toHaveLength(1);
            expect(state.requests.filter((one) => one.kind === 'notes-sent').map((one) => one.body?.through)).toEqual([2]);
        });

        it('notes-sent whose answer is lost: the note is NOT given again, and Orbit is told again (same number) before the next turn', async () => {
            const { orbit, state, scripts, person } = controlsOrbit({ notesSent: (n) => (n === 1 ? 'down' : 'ok') });
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'silent' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await idleWithin(runner);
            expect(state.inputs.filter((one) => one.includes('Use 12 March'))).toHaveLength(1);
            expect(state.inputs[2]).toBe(CONTINUE_PROMPT);
            const told = state.requests.filter((one) => one.kind === 'notes-sent');
            expect(told.map((one) => [one.answer, one.body?.through])).toEqual([
                ['down', 1],
                ['ok', 1],
            ]);
            expect(state.notes[0].state).toBe('sent');
        });

        it('a note whose turn could not even open is no note-cut turn: the turns that fail to open still end the job (no endless loop), and the note is never marked given', async () => {
            const { orbit, state, person } = controlsOrbit({ turnOpen: () => 'failed' });
            person.note('Use 12 March');
            const runner = runnerOf(orbit);
            await runner.tick();
            await idleWithin(runner, 3000);
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'failed', cause: 'ours' })]);
            expect(state.requests.filter((one) => one.kind === 'notes-sent')).toEqual([]);
            expect(state.notes[0].state).toBe('pending');
        });

        it('a turn the agent was already on (busy) did not take the note: it is given with the next turn the agent takes, and marked only then', async () => {
            const { orbit, state, scripts, person } = controlsOrbit({ turnOpen: (n) => (n === 1 ? 'busy' : 'ok') });
            person.note('Use 12 March');
            // The agent's own turn (read by a stream) ends silent, then the next turn takes the note
            scripts.push({ kind: 'silent' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await idleWithin(runner, 3000);
            expect(state.inputs).toHaveLength(1);
            expect(state.inputs[0]).toContain('> Use 12 March');
            const told = state.requests.filter((one) => one.kind === 'notes-sent');
            expect(told.map((one) => one.body?.through)).toEqual([1]);
            const order = state.requests.map((one) => `${one.kind}:${one.answer}`);
            expect(order.indexOf('notes-sent:ok')).toBeGreaterThan(order.indexOf('turn:opened'));
        });

        it('a note to a job that is paused is given with its first turn when it carries on (after the resumed words)', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.pause();
            await idleWithin(runner);
            person.note('Use the other passport');
            person.resume();
            scripts.push({ kind: 'done' });
            await runner.tick();
            await idleWithin(runner);
            expect(state.inputs[1].startsWith(RESUMED_HEAD)).toBe(true);
            expect(state.inputs[1].indexOf('> Use the other passport')).toBeGreaterThan(state.inputs[1].indexOf('Job: Visa form'));
            expect(state.requests.filter((one) => one.kind === 'notes-sent').map((one) => [one.body?.through, one.epoch])).toEqual([[1, state.ownerEpoch]]);
        });

        it('a note to a job waiting in line, before it ever started, is given with the job`s own first words', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            state.status = 'queued';
            person.note('Kuwait passports only');
            person.resume();
            scripts.push({ kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await idleWithin(runner);
            expect(state.inputs[0].startsWith('You are working on a computer')).toBe(true);
            expect(state.inputs[0]).toContain('> Kuwait passports only');
        });

        it('a note while the person holds the screen waits for the hand back, and goes with the hand-back words', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.takeOver();
            await pause(30);
            person.note('I signed in, carry on');
            await pause(30);
            expect(state.inputs).toHaveLength(1);
            person.handBack();
            await idleWithin(runner);
            expect(state.inputs[1].startsWith(RESUME_PROMPT)).toBe(true);
            expect(state.inputs[1]).toContain('> I signed in, carry on');
        });

        it('a note that answers Brick`s question while the job waits (not taken over): the wait ends and the agent gets the answered words with the note', async () => {
            const { orbit, state, scripts, person } = controlsOrbit();
            scripts.push({ kind: 'handover', words: 'Which date? [[handover answer]]' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.status === 'waiting');
            await pause(20);
            person.note('12 March');
            await idleWithin(runner);
            expect(state.inputs[1].startsWith(ANSWERED_PROMPT)).toBe(true);
            expect(state.inputs[1]).toContain('> 12 March');
            expect(state.finishes).toHaveLength(1);
        });

        it('a turn cut for a note does not count in the job`s turns: a job allowed one turn still ends well after a turn cut for a note', async () => {
            const saved = RUNNER_GUARDS.maxTurns;
            RUNNER_GUARDS.maxTurns = 1;
            try {
                const { orbit, state, scripts, person } = controlsOrbit();
                scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'done' });
                const runner = runnerOf(orbit);
                await runner.tick();
                await until(() => state.inputs.length === 1);
                person.note('Use 12 March');
                await idleWithin(runner);
                expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done' })]);
            } finally {
                RUNNER_GUARDS.maxTurns = saved;
            }
        });

        it('a worker that was replaced is told so by notes-sent: its run ends there, with nothing ended', async () => {
            const box: { state?: ReturnType<typeof controlsOrbit>['state'] } = {};
            const made = controlsOrbit({
                notesSent: () => {
                    // Another worker claimed the job just before the answer
                    if (box.state) box.state.ownerEpoch += 1;
                    return 'ok';
                },
            });
            box.state = made.state;
            const { orbit, state, scripts, person } = made;
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await until(() => (state.counts['notes-sent'] ?? 0) >= 1);
            expect(state.requests.filter((one) => one.kind === 'notes-sent').map((one) => one.answer)).toEqual(['superseded']);
            // N10: the answer itself stops the reader of the open turn (nothing here closes the stream): the run ends, and nothing is ended or cancelled
            await idleWithin(runner);
            expect(state.finishes).toEqual([]);
            expect(state.runnerCancels).toEqual([]);
            expect(kinds(state).filter((kind) => kind === 'cancel')).toEqual([]);
        });

        it('N9: notes-sent answered superseded: what is owed stays owed, and the worker that owns the job next tells Orbit under its own epoch', async () => {
            const box: { state?: ReturnType<typeof controlsOrbit>['state']; moved?: boolean } = {};
            const made = controlsOrbit({
                notesSent: () => {
                    // the first acknowledgement is answered superseded (another worker claimed the job just before it)
                    if (!box.moved && box.state) {
                        box.moved = true;
                        box.state.ownerEpoch += 1;
                    }
                    return 'ok';
                },
            });
            box.state = made.state;
            const { orbit, state, scripts, person } = made;
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await until(() => (state.counts['notes-sent'] ?? 0) >= 1);
            // the superseded answer recorded nothing at Orbit: the note is still pending, so what is owed is still owed
            const first = state.requests.filter((one) => one.kind === 'notes-sent')[0];
            expect(first.answer).toBe('superseded');
            expect(state.notes[0].state).toBe('pending');
            await idleWithin(runner);
            // the next worker of this process (a fresh claim on the epoch the job is on now) tells Orbit, under its own epoch, and knows the agent already had the note
            scripts.push({ kind: 'done' });
            await runner.tick();
            await until(() => state.notes[0].state === 'sent');
            const told = state.requests.filter((one) => one.kind === 'notes-sent');
            expect(told.map((one) => one.body?.through)).toEqual(told.map(() => 1));
            const accepted = told.filter((one) => one.answer === 'ok');
            expect(accepted).toHaveLength(1);
            expect(accepted[0].epoch).toBe(state.ownerEpoch);
            expect(accepted[0].epoch).not.toBe(first.epoch);
            expect(state.inputs.filter((one) => one.includes('Use 12 March'))).toHaveLength(1);
        });

        it('N10: a 409 whose body says another run holds the job (the answer to notes-sent) stops the reader of the open turn the same way, and cancels nothing', async () => {
            const { orbit, state, scripts, person } = controlsOrbit({ notesSent: () => 'conflict' });
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await until(() => (state.counts['notes-sent'] ?? 0) >= 1);
            await idleWithin(runner);
            expect(state.requests.filter((one) => one.kind === 'notes-sent').map((one) => one.answer)).toEqual(['superseded']);
            expect(state.finishes).toEqual([]);
            expect(state.runnerCancels).toEqual([]);
        });

        it('N10: a note acknowledgement Orbit accepts leaves the reader of the open turn running (the turn goes on to its own end)', async () => {
            const made = controlsOrbit();
            const { orbit, state, scripts, person } = made;
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed', words: 'All fine. [[done]]' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await until(() => (state.counts['notes-sent'] ?? 0) >= 1);
            await pause(150);
            // still reading the second turn: not ended, nothing finished
            expect(made.live.has('resp-2')).toBe(true);
            expect(state.finishes).toEqual([]);
            made.live.get('resp-2')?.();
            await idleWithin(runner);
            expect(state.finishes).toEqual([expect.objectContaining({ outcome: 'done' })]);
        });

        it('N9: notes-sent that failed, then a pause and a resume: the next worker tells Orbit about the note under its own epoch, and the agent is not given the note again', async () => {
            const { orbit, state, scripts, person } = controlsOrbit({ notesSent: (n) => (n === 1 ? 'down' : 'ok') });
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            // the second turn took the note, and the acknowledgement failed (down); the person pauses the job while that turn goes on
            await until(() => state.inputs.length === 2 && (state.counts['notes-sent'] ?? 0) >= 1);
            expect(state.notes[0].state).toBe('pending');
            person.pause();
            await idleWithin(runner);
            person.resume();
            scripts.push({ kind: 'done' });
            await runner.tick();
            await idleWithin(runner);
            const told = state.requests.filter((one) => one.kind === 'notes-sent');
            expect(told.map((one) => [one.answer, one.body?.through])).toEqual([
                ['down', 1],
                ['ok', 1],
            ]);
            // under the new owner's epoch, and Orbit now has it
            expect(told[1].epoch).toBe(state.ownerEpoch);
            expect(told[1].epoch).not.toBe(told[0].epoch);
            expect(state.notes[0].state).toBe('sent');
            // the text reached the agent once (the resumed words carry none of it)
            expect(state.inputs.filter((one) => one.includes('Use 12 March'))).toHaveLength(1);
        });
    });

    describe('the worker never keeps a job it no longer holds', () => {
        it('an Orbit that gives no epochs: a job back in line is still left at once, never polled', async () => {
            const { orbit, state, scripts, person } = controlsOrbit({ noEpochs: true });
            scripts.push({ kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.pause();
            await idleWithin(runner);
            expect(state.finishes).toEqual([]);
            expect(state.runnerCancels).toEqual([]);
            const reads = state.reads;
            await pause(60);
            expect(state.reads).toBe(reads);
        });

        it('another worker claims the job while this one waits for the person: this one leaves at once (it does not wait for the person too)', async () => {
            const { orbit, state, scripts } = controlsOrbit();
            scripts.push({ kind: 'handover' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.status === 'waiting');
            await pause(20);
            expect(runner.active()).toEqual(['job-1']);
            // Another bot server's worker (a rolling deploy) claimed it
            state.ownerEpoch += 1;
            await idleWithin(runner);
            expect(state.status).toBe('waiting');
            expect(state.finishes).toEqual([]);
        });

        it('a run told it was superseded by notes-sent sends nothing more, even while the job reads still show its own epoch (a lagging read)', async () => {
            const box: { state?: ReturnType<typeof controlsOrbit>['state'] } = {};
            const made = controlsOrbit({
                laggingReads: true,
                notesSent: () => {
                    if (box.state) box.state.ownerEpoch += 1;
                    return 'ok';
                },
            });
            box.state = made.state;
            const { orbit, state, scripts, person } = made;
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'hang', cut: 'completed' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await until(() => (state.counts['notes-sent'] ?? 0) >= 1);
            const told = state.requests.length;
            await idleWithin(runner);
            // After the superseded answer: at most the turn's own last progress report (answered superseded too), and nothing that prepares, opens, hands over or ends
            expect(kinds(state, told).filter((kind) => !['progress', 'renew'].includes(kind))).toEqual([]);
            expect(state.finishes).toEqual([]);
        });

        it('a run told it was superseded when it tells Orbit again about notes whose answer was lost: it stops there, before any prepare or turn', async () => {
            const box: { state?: ReturnType<typeof controlsOrbit>['state'] } = {};
            const made = controlsOrbit({
                laggingReads: true,
                notesSent: (n) => {
                    if (n === 1) return 'down';
                    if (box.state) box.state.ownerEpoch += 1;
                    return 'ok';
                },
            });
            box.state = made.state;
            const { orbit, state, scripts, person } = made;
            scripts.push({ kind: 'hang', cut: 'completed' }, { kind: 'silent' }, { kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await until(() => state.inputs.length === 1);
            person.note('Use 12 March');
            await idleWithin(runner);
            const second = state.requests.findIndex((one, at) => one.kind === 'notes-sent' && state.requests.slice(0, at).some((before) => before.kind === 'notes-sent'));
            expect(second).toBeGreaterThan(-1);
            expect(state.requests[second].answer).toBe('superseded');
            expect(kinds(state, second + 1).filter((kind) => kind !== 'job')).toEqual([]);
            expect(state.finishes).toEqual([]);
        });

        it('a worker that finds the job taken over as it starts, then a note and a hand back: the hand-back words, not the answered ones (the person used the computer)', async () => {
            const box: { person?: ReturnType<typeof controlsOrbit>['person']; once?: boolean } = {};
            const made = controlsOrbit({
                afterListing: () => {
                    if (box.once) return;
                    box.once = true;
                    box.person?.takeOver();
                },
            });
            box.person = made.person;
            const { orbit, state, scripts, person } = made;
            state.responseId = 'resp-0';
            scripts.push({ kind: 'done' });
            const runner = runnerOf(orbit);
            await runner.tick();
            await pause(30);
            person.note('I signed in');
            await pause(20);
            person.handBack();
            await idleWithin(runner);
            expect(state.inputs).toHaveLength(1);
            expect(state.inputs[0].startsWith(RESUME_PROMPT)).toBe(true);
            expect(state.inputs[0]).toContain('> I signed in');
        });
    });

    describe('the Orbit door the runner reads (AdminApiService)', () => {
        it('reads `resumed` and `notes` (only notes with a whole number and words, in order, once each) from GET job', async () => {
            const admin = new AdminApiService();
            (admin as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({
                data: {
                    job: {
                        id: 'job-1',
                        status: 'running',
                        control: 'brick',
                        generation: 3,
                        ownerEpoch: 2,
                        resumed: true,
                        askAgain: true,
                        notes: [{ seq: 2, text: 'second' }, { seq: 1, text: 'first' }, { seq: 1, text: 'again' }, { seq: 0, text: 'bad' }, { seq: 3, text: '  ' }, { seq: 1.5, text: 'half' }, null],
                    },
                },
            });
            const orbit = runnerOrbitFor(admin);
            const read = await orbit.job('brick-1', 'job-1');
            expect(read).toEqual({ status: 'running', control: 'brick', generation: 3, ownerEpoch: 2, resumed: true, askAgain: true, notes: [{ seq: 1, text: 'first' }, { seq: 2, text: 'second' }] });
            // Only a plain true asks again
            (admin as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({ data: { job: { id: 'job-1', status: 'running', control: 'brick', resumed: true, askAgain: 'yes' } } });
            expect(await orbit.job('brick-1', 'job-1')).toEqual({ status: 'running', control: 'brick', resumed: true });
        });

        it('an Orbit without the controls gives neither, and the job reads as before', async () => {
            const admin = new AdminApiService();
            (admin as unknown as { brickCall: unknown }).brickCall = vi.fn().mockResolvedValue({ data: { job: { id: 'job-1', status: 'running', control: 'brick', generation: 3, ownerEpoch: 2 } } });
            const read = await runnerOrbitFor(admin).job('brick-1', 'job-1');
            expect(read).toEqual({ status: 'running', control: 'brick', generation: 3, ownerEpoch: 2 });
        });
    });
});
