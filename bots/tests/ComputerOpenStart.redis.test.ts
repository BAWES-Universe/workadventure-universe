import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminApiService } from '../server/AdminApiService';
import { forgetSettledStarts, runComputerTool, OPEN_START_KEEP_MS, type StartKeyEntry } from '../ai/ComputerTools';
import { RedisStartKeys, startKeyNameOf } from '../server/ComputerStartKeys';

/**
 * GPT round 4, R1: ONE identity until an uncertain start is resolved. The real tool (`runComputerTool`), the real client (`AdminApiService`, its Orbit transport replaced by an Orbit that
 * keeps jobs by the key of the start that made them, as Orbit does) and a real Redis. Runs when BOTS_TEST_REDIS_URL is given; CI sets BOTS_REQUIRE_REDIS.
 */
const REAL_REDIS = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(process.env.BOTS_REQUIRE_REDIS === '1' && !REAL_REDIS)('the real Redis for the open start tests', () => {
    it('is given when the run requires it (CI): the open start is never left untested', () => {
        expect(REAL_REDIS, 'BOTS_TEST_REDIS_URL is not set while BOTS_REQUIRE_REDIS=1').toBeTruthy();
    });
});

/** Orbit as the start route has it: one job per key (a start that repeats a key is answered with that job), a read by key, and the ways an answer is lost. */
class FakeOrbit {
    readonly jobs = new Map<string, { id: string; status: string; title: string }>();
    posts: Array<{ key: string; title: string }> = [];
    lookups: string[] = [];
    reservations = 0;
    /** What the next start does: the answer comes whole, is lost after the job was made, or is a rate limiter's. */
    onPost: 'whole' | 'lose-after-commit' | 'limiter-after-commit' | 'limiter-before-commit' | 'refuse-200' | 'refuse-200-paused' = 'whole';
    /** What a read by key says: the truth, nothing (an Orbit that cannot say), or that no job has the key yet. */
    onGet: 'truth' | 'silent' | 'none' = 'truth';
    status = 'running';

    call = async (method: string, _path: string, body?: unknown, params?: Record<string, string>, _timeout?: number, headers?: Record<string, string>) => {
        if (method === 'post') {
            const key = headers?.['X-Computer-Start-Attempt'] ?? '';
            const title = (body as { title: string }).title;
            this.posts.push({ key, title });
            const make = () => {
                if (!this.jobs.has(key)) {
                    this.reservations += 1;
                    this.jobs.set(key, { id: `job-${this.jobs.size + 1}`, status: this.status, title });
                }
                const made = this.jobs.get(key)!;
                return { data: { ok: true, job: { id: made.id, status: made.status, queuedFor: null }, restoredFrom: null } };
            };
            switch (this.onPost) {
                case 'whole':
                    return make();
                case 'lose-after-commit':
                    make();
                    throw Object.assign(new Error('timeout of 480000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' });
                case 'limiter-after-commit':
                    make();
                    throw Object.assign(new Error('Request failed with status code 429'), { isAxiosError: true, response: { status: 429, data: { ok: false, reason: 'rate_limited' } } });
                case 'limiter-before-commit':
                    throw Object.assign(new Error('Request failed with status code 429'), { isAxiosError: true, response: { status: 429, data: { ok: false, reason: 'rate_limited' } } });
                case 'refuse-200':
                    return { data: { ok: false, reason: 'off' } };
                case 'refuse-200-paused':
                    return { data: { ok: false, reason: 'paused' } };
            }
        }
        const key = params?.attempt ?? '';
        this.lookups.push(key);
        if (this.onGet === 'silent') return { data: { available: true, on: true, busy: true } };
        if (this.onGet === 'none') return { data: { started: null } };
        const found = this.jobs.get(key);
        return { data: { started: found ? { id: found.id, status: found.status, attempt: key } : null } };
    };
}

describe.skipIf(!REAL_REDIS)('one open start per Brick and person, on a real Redis (GPT round 4, R1)', () => {
    let client!: ReturnType<typeof createClient>;
    let opened = false;
    const scopes: string[] = [];
    const ids = () => {
        const run = randomUUID().slice(0, 8);
        const scope = { botId: `brick-${run}`, userId: `uuid-${run}` };
        scopes.push(`${scope.botId}|${scope.userId}`);
        return scope;
    };
    beforeAll(async () => {
        client = createClient({ url: REAL_REDIS, socket: { reconnectStrategy: false } });
        client.on('error', () => undefined);
        await client.connect();
        opened = true;
    });
    afterAll(async () => {
        if (!opened || !client.isOpen) return;
        if (scopes.length > 0) await client.del(scopes.map(startKeyNameOf));
        await client.quit();
    });
    afterEach(() => vi.useRealTimers());

    /** A server process: its own memory of the chat and its own client, over the shared Redis and the one Orbit. */
    const process_ = (orbit: FakeOrbit, who: { botId: string; userId: string }, memory = new Map<string, StartKeyEntry>(), redis: () => never | null = () => client as never) => {
        const admin = new AdminApiService('http://orbit.test');
        vi.spyOn(admin, 'isConfigured').mockReturnValue(true);
        (admin as unknown as { brickCall: unknown }).brickCall = orbit.call;
        const store = new RedisStartKeys(redis);
        return {
            memory,
            ask: (title: string, over: Record<string, unknown> = {}) => runComputerTool({ job: title }, { admin, botId: who.botId, userId: who.userId, startKeys: memory, startKeyStore: store, ...over }) as Promise<Record<string, unknown>>,
        };
    };
    const COULD_NOT_CHECK = "I couldn't check whether this job has started. I'll use the same request when you check again.";
    const held = async (who: { botId: string; userId: string }) => JSON.parse((await client.get(startKeyNameOf(`${who.botId}|${who.userId}`))) ?? 'null') as { key: string; at: number } | null;

    it('an unknown start, then the ask REWORDED: zero new POSTs, the first key is looked up, and one job with one reservation exists', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        const server = process_(orbit, who);
        const first = await server.ask('Fill in my visa form');
        expect(first).toMatchObject({ started: false, unknown: true });
        const key = orbit.posts[0].key;
        expect((await held(who))?.key).toBe(key);
        // the person rewords it; Orbit still cannot say
        orbit.posts = [];
        orbit.lookups = [];
        const again = await server.ask('Apply for the visa online');
        expect(orbit.posts).toEqual([]);
        expect(orbit.lookups).toEqual([key]);
        expect(String(again.note)).toContain(COULD_NOT_CHECK);
        expect(again).toMatchObject({ started: false, unknown: true });
        expect(orbit.jobs.size).toBe(1);
        expect(orbit.reservations).toBe(1);
        // the open start is still the one the store holds
        expect((await held(who))?.key).toBe(key);
    });

    it('the same title eleven minutes on, and twenty-three hours on: the first key is looked up, no new key, and when Orbit can say, the ORIGINAL job is the answer (one job, one reservation)', async () => {
        for (const [name, later] of [['eleven minutes', 11 * 60_000], ['twenty-three hours', 23 * 3_600_000]] as const) {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'lose-after-commit';
            orbit.onGet = 'silent';
            const server = process_(orbit, who);
            await server.ask('Fill in my visa form');
            const key = orbit.posts[0].key;
            vi.setSystemTime(new Date('2026-11-22T10:00:00Z').getTime() + later);
            // the chat's next messages forget what is settled and keep what is open
            forgetSettledStarts(server.memory);
            // Orbit still cannot say: nothing new goes out
            orbit.posts = [];
            orbit.lookups = [];
            const quiet = await server.ask('Fill in my visa form');
            expect(orbit.posts, name).toEqual([]);
            expect(orbit.lookups, name).toEqual([key]);
            expect(quiet, name).toMatchObject({ unknown: true });
            // Orbit can say now: the job of the first key is the answer, nothing is sent, nothing new is reserved
            orbit.onGet = 'truth';
            const found = await server.ask('Fill in my visa form');
            expect(orbit.posts, name).toEqual([]);
            expect(found, name).toMatchObject({ started: false, found: true });
            expect(orbit.jobs.size, name).toBe(1);
            expect(orbit.reservations, name).toBe(1);
            vi.useRealTimers();
        }
    });

    it('a committed start whose answer was lost and whose read found nothing YET: the ask later sends the SAME key and gets the ORIGINAL job (one job, one reservation), reworded or not', async () => {
        for (const later of [11 * 60_000, 23 * 3_600_000]) {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'lose-after-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await server.ask('Fill in my visa form');
            const key = orbit.posts[0].key;
            vi.setSystemTime(new Date('2026-11-22T10:00:00Z').getTime() + later);
            forgetSettledStarts(server.memory);
            orbit.onPost = 'whole';
            const replayed = await server.ask('Apply for the visa, worded another way');
            expect(orbit.posts.map((one) => one.key)).toEqual([key, key]);
            expect(replayed).toMatchObject({ started: true });
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.reservations).toBe(1);
            expect(orbit.jobs.get(key)?.id).toBe('job-1');
            // the job is made: nothing is kept
            expect(await held(who)).toBeNull();
            vi.useRealTimers();
        }
    });

    it('a fresh process (empty memory) with the record in Redis: the same, reworded or not, at once or a day on', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        await process_(orbit, who).ask('Fill in my visa form');
        const key = orbit.posts[0].key;
        orbit.posts = [];
        orbit.lookups = [];
        const restarted = await process_(orbit, who).ask('Something else entirely');
        expect(orbit.posts).toEqual([]);
        expect(orbit.lookups).toEqual([key]);
        expect(restarted).toMatchObject({ started: false, unknown: true });
        orbit.onGet = 'truth';
        const found = await process_(orbit, who).ask('Fill in my visa form');
        expect(found).toMatchObject({ found: true });
        expect(orbit.posts).toEqual([]);
        expect(orbit.jobs.size).toBe(1);
        expect(orbit.reservations).toBe(1);
    });

    it('keeps the record with a safety life of a day, not ten minutes, and never renews it into a new key', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        await process_(orbit, who).ask('Fill in my visa form');
        const life = await client.pTTL(startKeyNameOf(`${who.botId}|${who.userId}`));
        expect(life).toBeGreaterThan(OPEN_START_KEEP_MS - 60_000);
        expect(life).toBeLessThanOrEqual(OPEN_START_KEEP_MS);
    });

    it('an intermediary 429 with Orbit\'s JSON shape on the start: at least one keyed look-up, the key kept (in memory and in Redis), the "couldn\'t check" words, and no failure answer', async () => {
        for (const commits of [true, false]) {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = commits ? 'limiter-after-commit' : 'limiter-before-commit';
            orbit.onGet = 'silent';
            const server = process_(orbit, who);
            const answer = await server.ask('Fill in my visa form');
            const key = orbit.posts[0].key;
            expect(orbit.lookups.length).toBeGreaterThanOrEqual(1);
            expect(orbit.lookups.every((one) => one === key)).toBe(true);
            expect(answer).toMatchObject({ started: false, unknown: true });
            expect(answer).not.toHaveProperty('success');
            expect(String(answer.note)).toContain(COULD_NOT_CHECK);
            expect((await held(who))?.key).toBe(key);
            expect([...server.memory.values()].map((one) => [one.key, one.open])).toEqual([[key, true]]);
            // the next ask is that start: the key is looked up, nothing else is sent
            orbit.posts = [];
            await server.ask('Fill in my visa form');
            expect(orbit.posts).toEqual([]);
            expect(orbit.jobs.size).toBe(commits ? 1 : 0);
            expect(orbit.reservations).toBe(commits ? 1 : 0);
        }
    });

    it('an Orbit refusal in a 200 is FINAL: the key is dropped (memory and Redis), and the next ask is a new ask with a key of its own', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'refuse-200';
        const server = process_(orbit, who);
        const answer = await server.ask('Fill in my visa form');
        expect(answer).toMatchObject({ started: false, success: false });
        expect(await held(who)).toBeNull();
        expect(server.memory.size).toBe(0);
        await server.ask('Fill in my visa form');
        expect(orbit.posts[1].key).not.toBe(orbit.posts[0].key);
        expect(orbit.lookups).toEqual([]);
    });

    it('a no from Orbit to a LATER send of an open start (the key looked up found no job yet) does not end the start', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'limiter-before-commit';
        orbit.onGet = 'none';
        const server = process_(orbit, who);
        await server.ask('Fill in my visa form');
        const key = orbit.posts[0].key;
        orbit.onPost = 'refuse-200-paused';
        await server.ask('Fill in my visa form again');
        expect(orbit.posts.map((one) => one.key)).toEqual([key, key]);
        expect((await held(who))?.key).toBe(key);
    });

    it('TWO deliberate asks, each resolved before the next: two jobs and two reservations, even with an identical title (the first is settled, a new message clears it)', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        const server = process_(orbit, who);
        expect(await server.ask('Fill in my visa form')).toMatchObject({ started: true });
        expect(await held(who)).toBeNull();
        forgetSettledStarts(server.memory);
        expect(await server.ask('Fill in my visa form')).toMatchObject({ started: true });
        expect(orbit.jobs.size).toBe(2);
        expect(orbit.reservations).toBe(2);
        expect(new Set(orbit.posts.map((one) => one.key)).size).toBe(2);
        // a different person or Brick is never the open start of this one
        const other = ids();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        await process_(orbit, other).ask('Fill in my visa form');
        orbit.onPost = 'whole';
        expect(await process_(orbit, who).ask('Fill in my visa form')).toMatchObject({ started: true });
        expect(orbit.jobs.size).toBe(4);
    });

    it('the SAME ask asked again in the same turn after a start that worked finds the same job (no second job), a retried reply included', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        const server = process_(orbit, who);
        await server.ask('Fill in my visa form');
        await server.ask('fill in my VISA form');
        expect(orbit.posts[1].key).toBe(orbit.posts[0].key);
        expect(orbit.jobs.size).toBe(1);
        expect(orbit.reservations).toBe(1);
    });

    it('E2: a configured shared store that is down, no key known here: a NEW start is deferred (nothing is sent, nothing is kept); a key this process knows is checked (looked up) instead', async () => {
        const who = ids();
        const orbit = new FakeOrbit();
        const server = process_(orbit, who, new Map(), () => null as never);
        const deferred = await server.ask('Fill in my visa form');
        expect(deferred).toMatchObject({ started: false, unconfirmed: true });
        expect(String(deferred.note)).toContain(COULD_NOT_CHECK);
        expect(orbit.posts).toEqual([]);
        expect(orbit.lookups).toEqual([]);
        expect(server.memory.size).toBe(0);
        // a start whose key this process knows (it sent it): the store being down changes nothing, and the key is looked up before anything is sent
        const known = ids();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        const inMemory = new Map<string, StartKeyEntry>();
        await process_(orbit, known, inMemory).ask('Fill in my visa form');
        const key = orbit.posts[0].key;
        orbit.posts = [];
        orbit.lookups = [];
        const down = await process_(orbit, known, inMemory, () => null as never).ask('Fill in my visa form reworded');
        expect(orbit.posts).toEqual([]);
        expect(orbit.lookups).toEqual([key]);
        expect(down).toMatchObject({ unknown: true });
    });
});
