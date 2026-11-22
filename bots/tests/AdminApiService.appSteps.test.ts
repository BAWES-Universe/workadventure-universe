import { describe, expect, it, vi } from 'vitest';
import { AdminApiService, COMPUTER_START_ATTEMPT_HEADER, COMPUTER_START_TIMEOUT_MS, isSlowAnswer } from '../server/AdminApiService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The key a start sent: in its header (Orbit's contract), never in its body. */
/** Orbit echoes the attempt it was asked for in the job it answers (`started.attempt`): the reads of the tests say the job, and this adds the echo. */
const echoing = (answer: unknown, params: unknown): unknown => {
    const started = (answer as { data?: { started?: unknown } } | undefined)?.data?.started;
    if (!started || typeof started !== 'object' || 'attempt' in started) return answer;
    return { ...(answer as object), data: { ...(answer as { data: object }).data, started: { ...started, attempt: (params as { attempt?: string } | undefined)?.attempt } } };
};
const sentKey = (call: { mock: { calls: unknown[][] } }, index = 0): string => (call.mock.calls[index][5] as Record<string, string>)['X-Computer-Start-Attempt'];

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
        expect(refused.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', title: 'Add a page', plan: { app: 'Notion', steps: 3 } }, undefined, COMPUTER_START_TIMEOUT_MS, { 'X-Computer-Start-Attempt': expect.stringMatching(UUID), 'X-Computer-Start-Acks': '1' });
        expect(await service(async () => ({ data: { ok: false, reason: 'off' } })).orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'off' });
    });

    it('sends whether the person is a guest with the id when it is known, and leaves it out when it is not', async () => {
        const known = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await known.orbit.startComputerJob('b', 'u', { title: 'x', isGuest: false });
        expect(known.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', isGuest: false, title: 'x' }, undefined, COMPUTER_START_TIMEOUT_MS, { 'X-Computer-Start-Attempt': expect.stringMatching(UUID), 'X-Computer-Start-Acks': '1' });
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
        const call = vi.fn(async (method: string, ..._rest: unknown[]) => {
            if (method === 'post') throw timedOut();
            return echoing(await read(), _rest[2]);
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
        // by the key of this start and nothing else: no title, no conversation, no window of time to match a job of another start by
        expect(asked[3]).toEqual({ userId: 'u', isGuest: 'false', attempt: sentKey(call) });
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
                // every asking is for the same key (the start's own), however long the waits were
                const keys = call.mock.calls.filter((one) => one[0] === 'get').map((one) => ((one as unknown[])[3] as { attempt: string }).attempt);
                expect(new Set(keys).size).toBe(1);
                expect(keys[0]).toBe(sentKey(call));
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
                const read = orbit.computerJobStarted('b', 'u', { startKey: 'key-1-abcdefgh' });
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
                    const answer = orbit.computerJobStarted('b', 'u', { startKey: 'key-1-abcdefgh' });
                    await vi.advanceTimersByTimeAsync(3100);
                    expect(await answer).toBe('unknown');
                    expect(call.mock.calls.filter((one) => one[0] === 'get')).toHaveLength(3);
                }
                // a read that answers `started: null` is not asked again
                const { orbit, call } = slowStart(() => ({ data: { started: null } }));
                expect(await orbit.computerJobStarted('b', 'u', { startKey: 'key-1-abcdefgh' })).toBe('none');
                expect(call).toHaveBeenCalledTimes(1);
            } finally {
                warn.mockRestore();
                vi.useRealTimers();
            }
        });
    });

    describe('the job a slow start made is told from another by the start’s own key, never by the title and the time', () => {
        const KEY = /^[A-Za-z0-9_-]{8,64}$/;
        const keyOf = (call: { mock: { calls: unknown[][] } }) => sentKey(call);

        it('sends one key with the start (in the header X-Computer-Start-Attempt, where Orbit keeps it with the job) and asks for that key (`attempt`), a new one for every start', async () => {
            const first = slowStart(() => ({ data: { started: { id: 'j', status: 'running' } } }));
            await first.orbit.startComputerJob('b', 'u', ASK);
            const second = slowStart(() => ({ data: { started: { id: 'j', status: 'running' } } }));
            await second.orbit.startComputerJob('b', 'u', ASK);
            expect(keyOf(first.call)).toMatch(KEY);
            expect(keyOf(second.call)).toMatch(KEY);
            expect(keyOf(first.call)).not.toBe(keyOf(second.call));
            // the body is what it was before the key: Orbit's body is strict, and a key in it is a 400
            expect(Object.keys(first.call.mock.calls[0][2] as object).sort()).toEqual(['isGuest', 'origin', 'title', 'userId']);
            expect(COMPUTER_START_ATTEMPT_HEADER).toBe('X-Computer-Start-Attempt');
            expect((first.call.mock.calls[1][3] as { attempt: string }).attempt).toBe(keyOf(first.call));
            expect(first.call.mock.calls[1][3]).not.toHaveProperty('startKey');
        });

        it('says "unknown", never "ended" or "starting", for a job of an EARLIER start of the same title in the same chat (it failed just before, and this start was not recorded): Orbit finds no job of THIS key', async () => {
            // Orbit as it is: it keeps the jobs by the key of the start that made them, and the POST of this start timed out before it was recorded
            const jobs = new Map<string, { id: string; status: string }>();
            for (const status of ['failed', 'stopped', 'running', 'queued']) {
                jobs.set(`earlier-${status}-key`, { id: `earlier-${status}`, status });
                const { orbit, call } = service(async () => ({ data: {} }));
                (orbit as unknown as { brickCall: unknown }).brickCall = vi.fn(async (method: string, _path: string, _body: unknown, params?: { attempt?: string; title?: string }) => {
                    if (method === 'post') throw timedOut();
                    // Orbit finds by the key of the start. (Asked by the title instead, it would answer the earlier job of that title, which is what an older reading did.)
                    if (params?.attempt === undefined) return { data: { started: params?.title ? { id: `earlier-${status}`, status } : undefined } };
                    const found = jobs.get(params.attempt);
                    return { data: { started: found ? { ...found, attempt: params.attempt } : null } };
                });
                expect(await orbit.startComputerJob('b', 'u', ASK), status).toEqual({ ok: false, reason: 'unknown' });
                void call;
            }
            // the job of this key, once recorded, is told as it was
            const mine = slowStart(() => ({ data: { started: { id: 'j', status: 'failed' } } }));
            expect(await mine.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'ended' });
        });

        it('asks by the key for a start with no conversation too (nothing but the key is needed), and says "unknown" for an Orbit that does not have the read', async () => {
            const noOrigin = slowStart(() => ({ data: { started: { id: 'j', status: 'running' } } }));
            expect(await noOrigin.orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'starting' });
            expect(noOrigin.call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            const older = slowStart(() => ({ data: { available: true, on: true, busy: true } }));
            expect(await older.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
        });
    });

    describe('a start whose answer was lost in a way that is not a timeout (the job may be made all the same)', () => {
        const lostBy = (failure: () => unknown, read: () => unknown) => {
            const { orbit } = service(async () => ({ data: {} }));
            const call = vi.fn(async (method: string, ..._rest: unknown[]) => {
                if (method === 'post') throw failure();
                return echoing(await read(), _rest[2]);
            });
            (orbit as unknown as { brickCall: unknown }).brickCall = call;
            return { orbit, call };
        };
        const network = (code: string) => () => Object.assign(new Error(`read ${code}`), { isAxiosError: true, code });
        const answered = (status: number, ...rest: [data?: unknown]) => () => Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, code: status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', response: { status, data: rest.length === 0 ? '<html>' : rest[0] } });
        const LOST: Array<[string, () => unknown]> = [
            ['ECONNRESET', network('ECONNRESET')],
            ['EPIPE', network('EPIPE')],
            ['ECONNREFUSED', network('ECONNREFUSED')],
            ['no code at all (an axios error with no answer)', () => Object.assign(new Error('Network Error'), { isAxiosError: true })],
            ['a plain error object with a network code', () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
            ['502', answered(502)],
            ['503 from a proxy', answered(503)],
            ['503 from Orbit itself', answered(503, { error: 'Try again', retry: true })],
            ['504', answered(504)],
            ['500', answered(500)],
            ['408', answered(408)],
            // a 4xx that Orbit did not write (a gateway's or proxy's page, an empty answer) says nothing of what Orbit decided
            ['a 404 page from a gateway', answered(404, '<html>Not found</html>')],
            ['a 429 with no body', answered(429, '')],
            ['a 400 with a text body', answered(400, 'Bad Request')],
            ['a 403 with no data at all', answered(403, undefined)],
        ];

        it.each(LOST)('asks Orbit for the job of this start after %s: found live, it is "starting", so the person is not told it failed and does not pay for a second job', async (_name, failure) => {
            const { orbit, call } = lostBy(failure, () => ({ data: { started: { id: 'job-1', status: 'queued' } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            expect((call.mock.calls[1][3] as { attempt: string }).attempt).toBe(sentKey(call));
        });

        it.each(LOST)('says the job of this start is over (`ended`) after %s when it was made and has failed', async (_name, failure) => {
            const { orbit } = lostBy(failure, () => ({ data: { started: { id: 'job-1', status: 'failed' } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'ended' });
        });

        it.each(LOST)('says "unknown" after %s when Orbit finds no job of the key yet (it may still commit): never a failure that has the person ask again', async (_name, failure) => {
            const { orbit } = lostBy(failure, () => ({ data: { started: null } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
        });

        it.each([
            ['400 (its own: invalid input)', answered(400, { error: 'Invalid input data' })],
            ['401 (its own: unauthorized)', answered(401, { error: 'Unauthorized' })],
        ])('throws at once after Orbit itself answered %s: the start made no job, and no look-up is made', async (_name, failure) => {
            const { orbit, call } = lostBy(failure, () => ({ data: { started: { id: 'job-1', status: 'queued' } } }));
            await expect(orbit.startComputerJob('b', 'u', ASK)).rejects.toThrow(/status code/);
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post']);
        });

        // GPT round 4, R1: Orbit sends its business refusals as a SUCCESSFUL HTTP answer (200). The same body on an error status (a rate limiter's 429, a gateway's 403 in front of
        // Orbit) is not Orbit's no: the key is looked up, and the start is never told as one that made nothing
        it.each([
            ['429 {ok:false, reason:"rate_limited"}', answered(429, { ok: false, reason: 'rate_limited' })],
            ['403 {ok:false, reason:"off"}', answered(403, { ok: false, reason: 'off' })],
            ['503 {ok:false, reason:"paused"}', answered(503, { ok: false, reason: 'paused' })],
        ])('looks up the SAME key after a %s (the shape of Orbit\'s refusal on an error status): it does not throw, and keeps the uncertainty', async (_name, failure) => {
            const { orbit, call } = lostBy(failure, () => ({ data: { started: null } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            expect((call.mock.calls[1][3] as { attempt: string }).attempt).toBe(sentKey(call));
        });

        it('keeps Orbit\'s refusal final when it comes as a 200 with a reason: the start made no job, and nothing is looked up', async () => {
            const { orbit } = service(async () => ({ data: {} }));
            const call = vi.fn(async (method: string) => (method === 'post' ? { data: { ok: false, reason: 'off' } } : { data: { started: { id: 'job-1', status: 'queued' } } }));
            (orbit as unknown as { brickCall: unknown }).brickCall = call;
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'off' });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post']);
        });

        // GPT round 3, finding 3: a JSON 429 (or 403/404/422) that is not one of Orbit's own shapes can come from a gateway or a rate limiter in front of Orbit,
        // and says nothing of what Orbit did with the start: the same key is looked up, and the job it made (if any) is found
        it.each([
            ['429 with a JSON body', answered(429, { error: 'slow down' })],
            ['403 with a JSON body', answered(403, { error: 'no' })],
            ['404 with a JSON body', answered(404, { error: 'no' })],
            ['422 with a JSON body', answered(422, { error: 'no' })],
            ['400 with another JSON body', answered(400, { error: 'bad' })],
            ['401 with another JSON body', answered(401, { error: 'no' })],
            ['429 whose body has a reason but not ok:false', answered(429, { reason: 'slow_down' })],
            ['429 whose body is a JSON array', answered(429, [])],
        ])('looks up the SAME key after a %s, because it does not prove Orbit made no job: found live, it is "starting"', async (_name, failure) => {
            const { orbit, call } = lostBy(failure, () => ({ data: { started: { id: 'job-1', status: 'queued' } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            expect((call.mock.calls[1][3] as { attempt: string }).attempt).toBe(sentKey(call));
        });

        it('says "unknown" after a JSON 429 when the look-up finds no job yet or fails (the attempt is kept, never a failure that has the person ask again), and "done" when the job of the key finished', async () => {
            const none = lostBy(answered(429, { error: 'slow down' }), () => ({ data: { started: null } }));
            expect(await none.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            const done = lostBy(answered(429, { error: 'slow down' }), () => ({ data: { started: { id: 'j', status: 'done' } } }));
            expect(await done.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'done' });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const down = lostBy(answered(429, { error: 'slow down' }), () => { throw new Error('down'); });
            expect(await down.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            warn.mockRestore();
        });

        it('uses the key the caller asked for (the same key on the start and on the look-up), and a key that does not fit the shape is replaced', async () => {
            const mine = lostBy(network('ECONNRESET'), () => ({ data: { started: { id: 'j', status: 'running' } } }));
            await mine.orbit.startComputerJob('b', 'u', { ...ASK, startKey: 'chat-key_0123456789' });
            expect(sentKey(mine.call)).toBe('chat-key_0123456789');
            expect((mine.call.mock.calls[1][3] as { attempt: string }).attempt).toBe('chat-key_0123456789');
            for (const bad of ['short', 'has space in it!!', 'x'.repeat(65), '']) {
                const replaced = lostBy(network('ECONNRESET'), () => ({ data: { started: { id: 'j', status: 'running' } } }));
                await replaced.orbit.startComputerJob('b', 'u', { ...ASK, startKey: bad });
                expect(sentKey(replaced.call), bad).toMatch(UUID);
            }
        });

        it('throws at once when nothing was sent (Orbit not set up, a bad address): no look-up, nothing was started', async () => {
            for (const failure of [() => new Error('Orbit is not set up for Bricks'), () => Object.assign(new Error('Invalid URL'), { isAxiosError: true, code: 'ERR_INVALID_URL' })]) {
                const { orbit, call } = lostBy(failure, () => ({ data: { started: { id: 'job-1', status: 'queued' } } }));
                await expect(orbit.startComputerJob('b', 'u', ASK)).rejects.toThrow();
                expect(call.mock.calls.map((one) => one[0])).toEqual(['post']);
            }
        });
    });

    describe('an answer that came but does not say what happened (an incomplete success)', () => {
        /** The POST answers as told, and the read about this start answers as told. */
        const answers = (post: unknown, read: () => unknown) => {
            const { orbit } = service(async () => ({ data: {} }));
            const call = vi.fn(async (method: string, ..._rest: unknown[]) => (method === 'post' ? { data: post } : echoing(await read(), _rest[2])));
            (orbit as unknown as { brickCall: unknown }).brickCall = call;
            return { orbit, call };
        };
        const INCOMPLETE: Array<[string, unknown]> = [
            ['ok:true with an empty job', { ok: true, job: {} }],
            ['ok:true with no job', { ok: true }],
            ['ok:true with a job that has no state', { ok: true, job: { id: 'j' } }],
            ['ok:true with a job that has no id', { ok: true, job: { status: 'running' } }],
            ['nothing that says what happened', {}],
            ['no body at all', undefined],
        ];

        it.each(INCOMPLETE)('asks for the job of this start by its key after %s, and says "starting" when it is live: the person is not told it failed and does not pay for a second job', async (_name, post) => {
            const { orbit, call } = answers(post, () => ({ data: { started: { id: 'job-1', status: 'running' } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            expect((call.mock.calls[1][3] as { attempt: string }).attempt).toBe(sentKey(call));
        });

        it.each(INCOMPLETE)('says `ended` after %s when the job of the key has failed, and stays "unknown" when the look-up cannot confirm a job (none, no echo, a failing read)', async (_name, post) => {
            expect(await answers(post, () => ({ data: { started: { id: 'j', status: 'failed' } } })).orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'ended' });
            expect(await answers(post, () => ({ data: { started: null } })).orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            expect(await answers(post, () => ({ data: { started: { id: 'j', status: 'running', attempt: 'another-key-xyz' } } })).orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            expect(await answers(post, () => { throw new Error('down'); }).orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
            warn.mockRestore();
        });

        it('keeps a whole success and a whole refusal (`ok: false` with a reason) on the direct path: no look-up is made', async () => {
            const whole = answers({ ok: true, job: { id: 'j', status: 'queued', queuedFor: null } }, () => ({ data: { started: { id: 'x', status: 'running' } } }));
            expect(await whole.orbit.startComputerJob('b', 'u', ASK)).toMatchObject({ ok: true, job: { id: 'j' } });
            expect(whole.call.mock.calls.map((one) => one[0])).toEqual(['post']);
            for (const refusal of [{ ok: false, reason: 'off' }, { ok: false, reason: 'cheaper_route', app: 'Notion' }]) {
                const refused = answers(refusal, () => ({ data: { started: { id: 'x', status: 'running' } } }));
                expect(await refused.orbit.startComputerJob('b', 'u', ASK)).toEqual(refusal);
                expect(refused.call.mock.calls.map((one) => one[0])).toEqual(['post']);
            }
        });

        // GPT round 3, finding 3: the shape of Orbit's refusal is checked, a body that only looks like one is looked up by the key
        it.each([
            ['ok:false with no reason', { ok: false }],
            ['a reason with no ok:false', { reason: 'busy' }],
            ['ok:false with an empty reason', { ok: false, reason: '' }],
            ['ok:false with a reason that is not text', { ok: false, reason: 5 }],
            ['a JSON array', []],
        ])('looks up the key after %s (it is not Orbit\'s refusal): live is "starting", none is "unknown"', async (_name, post) => {
            const live = answers(post, () => ({ data: { started: { id: 'j', status: 'running' } } }));
            expect(await live.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
            expect(live.call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            const none = answers(post, () => ({ data: { started: null } }));
            expect(await none.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
        });

        // a whole success is told by the real state of its job: a job that is already over is never "running"
        it.each([
            ['done', { ok: false, reason: 'done' }],
            ['failed', { ok: false, reason: 'ended' }],
            ['stopped', { ok: false, reason: 'ended' }],
            ['brand-new-state', { ok: false, reason: 'unknown' }],
        ])('tells a whole success whose job is already "%s" as it is, never as a job that is running', async (status, told) => {
            const { orbit, call } = answers({ ok: true, job: { id: 'j', status, queuedFor: null } }, () => ({ data: { started: { id: 'x', status: 'running' } } }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual(told);
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post']);
        });

        // CodeRabbit on 8a20b473: a reply that says it worked but names no job is no job; the keyed look-up tells what the start made
        it.each([
            ['an empty id', ''],
            ['no id', undefined],
            ['an id that is not text', 5],
        ])('does not take a "worked" reply with %s for a job that is running: the key is looked up, and what is found there is told', async (_name, id) => {
            const post = { ok: true, job: { id, status: 'running', queuedFor: null } };
            const live = answers(post, () => ({ data: { started: { id: 'j-real', status: 'running' } } }));
            expect(await live.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'starting' });
            expect(live.call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
            const none = answers(post, () => ({ data: { started: null } }));
            expect(await none.orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'unknown' });
        });

        it('still takes a "worked" reply whose job has an id (one character is enough), as before', async () => {
            const { orbit, call } = answers({ ok: true, job: { id: 'j', status: 'running', queuedFor: null } }, () => ({ data: {} }));
            expect(await orbit.startComputerJob('b', 'u', ASK)).toMatchObject({ ok: true, job: { id: 'j', status: 'running' } });
            expect(call.mock.calls.map((one) => one[0])).toEqual(['post']);
        });

        it('keeps a whole success whose job is queued, running or waiting as the success it is', async () => {
            for (const status of ['queued', 'running', 'waiting']) {
                const { orbit } = answers({ ok: true, job: { id: 'j', status, queuedFor: null } }, () => ({ data: {} }));
                expect(await orbit.startComputerJob('b', 'u', ASK), status).toMatchObject({ ok: true, job: { id: 'j', status } });
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
        warn.mockRestore();
    });

    it('answers `done` when the job of this start has finished (a look-up, not a start that answered): the job is over and its result is with the person, so it is never told as running', async () => {
        const { orbit, call } = slowStart(() => ({ data: { started: { id: 'j', status: 'done' } } }));
        expect(await orbit.startComputerJob('b', 'u', ASK)).toEqual({ ok: false, reason: 'done' });
        expect(call.mock.calls.map((one) => one[0])).toEqual(['post', 'get']);
    });

    it('says "starting" for a job that is running, waiting or queued, and leaves the guest flag out when it is not known', async () => {
        for (const status of ['running', 'waiting', 'queued']) {
            const { orbit, call } = slowStart(() => ({ data: { started: { id: 'j', status } } }));
            expect(await orbit.startComputerJob('b', 'u', { title: 'x', origin: { kind: 'dm', ref: 'r' } }), status).toEqual({ ok: false, reason: 'starting' });
            expect((call.mock.calls[1] as unknown[])[3]).not.toHaveProperty('isGuest');
        }
    });

    it('reads the job a start made exactly: an id and a state; none only when Orbit says null; anything else, or a failure, is unknown', async () => {
        const find = { startKey: 'key-1-abcdefgh' };
        expect(await service(async () => ({ data: { started: { id: 'j', status: 'running', attempt: 'key-1-abcdefgh' } } })).orbit.computerJobStarted('b', 'u', find)).toEqual({ id: 'j', status: 'running' });
        const seen = service(async () => ({ data: { started: null } }));
        expect(await seen.orbit.computerJobStarted('b', 'u', find)).toBe('none');
        expect((seen.call.mock.calls[0] as unknown[])[3]).toEqual({ userId: 'u', attempt: 'key-1-abcdefgh' });
        expect(await service(async () => ({ data: { started: { id: 5, status: 'running', attempt: 'key-1-abcdefgh' } } })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        // the job counts only when Orbit says it is the job of THIS key: no attempt, or another one, is no proof of anything (an older Orbit, a mix-up)
        expect(await service(async () => ({ data: { started: { id: 'j', status: 'running' } } })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        expect(await service(async () => ({ data: { started: { id: 'j', status: 'running', attempt: 'another-key-xyz' } } })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        expect(await service(async () => ({ data: { started: { id: 'j', status: 'running', attempt: null } } })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        expect(await service(async () => ({ data: {} })).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service(async () => { throw new Error('down'); }).orbit.computerJobStarted('b', 'u', find)).toBe('unknown');
        warn.mockRestore();
    });
});
