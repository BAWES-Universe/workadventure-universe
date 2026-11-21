import { describe, expect, it, vi } from 'vitest';
import { AdminApiService, COMPUTER_START_TIMEOUT_MS, isSlowAnswer } from '../server/AdminApiService';

function service(answer: () => Promise<unknown>) {
    const orbit = new AdminApiService('http://orbit.test', 'admin-token');
    const call = vi.fn(answer);
    (orbit as unknown as { brickCall: typeof call }).brickCall = call;
    return { orbit, call };
}

describe('asking Orbit at 20 app steps', () => {
    it('sends the person, the App and the steps to the Brick, and reads only a plain yes as one', async () => {
        const yes = service(async () => ({ data: { review: true } }));
        expect(await yes.orbit.reviewAppSteps('brick 1', 'u1', 'Notion', 20)).toBe(true);
        expect(yes.call).toHaveBeenCalledWith('post', 'api/bots/brick%201/computer-route-review', { userId: 'u1', app: 'Notion', steps: 20 });
        expect(await service(async () => ({ data: { review: false } })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
        expect(await service(async () => ({ data: { review: 'yes' } })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
        expect(await service(async () => ({ data: undefined })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
    });

    it('throws when Orbit cannot be reached, so the caller adds nothing', async () => {
        await expect(service(async () => { throw new Error('down'); }).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).rejects.toThrow('down');
    });
});

describe('what Orbit answers to a job that did not start', () => {
    it('reads a refusal that comes back with the answer (Orbit says no in the body of a 200), and keeps the app it names', async () => {
        const refused = service(async () => ({ data: { ok: false, reason: 'cheaper_route', app: 'Notion' } }));
        expect(await refused.orbit.startComputerJob('b', 'u', { title: 'Add a page', plan: { app: 'Notion', steps: 3 } })).toEqual({ ok: false, reason: 'cheaper_route', app: 'Notion' });
        expect(refused.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', title: 'Add a page', plan: { app: 'Notion', steps: 3 } }, undefined, COMPUTER_START_TIMEOUT_MS);
        expect(await service(async () => ({ data: { ok: false, reason: 'off' } })).orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'off' });
    });

    it('sends whether the person is a guest with the id when it is known, and leaves it out when it is not', async () => {
        const known = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await known.orbit.startComputerJob('b', 'u', { title: 'x', isGuest: false });
        expect(known.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', isGuest: false, title: 'x' }, undefined, COMPUTER_START_TIMEOUT_MS);
        const guest = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await guest.orbit.startComputerJob('b', 'u', { title: 'x', isGuest: true });
        expect((guest.call.mock.calls[0] as unknown[])[2]).toMatchObject({ isGuest: true });
        const unknown = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await unknown.orbit.startComputerJob('b', 'u', { title: 'x' });
        expect((unknown.call.mock.calls[0] as unknown[])[2]).not.toHaveProperty('isGuest');
    });

    it('throws for an answer it cannot get (Orbit down), so the caller says the computer could not be reached', async () => {
        await expect(service(async () => { throw new Error('503'); }).orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
    });
});

describe('the first job on a brand-new Brick, whose machine is made inside the start call', () => {
    const MADE = { data: { ok: true, job: { id: 'j1', status: 'running', queuedFor: null }, restoredFrom: null } };
    const timedOut = () => Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });

    it('waits longer than Orbit does for a machine (its ready wait is 4 minutes), and sends that wait with the start', async () => {
        expect(COMPUTER_START_TIMEOUT_MS).toBeGreaterThan(4 * 60_000);
        const { orbit, call } = service(async () => MADE);
        await orbit.startComputerJob('b', 'u', { title: 'x' });
        expect((call.mock.calls[0] as unknown[])[4]).toBe(COMPUTER_START_TIMEOUT_MS);
    });

    it('takes an answer that comes after 20 seconds as the answer', async () => {
        vi.useFakeTimers();
        try {
            const { orbit } = service(() => new Promise((resolve) => setTimeout(() => resolve(MADE), 20_000)));
            const started = orbit.startComputerJob('b', 'u', { title: 'x' });
            await vi.advanceTimersByTimeAsync(20_000);
            expect(await started).toEqual({ ok: true, job: { id: 'j1', status: 'running', queuedFor: null }, restoredFrom: null });
        } finally {
            vi.useRealTimers();
        }
    });

    const ASK = { title: '  Add a page ', origin: { kind: 'dm' as const, ref: '!room:chat.test' }, isGuest: false };
    /** Orbit as this start meets it: the POST times out, and the read about this start answers as told. */
    const slowStart = (read: () => unknown | Promise<unknown>) => {
        const { orbit } = service(async () => ({ data: {} }));
        const call = vi.fn(async (method: string) => {
            if (method === 'post') throw timedOut();
            return read();
        });
        (orbit as unknown as { brickCall: unknown }).brickCall = call;
        return { orbit, call };
    };

    it('answers "starting" only when Orbit proves THIS start made a job: the person had another job running, the start timed out, and Orbit made this one', async () => {
        const { orbit, call } = slowStart(() => ({ data: { available: true, on: true, busy: true, started: { id: 'job-new', status: 'queued' } } }));
        expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
        expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
        const asked = call.mock.calls[1] as unknown[];
        expect(asked.slice(0, 3)).toEqual(['get', 'api/bots/b/computer-jobs', undefined]);
        // by the ask's own conversation and title, as an elapsed time (a few seconds of slack, not a moment from this server's clock)
        expect(asked[3]).toMatchObject({ userId: 'u', isGuest: 'false', originRef: '!room:chat.test', title: '  Add a page ' });
        const since = Number((asked[3] as { sinceSeconds: string }).sinceSeconds);
        expect(since).toBeGreaterThanOrEqual(5);
        expect(since).toBeLessThanOrEqual(10);
    });

    it('answers "unknown" when this one read finds no job yet (`started: null`): the start may still be processed and commit after the read, so it is no proof that none will be made', async () => {
        const { orbit } = slowStart(() => ({ data: { available: true, on: true, busy: true, started: null } }));
        expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
    });

    describe('when Orbit could not look up who the question is about (HTTP 503, retry: true, no `started`)', () => {
        const unavailable = () => Object.assign(new Error('Request failed with status code 503'), { isAxiosError: true, response: { status: 503, data: { error: 'Try again', retry: true } } });

        it('asks again, after one second and then after two, and never starts the job again: the job it finds is "starting"', async () => {
            vi.useFakeTimers();
            try {
                let reads = 0;
                const { orbit, call } = slowStart(() => {
                    reads += 1;
                    if (reads < 3) throw unavailable();
                    return { data: { started: { id: 'job-new', status: 'running' } } };
                });
                const answer = orbit.startComputerJob('b', 'u', ASK);
                // the timers move in one-second steps: the second asking is not made before one second has passed, the third not before two more
                await vi.advanceTimersByTimeAsync(0);
                expect(reads).toBe(1);
                await vi.advanceTimersByTimeAsync(999);
                expect(reads).toBe(1);
                await vi.advanceTimersByTimeAsync(1);
                expect(reads).toBe(2);
                await vi.advanceTimersByTimeAsync(1000);
                expect(reads).toBe(2);
                await vi.advanceTimersByTimeAsync(999);
                expect(reads).toBe(2);
                await vi.advanceTimersByTimeAsync(1);
                expect(reads).toBe(3);
                expect(await answer).toEqual({ ok: false, reason: 'starting' });
                // one start, three questions about it
                expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get', 'get', 'get']);
                // each asking is for the time that has passed since the start began (the job made at its beginning stays inside the window), never the first number again
                const since = call.mock.calls.filter((one) => one[0] === 'get').map((one) => Number(((one as unknown[])[3] as { sinceSeconds: string }).sinceSeconds));
                expect(since[1] - since[0]).toBeGreaterThanOrEqual(1);
                expect(since[2] - since[1]).toBeGreaterThanOrEqual(2);
                expect(since[2] - since[0]).toBeGreaterThanOrEqual(3);
            } finally {
                vi.useRealTimers();
            }
        });

        it('answers "unknown" when it is still not answered after the last asking (never "no job"), and starts nothing again', async () => {
            vi.useFakeTimers();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                const { orbit, call } = slowStart(() => {
                    throw unavailable();
                });
                const answer = orbit.startComputerJob('b', 'u', ASK);
                await vi.advanceTimersByTimeAsync(3100);
                expect(await answer).toEqual({ ok: false, reason: 'unknown' });
                expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get', 'get', 'get']);
                // read on its own, it is unknown too (not 'none')
                const read = orbit.computerJobStarted('b', 'u', { originRef: 'r', title: 't', sinceSeconds: 5 });
                await vi.advanceTimersByTimeAsync(3100);
                expect(await read).toBe('unknown');
            } finally {
                warn.mockRestore();
                vi.useRealTimers();
            }
        });

        it('reads a 200 that carries `retry: true` and no `started` the same way, and a bare 503 from a gateway is asked again too', async () => {
            vi.useFakeTimers();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                for (const read of [() => ({ data: { retry: true } }), () => { throw Object.assign(new Error('503'), { isAxiosError: true, response: { status: 503, data: '<html>' } }); }]) {
                    const { orbit, call } = slowStart(read as () => unknown);
                    const answer = orbit.computerJobStarted('b', 'u', { originRef: 'r', title: 't', sinceSeconds: 5 });
                    await vi.advanceTimersByTimeAsync(3100);
                    expect(await answer).toBe('unknown');
                    expect(call.mock.calls.filter((one) => one[0] === 'get')).toHaveLength(3);
                }
                // a read that answers `started: null` is not asked again
                const { orbit, call } = slowStart(() => ({ data: { started: null } }));
                expect(await orbit.computerJobStarted('b', 'u', { originRef: 'r', title: 't', sinceSeconds: 5 })).toBe('none');
                expect(call).toHaveBeenCalledTimes(1);
            } finally {
                warn.mockRestore();
                vi.useRealTimers();
            }
        });
    });

    it('answers `ended`, never the timeout, when the job it made has failed or stopped: it was made and is over, which is no failure to reach the computer', async () => {
        for (const status of ['failed', 'stopped']) {
            const { orbit, call } = slowStart(() => ({ data: { started: { id: 'j', status } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK), status).toEqual({ ok: false, reason: 'ended' });
            // the one start, one question about it
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
        }
        // a start that failed by itself (not slow) still throws
        await expect(service(async () => { throw new Error('503'); }).orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
    });

    it('says "unknown", not that it failed, when nobody can tell whether the start made a job (and not a null, tested apart): an Orbit without the read, a damaged answer, the read failing, no conversation to ask by', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        // the person has another job running, and the old busy read said so: no proof of anything about this start
        const reads: unknown[] = [
            () => ({ data: { available: true, on: true, busy: true } }),
            () => {
                throw new Error('down');
            },
            () => ({ data: { started: { id: '', status: 'running' } } }),
            () => ({ data: { started: { status: 'running' } } }),
            () => ({ data: { started: { id: 'j' } } }),
            () => ({ data: { started: 'yes' } }),
            () => ({ data: { started: undefined } }),
            () => ({ data: { started: { id: 'j', status: 'brand-new-state' } } }),
            () => ({ data: undefined }),
            () => ({ data: 'text' }),
        ];
        for (const read of reads) {
            const { orbit } = slowStart(read as () => unknown);
            expect(await orbit.startComputerJob('b', 'u', ASK), String(read)).toEqual({ ok: false, reason: 'unknown' });
        }
        const noOrigin = slowStart(() => ({ data: { started: { id: 'j', status: 'running' } } }));
        expect(await noOrigin.orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'unknown' });
        // nothing was asked: there was nothing to ask by
        expect(noOrigin.call).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('says "starting" for a job that is running, waiting or queued, and leaves the guest flag out when it is not known', async () => {
        for (const status of ['running', 'waiting', 'queued']) {
            const { orbit, call } = slowStart(() => ({ data: { started: { id: 'j', status } } }));
            expect(await orbit.startComputerJob('b', 'u', { title: 'x', origin: { kind: 'dm', ref: 'r' } }), status).toEqual({ ok: false, reason: 'starting' });
            expect((call.mock.calls[1] as unknown[])[3]).not.toHaveProperty('isGuest');
        }
    });

    it('looks back at most as far as Orbit allows, however long the start took', async () => {
        vi.useFakeTimers();
        try {
            const { orbit } = service(async () => ({ data: {} }));
            const reads: Array<Record<string, string>> = [];
            (orbit as unknown as { brickCall: unknown }).brickCall = vi.fn(async (method: string, _path: string, _body: unknown, params?: Record<string, string>) => {
                if (method === 'post') {
                    await new Promise((resolve) => setTimeout(resolve, 15 * 60_000));
                    throw timedOut();
                }
                reads.push(params ?? {});
                return { data: { started: { id: 'j', status: 'running' } } };
            });
            const started = orbit.startComputerJob('b', 'u', ASK);
            await vi.advanceTimersByTimeAsync(15 * 60_000);
            expect(await started).toEqual({ ok: false, reason: 'starting' });
            expect(reads.map((one) => one.sinceSeconds)).toEqual(['600']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks about a job running only for a start that took too long, not for any other failure', async () => {
        const { orbit, call } = service(async () => { throw Object.assign(new Error('503'), { response: { status: 503 } }); });
        await expect(orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
        expect(call).toHaveBeenCalledTimes(1);
        expect(isSlowAnswer(timedOut())).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { response: { status: 504 } }))).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
        expect(isSlowAnswer(new Error('x'))).toBe(false);
        expect(isSlowAnswer(undefined)).toBe(false);
    });

    it('reads the job a start made exactly: an id and a state; none only when Orbit says null; anything else, or a failure, is unknown', async () => {
        const find = { originRef: 'r', title: 't', sinceSeconds: 7.2 };
        expect(await service(async () => ({ data: { started: { id: 'j', status: 'running' } } })).orbit.computerJobStarted('b', 'u', find)).toEqual({ id: 'j', status: 'running' });
        const seen = service(async () => ({ data: { started: null } }));
        expect(await seen.orbit.computerJobStarted('b', 'u', find)).toBe('none');
        expect((seen.call.mock.calls[0] as unknown[])[3]).toEqual({ userId: 'u', originRef: 'r', title: 't', sinceSeconds: '8' });
        expect(await service(async () => ({ data: { started: { id: 5, status: 'running' } } })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        expect(await service(async () => ({ data: {} })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service(async () => { throw new Error('down'); }).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        warn.mockRestore();
    });
});
