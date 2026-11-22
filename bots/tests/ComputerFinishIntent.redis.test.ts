import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as Sentry from '@sentry/node';
import { CALLED_PREFIX, RedisSharedCalls } from '../server/ComputerEvidenceStore';
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
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
    intent?: (n: number) => 'ok' | 'down' | 'old' | 'unknown-job' | 'stale' | 'cutoff' | 'other' | 'hang' | 'lost-ack' | 'late' | 'hold';
    /** What a finish does: taken (default), lost on its way (never got there), or its answer lost after it was done. */
    finish?: (n: number) => 'ok' | 'down' | 'answer-lost' | 'empty';
    /** With a finish that answers `empty` (an HTTP 200 with nothing in it: something on the way, not Orbit): looked at before the answer goes back. */
    onEmpty?: () => Promise<void>;
    /** How long Orbit takes over the intent before it answers (it is kept the moment it arrives). */
    intentDelayMs?: number;
    /** Done at the start of the nth finish, before Orbit answers it (the world moves while a finish is on its way). */
    onFinish?: (n: number) => void;
    /** The job reads that do not show the intent (a read from before it was kept). */
    hideReads?: number;
    /** After the intent was shown this many times, the reads that follow do not show it (a read answered by something that had not seen it yet). */
    hideAfterShown?: number;
    /** The job reads say nothing of the control generation (an Orbit from before it). */
    noGeneration?: boolean;
    /** Which calls Orbit refuses with `finish_pending` while an intent is kept (all of them by contract). */
    refuses?: Array<'prepare' | 'turn' | 'renew'>;
    /** Orbit from before the run fence (GPT fourth note, R2b-2): it orders no runs, whatever a request names. */
    noRunFence?: boolean;
    /** Done as a renew reaches Orbit, before it decides (another run prepares meanwhile). */
    beforeRenew?: () => void;
    /** How Orbit says a run is superseded: in a 200 (as it does) or as the body of a 409 (the game reads both). */
    runStaleStatus?: 200 | 409;
    /** Orbit cannot make this machine ready: every prepare is answered `failed` (the key is never minted, the run never becomes the current one). */
    prepareFails?: boolean;
    /** Orbit with ownership epochs (GPT fifth note): the job read carries `ownerEpoch`, a claim gives the next one, and every request's epoch is kept in `state.epochs`. */
    epochs?: boolean;
}

/** Orbit as the contract says, for one job. */
function intentOrbit(job: RunnableJob, modes: Modes = {}) {
    const state = {
        over: false,
        generation: 1,
        pending: null as (FinishPending & { at: number }) | null,
        hidden: modes.hideReads ?? 0,
        shown: 0,
        prepareAttempts: 0,
        turnsOpened: 0,
        turnAttempts: 0,
        streams: 0,
        prepares: 0,
        cancels: 0,
        intents: [] as Array<Record<string, unknown>>,
        finishes: [] as Array<Record<string, unknown>>,
        renews: [] as Array<Record<string, unknown>>,
        order: [] as string[],
        ledger: [] as LedgerEntry[],
        onIntentKept: undefined as (() => void) | undefined,
        /** The funded calls Orbit admitted, by turn (GPT third note: a pool-only stop and an admission on the turn are ordered at Orbit: the one that comes first wins). */
        admitted: [] as Array<{ turn: number; run?: string }>,
        refusedAdmissions: 0,
        /** The run Orbit holds as the job's current one (the last run to prepare, written under the cutoff lock): what another run sends is answered stale, saying `run: 'superseded'`. */
        currentRun: undefined as string | undefined,
        runStale: [] as Array<{ action: unknown; run: unknown }>,
        /** The runs that prepared (Orbit keeps a row for each, written with the key): only a run with a row of its own can be superseded. */
        ranRuns: new Set<string>(),
        /** The wallet of the job at Orbit: what an admitted call held (5,000 micros each) and what a stale or refused stop gave back (nothing: the game never refunds, Orbit does when it ends a job). */
        wallet: { held: 0, givenBack: 0 },
        /** Intents whose caller gave up (the timeout) and that reach Orbit later (`landLate`). */
        lateIntents: [] as Array<Record<string, unknown>>,
        /** Intents Orbit is holding before it decides (`releaseHeld`). */
        heldIntents: [] as Array<() => void>,
        turnScript: [] as Array<(signal?: AbortSignal) => AsyncGenerator<RunnerEvent>>,
        /** With epochs: the owner epoch of the job, the claims made, the epoch each request named, and what a cancel named. */
        ownerEpoch: 0,
        claims: 0,
        epochs: [] as Array<{ action: string; epoch?: unknown }>,
        cancelFacts: [] as Array<unknown>,
    };
    /** A funded call of a turn comes to Orbit: refused while a stop is kept (`finish_pending`), else admitted. */
    const admit = (turn: number, run = 'run1') => {
        if (state.pending !== null || state.over) {
            state.refusedAdmissions += 1;
            return false;
        }
        state.admitted.push({ turn, run });
        state.wallet.held += 5000;
        return true;
    };
    /** Orbit's rule (Opus): a pool-based stop is stale when a funded call was admitted for the same run (or no run on either side) at an equal or later turn than the stop's earliest turn. */
    const admissionWon = (body: Record<string, unknown>) => {
        const turns = (body.turns as number[] | undefined) ?? [];
        if (body.basis !== 'pool' || turns.length === 0) return false;
        return state.admitted.some((row) => (!row.run || !body.run || row.run === body.run) && row.turn >= Math.min(...turns));
    };
    /** The original intent requests whose caller timed out now reach Orbit, each ordered against the admissions on its turn: admission first leaves the stop stale, the stop first is kept. */
    const landLate = () => {
        for (const body of state.lateIntents.splice(0)) {
            if (state.over || state.pending || admissionWon(body) || runStale(body)) continue;
            state.pending = { outcome: body.outcome as 'done' | 'failed', cause: body.cause as 'ours' | 'agent', why: body.why as string, turns: body.turns as number[], run: body.run as string, generation: body.generation as number | undefined, at: Date.now() };
            state.onIntentKept?.();
        }
    };
    const releaseHeld = () => state.heldIntents.splice(0).forEach((release) => release());
    /** The run fence (Opus, 22 Nov): a finish, a finish intent or a renew that names a run other than the job's current one is stale, and nothing is written. No run named, or no run known: as before. */
    const runStale = (body: Record<string, unknown>) => {
        if (modes.noRunFence || state.currentRun === undefined || typeof body.run !== 'string' || body.run === state.currentRun || !state.ranRuns.has(body.run)) return false;
        state.runStale.push({ action: body.action, run: body.run });
        return true;
    };
    /** What Orbit answers a superseded run: a 200 with the marker (as it does), or the same body as a 409 (the game reads both). */
    const superseded = () => {
        const body = { ok: false, reason: 'stale', run: 'superseded', job: { id: job.jobId } };
        if (modes.runStaleStatus === 409) throw http(409, body);
        return body;
    };
    const refuses = (call: 'prepare' | 'turn' | 'renew') => state.pending !== null && (modes.refuses ?? ['prepare', 'turn', 'renew']).includes(call);
    const open = (signal?: AbortSignal): TurnOpened => {
        const make = state.turnScript.shift();
        const events = make
            ? make(signal)
            : (async function* (): AsyncGenerator<RunnerEvent> {
                  yield { type: 'created', id: 'r', sessionId: 's' };
                  yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
              })();
        return { ok: true, events };
    };
    const plain: RunnerOrbit = {
        running: async () => (state.over ? [] : [job]),
        job: async () => {
            if (modes.noGeneration) return { status: state.over ? 'failed' : 'running', control: 'brick', finishPending: null };
            if (state.over) return { status: 'failed', control: 'brick', generation: state.generation };
            if (state.pending && modes.hideAfterShown !== undefined) {
                if (state.shown >= modes.hideAfterShown) return { status: 'running', control: 'brick', generation: state.generation, finishPending: null };
                state.shown += 1;
            }
            if (state.hidden > 0 && state.pending) {
                state.hidden--;
                return { status: 'running', control: 'brick', generation: state.generation, finishPending: null };
            }
            return { status: 'running', control: 'brick', generation: state.generation, finishPending: state.pending ? { outcome: state.pending.outcome, cause: state.pending.cause, why: state.pending.why, turns: state.pending.turns, run: state.pending.run, generation: state.pending.generation } : null };
        },
        action: async (_botId, _jobId, body) => {
            if (body.action === 'renew') {
                state.renews.push(body);
                modes.beforeRenew?.();
                if (runStale(body)) return superseded();
                if (refuses('renew')) return { ok: false, reason: 'finish_pending' };
                return { ok: true, renewInSeconds: 240 };
            }
            if (body.action === 'finish-intent') {
                state.intents.push(body);
                state.order.push('intent');
                const mode = (modes.intent ?? (() => 'ok'))(state.intents.length);
                if (modes.intentDelayMs) await new Promise((resolve) => setTimeout(resolve, modes.intentDelayMs));
                // an intent that never arrives (the whole first process is lost while it is on its way)
                if (mode === 'hang') await new Promise<void>(() => undefined);
                // Orbit keeps the intent and its answer is lost (a timeout on the way back)
                if (mode === 'lost-ack') {
                    if (!state.pending) state.pending = { outcome: body.outcome as 'done' | 'failed', cause: body.cause as 'ours' | 'agent', why: body.why as string, turns: body.turns as number[], run: body.run as string, generation: body.generation as number | undefined, at: Date.now() };
                    throw new Error('timeout of 480000ms exceeded');
                }
                // the caller's timeout (8 s): it gives up, and the request reaches Orbit later
                if (mode === 'late') {
                    state.lateIntents.push(body);
                    throw new Error('timeout of 8000ms exceeded');
                }
                // Orbit takes its time over the decision (the caller is still waiting)
                if (mode === 'hold') await new Promise<void>((resolve) => state.heldIntents.push(resolve));
                if (mode === 'down') throw http(503, { error: 'unavailable' });
                if (mode === 'old') throw http(400, { error: 'Invalid input data' });
                if (mode === 'unknown-job') throw http(404, { error: 'not found' });
                // an answer that is a refusal of a kind the game does not know: nothing was kept
                if (mode === 'other') return { ok: false, reason: 'something_else', job: { id: job.jobId } };
                if (runStale(body)) return superseded();
                if (state.over || mode === 'stale') return { ok: false, reason: 'stale', job: { id: job.jobId } };
                if (body.generation !== undefined && body.generation !== state.generation) return { ok: false, reason: 'stale', job: { id: job.jobId } };
                // a funded call was admitted on the turn this stop is about, before the stop: the turn is no pool-only turn, the stop is stale and nothing is recorded
                if (admissionWon(body)) return { ok: false, reason: 'stale', job: { id: job.jobId } };
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
                if (mode === 'empty') {
                    await modes.onEmpty?.();
                    return {};
                }
                if (runStale(body)) return superseded();
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
        prepare: async (_jobId, _relay, extra) => {
            state.prepareAttempts += 1;
            if (refuses('prepare')) return { ok: false, reason: 'finish_pending' };
            if (modes.prepareFails) return { ok: false, reason: 'failed' };
            state.prepares += 1;
            // under a kept intent Orbit refuses a prepare, so the run is never moved then (a double that lets it pass for a refusal of another call must not move it either)
            if (state.pending === null && extra?.run) {
                state.currentRun = extra.run;
                state.ranRuns.add(extra.run);
            }
            return { ok: true };
        },
        turn: async (_jobId, _input, signal) => {
            state.turnAttempts += 1;
            if (refuses('turn')) return { ok: false, reason: 'finish_pending' } as unknown as TurnOpened;
            state.turnsOpened += 1;
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
    /** The same Orbit with ownership epochs: it gives the epoch in the job read, takes a claim, and notes the epoch every request names. */
    const withEpochs: RunnerOrbit = {
        ...plain,
        job: async (botId, jobId) => {
            const read = await plain.job(botId, jobId);
            return read ? { ...read, ownerEpoch: state.ownerEpoch } : read;
        },
        action: async (botId, jobId, body) => {
            if (body.action === 'claim') {
                state.claims += 1;
                state.ownerEpoch += 1;
                return { ok: true, epoch: state.ownerEpoch };
            }
            state.epochs.push({ action: String(body.action), epoch: body.epoch });
            return plain.action(botId, jobId, body);
        },
        prepare: async (jobId, relay, extra) => {
            state.epochs.push({ action: 'prepare', epoch: extra?.epoch });
            return plain.prepare(jobId, relay, extra);
        },
        turn: async (jobId, input, signal, epoch) => {
            state.epochs.push({ action: 'turn', epoch });
            return plain.turn(jobId, input, signal, epoch);
        },
        stream: async (jobId, signal, epoch) => {
            state.epochs.push({ action: 'stream', epoch });
            return plain.stream(jobId, signal, epoch);
        },
        cancel: async (jobId, facts) => {
            state.cancelFacts.push(facts);
            return plain.cancel(jobId, facts);
        },
    };
    const orbit = modes.epochs ? withEpochs : plain;
    return { orbit, state: Object.assign(state, { admit, landLate, releaseHeld }) };
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
        /** What the runner sees of the notes: the fence commit is written into the order of events (the intent must come first). */
        const seenBy = (notes: RefusalNotes): RefusalNotes => ({
            ...notes,
            commitTurn: async (...args: Parameters<NonNullable<RefusalNotes['commitTurn']>>) => {
                fake.state.order.push('commit');
                return notes.commitTurn!(...args);
            },
        });
        const runnerOn = (notes: RefusalNotes, run: string, extra: Partial<Parameters<typeof createComputerRunner>[0]> = {}) => createComputerRunner({ orbit: fake.orbit, relayUrl: RELAY, log: quiet, timing, refusals: seenBy(notes), runId: () => run, ...extra });
        /** Whether the fence of a turn is COMMITTED in the shared store (its value ends with `c`), or null when there is none. */
        const fenceOf = async (turn: number, run: string) => {
            const value = await client.hGet(`${CALLED_PREFIX}${job.jobId}`, `fence:${turn}|${run}`);
            return value === undefined || value === null ? null : { committed: value.endsWith('c') };
        };
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
        return { job, fake, notesOf, runnerOn, poolBusyTurn, work, admission, fenceOf, seenBy };
    };

    const endedOnce = (fake: ReturnType<typeof intentOrbit>, expected: Partial<LedgerEntry> = {}) => {
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1', ...expected });
    };

    it('the order is: a tentative close, then the INTENT, and only once Orbit KEPT it the fence is committed, the machine cancelled and the finish sent; the finish ends the job once with the intent\'s values', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work, fenceOf } = rig();
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        // the fence commit is written only after Orbit kept the intent
        expect(fake.state.order).toEqual(['intent', 'commit', 'cancel', 'finish']);
        expect(fake.state.intents).toHaveLength(1);
        expect(fake.state.intents[0]).toMatchObject({ action: 'finish-intent', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, basis: 'pool', turns: [1], run: 'run1', generation: 1 });
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        // and the committed fence is taken back once Orbit took the finish
        expect(await fenceOf(1, 'run1')).toBeNull();
    });
    describe('GPT fifth note, E1-E6: the epoch a give-up is made under goes with its intent, its cancel and its finish, across a restart', () => {
        it('the pool give-up claims the job first, and its intent, its cancel and its finish name the epoch the claim gave (the owner\'s own, so Orbit takes them)', async () => {
            const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ epochs: true });
            const notes = notesOf('A');
            poolBusyTurn(notes);
            await work(runnerOn(notes, 'run1'));
            expect(fake.state.claims).toBe(1);
            // the claim came before anything else the runner asked of Orbit
            expect(fake.state.epochs[0]).toEqual({ action: 'prepare', epoch: 1 });
            const named = (action: string) => fake.state.epochs.filter((row) => row.action === action).map((row) => row.epoch);
            for (const action of ['prepare', 'turn', 'renew', 'finish-intent', 'finish']) expect(named(action), action).toEqual(expect.arrayContaining([1]));
            expect(fake.state.epochs.filter((row) => row.epoch !== 1)).toEqual([]);
            // the cancel names the epoch and the provider turn the stream opened with
            expect(fake.state.cancelFacts).toEqual([{ epoch: 1, responseId: 'r' }]);
            endedOnce(fake);
        });

        it('a give-up whose finish Orbit did not take is sent again by the NEXT worker of the runner with the epoch it was made under, before any claim, and that worker claims nothing', async () => {
            let alive = true;
            let runner!: ReturnType<typeof createComputerRunner>;
            // the runner is stopped as its first finish goes out, and Orbit does not take it: the give-up is OWED, in the runner, to the next worker of the job
            const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ epochs: true, finish: () => (alive ? 'down' : 'ok'), onFinish: (n) => (n === 1 ? runner.stop() : undefined) });
            const notes = notesOf('A');
            runner = runnerOn(notes, 'run1');
            poolBusyTurn(notes);
            await work(runner);
            expect(fake.state.ledger).toEqual([]);
            expect(fake.state.epochs.filter((row) => row.action === 'finish')).toEqual([{ action: 'finish', epoch: 1 }]);
            // the job is claimed again by someone else meanwhile (the epoch moves): the owed finish still names the epoch it was made under
            fake.state.ownerEpoch += 1;
            alive = false;
            runner.start(1_000_000_000);
            await until(() => fake.state.over);
            runner.stop();
            await runner.idle();
            endedOnce(fake);
            const finishes = fake.state.epochs.filter((row) => row.action === 'finish');
            expect(finishes.map((row) => row.epoch)).toEqual([1, 1]);
            expect(fake.state.claims).toBe(1);
        });

        it('a fresh runner that completes the end Orbit holds claims nothing and names the epoch the job shows as its owner\'s', async () => {
            let alive = true;
            const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ epochs: true, finish: () => (alive ? 'down' : 'ok') });
            const notesA = notesOf('A');
            const first = runnerOn(notesA, 'run1');
            poolBusyTurn(notesA);
            fake.state.onIntentKept = () => first.stop();
            await work(first);
            alive = false;
            await work(runnerOn(notesOf('B'), 'run2'));
            expect(fake.state.claims).toBe(1);
            const finishes = fake.state.epochs.filter((row) => row.action === 'finish');
            expect(finishes[finishes.length - 1].epoch).toBe(1);
            expect(fake.state.prepares).toBe(1);
            expect(fake.state.ledger).toHaveLength(1);
        });
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

    it('CodeRabbit #4: an empty HTTP 200 for the finish is NOT an end: the committed fence stays, the finish is sent again, and the fence goes only once Orbit answers with the job; the job ends once', async () => {
        const seen: Array<{ committed: boolean } | null> = [];
        let fenceOfRef!: (turn: number, run: string) => Promise<{ committed: boolean } | null>;
        const { fake, notesOf, runnerOn, poolBusyTurn, work, fenceOf } = rig({
            finish: (n) => (n === 1 ? 'empty' : 'ok'),
            onEmpty: async () => void seen.push(await fenceOfRef(1, 'run1')),
        });
        fenceOfRef = fenceOf;
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.finishes).toHaveLength(2);
        expect(seen).toEqual([{ committed: true }]);
        endedOnce(fake);
        expect(await fenceOf(1, 'run1')).toBeNull();
    });

    it('CodeRabbit #5: the read after a turn shows the kept intent and the next read does not: the end is completed from the read that showed it, and no prepare or turn goes out first', async () => {
        const { fake, job, notesOf, runnerOn, work } = rig({ intent: () => 'lost-ack', hideAfterShown: 1 });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 300));
            yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.pending).not.toBeNull();
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, by: 'finish' });
        // the first prepare and the first turn are the job's own start: nothing after the intent
        expect(fake.state.prepareAttempts).toBe(1);
        expect(fake.state.turnAttempts).toBe(1);
        expect(fake.state.finishes).toHaveLength(1);
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

    it('INTENT NOT KEPT (Orbit down): NO give-up: nothing is committed, aborted or cancelled and no finish is sent while Orbit does not hold the intent, the turn goes on and the give-up is tried again; once it is kept the give-up proceeds and the job ends once', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n <= 3 ? 'down' : 'ok') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents).toHaveLength(4);
        // not one commit, cancel or finish before the intent was kept, and the order shows it
        expect(fake.state.order).toEqual(['intent', 'intent', 'intent', 'intent', 'commit', 'cancel', 'finish']);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.turnAttempts).toBe(1);
        endedOnce(fake);
    });
    it('PROOF R2 (GPT second note): the intent request never reaches Orbit and the whole first process is lost; nothing was abandoned (no commit, no abort, no cancel) and the replacement carries the job on by reattaching: no second agent turn, one ending', async () => {
        const { fake, job, notesOf, runnerOn, poolBusyTurn, work, fenceOf, admission } = rig({ intent: () => 'hang' });
        const notesA = notesOf('A');
        const first = runnerOn(notesA, 'run1');
        poolBusyTurn(notesA);
        void work(first);
        await until(() => fake.state.intents.length >= 1);
        // the process is gone: its worker is stuck on the intent that never arrives, and nothing else of it runs
        first.stop();
        expect(fake.state.pending).toBeNull();
        expect(fake.state.order).toEqual(['intent']);
        expect(await fenceOf(1, 'run1')).not.toMatchObject({ committed: true });
        // the replacement reattaches to the turn that was going (the job has its turn now) and the job ends as the turn says
        job.hasTurn = true;
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        const before = { turns: fake.state.turnsOpened, prepares: fake.state.prepares, cancels: fake.state.cancels };
        await work(runnerOn(notesOf('B'), 'run2'));
        const after = { turns: fake.state.turnsOpened, streams: fake.state.streams, prepares: fake.state.prepares, cancels: fake.state.cancels };
        console.log('R2 PROOF', JSON.stringify({ before, after, ledger: fake.state.ledger.map((entry) => `${entry.outcome}/${entry.by}`) }));
        // no second agent turn for the same input, no cancel; the one reattach; no extra prepare beyond the replacement's own
        expect(after.turns - before.turns).toBe(0);
        expect(after.streams).toBe(1);
        expect(after.cancels).toBe(0);
        expect(after.prepares - before.prepares).toBeLessThanOrEqual(1);
        // the fence of the turn that was never given up is not committed (it clears itself), so nothing admits a call as a duplicate of it
        expect(await fenceOf(1, 'run1')).not.toMatchObject({ committed: true });
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run2', by: 'finish' }]);
        void admission;
    });

    it('INTENT KEPT, the process lost before the fence commit and before the abort: the replacement reads finishPending: 0 turns, 0 reattaches, no admission, one ending with the intent\'s values', async () => {
        const { fake, job, notesOf, runnerOn, poolBusyTurn, work, seenBy, fenceOf } = rig();
        const notesA = notesOf('A');
        // the commit of the fence never returns (the process is lost on its way to it)
        const stuck = { ...seenBy(notesA), commitTurn: async () => new Promise<boolean>(() => undefined) };
        const first = runnerOn(notesA, 'run1', { refusals: stuck });
        poolBusyTurn(notesA);
        void work(first);
        await until(() => fake.state.pending !== null);
        first.stop();
        expect(fake.state.cancels).toBe(0);
        expect(await fenceOf(1, 'run1')).not.toMatchObject({ committed: true });
        job.hasTurn = true;
        const before = { turns: fake.state.turnsOpened, prepares: fake.state.prepares, streams: fake.state.streams };
        await work(runnerOn(notesOf('B'), 'run2'));
        expect(fake.state.turnsOpened - before.turns).toBe(0);
        expect(fake.state.streams - before.streams).toBe(0);
        expect(fake.state.prepares - before.prepares).toBe(0);
        endedOnce(fake);
    });

    it('CONTROL (GPT fourth note, R2b-2): the original intent is DELAYED and arrives after the replacement has PREPARED: Orbit answers it stale (run superseded), keeps nothing, the replacement\'s turn goes on to its own end, and the job ends once, as done', async () => {
        const { fake, job, notesOf, runnerOn, poolBusyTurn, work } = rig({ intentDelayMs: 400 });
        const notesA = notesOf('A');
        const first = runnerOn(notesA, 'run1');
        poolBusyTurn(notesA);
        void work(first);
        await until(() => fake.state.intents.length >= 1);
        first.stop();
        expect(fake.state.pending).toBeNull();
        // the replacement reattaches under a run of its own and its turn goes on past the moment the old intent lands
        job.hasTurn = true;
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            await new Promise((resolve) => setTimeout(resolve, 800));
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        await work(runnerOn(notesOf('B'), 'run2'));
        expect(fake.state.pending).toBeNull();
        expect(fake.state.runStale).toEqual([{ action: 'finish-intent', run: 'run1' }]);
        expect(fake.state.ledger).toHaveLength(1);
        expect(fake.state.ledger[0]).toMatchObject({ outcome: 'done', run: 'run2' });
        expect(fake.state.cancels).toBe(0);
    });

    describe('GPT fourth note, R2b-2: Orbit orders the runs of a job (the run fence), and the game names its run in everything that ends or keeps a job', () => {
        /** A turn that is refused for room (as `poolBusyTurn`) and that goes on until it is stopped or aborted, with a hook run as it opens. */
        const busyTurn = (fake: ReturnType<typeof intentOrbit>, notes: RefusalNotes, job: RunnableJob, onOpen: () => void = () => undefined) => {
            const seen = { abortedAt: 0 };
            fake.state.turnScript.push(async function* (signal?: AbortSignal) {
                yield { type: 'created', id: 'r', sessionId: 's' };
                onOpen();
                setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
                const end = Date.now() + 4000;
                while (!signal?.aborted && fake.state.cancels === 0 && !fake.state.over && Date.now() < end) await pause(5);
                if (signal?.aborted) seen.abortedAt = Date.now();
            });
            return seen;
        };

        it('every finish, finish intent and renew of a run names it: a done finish, a failed finish, the pool intent and the renew each carry `run`', async () => {
            const done = rig();
            await done.work(done.runnerOn(done.notesOf('A'), 'run1'));
            expect(done.fake.state.finishes.map((one) => [one.outcome, one.run])).toEqual([['done', 'run1']]);
            expect(done.fake.state.renews.map((one) => one.run)).toEqual(['run1']);
            const busy = rig();
            const notes = busy.notesOf('A');
            busy.poolBusyTurn(notes);
            await busy.work(busy.runnerOn(notes, 'run1'));
            expect(busy.fake.state.intents.map((one) => one.run)).toEqual(['run1']);
            expect(busy.fake.state.finishes.map((one) => [one.outcome, one.run])).toEqual([['failed', 'run1']]);
            const agent = rig();
            agent.fake.state.turnScript.push(async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                yield { type: 'completed', outputText: 'I cannot go on. [[failed: the form is closed]]', usage: null };
            });
            await agent.work(agent.runnerOn(agent.notesOf('A'), 'run1'));
            expect(agent.fake.state.finishes.map((one) => [one.outcome, one.run])).toEqual([['failed', 'run1']]);
        });

        it('a RENEW from an old run, after the replacement prepared, is answered stale (run superseded): the turn is stopped before it opens, the run exits, and nothing is cancelled, finished or prepared again', async () => {
            const { fake, notesOf, runnerOn, work } = rig({ beforeRenew: () => void (fake.state.currentRun = 'run2') });
            await work(runnerOn(notesOf('A'), 'run1'));
            expect(fake.state.runStale).toEqual([{ action: 'renew', run: 'run1' }]);
            expect(fake.state.turnsOpened).toBe(0);
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.finishes).toEqual([]);
            expect(fake.state.prepareAttempts).toBe(1);
            expect(fake.state.ledger).toEqual([]);
        });

        it('a pool stop of an old run, answered stale because the replacement prepared while its turn went on: the turn is stopped without a cancel, no ending is sent, the run exits', async () => {
            const { fake, job, notesOf, runnerOn, work } = rig();
            const notes = notesOf('A');
            const seen = busyTurn(fake, notes, job, () => void (fake.state.currentRun = 'run2'));
            await work(runnerOn(notes, 'run1'));
            expect(fake.state.runStale).toEqual([{ action: 'finish-intent', run: 'run1' }]);
            // the turn was stopped by the stale answer, not left to run on
            expect(seen.abortedAt).toBeGreaterThan(0);
            expect(fake.state.pending).toBeNull();
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.finishes).toEqual([]);
            expect(fake.state.ledger).toEqual([]);
            expect(fake.state.turnAttempts).toBe(1);
            expect(fake.state.prepareAttempts).toBe(1);
        });

        it('IN PROCESS: the old run\'s done finish is answered stale, its worker exits (no second turn of it, no cancel), and when the same process takes the job up again under a new run, that run works it to its own end: one ending, named run2', async () => {
            const ids = ['run1', 'run2'];
            const { fake, notesOf, runnerOn, work } = rig();
            fake.state.turnScript.push(async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                // another run holds the job by the time this turn says it is done
                fake.state.currentRun = 'run-elsewhere';
                yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
            });
            const runner = runnerOn(notesOf('A'), 'ignored', { runId: () => ids.shift() as string });
            await work(runner);
            expect(fake.state.runStale).toEqual([{ action: 'finish', run: 'run1' }]);
            expect(fake.state.turnAttempts).toBe(1);
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.ledger).toEqual([]);
            // the job is still going: this process takes it up again, under the next run
            await work(runner);
            expect(fake.state.ledger.map((entry) => [entry.outcome, entry.run])).toEqual([['done', 'run2']]);
            expect(fake.state.currentRun).toBe('run2');
            expect(fake.state.cancels).toBe(0);
        });

        it('a worker that was stopped is not replaced while it is still ending: a start of the runner opens nothing on the job until the old worker has ended (two runs of one process never work a job at once)', async () => {
            const ids = ['run1', 'run2'];
            const { fake, job, notesOf, runnerOn, work } = rig({ intent: () => 'hold' });
            const notes = notesOf('A');
            const runner = runnerOn(notes, 'ignored', { runId: () => ids.shift() as string });
            busyTurn(fake, notes, job);
            void work(runner);
            await until(() => fake.state.heldIntents.length >= 1);
            runner.stop();
            runner.start(20);
            await pause(150);
            // nothing new began while the old worker is still on its intent
            expect(fake.state.prepareAttempts).toBe(1);
            expect(fake.state.turnAttempts).toBe(1);
            fake.state.releaseHeld();
            await runner.idle();
            runner.stop();
        });

        for (const status of [200, 409] as const) {
            it(`Orbit says "run superseded" in a ${status}: a pool stop is read the same (the run exits, nothing is cancelled), and so is a done finish`, async () => {
                const stop = rig({ runStaleStatus: status });
                const notes = stop.notesOf('A');
                const seen = busyTurn(stop.fake, notes, stop.job, () => void (stop.fake.state.currentRun = 'run2'));
                await stop.work(stop.runnerOn(notes, 'run1'));
                expect(stop.fake.state.runStale).toEqual([{ action: 'finish-intent', run: 'run1' }]);
                expect(seen.abortedAt).toBeGreaterThan(0);
                expect(stop.fake.state.cancels).toBe(0);
                expect(stop.fake.state.finishes).toEqual([]);
                const done = rig({ runStaleStatus: status });
                done.fake.state.turnScript.push(async function* () {
                    yield { type: 'created', id: 'r', sessionId: 's' };
                    done.fake.state.currentRun = 'run2';
                    yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
                });
                await done.work(done.runnerOn(done.notesOf('A'), 'run1'));
                expect(done.fake.state.runStale).toEqual([{ action: 'finish', run: 'run1' }]);
                expect(done.fake.state.turnAttempts).toBe(1);
                expect(done.fake.state.ledger).toEqual([]);
                const renew = rig({ runStaleStatus: status, beforeRenew: () => void (renew.fake.state.currentRun = 'run2') });
                await renew.work(renew.runnerOn(renew.notesOf('A'), 'run1'));
                expect(renew.fake.state.runStale).toEqual([{ action: 'renew', run: 'run1' }]);
                expect(renew.fake.state.turnsOpened).toBe(0);
                expect(renew.fake.state.cancels).toBe(0);
            });
        }

        it('a run whose own prepare never succeeded is never fenced: its failed finish (named with its run) is taken, the job ends once as the run said, even while another run is the job\'s current one', async () => {
            const { fake, notesOf, runnerOn, work } = rig({ prepareFails: true });
            // run1 prepared the job before it was lost; run2 (this restart) cannot get a machine ready
            fake.state.currentRun = 'run1';
            fake.state.ranRuns.add('run1');
            await work(runnerOn(notesOf('B'), 'run2'));
            expect(fake.state.runStale).toEqual([]);
            expect(fake.state.finishes.map((one) => [one.outcome, one.cause, one.run])).toEqual([['failed', 'ours', 'run2']]);
            expect(fake.state.ledger).toHaveLength(1);
        });

        it('HISTORICAL control: an old run\'s successful calls never block the replacement run\'s own genuine pool stop: it is kept and the job ends as the replacement\'s pool failure', async () => {
            const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig();
            // run1 admitted a funded call on turn 1 before it was lost
            fake.state.admitted.push({ turn: 1, run: 'run1' });
            const notes = notesOf('B');
            poolBusyTurn(notes);
            await work(runnerOn(notes, 'run2'));
            expect(fake.state.runStale).toEqual([]);
            expect(fake.state.intents).toHaveLength(1);
            expect(fake.state.intents[0]).toMatchObject({ run: 'run2', turns: [1] });
            endedOnce(fake, { run: 'run2' });
        });

        it('MIXED VERSIONS: an Orbit from before the run fence ignores the run it is told and answers as it did: a plain stale (an old control generation) does NOT end a run, which reads the job again', async () => {
            const { fake, notesOf, runnerOn, work } = rig({ noRunFence: true });
            fake.state.turnScript.push(async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                // the person took the machine and gave it back while the turn went on: the generation moved
                fake.state.generation = 2;
                yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
            });
            await work(runnerOn(notesOf('A'), 'run1'));
            // the first finish named generation 1 (an older one) and was answered stale (no run marker): the run read the job again and went on
            expect(fake.state.finishes.length).toBeGreaterThanOrEqual(1);
            expect(fake.state.ledger.length).toBe(1);
            expect(fake.state.runStale).toEqual([]);
            expect(fake.state.ledger[0]).toMatchObject({ outcome: 'done', run: 'run1' });
        });
    });

    it('CONTROL: the intent is committed at Orbit but its ANSWER is lost (the first process alive): not kept, so nothing is committed or cancelled; the next attempt gets "already" (kept), the give-up proceeds and the job ends once', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n === 1 ? 'lost-ack' : 'ok') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents.length).toBeGreaterThanOrEqual(2);
        // the first intent was not read as kept: no commit or cancel before the second
        expect(fake.state.order.slice(0, 3)).toEqual(['intent', 'intent', 'commit']);
        expect(fake.state.turnsOpened).toBe(1);
        endedOnce(fake);
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

    describe('GPT third note, R2 follow-up: a pool-only stop and a funded call admitted on the same turn are ordered at Orbit, and the game does what the answer says', () => {
        const slow = { ...timing, poolGiveUpMs: 400 };
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        /** A turn that is refused for room, then goes on until `release()` and ends by itself as a turn that did its work (or fails with refused calls when the stop was kept). */
        const turnThatGoesOn = (fake: ReturnType<typeof intentOrbit>, notes: RefusalNotes, job: RunnableJob) => {
            const gate = { open: false };
            fake.state.turnScript.push(async function* () {
                yield { type: 'created', id: 'r', sessionId: 's' };
                setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
                const end = Date.now() + 8000;
                while (!gate.open && Date.now() < end) await sleep(10);
                if (fake.state.pending) yield { type: 'failed', code: 'calls_refused', message: 'keys revoked' } as RunnerEvent;
                else yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
            });
            return gate;
        };
        const fenceGone = async (fenceOf: (turn: number, run: string) => Promise<unknown>) => {
            const end = Date.now() + 5000;
            while ((await fenceOf(1, 'run1')) !== null && Date.now() < end) await sleep(5);
            expect(await fenceOf(1, 'run1')).toBeNull();
        };

        it('ORDER A, caller timeout then admission then the late request: the game takes the close back at the timeout (the turn goes on), the relay and Orbit admit a funded call, the late stop is stale and changes nothing: 1 admission, no stop recorded, 0 cancels, the job ends as the turn ended (done), not failed', async () => {
            const { fake, job, notesOf, runnerOn, work, admission, fenceOf } = rig({ intent: () => 'late' });
            const notes = notesOf('A');
            const gate = turnThatGoesOn(fake, notes, job);
            const running = work(runnerOn(notes, 'run1', { timing: slow }));
            await until(() => fake.state.lateIntents.length >= 1);
            await fenceGone(fenceOf);
            expect(fake.state.pending).toBeNull();
            // the pool has room again: the relay takes up a funded call of the turn and Orbit admits it
            expect(await admission(1)).toBe(true);
            expect(fake.state.admit(1)).toBe(true);
            // now the original request reaches Orbit
            fake.state.landLate();
            expect(fake.state.pending).toBeNull();
            gate.open = true;
            await running;
            expect(fake.state.admitted).toEqual([{ turn: 1, run: 'run1' }]);
            expect(fake.state.refusedAdmissions).toBe(0);
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.wallet).toEqual({ held: 5000, givenBack: 0 });
            expect(fake.state.intents).toHaveLength(1);
            expect(fake.state.ledger.map((entry) => entry.outcome)).toEqual(['done']);
            expect(fake.state.ledger[0]).not.toMatchObject({ cause: 'ours', why: POOL_BUSY_WHY });
            expect(fake.state.turnsOpened).toBe(1);
        });

        it('ORDER B, caller timeout then the late request FIRST then an admission: the stop is kept at Orbit, the admission is refused (0 admissions), and the job ends ONCE as the stop says (failed for room), completed from the intent when the turn\'s calls are refused', async () => {
            const { fake, job, notesOf, runnerOn, work, fenceOf } = rig({ intent: (n) => (n === 1 ? 'late' : 'ok') });
            const notes = notesOf('A');
            const gate = turnThatGoesOn(fake, notes, job);
            const running = work(runnerOn(notes, 'run1', { timing: slow }));
            await until(() => fake.state.lateIntents.length >= 1);
            await fenceGone(fenceOf);
            fake.state.landLate();
            expect(fake.state.pending).toMatchObject({ outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run1' });
            // a funded call of the turn now comes to Orbit: refused
            expect(fake.state.admit(1)).toBe(false);
            gate.open = true;
            await running;
            expect(fake.state.admitted).toEqual([]);
            expect(fake.state.refusedAdmissions).toBe(1);
            expect(fake.state.wallet).toEqual({ held: 0, givenBack: 0 });
            endedOnce(fake);
            expect(fake.state.turnsOpened).toBe(1);
        });

        it('GPT fourth note, R2b-2 (repro): across a runner restart on the same job, the replacement (another run) admits a funded call first, then the old runner\'s delayed stop arrives: it is STALE, the replacement\'s work goes on, nothing is cancelled and no pool failure is recorded', async () => {
            const { fake, job, notesOf, runnerOn, work, admission, fenceOf } = rig({ intent: () => 'late' });
            const notesA = notesOf('A');
            const gateA = turnThatGoesOn(fake, notesA, job);
            const first = runnerOn(notesA, 'run1', { timing: slow });
            const runningA = work(first);
            await until(() => fake.state.lateIntents.length >= 1);
            await fenceGone(fenceOf);
            // the first runner is lost (a restart): the replacement takes the job up under a run of its own and its turn 1 admits a funded call
            first.stop();
            gateA.open = true;
            await runningA;
            const notesB = notesOf('B');
            const gateB = turnThatGoesOn(fake, notesB, job);
            const second = runnerOn(notesB, 'run2', { timing: slow });
            const runningB = work(second);
            await until(() => fake.state.turnsOpened >= 2);
            expect(await admission(1, 'run2')).toBe(true);
            expect(fake.state.admit(1, 'run2')).toBe(true);
            // now the old runner's request reaches Orbit
            fake.state.landLate();
            expect(fake.state.pending).toBeNull();
            gateB.open = true;
            await runningB;
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.ledger.map((entry) => entry.outcome)).toEqual(['done']);
            expect(fake.state.wallet).toEqual({ held: 5000, givenBack: 0 });
        });

        it('the tentative fence EXPIRES while Orbit holds the intent, a funded call is admitted, and Orbit then answers STALE: the turn stays (nothing committed, aborted or cancelled), the job ends as the turn ended, and the give-up is not tried again for that turn', async () => {
            const { fake, job, notesOf, runnerOn, work, admission, fenceOf } = rig({ intent: () => 'hold' });
            const notes = notesOf('A');
            const gate = turnThatGoesOn(fake, notes, job);
            const running = work(runnerOn(notes, 'run1', { timing: slow }));
            await until(() => fake.state.heldIntents.length >= 1);
            expect(await fenceOf(1, 'run1')).toMatchObject({ committed: false });
            // 30 seconds pass: the tentative fence is gone from the store, the relay takes up a funded call and Orbit admits it
            await client.hDel(`${CALLED_PREFIX}${job.jobId}`, 'fence:1|run1');
            expect(await admission(1)).toBe(true);
            expect(fake.state.admit(1)).toBe(true);
            // Orbit decides now: the admission came first
            fake.state.releaseHeld();
            await sleep(300);
            expect(fake.state.pending).toBeNull();
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.order).not.toContain('commit');
            gate.open = true;
            await running;
            expect(fake.state.intents).toHaveLength(1);
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.admitted).toEqual([{ turn: 1, run: 'run1' }]);
            expect(fake.state.wallet).toEqual({ held: 5000, givenBack: 0 });
            expect(fake.state.ledger.map((entry) => entry.outcome)).toEqual(['done']);
        });

        it('a STALE answer latches the give-up off for THAT turn: the turn stays refused for room for a long while and exactly one intent is sent (the tentative close does not flap the relay), nothing is cancelled', async () => {
            const { fake, job, notesOf, runnerOn, work } = rig({ intent: () => 'stale' });
            const notes = notesOf('A');
            const gate = turnThatGoesOn(fake, notes, job);
            const running = work(runnerOn(notes, 'run1'));
            await sleep(700);
            gate.open = true;
            await running;
            expect(fake.state.intents).toHaveLength(1);
            expect(fake.state.cancels).toBe(0);
            expect(fake.state.ledger.map((entry) => entry.outcome)).toEqual(['done']);
        });
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

    it('a 400 for the intent: NO give-up (nothing is committed, cancelled or finished), the turn goes on, the log says it every time and Sentry once, and the job ends as its turn said', async () => {
        const { fake, notesOf, runnerOn, work, job } = rig({ intent: () => 'old' });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 400));
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        quiet.warn.mockClear();
        vi.mocked(Sentry.captureMessage).mockClear();
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents.length).toBeGreaterThanOrEqual(2);
        expect(fake.state.order.filter((one) => one === 'commit' || one === 'cancel')).toEqual([]);
        expect(fake.state.pending).toBeNull();
        expect(quiet.warn.mock.calls.filter((call) => String(call[0]).includes('finish intent with 400')).length).toBeGreaterThanOrEqual(2);
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run1', by: 'finish' }]);
    });
    it('a runner that sends no intent (0.4.3) and a finish with no generation are still taken: nothing about the intent is needed to end a job', async () => {
        // an Orbit whose job read has no control generation: the runner has none to send, so the finish carries none (and the ledger could not tell otherwise)
        const { fake, notesOf, runnerOn, work, job } = rig({ noGeneration: true });
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
        });
        await work(runnerOn(notesOf('A'), 'run1'));
        expect(fake.state.intents).toEqual([]);
        expect(fake.state.finishes).toHaveLength(1);
        expect('generation' in fake.state.finishes[0]).toBe(false);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run1', by: 'finish' }]);
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
        // Orbit processes BOTH finishes: the first names the generation the give-up began on and is answered stale, the second names the one the job is on now
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig();
        const notes = notesOf('A');
        const runner = runnerOn(notes, 'run1');
        poolBusyTurn(notes);
        // the generation moves after the intent is kept and before the first finish goes
        fake.state.onIntentKept = () => (fake.state.generation = 2);
        await work(runner);
        expect(fake.state.finishes.map((one) => one.generation)).toEqual([1, 2]);
        endedOnce(fake);
        expect(fake.state.turnsOpened).toBe(1);
        expect(fake.state.prepares).toBe(1);
    });

    it('R2.7: a turn that ENDS while the tentative close is being written is not given up, and no intent is sent for it (the intent cannot be taken back)', async () => {
        const { fake, notesOf, runnerOn, work, job, seenBy } = rig();
        const notes = notesOf('A');
        // the close is slow, and the turn completes while it is being written
        // no timings: the turn ends only after the close was entered, and the close is released only after the runner has read the end of the turn
        let entered!: () => void;
        const closeEntered = new Promise<void>((resolve) => (entered = resolve));
        let observed!: () => void;
        const turnObserved = new Promise<void>((resolve) => (observed = resolve));
        const slow = { ...seenBy(notes), closeTurn: async (...args: Parameters<NonNullable<RefusalNotes['closeTurn']>>) => {
            entered();
            await turnObserved;
            return notes.closeTurn!(...args);
        } };
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await closeEntered;
            try {
                yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
            } finally {
                observed();
            }
        });
        await work(runnerOn(notes, 'run1', { refusals: slow }));
        expect(fake.state.intents).toEqual([]);
        expect(fake.state.pending).toBeNull();
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run1', by: 'finish' }]);
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

    it('a turn that ends with its [[done]] after the intent of its OWN run was kept (a replacement worker of the same run, the process lost): the end is completed from what Orbit holds, never the turn\'s own words (no finish of `done` is sent)', async () => {
        const { fake, notesOf, runnerOn, work } = rig();
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            // the intent of this run was kept meanwhile
            fake.state.pending = { outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run2', at: Date.now() };
            yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
        });
        await work(runnerOn(notesOf('A'), 'run2'));
        expect(fake.state.finishes).toHaveLength(1);
        expect(fake.state.finishes[0]).toMatchObject({ action: 'finish', outcome: 'failed', cause: 'ours', why: POOL_BUSY_WHY, turns: [1], run: 'run2' });
        endedOnce(fake, { run: 'run2' });
        expect(fake.state.turnAttempts).toBe(1);
    });

    it('GPT fourth note, R2b-2: a turn that ends with its [[done]] after ANOTHER run prepared the job (a process that took it up): this run\'s done finish is answered stale (run superseded), it exits, and the other run\'s end is the only one', async () => {
        const { fake, notesOf, runnerOn, work } = rig();
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            // another run (a process that took the job up) prepared its machine
            fake.state.currentRun = 'run3';
            yield { type: 'completed', outputText: 'Filed. [[done]]', usage: null };
        });
        await work(runnerOn(notesOf('A'), 'run2'));
        // its own words ended nothing: the done finish was answered stale and nothing was recorded, cancelled or opened again
        expect(fake.state.finishes.map((one) => [one.outcome, one.run])).toEqual([['done', 'run2']]);
        expect(fake.state.runStale).toEqual([{ action: 'finish', run: 'run2' }]);
        expect(fake.state.ledger).toEqual([]);
        expect(fake.state.cancels).toBe(0);
        expect(fake.state.turnAttempts).toBe(1);
        expect(fake.state.prepareAttempts).toBe(1);
    });

    it('an intent that Orbit could not take at first and then finds STALE (the job moved on meanwhile): no give-up at all, no finish of it is ever sent, and the job goes on to its own end', async () => {
        const { fake, notesOf, runnerOn, work, job } = rig({ intent: (n) => (n === 1 ? 'down' : 'stale') });
        const notes = notesOf('A');
        fake.state.turnScript.push(async function* () {
            yield { type: 'created', id: 'r', sessionId: 's' };
            setTimeout(() => notes.record(job.botId, job.jobId, poolRefusal), 0);
            await new Promise((resolve) => setTimeout(resolve, 400));
            yield { type: 'completed', outputText: 'Filed after all. [[done]]', usage: null };
        });
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents.length).toBeGreaterThanOrEqual(2);
        expect(fake.state.order.filter((one) => one === 'commit' || one === 'cancel')).toEqual([]);
        expect(fake.state.finishes.some((one) => one.why === POOL_BUSY_WHY)).toBe(false);
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run1', by: 'finish' }]);
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
        expect(fake.state.ledger).toEqual([{ outcome: 'done', cause: undefined, why: undefined, turns: undefined, run: 'run1', by: 'finish' }]);
        expect(await admission(1)).toBe(true);
    });

    it('an answer that is a refusal of a kind the game does not know (200 {ok:false, reason: something else}) is NOT a kept intent: no give-up (nothing committed, cancelled or finished) until a later answer keeps it', async () => {
        const { fake, notesOf, runnerOn, poolBusyTurn, work } = rig({ intent: (n) => (n <= 2 ? 'other' : 'ok') });
        const notes = notesOf('A');
        poolBusyTurn(notes);
        await work(runnerOn(notes, 'run1'));
        expect(fake.state.intents).toHaveLength(3);
        expect(fake.state.order).toEqual(['intent', 'intent', 'intent', 'commit', 'cancel', 'finish']);
        expect(fake.state.turnAttempts).toBe(1);
        expect(fake.state.turnsOpened).toBe(1);
        endedOnce(fake);
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
