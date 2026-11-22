import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RedisSharedCalls } from '../server/ComputerEvidenceStore';
import { createRefusalNotes, type RefusalNotes } from '../server/ComputerRefusals';
import { createComputerRunner, POOL_BUSY_WHY, type FinishPending, type RunnableJob, type RunnerEvent, type RunnerOrbit, type TurnOpened } from '../server/ComputerRunner';

/**
 * GPT round 4, R2: a give-up that was committed survives the runner that made it. The runner tells Orbit the job is committed to ending (the finish INTENT) before it abandons the
 * job, and any runner (a replacement worker, a fresh process after a restart) that reads the intent completes the finish with exactly what Orbit holds and opens no turn, no prepare
 * and no call for the job. Orbit here is a double that keeps to the contract Orbit's own thread gave: the intent is kept once (first wins), a finish while it is kept ends the job with the
 * INTENT's values whatever its own body says, the job read carries `finishPending`, and prepare, turn and renew are refused with `finish_pending`. The fences are the real ones, on a
 * real Redis, so a fresh runner has fresh notes of its own and knows nothing the first one knew in memory.
 */
const REAL_REDIS = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(process.env.BOTS_REQUIRE_REDIS === '1' && !REAL_REDIS)('the real Redis for the finish intent tests', () => {
    it('is given when the run requires it (CI): the intent is never left untested', () => {
        expect(REAL_REDIS, 'BOTS_TEST_REDIS_URL is not set while BOTS_REQUIRE_REDIS=1').toBeTruthy();
    });
});

const RELAY = 'https://bot-server.example.test';
const quiet = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const poolRefusal = { callId: 'c1', kind: 'fault', reason: 'pool_busy', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 503 } as const;
const timing = { waitMs: 5, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0], poolCheckMs: 10, poolGiveUpMs: 40, cleanupMs: 200 };
const until = async (what: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!what()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};
const http = (status: number, data: unknown) => Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });

type LedgerEntry = { outcome: string; cause?: unknown; why?: unknown; turns?: unknown; run?: unknown; by: 'finish' | 'cutoff' };
interface Modes {
    /** What the intent answers: kept (default), a thrown error, or a refusal. */
    intent?: (n: number) => 'ok' | 'down' | 'old' | 'unknown-job' | 'stale' | 'cutoff' | 'other';
    /** What a finish does: taken (default), lost on its way (never got there), or its answer lost after it was done. */
    finish?: (n: number) => 'ok' | 'down' | 'answer-lost';
    /** How long Orbit takes over the intent before it answers (it is kept the moment it arrives). */
    intentDelayMs?: number;
    /** Done at the start of the nth finish, before Orbit answers it (the world moves while a finish is on its way). */
    onFinish?: (n: number) => void;
    /** The job reads that do not show the intent (a read from before it was kept). */
    hideReads?: number;
    /** Which calls Orbit refuses with `finish_pending` while an intent is kept (all of them by contract). */
    refuses?: Array<'prepare' | 'turn' | 'renew'>;
}

/** Orbit as the contract says, for one job. */
function intentOrbit(job: RunnableJob, modes: Modes = {}) {
    const state = {
        over: false,
        generation: 1,
        pending: null as (FinishPending & { at: number }) | null,
        hidden: modes.hideReads ?? 0,
        turnsOpened: 0,
        turnAttempts: 0,
        streams: 0,
        prepares: 0,
        cancels: 0,
        intents: [] as Array<Record<string, unknown>>,
        finishes: [] as Array<Record<string, unknown>>,
        order: [] as string[],
        ledger: [] as LedgerEntry[],
        onIntentKept: undefined as (() => void) | undefined,
        turnScript: [] as Array<(signal?: AbortSignal) => AsyncGenerator<RunnerEvent>>,
    };
    const refuses = (call: 'prepare' | 'turn' | 'renew') => state.pending !== null && (modes.refuses ?? ['prepare', 'turn', 'renew']).includes(call);
    const open = (signal?: AbortSignal): TurnOpened => {
        const make = state.turnScript.shift();
        state.turnsOpened += 1;
        const events = make
            ? make(signal)
            : (async function* (): AsyncGenerator<RunnerEvent> {
                  yield { type: 'created', id: 'r', sessionId: 's' };
                  yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
              })();
        return { ok: true, events };
    };
    const orbit: RunnerOrbit = {
        running: async () => (state.over ? [] : [job]),
        job: async () => {
            if (state.over) return { status: 'failed', control: 'brick', generation: state.generation };
            if (state.hidden > 0 && state.pending) {
                state.hidden--;
                return { status: 'running', control: 'brick', generation: state.generation, finishPending: null };
            }
            return { status: 'running', control: 'brick', generation: state.generation, finishPending: state.pending ? { outcome: state.pending.outcome, cause: state.pending.cause, why: state.pending.why, turns: state.pending.turns, run: state.pending.run, generation: state.pending.generation } : null };
        },
        action: async (_botId, _jobId, body) => {
            if (body.action === 'renew') {
                if (refuses('renew')) return { ok: false, reason: 'finish_pending' };
                return { ok: true, renewInSeconds: 240 };
            }
            if (body.action === 'finish-intent') {
                state.intents.push(body);
                state.order.push('intent');
                const mode = (modes.intent ?? (() => 'ok'))(state.intents.length);
                if (modes.intentDelayMs) await new Promise((resolve) => setTimeout(resolve, modes.intentDelayMs));
                if (mode === 'down') throw http(503, { error: 'unavailable' });
                if (mode === 'old') throw http(400, { error: 'Invalid input data' });
                if (mode === 'unknown-job') throw http(404, { error: 'not found' });
                // an answer that is a refusal of a kind the game does not know: nothing was kept
                if (mode === 'other') return { ok: false, reason: 'something_else', job: { id: job.jobId } };
                if (state.over || mode === 'stale') return { ok: false, reason: 'stale', job: { id: job.jobId } };
                if (body.generation !== undefined && body.generation !== state.generation) return { ok: false, reason: 'stale', job: { id: job.jobId } };
                if (mode === 'cutoff') {
                    // Orbit's own pool cutoff already decided: the job ends as ours, once
                    state.over = true;
                    state.ledger.push({ outcome: 'failed', cause: 'ours', why: 'cutoff', by: 'cutoff' });
                    return { ok: false, reason: 'cutoff', job: { id: job.jobId } };
                }
                if (state.pending) return { ok: true, already: true, finishPending: state.pending };
                state.pending = { outcome: body.outcome as 'done' | 'failed', cause: body.cause as 'ours' | 'agent', why: body.why as string, turns: body.turns as number[], run: body.run as string, generation: body.generation as number | undefined, at: Date.now() };
                state.onIntentKept?.();
                return { ok: true, already: false, finishPending: state.pending };
            }
            if (body.action === 'finish') {
                state.finishes.push(body);
                state.order.push('finish');
                modes.onFinish?.(state.finishes.length);
                const mode = (modes.finish ?? (() => 'ok'))(state.finishes.length);
                if (mode === 'down') throw new Error('Orbit could not be reached');
                if (state.over) return { ok: true, already: true };
                if (body.generation !== undefined && (body.generation as number) < state.generation) return { ok: false, reason: 'stale', job: { id: job.jobId } };
                // While an intent is kept the job ends with the INTENT's values, whatever the finish says
                const held = state.pending;
                state.ledger.push({ outcome: held ? held.outcome : (body.outcome as string), cause: held ? held.cause : body.cause, why: held ? held.why : body.why, turns: held ? held.turns : body.turns, run: held ? held.run : body.run, by: 'finish' });
                state.over = true;
                if (mode === 'answer-lost') throw new Error('Orbit could not be reached');
                return { ok: true };
            }
            return { ok: true };
        },
        prepare: async () => {
            if (refuses('prepare')) return { ok: false, reason: 'finish_pending' };
            state.prepares += 1;
            return { ok: true };
        },
        turn: async (_jobId, _input, signal) => {
            state.turnAttempts += 1;
            if (refuses('turn')) return { ok: false, reason: 'finish_pending' } as unknown as TurnOpened;
            return open(signal);
        },
        stream: async () => {
            state.streams += 1;
            if (refuses('turn')) return { ok: false, reason: 'finish_pending' } as unknown as TurnOpened;
            return open();
        },
        cancel: async () => {
            state.cancels += 1;
            state.order.push('cancel');
        },
    };
    return { orbit, state };
}

describe.skipIf(!REAL_REDIS)('a committed give-up survives the runner that made it (the finish intent), on a real Redis', () => {
    let client!: ReturnType<typeof createClient>;
    let opened = false;
    beforeAll(async () => {
        client = createClient({ url: REAL_REDIS, socket: { reconnectStrategy: false } });
        client.on('error', () => undefined);
        await client.connect();
        opened = true;
    });
    afterAll(async () => {
        if (!opened || !client.isOpen) return;
        await client.quit();
    });

    const rig = (modes: Modes = {}) => {
        const job: RunnableJob = { jobId: `job-${randomUUID()}`, botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
        const fake = intentOrbit(job, modes);
        /** A server's notes (its own memory) over the one shared Redis; a new id each time is a new process that knows nothing of the others. */
        const notesOf = (id: string): RefusalNotes => createRefusalNotes(Date.now, { sink: async () => true, shared: new RedisSharedCalls(() => client as never, `${id}-${randomUUID()}`) });
        const runnerOn = (notes: RefusalNotes, run: string, extra: Partial<Parameters<typeof createComputerRunner>[0]> = {}) => createComputerRunner({ orbit: fake.orbit, relayUrl: RELAY, log: quiet, timing, refusals: notes, runId: () => run, ...extra });
        /** The first turn: every call of it is refused for want of room in the pool, and it goes on until it is stopped. */
        const poolBusyTurn = (notes: RefusalNotes) => {
            fake.state.turnScript.push(async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
                await new Promise<void>((resolve) => {
                    const stop = setInterval(() => {
                        if (fake.state.cancels > 0 || fake.state.over) {
                            clearInterval(stop);
                            resolve();
                        }
                    }, 5);
                    setTimeout(() => (clearInterval(stop), resolve()), 6000);
                });
            });
        };
        const work = async (runner: ReturnType<typeof createComputerRunner>) => {
            await runner.tick();
            await runner.idle();
        };
        /** What another bot server's relay does with a call of the given turn: whether it is taken up. */
        const admission = (turn: number, run = 'run1') => notesOf('relay').accepted(job.jobId, { turn, run });
        return { job, fake, notesOf, runnerOn, poolBusyTurn, work, admission };
    };

    const endedOnce = (fake: ReturnType<typeof intentOrbit>, expected: Partial<LedgerEntry> = {}) => {
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', ...expected });
    };

    it('sends the intent AFTER the close is committed and BEFORE the machine is cancelled and the finish is sent, and the finish ends the job once with the intent\'s values', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work, job } = rig();
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.order).toEqual(['intent', 'cancel', 'finish']);
        expect(fake.state.intents).toHaveLength(1);
        expect(fake.state.intents[0]).toMatchObject({ action: 'finish-intent', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', generation: 1 });
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        expect(job.jobId).toBeTruthy();
    });

    it('KEPT INTENT, FINISH LOST: a fresh runner with fresh notes completes the finish with the intent\'s values and opens no turn, prepares no machine, and admits no call (0 agent turns, 0 provider admissions, one ending in the ledger)', async () => {
        // the finish never reaches Orbit while the first runner is alive, and the first runner is stopped as soon as the intent is kept (a restart, a replaced worker)
        let alive = true;
        const { fake, notesOf, runnerOn, poolBusyTurn, work, admission } = rig({ finish: () => (alive ? 'down' : 'ok') });
        const notesA = notesOf('A');
        const first = runnerOn(notesA, 'run1');
        poolBusyTurn(notesA);
        fake.state.onIntentKept = () => first.stop();
        await work(first);
        // Orbit holds the intent and nothing has ended it
        expect(fake.state.pending).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1' });
        expect(fake.state.ledger).toEqual([]);
        expect(fake.state.over).toBe(false);
        const turnsBefore = fake.state.turnsOpened;
        const preparesBefore = fake.state.prepares;
        // a NEW runner object with NEW notes (another process): it has no give-up of its own in memory and does not know the run of the first
        alive = false;
        const second = runnerOn(notesOf('B'), 'run2');
        await work(second);
        expect(fake.state.ledger).toHaveLength(1);
        // the end is the one the intent holds (the first run's turn and run), never the second runner's own
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', by: 'finish' });
        expect(fake.state.turnsOpened).toBe(turnsBefore);
        expect(fake.state.turnAttempts).toBe(turnsBefore);
        expect(fake.state.streams).toBe(0);
        expect(fake.state.prepares).toBe(preparesBefore);
        // the finish the second runner sent carries the intent's values
        const sent = fake.state.finishes[fake.state.finishes.length - 1];
        expect(sent).toMatchObject({ action: 'finish', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1' });
        // no provider call of the turn is taken up by another server's relay (the committed fence holds)
        expect(await admission(1)).toBe(false);
    });

    it('a replacement worker of the SAME runner (stop, then start) reads the kept intent too and ends the job once, opening no turn', async () => {
        let alive = true;
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ finish: () => (alive ? 'down' : 'ok') });
        const notes = notesOf('A');
        const runner = runnerOn(notes, 'run1');
        poolBusyTurn(notes);
        fake.state.onIntentKept = () => runner.stop();
        await work(runner);
        expect(fake.state.ledger).toEqual([]);
        alive = false;
        runner.start(1_000_000_000);
        await until(() => fake.state.over);
        runner.stop();
        await runner.idle();
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        // the one prepare of the first run's own turn, none after it
        expect(fake.state.prepares).toBe(1);
    });

    it('a finish whose ANSWER was lost after it was done: the next read says the job is over, and nothing is ended twice', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ finish: () => 'answer-lost' });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
    });

    it('INTENT NOT KEPT (Orbit down): no finish is sent and no new turn begins until Orbit holds the intent; then it is kept, the finish goes, and the job ends once', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n <= 3 ? 'down' : 'ok') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents).toHaveLength(4);
        // not one finish went before the intent was kept, and the order shows it
        expect(fake.state.order.filter((one) => one !== 'cancel')).toEqual(['intent', 'intent', 'intent', 'intent', 'finish']);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.turnAttempts).toBe(1);
        endedOnce(fake);
    });

    it('INTENT NOT KEPT, the runner stopped meanwhile: the give-up stays owed in the runner and its replacement sends the intent again before anything else; no other turn begins', async () => {
        let down = true;
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: () => (down ? 'down' : 'ok') });
        const notes = notesOf('A');
        const runner = runnerOn(notes, 'run1');
        poolBusyTurn(notes);
        fake.state.onIntentKept = undefined;
        const first = work(runner);
        await until(() => fake.state.intents.length >= 2);
        runner.stop();
        await first;
        expect(fake.state.ledger).toEqual([]);
        expect(fake.state.finishes).toEqual([]);
        down = false;
        runner.start(1_000_000_000);
        await until(() => fake.state.over);
        runner.stop();
        await runner.idle();
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.finishes.every((one) => one.turns?.toString() === '1')).toBe(true);
    });

    it('a STALE intent (the job is over, never started or on another generation): no give-up, nothing is ended, the committed fence is taken back and the turn goes on', async () => {
        const { fake, notesOf, runnerOn, work, admission, job } = rig({ intent: () => 'stale' });
        const notes = notesOf('A');
        // the turn is refused for room, the intent is stale, and the turn ends by itself shortly after
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 300));
            yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents.length).toBeGreaterThanOrEqual(1);
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.ledger.filter((entry) => entry.cause === 'ours' && entry.why === POOL_BUSY_WHY)).toEqual([]);
        // the fence of the close that was taken back: the turn's calls are taken up again
        expect(await admission(1)).toBe(true);
    });

    it('a 404 for the intent is stale too (the job is gone): nothing is given up', async () => {
        const { fake, notesOf, runnerOn, work, job } = rig({ intent: () => 'unknown-job' });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 300));
            yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.ledger.filter((entry) => entry.why === POOL_BUSY_WHY)).toEqual([]);
    });

    it('a CUTOFF answer (Orbit\'s own pool cutoff already decided): the finish goes as it would, the job is ended once, as ours, and nothing is ended twice', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: () => 'cutoff' });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'failed', cause: 'ours', by: 'cutoff' });
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.cancels).toBe(1);
    });

    it('an Orbit that does not know the intent (400 "Invalid input data"): the give-up goes on as before (mixed versions), ended once with the runner\'s own values', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: () => 'old' });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        quiet.warn.mockClear();
        await work(runnerOn(notes, 'run1'));
        // said once in the log (in production this would mean our own body is wrong), with nothing of anyone's in it
        expect(quiet.warn.mock.calls.filter((call) => String(call[0]).includes('finish intent with 400'))).toHaveLength(1);
        expect(fake.state.pending).toBeNull();
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
    });

    it('a runner that sends no intent (0.4.3) and a finish with no generation are still taken: nothing about the intent is needed to end a job', async () => {
        const { fake, notesOf, runnerOn, work, job } = rig();
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
        });
        void notesOf;
        await work(runnerOn(notesOf('A'), 'run1'));
        expect(fake.state.intents).toEqual([]);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: undefined, by: 'finish' }]);
        expect(job.jobId).toBeTruthy();
    });

    it('a NEWER generation after the intent (the person took the machine and gave it back): the intent holds, the end is completed on the generation the job is on now, and the old one is never resurrected in a loop', async () => {
        let alive = true;
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ finish: () => (alive ? 'down' : 'ok') });
        const notesA = notesOf('A');
        const first = runnerOn(notesA, 'run1');
        poolBusyTurn(notesA);
        fake.state.onIntentKept = () => first.stop();
        await work(first);
        expect(fake.state.pending).not.toBeNull();
        // the person takes the machine and gives it back: the generation moves on
        fake.state.generation = 3;
        alive = false;
        await work(runnerOn(notesOf('B'), 'run2'));
        endedOnce(fake);
        // the finish was sent with the generation the job is on, and taken at once (no loop of stale answers)
        const last = fake.state.finishes[fake.state.finishes.length - 1];
        expect(last.generation).toBe(3);
        expect(fake.state.finishes.filter((one) => one.generation === 3)).toHaveLength(1);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.prepares).toBe(1);
    });

    it('a give-up of the same runner begun on the OLD generation, after the generation moved: its finish is answered stale, the job is read again, and the end is completed from the intent, once', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ finish: (n) => (n === 1 ? 'down' : 'ok') });
        const notes = notesOf('A');
        const runner = runnerOn(notes, 'run1');
        poolBusyTurn(notes);
        // the generation moves after the intent is kept and before the first finish goes
        fake.state.onIntentKept = () => (fake.state.generation = 2);
        await work(runner);
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.prepares).toBe(1);
    });

    it('R2.7: a turn that ENDS while the close is being committed is not given up, and no intent is sent for it (the intent cannot be taken back)', async () => {
        const { fake, notesOf, runnerOn, work, job } = rig();
        const notes = notesOf('A');
        let release!: () => void;
        const slow = new Promise<void>((resolve) => (release = resolve));
        // the commit is slow, and the turn completes while it is being written
        const refusals = {
            ...notes,
            commitTurn: async (...args: Parameters<NonNullable<RefusalNotes['commitTurn']>>) => {
                release();
                await new Promise((resolve) => setTimeout(resolve, 150));
                return notes.commitTurn!(...args);
            },
        };
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await slow;
            await new Promise((resolve) => setTimeout(resolve, 40));
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        await work(createComputerRunner({ orbit: fake.orbit, relayUrl: RELAY, log: quiet, timing, refusals, runId: () => 'run1' }));
        expect(fake.state.intents).toEqual([]);
        expect(fake.state.pending).toBeNull();
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: undefined, by: 'finish' }]);
    });

    it('a turn that ENDS (without its [[done]]) while the intent is on its way, after the commit: the intent is kept all the same, and no other turn is attempted: the end is completed from the job read', async () => {
        const { fake, notesOf, runnerOn, work, job, admission } = rig({ intentDelayMs: 150 });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            // the pool gives up at about 40 ms (the intent then takes 150 ms): the turn ends on its own in between
            await new Promise((resolve) => setTimeout(resolve, 100));
            yield { type: 'completed', outputText: 'Still working on it.', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents).toHaveLength(1);
        endedOnce(fake);
        // the turn that ended is no ground for another: Orbit would refuse it, and none is even attempted
        expect(fake.state.turnAttempts).toBe(1);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.streams).toBe(0);
        // the turn was over: nothing is cancelled (a cancel is the job's), and the turn is read as the give-up it became, so the fence of its close is taken back once Orbit took the finish
        expect(fake.state.cancels).toBe(0);
        expect(await admission(1)).toBe(true);
    });

    it('a turn that ends with its [[done]] after ANOTHER runner\'s intent was kept: the end is completed from what Orbit holds, never the turn\'s own words (no finish of `done` is sent)', async () => {
        const { fake, notesOf, runnerOn, work } = rig();
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            // another runner (a replacement worker, another process) has just had its intent kept
            fake.state.pending = { outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', at: Date.now() };
            yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
        });
        await work(runnerOn(notesOf('A'), 'run2'));
        expect(fake.state.finishes).toHaveLength(1);
        expect(fake.state.finishes[0]).toMatchObject({ action: 'finish', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1' });
        endedOnce(fake);
        expect(fake.state.turnAttempts).toBe(1);
    });

    it('an intent that Orbit could not take at first and then finds STALE (the job moved on meanwhile): the owed give-up is dropped, no finish of it is ever sent, and the job goes on', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n === 1 ? 'down' : 'stale') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents.length).toBeGreaterThanOrEqual(2);
        expect(fake.state.finishes.some((one) => one.why === POOL_BUSY_WHY)).toBe(false);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: undefined, by: 'finish' }]);
    });

    it('a turn that ENDS (with its [[done]]) while an intent Orbit could not take is on its way: no give-up is held, nothing is cancelled, the committed fence is taken back and the job ends as the turn said', async () => {
        const { fake, notesOf, runnerOn, work, job, admission } = rig({ intentDelayMs: 150, intent: () => 'down' });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 100));
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.pending).toBeNull();
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: undefined, by: 'finish' }]);
        expect(await admission(1)).toBe(true);
    });

    it('an answer that is a refusal of a kind the game does not know (200 {ok:false, reason: something else}) is NOT a kept intent: it stays owed, no finish is sent and no turn opens until a later answer keeps it', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n <= 2 ? 'other' : 'ok') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents).toHaveLength(3);
        expect(fake.state.order.filter((one) => one !== 'cancel')).toEqual(['intent', 'intent', 'intent', 'finish']);
        expect(fake.state.turnAttempts).toBe(1);
        expect(fake.state.turnsOpened).toBe(1);
        endedOnce(fake);
    });

    it('an owed intent that is later answered STALE drops the give-up for good: a stop and a start of the runner (a replacement worker) sends no intent and no finish for it', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n === 1 ? 'down' : 'stale') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        // after the stale answer the job goes on with a turn of its own, that lasts until the worker is stopped
        fake.state.turnScript.push(async function* (signal) {
            yield { type: 'created', id: 'r2', sessionId: 's' };
            await new Promise<void>((resolve) => {
                signal?.addEventListener('abort', () => resolve(), { once: true });
                setTimeout(resolve, 4000);
            });
        });
        const runner = runnerOn(notes, 'run1');
        const first = work(runner);
        await until(() => fake.state.intents.length >= 2 && fake.state.turnsOpened >= 2);
        runner.stop();
        await first;
        const intentsBefore = fake.state.intents.length;
        expect(intentsBefore).toBe(2);
        // the replacement worker for the same job: no debt is left to send
        runner.start(1_000_000_000);
        await until(() => fake.state.over);
        runner.stop();
        await runner.idle();
        expect(fake.state.intents).toHaveLength(intentsBefore);
        expect(fake.state.finishes.some((one) => one.why === POOL_BUSY_WHY)).toBe(false);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: undefined, by: 'finish' }]);
    });

    it('the generation moves while the intent\'s finish is on its way: the finish is answered stale, the runner reads the job again and completes ONCE on the new generation, with no sweep needed', async () => {
        let alive = true;
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({
            finish: () => (alive ? 'down' : 'ok'),
            // the first finish of the second runner is on its way when the person takes the machine and gives it back
            onFinish: () => {
                if (!alive && fake.state.generation === 1) fake.state.generation = 2;
            },
        });
        const notesA = notesOf('A');
        const first = runnerOn(notesA, 'run1');
        poolBusyTurn(notesA);
        fake.state.onIntentKept = () => first.stop();
        await work(first);
        expect(fake.state.pending).not.toBeNull();
        alive = false;
        await work(runnerOn(notesOf('B'), 'run2'));
        endedOnce(fake);
        // the second runner's finishes: the one on the old generation (answered stale) and the one on the new, taken
        const second = fake.state.finishes.filter((one) => one.generation === 1 || one.generation === 2).slice(-2);
        expect(second.map((one) => one.generation)).toEqual([1, 2]);
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.prepares).toBe(1);
    });

    describe('Orbit refuses with finish_pending (a read that came before the intent was kept): the runner reads the job again and completes the end, with no turn', () => {
        for (const call of ['prepare', 'turn', 'renew'] as const) {
            it(`on ${call}`, async () => {
                const { fake, notesOf, runnerOn, work, job } = rig({ hideReads: 1, refuses: [call] });
                // the intent is already kept (by another runner) and the first read of the job does not show it
                fake.state.pending = { outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', at: Date.now() };
                await work(runnerOn(notesOf('B'), 'run2'));
                endedOnce(fake);
                // no turn was opened for the agent
                expect(fake.state.turnsOpened).toBe(0);
                expect(fake.state.streams).toBe(0);
                if (call === 'prepare') expect(fake.state.prepares).toBe(0);
                expect(job.jobId).toBeTruthy();
            });
        }
    });
});
