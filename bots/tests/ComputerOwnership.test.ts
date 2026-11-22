import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiService } from '../server/AdminApiService';
import { createComputerRunner, RUNNER_GUARDS, runnerOrbitFor, type CancelFacts, type FinishPending, type PrepareFacts, type RunnableJob, type RunnerEvent, type RunnerOrbit, type TurnOpened } from '../server/ComputerRunner';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

/**
 * GPT fifth note, E1-E6 (the game's side): Orbit gives every job ONE owner at a time (an ownership epoch). A worker claims the job before it sends anything that changes it, and every
 * later request names the epoch it holds; Orbit answers a request from any other epoch `superseded` and writes nothing (its own tests cover what it leaves intact). What is tested here is
 * what the GAME does: it claims first, it names its epoch (and run, generation, provider turn) in every request, it ends its run (no finish, no cancel, no retry) when it is told it was
 * superseded, and it leaves a job's end to Orbit's finalizer once Orbit has committed to one. The double below keeps to the contract Orbit's thread gave; it also holds a replacement
 * worker's marker (its key, its provider turn, its reservation, the job's state) so a test can say that an obsolete request of the old worker left all of it where it was.
 */
const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
const RESUMED_JOB: RunnableJob = { ...JOB, hasTurn: true };
const RELAY = 'https://bot-server.example.test';
/** A wait that lets other work run (a runner that wrongly waits for a person fails its test on the clock, never spins). The two tests that use fake timers say `instantly`. */
const instantly = async () => undefined;
const yielding = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const quiet = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });
const TIMING = { waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0] };

type Kind = 'job' | 'claim' | 'prepare' | 'turn' | 'stream' | 'renew' | 'progress' | 'handover' | 'finish' | 'finish-intent' | 'cancel';
interface Request {
    kind: Kind;
    epoch?: number;
    body?: Record<string, unknown>;
    answer: string;
}
interface Options {
    /** The owner epoch the job is on when the runner takes it up; `'legacy'` is an Orbit that has no epochs at all. */
    epoch?: number | 'legacy';
    /** Done as a request reaches Orbit, before it decides (the world moves while a request is on its way). `n` counts the requests of that kind. */
    before?: Partial<Record<Kind, (n: number) => void>>;
    /** Done as a read of the job reaches Orbit, before it answers (`n` counts the reads). */
    beforeRead?: (n: number) => void;
    /** What a renewal is answered (Orbit's own decision on room): ok by default. */
    renew?: (n: number) => Record<string, unknown>;
    /** The turns: the next script opens each turn (the default turn says done). */
    turns?: Array<() => AsyncGenerator<RunnerEvent>>;
    /** Prepare is refused this way (`failed`...) while the worker owns the job. */
    prepare?: string;
    /** The job reads lag (a replica that has not seen another worker's claim): they show the epoch this worker claimed, whatever the job is on now. */
    staleReads?: boolean;
    /** A handover is refused (`reason: refused`, a no from Orbit that is neither stale nor not_current). */
    refuseHandover?: boolean;
    /** The first turn is answered `busy` (the agent is still on a turn of its own): the runner reads that one with a stream instead. */
    busy?: boolean;
}

const REPLACEMENT_TURN = 'resp-B';

/** Orbit as the ownership contract says, for one job. */
function ownedOrbit(job: RunnableJob, options: Options = {}) {
    const legacy = options.epoch === 'legacy';
    const state = {
        ownerEpoch: typeof options.epoch === 'number' ? options.epoch : 0,
        status: 'running' as 'running' | 'waiting' | 'done' | 'failed',
        generation: 1,
        pending: null as (FinishPending & { by?: number }) | null,
        /** The provider turn the job is on (what a handover and a cancel must name). */
        responseId: 'resp-1',
        /** The live model key: for which epoch it was made (a claim ends every key of the job, a prepare of the owner makes one). */
        key: null as { epoch: number } | null,
        reserved: 5000,
        admitted: 0,
        cancelled: [] as string[],
        ended: null as null | { outcome: string; cause?: unknown; why?: unknown; by: 'finish' | 'intent' },
        requests: [] as Request[],
        superseded: [] as Request[],
        counts: {} as Partial<Record<Kind, number>>,
        turnScripts: [...(options.turns ?? [])],
    };
    const count = (kind: Kind): number => {
        // A runner that goes round the same refusal again and again ends the job here (the test then fails on what it asked), so a wrong runner never spins
        if (state.requests.length > 300 && state.status === 'running') state.status = 'failed';
        return (state.counts[kind] = (state.counts[kind] ?? 0) + 1);
    };
    /** The epoch the job reads show: the job's own, or (a lagging replica) the one this worker claimed. */
    let claimedEpoch: number | undefined;
    const log = (kind: Kind, answer: string, epoch?: number, body?: Record<string, unknown>) => {
        const row = { kind, answer, ...(epoch === undefined ? {} : { epoch }), ...(body ? { body } : {}) };
        state.requests.push(row);
        if (answer === 'superseded') state.superseded.push(row);
    };
    /** Orbit's predicate: the epoch is the job's own (an epoch-less request only while the job was never claimed), and the job is Brick's and going. */
    const owns = (epoch: number | undefined) => legacy || (epoch === undefined ? state.ownerEpoch === 0 : epoch === state.ownerEpoch);
    const live = () => state.status === 'running' || state.status === 'waiting';
    const end = (outcome: 'done' | 'failed', by: 'finish' | 'intent', extra: { cause?: unknown; why?: unknown } = {}) => {
        state.status = outcome;
        state.ended = { outcome, by, ...extra };
    };
    const supersededAnswer = (extra: Record<string, unknown> = {}) => ({ ok: false, reason: 'stale', run: 'superseded', ...extra });
    /** The replacement worker B: it claims, prepares (a key of its own) and admits a funded call of 5,000 micros on a provider turn of its own. */
    const replace = () => {
        state.ownerEpoch += 1;
        state.key = { epoch: state.ownerEpoch };
        state.responseId = REPLACEMENT_TURN;
        state.reserved += 5000;
        state.admitted += 1;
    };
    const markerIntact = () => state.key?.epoch === state.ownerEpoch && state.responseId === REPLACEMENT_TURN && state.reserved === 10_000 && state.admitted === 1 && state.status === 'running' && state.ended === null && state.cancelled.length === 0;
    const turnOf = (): AsyncGenerator<RunnerEvent> => {
        const make = state.turnScripts.shift();
        if (make) return make();
        return (async function* () {
            yield { type: 'created', id: state.responseId, sessionId: 's' };
            yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
        })();
    };
    const orbit: RunnerOrbit = {
        running: async () => [job],
        job: async () => {
            options.beforeRead?.(count('job'));
            const shown = options.staleReads && claimedEpoch !== undefined ? claimedEpoch : state.ownerEpoch;
            if (!live()) return { status: state.status, control: 'brick', generation: state.generation, ...(legacy ? {} : { ownerEpoch: shown }) };
            return {
                status: state.status,
                control: 'brick',
                generation: state.generation,
                ...(legacy ? {} : { ownerEpoch: shown }),
                finishPending: state.pending ? { outcome: state.pending.outcome, cause: state.pending.cause, why: state.pending.why, turns: state.pending.turns, run: state.pending.run, generation: state.pending.generation } : null,
            };
        },
        action: async (_botId, _jobId, body) => {
            const kind = String(body.action) as Kind;
            const n = count(kind);
            options.before?.[kind]?.(n);
            const epoch = typeof body.epoch === 'number' ? body.epoch : undefined;
            if (kind === 'claim') {
                if (!live()) {
                    log(kind, 'over', epoch, body);
                    return { ok: false, reason: 'over' };
                }
                if (state.pending) {
                    log(kind, 'finish_pending', epoch, body);
                    return { ok: false, reason: 'finish_pending' };
                }
                if (body.seen !== state.ownerEpoch) {
                    log(kind, 'superseded', epoch, body);
                    return supersededAnswer({ ownerEpoch: state.ownerEpoch });
                }
                state.ownerEpoch += 1;
                // Every live key of the job ends with a claim: the new owner's prepare makes one
                state.key = null;
                claimedEpoch = state.ownerEpoch;
                log(kind, 'claimed', state.ownerEpoch, body);
                return { ok: true, epoch: state.ownerEpoch };
            }
            if (!live()) {
                log(kind, 'over', epoch, body);
                return { ok: true, already: true };
            }
            // A kept intent is the committed word: a finish is accepted from any worker and ends the job as the intent says (the finalizer owns the ending)
            if (kind === 'finish' && state.pending) {
                end(state.pending.outcome, 'intent', { cause: state.pending.cause, why: state.pending.why });
                log(kind, 'ended-as-intent', epoch, body);
                return { ok: true };
            }
            if (!owns(epoch)) {
                log(kind, 'superseded', epoch, body);
                return supersededAnswer();
            }
            if (kind === 'renew') {
                // Once an end is kept the finalizer owns it: a renewal adds nothing and writes nothing
                if (state.pending) {
                    log(kind, 'ending', epoch, body);
                    return { ok: false, reason: 'ending' };
                }
                const answer = options.renew?.(n) ?? { ok: true, renewInSeconds: 240 };
                log(kind, answer.ok === false ? 'refused' : 'ok', epoch, body);
                return answer;
            }
            if (kind === 'finish-intent') {
                if (!state.pending) state.pending = { outcome: body.outcome as 'done' | 'failed', cause: body.cause as 'ours' | 'agent', why: body.why as string, turns: body.turns as number[], run: body.run as string, generation: body.generation as number, by: epoch };
                log(kind, 'kept', epoch, body);
                return { ok: true };
            }
            if (kind === 'finish') {
                end(body.outcome as 'done' | 'failed', 'finish', { cause: body.cause, why: body.why });
                log(kind, 'ended', epoch, body);
                return { ok: true };
            }
            if (kind === 'handover') {
                if (options.refuseHandover) {
                    log(kind, 'refused', epoch, body);
                    return { ok: false, reason: 'refused' };
                }
                // Lands only on the provider turn it names (a delayed handover of an old worker never holds the replacement's job)
                if (typeof body.responseId === 'string' && body.responseId !== state.responseId) {
                    log(kind, 'not_current', epoch, body);
                    return { ok: false, reason: 'not_current' };
                }
                if (body.generation !== undefined && body.generation !== state.generation) {
                    log(kind, 'stale', epoch, body);
                    return { ok: false, reason: 'stale' };
                }
                state.status = 'waiting';
                log(kind, 'handed', epoch, body);
                return { ok: true };
            }
            log(kind, 'ok', epoch, body);
            return { ok: true };
        },
        prepare: async (_jobId: string, _relay: string, extra?: PrepareFacts) => {
            count('prepare');
            options.before?.prepare?.(state.counts.prepare as number);
            const epoch = extra?.epoch;
            if (!owns(epoch)) {
                log('prepare', 'superseded', epoch);
                return { ok: false as const, reason: 'superseded' };
            }
            if (state.pending) {
                log('prepare', 'finish_pending', epoch);
                return { ok: false as const, reason: 'finish_pending' };
            }
            if (options.prepare) {
                log('prepare', options.prepare, epoch);
                return { ok: false as const, reason: options.prepare };
            }
            state.key = { epoch: epoch ?? 0 };
            log('prepare', 'ok', epoch);
            return { ok: true as const };
        },
        turn: async (_jobId: string, _input: string, _signal: AbortSignal, epoch?: number): Promise<TurnOpened> => {
            count('turn');
            options.before?.turn?.(state.counts.turn as number);
            if (!owns(epoch)) {
                log('turn', 'superseded', epoch);
                return { ok: false, reason: 'stale', superseded: true };
            }
            if (options.busy && state.counts.turn === 1) {
                log('turn', 'busy', epoch);
                return { ok: false, reason: 'busy', responseId: state.responseId };
            }
            log('turn', 'ok', epoch);
            return { ok: true, events: turnOf() };
        },
        stream: async (_jobId: string, _signal: AbortSignal, epoch?: number): Promise<TurnOpened> => {
            count('stream');
            options.before?.stream?.(state.counts.stream as number);
            if (!owns(epoch)) {
                log('stream', 'superseded', epoch);
                return { ok: false, reason: 'stale', superseded: true };
            }
            log('stream', 'ok', epoch);
            return { ok: true, events: turnOf() };
        },
        cancel: async (_jobId: string, facts?: CancelFacts) => {
            count('cancel');
            options.before?.cancel?.(state.counts.cancel as number);
            const epoch = facts?.epoch;
            if (!owns(epoch)) {
                log('cancel', 'superseded', epoch, facts as Record<string, unknown>);
                return;
            }
            // Orbit cancels exactly the provider turn the request names, and never "whichever is current"
            if (facts?.responseId && facts.responseId !== state.responseId) {
                log('cancel', 'not_current', epoch, facts as Record<string, unknown>);
                return;
            }
            state.cancelled.push(state.responseId);
            log('cancel', 'cancelled', epoch, facts as Record<string, unknown>);
        },
    };
    return {
        orbit,
        state,
        replace,
        markerIntact,
        requests: () => state.requests,
        /** The requests of one kind, in the order they were made. */
        of: (kind: Kind) => state.requests.filter((row) => row.kind === kind),
        /** Everything the runner asked Orbit to CHANGE (not the reads), in order. */
        asked: () => state.requests.filter((row) => row.kind !== 'job').map((row) => row.kind),
    };
}

const runner = (fake: ReturnType<typeof ownedOrbit>, extra: { relayUrl?: string | null; log?: ReturnType<typeof quiet>; sleep?: (ms: number) => Promise<void> } = {}) => {
    const log = extra.log ?? quiet();
    const instance = createComputerRunner({ orbit: fake.orbit, relayUrl: extra.relayUrl === undefined ? RELAY : extra.relayUrl, sleep: extra.sleep ?? yielding, log, timing: TIMING, runId: () => 'run1' });
    return { instance, log };
};
const runJob = async (fake: ReturnType<typeof ownedOrbit>, job: RunnableJob = JOB, extra: { relayUrl?: string | null; sleep?: (ms: number) => Promise<void> } = {}) => {
    const { instance, log } = runner(fake, extra);
    fake.orbit.running = async () => [job];
    await instance.tick();
    await instance.idle();
    return log;
};
const toolStep = (words: string) =>
    async function* (): AsyncGenerator<RunnerEvent> {
        yield { type: 'created', id: 'resp-1', sessionId: 's' };
        yield { type: 'tool', state: 'started', tool: 'click', label: 'Opening the form' };
        yield { type: 'tool', state: 'completed', tool: 'click', durationMs: 5 };
        yield { type: 'text', text: words };
        yield { type: 'completed', outputText: words, usage: null };
    };

describe('GPT fifth note, E1/E2: the worker claims the job first, and names its epoch in every request', () => {
    it('claims before it sends anything else, on the epoch it read, and every later request carries the epoch the claim gave', async () => {
        const fake = ownedOrbit(JOB, { epoch: 3, turns: [toolStep('Filled in. [[done]]')] });
        await runJob(fake);
        expect(fake.asked()[0]).toBe('claim');
        expect(fake.of('claim')[0].body).toMatchObject({ action: 'claim', run: 'run1', seen: 3 });
        const epoch = 4;
        expect(fake.state.ownerEpoch).toBe(epoch);
        // prepare, the turn, the renewal, the progress report and the end: each names the epoch (and the run, where the request has one)
        for (const kind of ['prepare', 'turn', 'renew', 'progress', 'finish'] as const) {
            expect(fake.of(kind).length, kind).toBeGreaterThan(0);
            for (const row of fake.of(kind)) expect(row.epoch, kind).toBe(epoch);
        }
        expect(fake.of('renew')[0].body).toMatchObject({ run: 'run1', generation: 1 });
        expect(fake.of('finish')[0].body).toMatchObject({ outcome: 'done', run: 'run1', generation: 1 });
        // Control: the owner's every request was taken
        expect(fake.state.superseded).toEqual([]);
        expect(fake.state.ended).toMatchObject({ outcome: 'done', by: 'finish' });
        expect(fake.state.key).toEqual({ epoch });
    });

    it('a job that is taken up again (a stream, not a new turn) names the epoch too', async () => {
        const fake = ownedOrbit(RESUMED_JOB, { epoch: 0 });
        await runJob(fake, RESUMED_JOB);
        expect(fake.of('stream').map((row) => row.epoch)).toEqual([1]);
        expect(fake.of('turn')).toEqual([]);
        expect(fake.state.superseded).toEqual([]);
    });

    it('a claim that lands after another worker claimed is told so: the job is read again and claimed on what it shows, at most three times, then the run is over with nothing sent', async () => {
        // Another claim lands ahead of each of this worker's tries
        const fake = ownedOrbit(JOB, { epoch: 0, before: { claim: () => void fake.replace() } });
        await runJob(fake);
        expect(fake.of('claim')).toHaveLength(3);
        // Nothing but claims: no prepare, no turn, no finish, no cancel, no renewal, and the other worker's marker stands
        expect(fake.asked().every((kind) => kind === 'claim')).toBe(true);
        expect(fake.state.cancelled).toEqual([]);
        expect(fake.state.ended).toBeNull();
        expect(fake.state.status).toBe('running');
    });

    it('a claim that was superseded once and then lands claims on the epoch the job showed meanwhile and goes on', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { claim: (n) => (n === 1 ? fake.replace() : undefined) } });
        await runJob(fake);
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['superseded', 'claimed']);
        expect(fake.of('claim')[1].body).toMatchObject({ seen: 1 });
        expect(fake.state.ended).toMatchObject({ outcome: 'done' });
        for (const row of fake.of('finish')) expect(row.epoch).toBe(2);
    });

    it('E1: a prepare that is answered superseded (another worker claimed after this one did) ends the run: no retry, no turn, no finish, no cancel, and the replacement keeps its key', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { prepare: () => fake.replace() } });
        const log = await runJob(fake);
        expect(fake.of('prepare')).toHaveLength(1);
        expect(fake.of('prepare')[0].answer).toBe('superseded');
        expect(fake.asked()).toEqual(['claim', 'prepare']);
        expect(fake.markerIntact()).toBe(true);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('E1 control: a prepare that merely failed (the machine would not get ready) is tried again and the job then ends as ours, with the epoch', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, prepare: 'failed' });
        await runJob(fake);
        expect(fake.of('prepare')).toHaveLength(3);
        expect(fake.of('finish')).toHaveLength(1);
        expect(fake.of('finish')[0].epoch).toBe(1);
        expect(fake.of('finish')[0].body).toMatchObject({ outcome: 'failed', cause: 'ours', run: 'run1' });
        expect(fake.state.superseded).toEqual([]);
    });

    it('a turn answered `busy` is read with a stream that names the epoch too, and the provider turn it named is the one a handover would carry', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, busy: true });
        await runJob(fake);
        expect(fake.of('turn')).toHaveLength(1);
        expect(fake.of('stream').map((row) => row.epoch)).toEqual([1]);
        expect(fake.state.superseded).toEqual([]);
        expect(fake.state.ended).toMatchObject({ outcome: 'done' });
    });

    it('E2: a stream that follows a `busy` turn and is answered superseded ends the run the same way', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, busy: true, before: { stream: () => fake.replace() } });
        await runJob(fake);
        expect(fake.asked()).toEqual(['claim', 'prepare', 'renew', 'turn', 'stream']);
        expect(fake.markerIntact()).toBe(true);
    });

    it('E2: a turn that is answered superseded ends the run the same way: nothing is ended, cancelled or tried again', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { turn: () => fake.replace() } });
        await runJob(fake);
        // (the renewal is the first thing a turn does)
        expect(fake.asked()).toEqual(['claim', 'prepare', 'renew', 'turn']);
        expect(fake.markerIntact()).toBe(true);
    });

    it('E2: so is a stream that is answered superseded (a job taken up again)', async () => {
        const fake = ownedOrbit(RESUMED_JOB, { epoch: 0, before: { stream: () => fake.replace() } });
        await runJob(fake, RESUMED_JOB);
        expect(fake.asked()).toEqual(['claim', 'prepare', 'renew', 'stream']);
        expect(fake.markerIntact()).toBe(true);
    });

    describe('the answer to the request itself ends the run, whatever a lagging read of the job still shows', () => {
        it('a prepare answered superseded: the run is over at once (no second prepare, no turn, no finish, no cancel)', async () => {
            const fake = ownedOrbit(JOB, { epoch: 0, staleReads: true, before: { prepare: () => fake.replace() } });
            await runJob(fake);
            expect(fake.asked()).toEqual(['claim', 'prepare']);
            expect(fake.markerIntact()).toBe(true);
        });

        it('a turn answered superseded: the run is over at once (the turn is not asked for again, nothing is ended or cancelled)', async () => {
            const fake = ownedOrbit(JOB, { epoch: 0, staleReads: true, before: { turn: () => fake.replace() } });
            await runJob(fake);
            expect(fake.asked()).toEqual(['claim', 'prepare', 'renew', 'turn']);
            expect(fake.markerIntact()).toBe(true);
        });

        it('a stream answered superseded (a job taken up again): the same', async () => {
            const fake = ownedOrbit(RESUMED_JOB, { epoch: 0, staleReads: true, before: { stream: () => fake.replace() } });
            await runJob(fake, RESUMED_JOB);
            expect(fake.asked()).toEqual(['claim', 'prepare', 'renew', 'stream']);
            expect(fake.markerIntact()).toBe(true);
        });

        it('a progress report answered superseded (another worker claimed while the turn went on): the turn stops and nothing is ended', async () => {
            const overtaken = async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                fake.replace();
                yield { type: 'tool', state: 'completed', tool: 'click', durationMs: 5 };
                yield { type: 'text', text: 'Done. [[done]]' };
                yield { type: 'completed', outputText: 'Done. [[done]]', usage: null };
            };
            const fake = ownedOrbit(JOB, { epoch: 0, staleReads: true, turns: [overtaken] });
            await runJob(fake);
            expect(fake.of('progress')[0].answer).toBe('superseded');
            expect(fake.of('finish')).toEqual([]);
            expect(fake.of('cancel')).toEqual([]);
            expect(fake.markerIntact()).toBe(true);
        });

        it('a handover answered superseded: the run is over at once, with no failed ending sent for a handover that was only refused because the job is another worker\'s', async () => {
            const asking = async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                yield { type: 'text', text: 'Need you. [[handover signin]]' };
                yield { type: 'completed', outputText: 'Need you. [[handover signin]]', usage: null };
            };
            const fake = ownedOrbit(JOB, { epoch: 0, staleReads: true, turns: [asking], before: { handover: () => fake.replace() } });
            await runJob(fake);
            expect(fake.of('handover')).toHaveLength(1);
            expect(fake.of('finish')).toEqual([]);
            expect(fake.markerIntact()).toBe(true);
            // the handover is the LAST thing this run asks: it does not read the job again and try a prepare or a turn on it (the replacement's key and turn are not the old run's to touch)
            expect(fake.asked().at(-1)).toBe('handover');
        });

        it('a stream that reconnects (the first broke) and is answered superseded: the same', async () => {
            const breaking = async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                throw new Error('terminated');
            };
            const fake = ownedOrbit(JOB, { epoch: 0, staleReads: true, turns: [breaking], before: { stream: () => fake.replace() } });
            await runJob(fake);
            expect(fake.asked().filter((kind) => kind !== 'progress')).toEqual(['claim', 'prepare', 'renew', 'turn', 'stream']);
            expect(fake.of('finish')).toEqual([]);
            expect(fake.markerIntact()).toBe(true);
        });
    });

    it('E2: a worker that finds the job on an epoch it did not claim (another worker claimed while it worked) does nothing more', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [async function* () { fake.replace(); yield { type: 'created', id: 'resp-1', sessionId: 's' }; yield { type: 'completed', outputText: 'Done. [[done]]', usage: null }; }] });
        await runJob(fake);
        // The words of the turn are not acted on: the job is another worker's now, so no finish of ours goes out
        expect(fake.of('finish')).toEqual([]);
        expect(fake.state.ended).toBeNull();
        expect(fake.state.cancelled).toEqual([]);
    });

    it('E2: the words of a turn that another worker overtook are not acted on, even with no step reported meanwhile: the worker makes no request that ends anything', async () => {
        // no tool step: no progress report is due, so only the read after the turn can tell
        const overtaken = async function* (): AsyncGenerator<RunnerEvent> {
            yield { type: 'created', id: 'resp-1', sessionId: 's' };
            fake.replace();
            yield { type: 'text', text: 'Done. [[done]]' };
            yield { type: 'completed', outputText: 'Done. [[done]]', usage: null };
        };
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [overtaken] });
        await runJob(fake);
        // (the closing progress report is answered superseded and stops the turn; no finish, intent, handover or cancel is ever sent)
        expect(fake.asked().filter((kind) => kind !== 'progress')).toEqual(['claim', 'prepare', 'renew', 'turn']);
        expect(fake.markerIntact()).toBe(true);
    });

    it('E2: the same when the read after the turn is what shows it (the progress report was not due)', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [async function* () { yield { type: 'created', id: 'resp-1', sessionId: 's' }; yield { type: 'text', text: 'Done. [[done]]' }; yield { type: 'completed', outputText: 'Done. [[done]]', usage: null }; }], before: { progress: () => undefined } });
        // another worker claims at the moment this worker's closing progress report reaches Orbit, which Orbit takes before the claim (the report is the owner's last word)
        const original = fake.orbit.action;
        fake.orbit.action = async (botId, jobId, body) => {
            const answer = await original(botId, jobId, body);
            if (body.action === 'progress') fake.replace();
            return answer;
        };
        await runJob(fake);
        expect(fake.of('finish')).toEqual([]);
        expect(fake.markerIntact()).toBe(true);
    });

    it('E2: the early failure with no relay address claims first, and ends the job with its run and its epoch', async () => {
        const fake = ownedOrbit(JOB, { epoch: 2 });
        await runJob(fake, JOB, { relayUrl: null });
        expect(fake.asked()).toEqual(['claim', 'finish']);
        expect(fake.of('finish')[0].epoch).toBe(3);
        expect(fake.of('finish')[0].body).toMatchObject({ outcome: 'failed', cause: 'ours', run: 'run1' });
        expect(fake.state.ended).toMatchObject({ outcome: 'failed', by: 'finish' });
    });

    it('E2: the early failure of a worker that is not the owner ends nothing (its claim lands after another one)', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { claim: () => fake.replace() } });
        await runJob(fake, JOB, { relayUrl: null });
        // three claims, each behind another worker's: the run is over with nothing ended
        expect(fake.of('claim')).toHaveLength(3);
        expect(fake.of('finish')).toEqual([]);
        expect(fake.state.ended).toBeNull();
        expect(fake.state.status).toBe('running');
    });

    it('E2: the early failure completes an end Orbit already holds instead of claiming the job', async () => {
        const fake = ownedOrbit(JOB, { epoch: 4 });
        fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'pool', turns: [1], run: 'old', generation: 1 };
        await runJob(fake, JOB, { relayUrl: null });
        expect(fake.of('claim')).toEqual([]);
        expect(fake.state.ended).toMatchObject({ outcome: 'failed', by: 'intent', why: 'pool' });
    });

    it('a job that holds an end (a kept finish intent) is completed from any worker with no claim, no prepare and no turn', async () => {
        const fake = ownedOrbit(JOB, { epoch: 5 });
        fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'pool', turns: [2], run: 'other', generation: 1 };
        await runJob(fake);
        expect(fake.asked()).toEqual(['finish']);
        expect(fake.of('finish')[0].body).toMatchObject({ outcome: 'failed', cause: 'ours', run: 'other', turns: [2] });
        // the epoch it names is the owner's as the job shows it: a worker that never claimed does not invent one
        expect(fake.of('finish')[0].epoch).toBe(5);
        expect(fake.state.ended).toMatchObject({ outcome: 'failed', by: 'intent' });
    });

    it('a claim answered finish_pending (the intent was kept after the read) takes no ownership: the job is read again and its end completed', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { claim: () => (fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'pool', turns: [1], run: 'x', generation: 1 }) } });
        await runJob(fake);
        expect(fake.of('claim')[0].answer).toBe('finish_pending');
        expect(fake.of('prepare')).toEqual([]);
        expect(fake.of('turn')).toEqual([]);
        expect(fake.state.ended).toMatchObject({ by: 'intent', outcome: 'failed' });
    });

    it('mixed versions: an Orbit with no epochs is never asked to claim, and no request names one', async () => {
        const fake = ownedOrbit(JOB, { epoch: 'legacy', turns: [toolStep('Done. [[done]]')] });
        await runJob(fake);
        expect(fake.of('claim')).toEqual([]);
        expect(fake.requests().filter((row) => row.epoch !== undefined)).toEqual([]);
        expect(fake.state.ended).toMatchObject({ outcome: 'done', by: 'finish' });
    });

    it('mixed versions: the early failure with no relay address on an Orbit with no epochs still ends the job, naming its run', async () => {
        const fake = ownedOrbit(JOB, { epoch: 'legacy' });
        await runJob(fake, JOB, { relayUrl: null });
        expect(fake.asked()).toEqual(['finish']);
        expect(fake.of('finish')[0].epoch).toBeUndefined();
        expect(fake.of('finish')[0].body).toMatchObject({ run: 'run1', outcome: 'failed', cause: 'ours' });
    });

    const stillOn = (words = 'Still working on it.') =>
        async function* (): AsyncGenerator<RunnerEvent> {
            yield { type: 'created', id: 'resp-1', sessionId: 's' };
            yield { type: 'text', text: words };
            yield { type: 'completed', outputText: words, usage: null };
        };

    it('E33: a job that took more turns than allowed is ended as failed by its OWNER: the end names the epoch and the run, and is taken', async () => {
        const allowed = RUNNER_GUARDS.maxTurns;
        RUNNER_GUARDS.maxTurns = 2;
        try {
            const fake = ownedOrbit(JOB, { epoch: 1, turns: [stillOn(), stillOn(), stillOn(), stillOn()] });
            await runJob(fake);
            expect(fake.of('turn')).toHaveLength(2);
            const [end] = fake.of('finish');
            expect(end.body).toMatchObject({ outcome: 'failed', cause: 'agent', run: 'run1' });
            expect(end.epoch).toBe(2);
            expect(end.answer).not.toBe('superseded');
            expect(fake.state.ended).toMatchObject({ outcome: 'failed', by: 'finish' });
            expect(fake.state.superseded).toEqual([]);
        } finally {
            RUNNER_GUARDS.maxTurns = allowed;
        }
    });

    it('E34: another worker claims the job between two turns (whichever read sees it): the old run stops there. It does not claim the job back, does not take a turn, cancel, finish or renew, and the replacement is left whole', async () => {
        let stopped = 0;
        for (let at = 2; at <= 9; at++) {
            const fake = ownedOrbit(JOB, { epoch: 0, turns: [stillOn(), stillOn(), stillOn()], beforeRead: (n) => (n === at ? fake.replace() : undefined) });
            await runJob(fake);
            if (fake.state.ownerEpoch === 1) continue; // the run was over before this read
            stopped++;
            // the old run claimed once, at its start: a second claim would be the job taken back
            expect(fake.of('claim'), `read ${at}`).toHaveLength(1);
            expect(fake.markerIntact(), `read ${at}`).toBe(true);
            expect(fake.of('finish'), `read ${at}`).toEqual([]);
        }
        expect(stopped).toBeGreaterThan(2);
    });

    /** G71-1 (Opus): every way a job can END names the epoch the worker holds. One that did not was answered superseded, the run left with nothing ended, and the next tick claimed again with fresh counters. */
    describe('every ending path names the owner epoch, and ends the job in ONE tick', () => {
        const failing = () =>
            async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                yield { type: 'failed', code: 'model_error', message: 'no' };
            };
        const saying = (words: string) =>
            async function* (): AsyncGenerator<RunnerEvent> {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                yield { type: 'text', text: words };
                yield { type: 'completed', outputText: words, usage: null };
            };
        const paths: Array<{ name: string; make: () => ReturnType<typeof ownedOrbit>; relay?: null; guard?: number; outcome: 'done' | 'failed' }> = [
            { name: 'done', make: () => ownedOrbit(JOB, { epoch: 2 }), outcome: 'done' },
            { name: 'the agent says it failed', make: () => ownedOrbit(JOB, { epoch: 2, turns: [saying('I cannot go on. [[failed]]')] }), outcome: 'failed' },
            { name: 'more turns than allowed (maxTurns)', make: () => ownedOrbit(JOB, { epoch: 2, turns: [saying('Still on it.'), saying('Still on it.'), saying('Still on it.')] }), guard: 1, outcome: 'failed' },
            { name: 'the machine could not be prepared', make: () => ownedOrbit(JOB, { epoch: 2, prepare: 'failed' }), outcome: 'failed' },
            { name: 'the machine cannot reach the relay (unreachable)', make: () => ownedOrbit(JOB, { epoch: 2, prepare: 'relay_unreachable' }), outcome: 'failed' },
            { name: 'no relay is set up for the runner at all', make: () => ownedOrbit(JOB, { epoch: 2 }), relay: null, outcome: 'failed' },
            { name: 'a handover Orbit refuses', make: () => ownedOrbit(JOB, { epoch: 2, refuseHandover: true, turns: [saying('Need you. [[handover signin]]')] }), outcome: 'failed' },
            { name: 'the bad-turn streak (three turns in a row end badly)', make: () => ownedOrbit(JOB, { epoch: 2, turns: [failing(), failing(), failing(), failing(), failing()] }), outcome: 'failed' },
        ];
        for (const path of paths) {
            it(`${path.name}: one tick ends the job on the owner epoch (nothing answered superseded), and two more ticks claim nothing new`, async () => {
                const allowed = RUNNER_GUARDS.maxTurns;
                if (path.guard !== undefined) RUNNER_GUARDS.maxTurns = path.guard;
                try {
                    const fake = path.make();
                    let runs = 0;
                    const instance = createComputerRunner({ orbit: fake.orbit, relayUrl: path.relay === undefined ? RELAY : path.relay, sleep: yielding, log: quiet(), timing: TIMING, runId: () => `run${++runs}` });
                    for (let tick = 0; tick < 3; tick++) {
                        fake.orbit.running = async () => [JOB];
                        await instance.tick();
                        await instance.idle();
                    }
                    expect(fake.state.ended, path.name).toMatchObject({ outcome: path.outcome, by: 'finish' });
                    // every request that changes anything names the epoch the one claim gave
                    expect(fake.of('claim'), path.name).toHaveLength(1);
                    expect(fake.state.ownerEpoch, path.name).toBe(3);
                    for (const row of fake.requests().filter((one) => one.kind !== 'job' && one.kind !== 'claim')) expect(row.epoch, `${path.name}: ${row.kind}`).toBe(3);
                    expect(fake.state.superseded, path.name).toEqual([]);
                    expect(fake.of('finish'), path.name).toHaveLength(1);
                } finally {
                    RUNNER_GUARDS.maxTurns = allowed;
                }
            });
        }

        it('a finish kept by Orbit (an intent) is completed by the next worker on the owner epoch it reads, and ends the job once', async () => {
            const fake = ownedOrbit(JOB, { epoch: 2 });
            fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'The machine was busy.', turns: [1], run: 'old', generation: 1, by: 2 };
            await runJob(fake);
            expect(fake.state.ended).toMatchObject({ outcome: 'failed' });
            expect(fake.of('finish')).toHaveLength(1);
            expect(fake.of('finish')[0].epoch).toBe(2);
            expect(fake.state.superseded).toEqual([]);
        });
    });
});

describe('GPT fifth note, E3/E6: a renewal that meets an end Orbit has committed to adds nothing, and the game does not end the job itself', () => {
    it('stops the turn when the renewal is answered `ending`, cancels nothing, and completes the end Orbit holds with the intent\'s own values', async () => {
        // An intent is kept (by a worker that lost its process) just as this worker's renewal reaches Orbit
        const fake = ownedOrbit(JOB, { epoch: 0, before: { renew: () => (fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'Computers are busy', turns: [1], run: 'gone', generation: 1 }) } });
        await runJob(fake);
        expect(fake.of('renew')[0].answer).toBe('ending');
        // no cancel from the runner: Orbit's finalizer owns the turn's stop; no turn goes on, and nothing of the agent's words is acted on
        expect(fake.of('cancel')).toEqual([]);
        expect(fake.state.ended).toMatchObject({ outcome: 'failed', cause: 'ours', by: 'intent' });
        expect(fake.state.cancelled).toEqual([]);
        // the job ended once, as the intent said
        expect(fake.of('finish')).toHaveLength(1);
        expect(fake.of('finish')[0].body).toMatchObject({ outcome: 'failed', cause: 'ours', run: 'gone' });
    });

    it('a renewal that is answered `ending` is never taken for a refusal of room: the turn is not cancelled and the job is not stopped on any allowance or pool ground', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { renew: () => (fake.state.pending = { outcome: 'failed', cause: 'ours', why: 'x', turns: [1], run: 'gone', generation: 1 }) } });
        await runJob(fake);
        for (const row of fake.of('finish')) expect(row.body?.cause).toBe('ours');
        expect(fake.state.ended?.by).toBe('intent');
    });

    it('control: a renewal Orbit refuses for the OWNER (its allowance, a rule, the pool) still stops the turn, and the cancel names the owner\'s epoch and its provider turn', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, renew: (n) => (n === 1 ? { ok: false, reason: 'allowance' } : { ok: true, renewInSeconds: 240 }), turns: [toolStep('x'), toolStep('Done. [[done]]')] });
        // the turn is cancelled while it is on a provider turn the runner has seen (the first turn's stream opened with its id)
        await runJob(fake);
        expect(fake.of('renew')[0].answer).toBe('refused');
        // the refusal came before the stream opened, so no provider turn was known: the cancel names the epoch alone
        expect(fake.of('cancel')[0]?.epoch).toBe(1);
        expect(fake.of('cancel')[0]?.body).toEqual({ epoch: 1 });
    });

    it('a renewal that is answered superseded ends the run: no cancel, no ending', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, before: { renew: () => fake.replace() } });
        await runJob(fake);
        expect(fake.of('renew')[0].answer).toBe('superseded');
        expect(fake.of('cancel')).toEqual([]);
        expect(fake.of('finish')).toEqual([]);
        expect(fake.markerIntact()).toBe(true);
    });
});

describe('GPT fifth note, E4: a handover and a cancel are bound to the turn they come from', () => {
    const handover = (waitingFor = 'signin') => async function* (): AsyncGenerator<RunnerEvent> {
        yield { type: 'created', id: 'resp-1', sessionId: 's' };
        yield { type: 'text', text: `Need you. [[handover ${waitingFor}]]` };
        yield { type: 'completed', outputText: `Need you. [[handover ${waitingFor}]]`, usage: null };
    };

    it('the handover names the epoch, the generation and the provider turn the agent was on, and the owner\'s handover lands (the job waits for the person)', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [handover()] });
        // the person never comes back in this test: the job waits
        // (the job waits for the person for as long as the runner runs: a real wait, so the test can look and stop it)
        const { instance } = runner(fake, { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(ms, 5))) });
        fake.orbit.running = async () => [JOB];
        await instance.tick();
        for (let i = 0; i < 50 && fake.state.status !== 'waiting'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
        instance.stop();
        await instance.idle();
        expect(fake.of('handover')).toHaveLength(1);
        expect(fake.of('handover')[0].epoch).toBe(1);
        expect(fake.of('handover')[0].body).toMatchObject({ waitingFor: 'signin', generation: 1, responseId: 'resp-1' });
        expect(fake.state.status).toBe('waiting');
    });

    it('an old worker\'s handover, after another worker admitted work, is answered superseded: the job stays running, the worker ends its run (no finish, no retry, no cancel)', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [handover()], before: { handover: () => fake.replace() } });
        await runJob(fake);
        expect(fake.of('handover')).toHaveLength(1);
        expect(fake.of('handover')[0].answer).toBe('superseded');
        expect(fake.of('finish')).toEqual([]);
        expect(fake.markerIntact()).toBe(true);
    });

    it('a handover answered `not_current` (the owner\'s own job is on another provider turn than the one named) is read again: it is no refusal, the job is not ended as failed on it, and the next turn goes on', async () => {
        const fake = ownedOrbit(JOB, { epoch: 0, turns: [handover(), toolStep('Done. [[done]]')], before: { handover: (n) => (n === 1 ? void (fake.state.responseId = 'resp-other') : undefined) } });
        await runJob(fake);
        expect(fake.of('handover')[0].answer).toBe('not_current');
        // no finish was sent on the handover's account (the only one is the job's own end, done)
        expect(fake.of('finish').map((row) => row.body?.outcome)).toEqual(['done']);
        expect(fake.state.ended).toMatchObject({ outcome: 'done' });
    });

    it('a cancel names the epoch and the provider turn, so an old cancel never reaches the replacement\'s turn', async () => {
        // The turn is lost on a renewal that is refused while the stream is on its provider turn
        let release: () => void = () => undefined;
        const hold = new Promise<void>((resolve) => (release = resolve));
        const fake = ownedOrbit(JOB, {
            epoch: 0,
            renew: (n) => (n === 1 ? { ok: true, renewInSeconds: 5 } : { ok: false, reason: 'allowance' }),
            turns: [
                async function* () {
                    yield { type: 'created', id: 'resp-1', sessionId: 's' };
                    release();
                    await new Promise((resolve) => setTimeout(resolve, 6000));
                },
                toolStep('Done. [[done]]'),
            ],
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const running = runJob(fake, JOB, { sleep: instantly });
            await hold;
            await vi.advanceTimersByTimeAsync(6000);
            await vi.advanceTimersByTimeAsync(10_000);
            await running;
        } finally {
            vi.useRealTimers();
        }
        const cancel = fake.of('cancel')[0];
        expect(cancel.body).toEqual({ epoch: 1, responseId: 'resp-1' });
        expect(cancel.answer).toBe('cancelled');
    });

    it('an old cancel (another worker admitted work on its own provider turn) leaves the replacement\'s turn alone', async () => {
        let release: () => void = () => undefined;
        const hold = new Promise<void>((resolve) => (release = resolve));
        const fake = ownedOrbit(JOB, {
            epoch: 0,
            renew: (n) => (n === 1 ? { ok: true, renewInSeconds: 5 } : { ok: false, reason: 'allowance' }),
            turns: [
                async function* () {
                    yield { type: 'created', id: 'resp-1', sessionId: 's' };
                    release();
                    await new Promise((resolve) => setTimeout(resolve, 6000));
                },
            ],
            // The other worker takes the job over just as this worker's second renewal arrives
            before: { renew: (n) => (n === 2 ? fake.replace() : undefined) },
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const running = runJob(fake, JOB, { sleep: instantly });
            await hold;
            await vi.advanceTimersByTimeAsync(6000);
            await vi.advanceTimersByTimeAsync(10_000);
            await running;
        } finally {
            vi.useRealTimers();
        }
        // the renewal was answered superseded, so the runner cancelled nothing at all; and whatever cancel an old worker might send is refused or names its own turn
        expect(fake.state.cancelled).toEqual([]);
        expect(fake.markerIntact()).toBe(true);
    });
});

describe('GPT fifth note: the runner\'s view of Orbit carries the ownership epoch to the routes that take it', () => {
    const adminWith = (overrides: Record<string, unknown> = {}) => ({
        computerRunningJobs: vi.fn(),
        getComputerJob: vi.fn(async () => ({ id: 'job-1', status: 'running', control: 'brick', generation: 2, ownerEpoch: 7 })),
        computerJobAction: vi.fn(async () => ({ ok: true })),
        computerBroker: vi.fn(async () => ({ status: 200, data: { ok: true } })),
        computerOpenTurn: vi.fn(async () => ({ ok: false as const, status: 409, reason: 'stale', superseded: true as const })),
        ...overrides,
    });

    it('the job read gives the owner epoch (and none for an Orbit that gives none)', async () => {
        const admin = adminWith();
        expect(await runnerOrbitFor(admin as never).job('brick-1', 'job-1')).toMatchObject({ status: 'running', generation: 2, ownerEpoch: 7 });
        const legacy = adminWith({ getComputerJob: vi.fn(async () => ({ id: 'job-1', status: 'running', control: 'brick', generation: 2 })) });
        expect(await runnerOrbitFor(legacy as never).job('brick-1', 'job-1')).not.toHaveProperty('ownerEpoch');
    });

    it('prepare sends the run and the epoch, and a 409 `stale` with `run: superseded` is told apart from every other refusal', async () => {
        const broker = vi.fn(async () => ({ status: 409, data: { ok: false, reason: 'stale', run: 'superseded' } }));
        const orbit = runnerOrbitFor(adminWith({ computerBroker: broker }) as never);
        expect(await orbit.prepare('job-1', RELAY, { run: 'run1', epoch: 7 })).toEqual({ ok: false, reason: 'superseded' });
        expect(broker).toHaveBeenCalledWith('job-1', 'prepare', { relay: RELAY, run: 'run1', epoch: 7 });
        // `preparing` (another prepare of the same worker is going) and a plain failure are not "superseded"
        const preparing = runnerOrbitFor(adminWith({ computerBroker: vi.fn(async () => ({ status: 409, data: { ok: false, reason: 'preparing' } })) }) as never);
        expect(await preparing.prepare('job-1', RELAY, { run: 'run1', epoch: 7 })).toEqual({ ok: false, reason: 'preparing' });
    });

    it('a turn and a stream name the epoch, and a stale answer that says superseded reaches the runner as such', async () => {
        const open = vi.fn(async () => ({ ok: false as const, status: 409, reason: 'stale', superseded: true as const }));
        const orbit = runnerOrbitFor(adminWith({ computerOpenTurn: open }) as never);
        const signal = new AbortController().signal;
        expect(await orbit.turn('job-1', 'go', signal, 7)).toEqual({ ok: false, reason: 'stale', superseded: true });
        expect(await orbit.stream('job-1', signal, 7)).toEqual({ ok: false, reason: 'stale', superseded: true });
        expect(open).toHaveBeenNthCalledWith(1, 'job-1', 'turn', 'go', signal, 7);
        expect(open).toHaveBeenNthCalledWith(2, 'job-1', 'stream', null, signal, 7);
    });

    it('a cancel names the epoch and the provider turn, and says nothing of them when the caller knew none', async () => {
        const broker = vi.fn(async () => ({ status: 200, data: { ok: true } }));
        const orbit = runnerOrbitFor(adminWith({ computerBroker: broker }) as never);
        await orbit.cancel('job-1', { epoch: 7, responseId: 'resp-1' });
        await orbit.cancel('job-1');
        expect(broker).toHaveBeenNthCalledWith(1, 'job-1', 'cancel', { epoch: 7, responseId: 'resp-1' });
        expect(broker).toHaveBeenNthCalledWith(2, 'job-1', 'cancel', {});
    });
});

describe('GPT fifth note: the bot server\'s calls to Orbit carry the epoch on the wire', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.BOT_SERVICE_TOKEN;
    });
    const admin = () => {
        const one = new AdminApiService('http://orbit.test');
        vi.spyOn(one, 'isConfigured').mockReturnValue(true);
        return one;
    };

    it('the job read gives the owner epoch: zero is a value (never claimed), anything that is not a whole number from zero up is none', async () => {
        for (const [given, expected] of [[0, 0], [7, 7], [-1, undefined], [1.5, undefined], ['3', undefined], [undefined, undefined]] as const) {
            const one = admin();
            (one as unknown as { brickCall: unknown }).brickCall = async () => ({ data: { job: { id: 'job-1', status: 'running', control: 'brick', ownerEpoch: given } } });
            const read = await one.getComputerJob('brick-1', 'job-1');
            if (expected === undefined) expect(read).not.toHaveProperty('ownerEpoch');
            else expect(read).toMatchObject({ ownerEpoch: expected });
        }
    });

    it('a turn carries the epoch in its body, a stream in its query, and neither says anything of one when the runner holds none', async () => {
        process.env.BOT_SERVICE_TOKEN = 'token';
        const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
        vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
            calls.push({ url, method: init?.method, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
            return new Response(JSON.stringify({ reason: 'stale', run: 'superseded' }), { status: 409 });
        });
        const signal = new AbortController().signal;
        const one = admin();
        const turn = await one.computerOpenTurn('job-1', 'turn', 'go', signal, 4);
        const stream = await one.computerOpenTurn('job-1', 'stream', null, signal, 4);
        await one.computerOpenTurn('job-1', 'turn', 'go', signal);
        await one.computerOpenTurn('job-1', 'stream', null, signal);
        expect(calls[0]).toMatchObject({ method: 'POST', body: { input: 'go', epoch: 4 } });
        expect(calls[1].url).toMatch(/\/stream\?epoch=4$/);
        expect(calls[1].method).toBe('GET');
        expect(calls[2].body).toEqual({ input: 'go' });
        expect(calls[3].url).not.toContain('epoch');
        // Orbit's `stale` that names the run as superseded is told as such
        expect(turn).toMatchObject({ ok: false, reason: 'stale', superseded: true });
        expect(stream).toMatchObject({ ok: false, reason: 'stale', superseded: true });
    });

    it('a plain `stale` (an old control generation) is NOT superseded', async () => {
        process.env.BOT_SERVICE_TOKEN = 'token';
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reason: 'stale' }), { status: 409 }));
        const answer = await admin().computerOpenTurn('job-1', 'turn', 'go', new AbortController().signal, 4);
        expect(answer).toMatchObject({ ok: false, reason: 'stale' });
        expect(answer).not.toHaveProperty('superseded');
    });
});
