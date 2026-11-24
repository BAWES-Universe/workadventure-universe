import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComputerRunner, RUNNER_TIMING, type CancelFacts, type PrepareFacts, type RunnableJob, type RunnerEvent, type RunnerOrbit, type TurnOpened } from '../server/ComputerRunner';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

/**
 * GPT's sixth answer, finding 3 (the game's side): Orbit gives a job's owner a LEASE. The owner renews it (`beat`) every 30 seconds in every state it holds the job, and gives it back
 * (`release`) when it stops gracefully; a claim while the lease is alive is answered `{ ok: false, reason: 'held', until }` and writes nothing.
 *
 * What is tested here is what the GAME does:
 *  - it renews the lease while it owns the job, under its own epoch, and stops renewing the moment Orbit says another run holds the job;
 *  - it gives the lease back as its worker stops, so a replacement does not wait for it to lapse;
 *  - `held` means it stops and looks again only after `until`: it never goes round a claim loop, and claims nothing in between;
 *  - a job read again and claimed after a superseded claim is read ONCE, never in a loop;
 *  - two workers on one job: the second never claims while the first beats, and it takes the job up once the first has gone.
 *
 * The double below keeps to that contract, with a clock the test moves.
 */
const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: 'Two people, Kuwait', writes: true, hasTurn: false };
const RELAY = 'https://bot-server.example.test';
const LEASE_MS = 90_000;
/** How long a job another worker holds is left alone before it is asked for again (the holder may have given it back). */
const RECHECK_MS = 15_000;
const quiet = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });
const TIMING = { ...RUNNER_TIMING, waitMs: 0, progressMs: 0, reconnectMs: [0, 0], prepareMs: [0, 0], beatMs: 30_000, leaseMs: LEASE_MS };

/** Orbit for one job, with the owner lease of finding 3. `clock` is the test's own: every lease decision is made on it. */
function leasedOrbit(options: { epoch?: number; clock?: () => number; turns?: Array<() => AsyncGenerator<RunnerEvent>>; holdTurn?: boolean } = {}) {
    const clock = options.clock ?? Date.now;
    const state = {
        ownerEpoch: options.epoch ?? 0,
        /** When the owner's lease ends, or null when no one holds the job. */
        leaseUntil: null as number | null,
        status: 'running' as 'running' | 'done' | 'failed' | 'stopped',
        asked: [] as Array<{ action: string; epoch?: number; run?: string; answer: string; body: Record<string, unknown> }>,
        turnScripts: [...(options.turns ?? [])],
    };
    const log = (action: string, answer: string, body: Record<string, unknown>) =>
        state.asked.push({ action, answer, body, ...(typeof body.epoch === 'number' ? { epoch: body.epoch } : {}), ...(typeof body.run === 'string' ? { run: body.run } : {}) });
    const live = () => state.status === 'running';
    const held = () => state.leaseUntil !== null && state.leaseUntil > clock();
    /** The signal of every turn that was opened, in order: a turn is stopped through it, so whether it was aborted says whether that worker was stopped. */
    const signals: AbortSignal[] = [];
    const turnOf = (signal: AbortSignal): AsyncGenerator<RunnerEvent> => {
        signals.push(signal);
        const make = state.turnScripts.shift();
        if (make) return make();
        if (options.holdTurn) {
            // A turn that goes on until the worker is stopped: the job stays this worker's while the test moves the clock
            return (async function* () {
                yield { type: 'created', id: 'resp-1', sessionId: 's' };
                await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
            })();
        }
        return (async function* () {
            yield { type: 'created', id: 'resp-1', sessionId: 's' };
            yield { type: 'completed', outputText: 'All fine. [[done]]', usage: null };
        })();
    };
    const orbit: RunnerOrbit = {
        running: async () => [JOB],
        job: async () => ({ status: state.status, control: 'brick', generation: 1, ownerEpoch: state.ownerEpoch, finishPending: null }),
        action: async (_botId, _jobId, body) => {
            const action = String(body.action);
            const epoch = typeof body.epoch === 'number' ? body.epoch : undefined;
            if (action === 'claim') {
                if (!live()) {
                    log(action, 'over', body);
                    return { ok: false, reason: 'over' };
                }
                // A healthy owner is never claimed over: nothing is written, and the answer says when its lease ends
                if (held()) {
                    log(action, 'held', body);
                    return { ok: false, reason: 'held', until: new Date(state.leaseUntil as number).toISOString(), job: { id: JOB.jobId } };
                }
                if (body.seen !== state.ownerEpoch) {
                    log(action, 'superseded', body);
                    return { ok: false, reason: 'stale', run: 'superseded', ownerEpoch: state.ownerEpoch };
                }
                state.ownerEpoch += 1;
                state.leaseUntil = clock() + LEASE_MS;
                log(action, 'claimed', body);
                return { ok: true, epoch: state.ownerEpoch };
            }
            if (epoch !== undefined && epoch !== state.ownerEpoch) {
                log(action, 'superseded', body);
                return { ok: false, reason: 'stale', run: 'superseded' };
            }
            if (action === 'beat') {
                state.leaseUntil = clock() + LEASE_MS;
                log(action, 'ok', body);
                return { ok: true };
            }
            if (action === 'release') {
                state.leaseUntil = null;
                log(action, 'ok', body);
                return { ok: true };
            }
            if (action === 'finish') {
                state.status = body.outcome === 'done' ? 'done' : 'failed';
                state.leaseUntil = null;
                log(action, 'ended', body);
                return { ok: true };
            }
            log(action, 'ok', body);
            return { ok: true };
        },
        prepare: async (_jobId: string, _relay: string, extra?: PrepareFacts) => {
            if (extra?.epoch !== undefined && extra.epoch !== state.ownerEpoch) return { ok: false as const, reason: 'superseded' };
            return { ok: true as const };
        },
        turn: async (_jobId: string, _input: string, signal: AbortSignal, epoch?: number): Promise<TurnOpened> => {
            if (epoch !== undefined && epoch !== state.ownerEpoch) return { ok: false, reason: 'stale', superseded: true };
            return { ok: true, events: turnOf(signal) };
        },
        stream: async (_jobId: string, signal: AbortSignal, epoch?: number): Promise<TurnOpened> => {
            if (epoch !== undefined && epoch !== state.ownerEpoch) return { ok: false, reason: 'stale', superseded: true };
            return { ok: true, events: turnOf(signal) };
        },
        cancel: async (_jobId: string, _facts?: CancelFacts) => undefined,
    };
    return {
        orbit,
        state,
        signals,
        of: (action: string) => state.asked.filter((row) => row.action === action),
        actions: () => state.asked.map((row) => row.action),
    };
}

const runnerOn = (fake: ReturnType<typeof leasedOrbit>, extra: { runId?: string; now?: () => number; relayUrl?: string | null; orbit?: RunnerOrbit; runIds?: () => string } = {}) => {
    const log = quiet();
    const instance = createComputerRunner({
        orbit: extra.orbit ?? fake.orbit,
        relayUrl: extra.relayUrl === undefined ? RELAY : extra.relayUrl,
        sleep: async () => undefined,
        log,
        timing: TIMING,
        runId: extra.runIds ?? (() => extra.runId ?? 'run1'),
        ...(extra.now ? { now: extra.now } : {}),
    });
    return { instance, log };
};

afterEach(() => {
    vi.useRealTimers();
});

describe("the owner's lease: the job is never claimed over a worker that is running it", () => {
    it('renews the lease while it owns the job, under its own epoch and run, and gives it back when the worker is stopped', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.of('claim')).toHaveLength(1);
        expect(fake.state.ownerEpoch).toBe(3);

        // Two beats over a minute, each under the epoch the claim gave and naming the run
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fake.of('beat')).toHaveLength(2);
        // Orbit's contract: the epoch alone says who owns the job, so a beat carries nothing else
        for (const row of fake.of('beat')) expect(row).toMatchObject({ epoch: 3, answer: 'ok', body: { action: 'beat', epoch: 3 } });
        for (const row of fake.of('beat')) expect(Object.keys(row.body).sort()).toEqual(['action', 'epoch']);
        // The lease was pushed out by the last beat, so no other worker could claim meanwhile
        expect(fake.state.leaseUntil).toBe(at + LEASE_MS);

        // The server stops: the lease is given back at once instead of being left to lapse
        instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await instance.idle();
        expect(fake.of('release')).toHaveLength(1);
        expect(fake.of('release')[0]).toMatchObject({ epoch: 3, body: { action: 'release', epoch: 3 } });
        expect(Object.keys(fake.of('release')[0].body).sort()).toEqual(['action', 'epoch']);
        expect(fake.state.leaseUntil).toBeNull();
        // Nothing was ended: the job is still there for the worker that takes it up next
        expect(fake.state.status).toBe('running');
        expect(fake.of('finish')).toEqual([]);
    });

    it('stops renewing, and gives nothing back, once Orbit says another run holds the job', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        // Another worker takes the job over while this one holds a turn open
        fake.state.ownerEpoch = 9;
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fake.of('beat')).toHaveLength(1);
        expect(fake.of('beat')[0].answer).toBe('superseded');
        // No beat after it, and no release: the job is the replacement's, and its lease is not this worker's to give back
        at += 60_000;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fake.of('beat')).toHaveLength(1);
        instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await instance.idle();
        expect(fake.of('release')).toEqual([]);
    });

    // Opus's note on finding 3: a beat answered superseded ends the run's open turn too, as a superseded answer to the notes does, and cancels nothing
    it('a beat answered superseded stops the turn this run has open: the worker ends by itself, with nothing cancelled, ended or given back', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const cancel = vi.fn(fake.orbit.cancel);
        fake.orbit.cancel = cancel;
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(instance.active()).toEqual([JOB.jobId]);
        // another worker takes the job over while this one holds a turn open, and the next beat tells this worker so
        fake.state.ownerEpoch = 9;
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(0);
        // the worker is over WITHOUT the runner being stopped: the open turn was read to its end
        expect(instance.active()).toEqual([]);
        expect(cancel).not.toHaveBeenCalled();
        expect(fake.of('finish')).toEqual([]);
        expect(fake.of('release')).toEqual([]);
        expect(fake.state.status).toBe('running');
    });

    it('a beat Orbit refuses with a 409 that says the run is superseded stops the open turn the same way', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const original = fake.orbit.action;
        fake.orbit.action = async (botId, jobId, body) => {
            if (String(body.action) === 'beat') throw Object.assign(new Error('conflict'), { response: { status: 409, data: { ok: false, reason: 'stale', run: 'superseded' } } });
            return original(botId, jobId, body);
        };
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(instance.active()).toEqual([JOB.jobId]);
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(instance.active()).toEqual([]);
        expect(fake.of('finish')).toEqual([]);
    });

    // Orbit's contract: a beat answered `over` (the job is over or went back in line) means there is nothing left to hold
    it('a beat answered `over` stops beating, and gives nothing back when the worker stops', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const original = fake.orbit.action;
        fake.orbit.action = async (botId, jobId, body) => (String(body.action) === 'beat' ? { ok: false, reason: 'over' } : original(botId, jobId, body));
        let beats = 0;
        const counting = fake.orbit.action;
        fake.orbit.action = async (botId, jobId, body) => {
            if (String(body.action) === 'beat') beats += 1;
            return counting(botId, jobId, body);
        };
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(beats).toBe(1);
        // no more beats, however long it goes on
        at += 120_000;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(beats).toBe(1);
        instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await instance.idle();
        expect(fake.of('release')).toEqual([]);
    });

    it('does not give the lease back for a job it ended itself', async () => {
        const fake = leasedOrbit({ epoch: 2 });
        const { instance } = runnerOn(fake);
        await instance.tick();
        await instance.idle();
        expect(fake.state.status).toBe('done');
        expect(fake.of('release')).toEqual([]);
    });

    it('a claim answered `held` claims nothing more, ends nothing, and the job is left alone until the lease ends', async () => {
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 4, clock: () => at });
        // Another worker owns it with a lease that has 40 seconds to run
        fake.state.leaseUntil = at + 40_000;
        const { instance, log } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(1);
        expect(fake.of('claim')[0].answer).toBe('held');
        // Nothing else was asked at all: no second claim, no prepare, no turn, no end
        expect(fake.actions()).toEqual(['claim']);
        expect(fake.state.ownerEpoch).toBe(4);
        expect(fake.state.status).toBe('running');
        expect(log.info).toHaveBeenCalled();

        // Ticks inside the short while after it ask Orbit nothing about the job
        at += 10_000;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(1);

        // After it the job is asked for again, once: the lease is still alive, so nothing is written and nothing is ended
        at += 10_000;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['held', 'held']);
        expect(fake.state.ownerEpoch).toBe(4);

        // Once the lease has ended the job is taken up on the first look, with no one to hold it
        at += 30_000;
        fake.state.leaseUntil = null;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(3);
        expect(fake.of('claim')[2].answer).toBe('claimed');
        expect(fake.state.status).toBe('done');
    });

    it('a `held` answer that names no time, one already past, or one far ahead holds the job for the short while and no longer', async () => {
        for (const until of [undefined, 'not a time', 500_000, new Date(9_000_000_000_000).toISOString()] as const) {
            let at = 1_000_000;
            const fake = leasedOrbit({ epoch: 4, clock: () => at });
            fake.orbit.action = async (_botId, _jobId, body) => (String(body.action) === 'claim' ? { ok: false, reason: 'held', ...(until === undefined ? {} : { until }) } : { ok: true });
            const { instance } = runnerOn(fake, { now: () => at });
            let claims = 0;
            const watched = fake.orbit.action;
            fake.orbit.action = async (botId, jobId, body) => {
                if (String(body.action) === 'claim') claims += 1;
                return watched(botId, jobId, body);
            };
            await instance.tick();
            await instance.idle();
            expect(claims, String(until)).toBe(1);
            // Still held just before the short while is up, and looked at again just after it: never held for longer than that, whatever the answer named
            at += RECHECK_MS - 1000;
            await instance.tick();
            await instance.idle();
            expect(claims, String(until)).toBe(1);
            at += 2000;
            await instance.tick();
            await instance.idle();
            expect(claims, String(until)).toBe(2);
        }
    });

    // CodeRabbit on #2114: a lease that ends sooner than the short while is looked at when it ends, and a holder that gives the job back early does not leave it idle
    it('a lease that ends before the short while is up is looked at when it ends', async () => {
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 4, clock: () => at });
        fake.state.leaseUntil = at + 5_000;
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(1);
        at += 4_000;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(1);
        at += 2_000;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['held', 'claimed']);
    });

    it('a holder that gives the job back early (a rolling restart) does not leave it idle for the rest of its lease: the next look after the short while takes it up', async () => {
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 4, clock: () => at });
        // another worker holds it for a whole lease
        fake.state.leaseUntil = at + LEASE_MS;
        const { instance } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['held']);
        // the holder releases at once, long before its lease would have lapsed
        fake.state.leaseUntil = null;
        at += 5_000;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim')).toHaveLength(1);
        at += RECHECK_MS;
        await instance.tick();
        await instance.idle();
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['held', 'claimed']);
        expect(fake.state.status).toBe('done');
    });

    // CodeRabbit on #2114 (I12)
    it('a beat answered superseded after its worker stopped and the job was taken up again here stops nothing of the new worker: its beat goes on and its turn stays open', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 2, clock: () => at, holdTurn: true });
        const original = fake.orbit.action;
        let answerLate: ((value: Record<string, unknown>) => void) | undefined;
        let delayed = false;
        fake.orbit.action = async (botId, jobId, body) => {
            // the FIRST beat is slow: its answer is read after the worker it was for has gone
            if (String(body.action) === 'beat' && !delayed) {
                delayed = true;
                return new Promise<Record<string, unknown>>((resolve) => (answerLate = resolve));
            }
            return original(botId, jobId, body);
        };
        // each stretch of work is a run of its own, as it is in the server
        let runs = 0;
        const { instance } = runnerOn(fake, { now: () => at, runIds: () => `run-${++runs}` });
        await instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        const firstEpoch = fake.state.ownerEpoch;
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(delayed).toBe(true);
        // the worker stops while that beat is in flight, and the job is taken up again here under a new epoch
        instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await instance.idle();
        at += 1_000;
        instance.start(10_000_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(instance.active()).toEqual([JOB.jobId]);
        expect(fake.state.ownerEpoch).toBe(firstEpoch + 1);
        const beatsBefore = fake.of('beat').length;
        // the old beat's answer arrives now: another run holds the job
        answerLate?.({ ok: false, reason: 'stale', run: 'superseded' });
        await vi.advanceTimersByTimeAsync(0);
        // the new worker is still working, and its beat goes on under its own epoch
        expect(instance.active()).toEqual([JOB.jobId]);
        // the replacement turn itself was not stopped by the old beat's late answer (the signal of the turn opened by the restart), while the first one was stopped with its worker
        expect(fake.signals).toHaveLength(2);
        expect(fake.signals[0].aborted).toBe(true);
        expect(fake.signals[1].aborted).toBe(false);
        at += 30_000;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fake.of('beat').length).toBeGreaterThan(beatsBefore);
        expect(fake.of('beat').at(-1)?.epoch).toBe(firstEpoch + 1);
        instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await instance.idle();
    });

    // Orbit's second claim refusal: a resumed job whose browser is still being settled answers `not_ready` and writes nothing; the job is looked at again after a short wait, not held off for a lease
    it('a claim answered `not_ready` writes and ends nothing, and the job is claimed again a little later, not held off for a lease', async () => {
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 4, clock: () => at });
        const original = fake.orbit.action;
        let notReady = 2;
        fake.orbit.action = async (botId, jobId, body) => {
            if (String(body.action) === 'claim' && notReady > 0) {
                notReady -= 1;
                fake.state.asked.push({ action: 'claim', answer: 'not_ready', body });
                return { ok: false, reason: 'not_ready', prep: 'restoring', job: { id: JOB.jobId } };
            }
            return original(botId, jobId, body);
        };
        const { instance, log } = runnerOn(fake, { now: () => at });
        await instance.tick();
        await instance.idle();
        // Asked three times in one stretch (no lease wait in between), and the third claim took the job and ended it
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['not_ready', 'not_ready', 'claimed']);
        expect(fake.state.status).toBe('done');
        // Nothing was started, ended or given back before the claim that landed
        const firstOwned = fake.actions().indexOf('claim', 2);
        expect(fake.actions().slice(0, firstOwned).every((action) => action === 'claim')).toBe(true);
        expect(fake.of('release')).toEqual([]);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('two workers on one job: the second never claims while the first beats, and takes it up once the first has gone', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        let at = 1_000_000;
        const fake = leasedOrbit({ epoch: 1, clock: () => at, holdTurn: true });
        // Two bot servers, each its own runner, on one Orbit and one job
        // The first server's connection to Orbit can be cut: once it is, nothing it sends (a release, a beat) arrives
        let dead = false;
        const cut: RunnerOrbit = { ...fake.orbit, action: async (botId, jobId, body) => (dead ? ({ ok: true } as never) : fake.orbit.action(botId, jobId, body)) };
        const first = runnerOn(fake, { runId: 'run-A', now: () => at, orbit: cut });
        const second = runnerOn(fake, { runId: 'run-B', now: () => at });
        await first.instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.of('claim')).toHaveLength(1);
        const owner = fake.state.ownerEpoch;

        // The second server looks at the same job again and again while the first beats: it is told `held` and claims nothing
        for (let look = 0; look < 4; look++) {
            at += 30_000;
            await vi.advanceTimersByTimeAsync(30_000);
            await second.instance.tick();
            await second.instance.idle();
        }
        expect(fake.of('claim').filter((row) => row.answer === 'claimed')).toHaveLength(1);
        expect(fake.of('claim').filter((row) => row.answer === 'held').length).toBeGreaterThan(0);
        expect(fake.state.ownerEpoch).toBe(owner);
        expect(fake.of('beat').length).toBeGreaterThanOrEqual(4);
        expect(fake.of('beat').every((row) => row.epoch === owner)).toBe(true);

        // The first server dies: nothing reaches Orbit from it any more, so nothing is released and the lease is left to lapse. The second waits it out and then takes the job over ONCE
        dead = true;
        first.instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await first.instance.idle();
        const lapses = fake.state.leaseUntil as number;
        expect(lapses).toBeGreaterThan(at);
        fake.state.asked.length = 0;
        // just before it lapses: still the first server's, and the second is told so
        at = lapses - 1000;
        await second.instance.tick();
        await second.instance.idle();
        expect(fake.of('claim').map((row) => row.answer)).toEqual(['held']);
        expect(fake.of('release')).toEqual([]);
        expect(fake.state.ownerEpoch).toBe(owner);
        fake.state.asked.length = 0;
        // just after: the job is taken up
        at = lapses + 1000;
        await second.instance.tick();
        await vi.advanceTimersByTimeAsync(0);
        // ONE takeover: the job is the second server's now, and it is running it (its turn is open, so it is not awaited here)
        expect(fake.of('claim').filter((row) => row.answer === 'claimed')).toHaveLength(1);
        expect(fake.state.ownerEpoch).toBe(owner + 1);
        expect(fake.of('claim')).toHaveLength(1);
        second.instance.stop();
        await vi.advanceTimersByTimeAsync(0);
        await second.instance.idle();
    });
});
