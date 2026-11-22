import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as Sentry from '@sentry/node';
import { AdminApiService } from '../server/AdminApiService';
import { ConfirmationQueue, FOUND_EARLIER_SLOT, forgetSettledStarts, jobLine, runComputerTool, OPEN_START_KEEP_MS, type StartKeyEntry } from '../ai/ComputerTools';
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

/** A job as the fake Orbit keeps it: the words of the start that made it (for what a resend carried), who it is for, and whether this game confirmed it saw it (Orbit's `start-ack` contract). */
interface FakeJob {
    id: string;
    status: string;
    title: string;
    brief?: string;
    writes?: boolean;
    plan?: unknown;
    scope: string;
    attempt: string;
    acked: boolean;
}

/**
 * Orbit as the start route has it, with the contract of GPT's second note (R1): one job per key (a start that repeats a key is answered with that job), a read by key that also confirms
 * the job it finds, the ways an answer is lost, and the guard: a start that says it confirms (`X-Computer-Start-Acks: 1`) makes a job that is UNCONFIRMED until the game acks it, and while
 * a person has an unconfirmed job on a Brick a start with another key makes nothing and answers `earlier` with the OLDEST one (its state and its key).
 */
class FakeOrbit {
    readonly jobs = new Map<string, FakeJob>();
    /** The starts that reached Orbit (the acks are kept apart): the key, the words they carried, and whether they said they confirm. */
    posts: Array<{ key: string; title: string; brief?: string; writes?: boolean; plan?: unknown; origin?: unknown; confirms: boolean }> = [];
    /** The confirmations that reached Orbit. */
    acks: Array<{ attempt: string; userId: string }> = [];
    lookups: string[] = [];
    reservations = 0;
    /** Starts that were answered `earlier` (nothing made). */
    guarded = 0;
    /** What the next start does: the answer comes whole, is lost after the job was made, or is a rate limiter's. */
    onPost: 'whole' | 'lose-after-commit' | 'limiter-after-commit' | 'limiter-before-commit' | 'refuse-200' | 'refuse-200-paused' = 'whole';
    /** What a read by key says: the truth, nothing (an Orbit that cannot say), or that no job has the key yet. */
    onGet: 'truth' | 'silent' | 'none' = 'truth';
    /** Whether a read by key confirms the job it finds (Orbit 6be29335 did; GPT's third note: it is READ-ONLY from now on, the game confirms with `start-ack`). */
    getConfirms = false;
    /** A read whose answer is lost on the way (the read itself is made at Orbit). */
    loseNextGets = 0;
    /** What a confirmation does: reaches Orbit, or is lost on the way (nothing happens there). */
    onAck: 'ok' | 'lose' = 'ok';
    status = 'running';

    private stateOf = (status: string): 'live' | 'done' | 'ended' => (status === 'running' || status === 'queued' || status === 'waiting' ? 'live' : status === 'done' ? 'done' : 'ended');

    call = async (method: string, path: string, body?: unknown, params?: Record<string, string>, _timeout?: number, headers?: Record<string, string>) => {
        if (method === 'post') {
            const sent = body as { action?: string; userId: string; title: string; brief?: string; writes?: boolean; plan?: unknown; origin?: unknown; attempt?: string };
            const scope = `${path.split('/')[2] ?? ''}|${sent.userId}`;
            if (sent.action === 'start-ack') {
                this.acks.push({ attempt: sent.attempt ?? '', userId: sent.userId });
                if (this.onAck === 'lose') throw Object.assign(new Error('timeout of 5000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' });
                const job = this.jobs.get(sent.attempt ?? '');
                const acked = !!job && job.scope === scope && !job.acked;
                if (acked) job!.acked = true;
                return { data: { ok: true, acked } };
            }
            const key = headers?.['X-Computer-Start-Attempt'] ?? '';
            const confirms = headers?.['X-Computer-Start-Acks'] === '1';
            const title = sent.title;
            this.posts.push({ key, title, ...(sent.brief ? { brief: sent.brief } : {}), ...(sent.writes === undefined ? {} : { writes: sent.writes }), ...(sent.plan ? { plan: sent.plan } : {}), ...(sent.origin ? { origin: sent.origin } : {}), confirms });
            const make = () => {
                if (!this.jobs.has(key)) {
                    // the guard sits at the moment of creation: the oldest job of this person on this Brick that was never confirmed stands in the way of a start with another key
                    const unconfirmed = confirms ? [...this.jobs.values()].find((one) => one.scope === scope && !one.acked) : undefined;
                    if (unconfirmed) {
                        this.guarded += 1;
                        return { data: { ok: false, reason: 'earlier', job: { id: unconfirmed.id, status: unconfirmed.status, state: this.stateOf(unconfirmed.status), attempt: unconfirmed.attempt } } };
                    }
                    this.reservations += 1;
                    this.jobs.set(key, { id: `job-${this.jobs.size + 1}`, status: this.status, title, ...(sent.brief ? { brief: sent.brief } : {}), ...(sent.writes === undefined ? {} : { writes: sent.writes }), ...(sent.plan ? { plan: sent.plan } : {}), scope, attempt: key, acked: !confirms });
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
        // a read by the key confirms the job it finds, as Orbit 6be29335 did (before the answer was sent: a lost answer confirmed it all the same)
        if (this.getConfirms && found && found.scope === `${path.split('/')[2] ?? ''}|${params?.userId}`) found.acked = true;
        if (this.loseNextGets > 0) {
            this.loseNextGets -= 1;
            throw Object.assign(new Error('timeout of 20000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' });
        }
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
        const context = { admin, botId: who.botId, userId: who.userId, startKeys: memory, startKeyStore: store };
        /** One reply of this server: what it names is confirmed once it is delivered (`deliver: false` is a reply that failed, was replaced or whose send failed: nothing is confirmed). */
        const reply = async (args: Record<string, unknown>, over: Record<string, unknown> = {}) => {
            const { deliver, ...rest } = over;
            const queue = new ConfirmationQueue();
            const answer = (await runComputerTool(args, { ...context, confirmations: queue, ...rest })) as Record<string, unknown>;
            if (deliver === false) queue.drop();
            else await queue.deliver();
            return answer;
        };
        return {
            memory,
            context,
            reply,
            ask: (title: string, over: Record<string, unknown> = {}) => reply({ job: title }, over),
        };
    };
    const COULD_NOT_CHECK = "I couldn't check whether this job has started. I'll use the same request when you check again.";
    const held = async (who: { botId: string; userId: string }) => JSON.parse((await client.get(startKeyNameOf(`${who.botId}|${who.userId}`))) ?? 'null') as { key: string; at: number; payload?: Record<string, unknown> } | null;

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

    it('reports a start nobody could resolve for an hour to Sentry once (no title, no words of anyone\'s), and still looks it up on every ask', async () => {
        vi.mocked(Sentry.captureMessage).mockClear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
        const who = ids();
        const orbit = new FakeOrbit();
        orbit.onPost = 'lose-after-commit';
        orbit.onGet = 'silent';
        const server = process_(orbit, who);
        await server.ask('Fill in my visa form');
        vi.setSystemTime(new Date('2026-11-22T10:59:00Z'));
        await server.ask('Fill in my visa form');
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
        vi.setSystemTime(new Date('2026-11-22T11:01:00Z'));
        await server.ask('Fill in my visa form');
        await server.ask('Fill in my visa form');
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls)).not.toMatch(/visa/i);
        expect(orbit.lookups).toHaveLength(4);
        vi.useRealTimers();
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

    describe('G63-1: the look-up of an EARLIER ask\'s start is said as that earlier job, never as the ask the person makes now', () => {
        for (const [found, says] of [['done', /the job you asked for earlier finished/], ['failed', /the job you asked for earlier has already ended/], ['running', /the job you asked for earlier was found/]] as const) {
            it(`the earlier start is ${found}: the note names the earlier job, says this ask was not started, never says this ask finished; asked again in the next message it gets a new key and starts`, async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onPost = 'lose-after-commit';
                orbit.onGet = 'silent';
                const server = process_(orbit, who);
                // 1. job A comes back unknown
                expect(await server.ask('Fill in my visa form')).toMatchObject({ started: false, unknown: true });
                const first = orbit.posts[0].key;
                // 2. a new message, a different job B; 3. the look-up finds A (done, ended or still going)
                forgetSettledStarts(server.memory);
                orbit.onGet = 'truth';
                orbit.status = found;
                for (const [, job] of orbit.jobs) job.status = found;
                orbit.posts = [];
                const answer = await server.ask('Book me a table for Friday');
                expect(orbit.posts).toEqual([]);
                expect(answer).toMatchObject({ started: false, earlier: true });
                const note = String(answer.note);
                expect(note).toMatch(says);
                expect(note).toContain('the job you asked for earlier');
                expect(note).toMatch(/something different now, say it was not started/);
                expect(note).toMatch(found === 'running' ? /once the earlier job is over/ : /in their next message/);
                // it never tells the person that THIS ask finished, or that Orbit found "this job"
                expect(note).not.toMatch(/found this job/i);
                expect(note).not.toMatch(/that your job finished/);
                expect(note).not.toMatch(/(?<!earlier )(?<!ask )\bis done\b/);
                if (found === 'running') return;
                // B asked in the next message: a new key, a new job, started
                forgetSettledStarts(server.memory);
                orbit.status = 'running';
                orbit.onPost = 'whole';
                const next = await server.ask('Book me a table for Friday');
                expect(next).toMatchObject({ started: true });
                expect(orbit.posts).toHaveLength(1);
                expect(orbit.posts[0].key).not.toBe(first);
                expect(orbit.posts[0].title).toBe('Book me a table for Friday');
                expect(orbit.jobs.size).toBe(2);
                expect(orbit.reservations).toBe(2);
            });
        }
    });

    for (const [name, replay] of [['different wording', 'Apply for the visa online'], ['the same wording', 'Fill in my visa form']] as const) {
        it(`PROOF R1 (GPT second note): a start is committed and its reply lost, the Redis open-start entry is gone (24 h life over), a fresh process replays with ${name}: the original job comes back, one reservation, nothing new made; a deliberate second job with the same title then has its own id`, async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'lose-after-commit';
            orbit.onGet = 'silent';
            const first = process_(orbit, who);
            expect(await first.ask('Fill in my visa form')).toMatchObject({ unknown: true });
            const original = orbit.posts[0].key;
            const originalJob = orbit.jobs.get(original)!;
            expect(originalJob.acked).toBe(false);
            // the 24 h life is over: the entry is gone from Redis; the process is a fresh one
            await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
            orbit.onPost = 'whole';
            orbit.onGet = 'truth';
            orbit.status = 'done';
            originalJob.status = 'done';
            orbit.posts = [];
            const fresh = process_(orbit, who);
            const answer = await fresh.ask(replay);
            // the original job and its result are what the person is told of; Orbit made nothing new (its guard answered the one start that went out) and was told the job was seen
            expect(answer).toMatchObject({ started: false, done: true, earlier: true });
            expect(String(answer.note)).toContain('the job you asked for earlier finished');
            expect(String(answer.note)).toContain('[Usage](#usage)');
            expect(orbit.posts.map((one) => (one.key === original ? 'original-key' : 'other-key'))).toEqual(['other-key']);
            expect(orbit.guarded).toBe(1);
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.reservations).toBe(1);
            expect(orbit.acks.map((one) => one.attempt)).toEqual([original]);
            expect(originalJob.acked).toBe(true);
            // nothing is kept for it: no record in Redis, and the chat's memory only remembers this turn's answer
            expect(await held(who)).toBeNull();
            // the same ask again in this turn is answered the same, with nothing sent
            orbit.posts = [];
            expect(await fresh.ask(replay)).toMatchObject({ done: true, earlier: true });
            expect(orbit.posts).toEqual([]);
            // a deliberate second job with the SAME title, in the person's next message: its own key, its own job, its own reservation
            forgetSettledStarts(fresh.memory);
            orbit.status = 'running';
            const second = await fresh.ask('Fill in my visa form');
            expect(second).toMatchObject({ started: true });
            expect(orbit.jobs.size).toBe(2);
            expect(orbit.reservations).toBe(2);
            expect(new Set([...orbit.jobs.values()].map((one) => one.id)).size).toBe(2);
            expect(orbit.posts).toHaveLength(1);
            expect(orbit.posts[0].key).not.toBe(original);
            expect(orbit.posts[0].title).toBe('Fill in my visa form');
        });
    }

    describe('R1 closing design (Opus): the words of a start go with its key, and a job the game never confirmed is found before anything else is made', () => {
        const SAID = { job: 'Fill in my visa form', details: 'Use the passport number from my notes', reads_only: true, app: 'Gmail', app_steps: 12 };
        const askWith = (server: ReturnType<typeof process_>, args: Record<string, unknown>) => server.reply(args);

        it('the record in Redis holds the key and the words that key said (title, details, writes, the way weighed), and nothing else', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await askWith(server, SAID);
            expect(await held(who)).toMatchObject({ key: orbit.posts[0].key, payload: { title: 'Fill in my visa form', brief: 'Use the passport number from my notes', writes: false, plan: { app: 'Gmail', steps: 12 } } });
            expect(Object.keys((await held(who))!.payload!).sort()).toEqual(['brief', 'plan', 'title', 'writes']);
            // the record's life is the safety life, and it goes when the outcome is final
            expect(await client.pTTL(startKeyNameOf(`${who.botId}|${who.userId}`))).toBeLessThanOrEqual(OPEN_START_KEEP_MS);
        });

        it('A\'s start never reached Orbit, the look-up finds no job, and the person asks something ELSE: the resend carries A\'s own title, details, writes and plan under A\'s key (B is never sent under it), and the answer is A\'s', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            expect(await askWith(server, SAID)).toMatchObject({ started: false, unknown: true });
            const key = orbit.posts[0].key;
            expect(orbit.jobs.size).toBe(0);
            // the chat moves on: a different ask in the next message, from a process that has only Redis (a restart)
            orbit.onPost = 'whole';
            orbit.posts = [];
            const restarted = process_(orbit, who);
            const answer = await askWith(restarted, { job: 'Book me a table for Friday', details: 'Four people, outside' });
            expect(orbit.posts).toHaveLength(1);
            expect(orbit.posts[0]).toMatchObject({ key, title: 'Fill in my visa form', brief: 'Use the passport number from my notes', writes: false, plan: { app: 'Gmail', steps: 12 } });
            expect(orbit.posts.some((one) => /table/i.test(one.title + (one.brief ?? '')))).toBe(false);
            expect(orbit.jobs.get(key)).toMatchObject({ title: 'Fill in my visa form', brief: 'Use the passport number from my notes' });
            expect(orbit.reservations).toBe(1);
            // told as the job asked for earlier, never as the new ask
            expect(answer).toMatchObject({ started: true, earlier: true });
            expect(String(answer.note)).toContain('the job they asked for earlier');
            expect(String(answer.note)).toMatch(/something different now, say it was not started/);
            expect(await held(who)).toBeNull();
        });

        it('CodeRabbit O1/#1: A is unknown and the next ask B resends A\'s words, which makes A\'s job: every other call of that reply (B reworded, B again, A again) is told of that job and sends nothing; the record goes once the reply is delivered; the next message starts a job of its own', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            expect(await askWith(server, SAID)).toMatchObject({ started: false, unknown: true });
            const key = orbit.posts[0].key;
            // the person's next message: the chat asks something else, in one reply with several calls
            forgetSettledStarts(server.memory);
            orbit.onPost = 'whole';
            orbit.posts = [];
            const queue = new ConfirmationQueue();
            const call = (args: Record<string, unknown>) => runComputerTool(args, { ...server.context, confirmations: queue }) as Promise<Record<string, unknown>>;
            const first = await call({ job: 'Book me a table for Friday' });
            expect(orbit.posts).toHaveLength(1);
            expect(orbit.posts[0].key).toBe(key);
            expect(first).toMatchObject({ started: true, earlier: true });
            const reworded = await call({ job: 'Reserve a table on Friday evening' });
            const again = await call({ job: 'Book me a table for Friday' });
            const visa = await call(SAID);
            for (const answer of [reworded, again, visa]) expect(answer).toMatchObject({ started: false, found: true, earlier: true });
            expect(orbit.posts).toHaveLength(1);
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.reservations).toBe(1);
            expect(orbit.acks).toEqual([]);
            expect(await held(who)).not.toBeNull();
            await queue.deliver();
            expect(orbit.acks).toHaveLength(1);
            expect(orbit.acks[0].attempt).toBe(key);
            expect(await held(who)).toBeNull();
            // a deliberate ask in the next message is a job of its own
            forgetSettledStarts(server.memory);
            expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: true });
            expect(orbit.jobs.size).toBe(2);
            expect(orbit.reservations).toBe(2);
        });

        it('CodeRabbit O1: the job the resend made is kept under the ask that SENT it: with the turn-wide answer gone, A asked again in the same turn goes under A\'s own key (the same job), never a new key and a second job', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await askWith(server, SAID);
            const key = orbit.posts[0].key;
            forgetSettledStarts(server.memory);
            orbit.onPost = 'whole';
            expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: true, earlier: true });
            // the resend was confirmed once its reply was delivered, so Orbit no longer guards: only A's own key keeps the second ask from being a second job
            expect(orbit.jobs.get(key)?.acked).toBe(true);
            server.memory.delete(FOUND_EARLIER_SLOT);
            orbit.posts = [];
            await askWith(server, SAID);
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.reservations).toBe(1);
            expect(orbit.posts.every((one) => one.key === key)).toBe(true);
        });

        it('the same, when the resend finds A\'s job already DONE: the later calls of the reply are told of it, and A asked again is not sent as a new job', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await askWith(server, SAID);
            const key = orbit.posts[0].key;
            forgetSettledStarts(server.memory);
            orbit.onPost = 'whole';
            orbit.status = 'done';
            orbit.posts = [];
            const first = await server.ask('Book me a table for Friday');
            expect(first).toMatchObject({ started: false, done: true, earlier: true });
            expect(await askWith(server, SAID)).toMatchObject({ done: true, earlier: true });
            expect(orbit.posts).toHaveLength(1);
            expect(orbit.posts[0].key).toBe(key);
            expect(orbit.jobs.size).toBe(1);
        });

        it('CodeRabbit #2: Orbit answers `earlier` and the record of the key that made nothing is still being deleted: an overlapping call of the reply (another title) is answered with the earlier job at once and goes nowhere near Orbit', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'lose-after-commit';
            orbit.onGet = 'silent';
            const before = process_(orbit, who);
            await before.ask('Fill in my visa form', { deliver: false });
            await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
            orbit.onPost = 'whole';
            orbit.onGet = 'truth';
            orbit.posts = [];
            const server = process_(orbit, who);
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            const real = RedisStartKeys.prototype.delete;
            let entered = 0;
            const spy = vi.spyOn(RedisStartKeys.prototype, 'delete').mockImplementation(async function (this: RedisStartKeys, scope: string, key: string) {
                entered += 1;
                await gate;
                return real.call(this, scope, key);
            });
            try {
                const queue = new ConfirmationQueue();
                const call = (job: string) => runComputerTool({ job }, { ...server.context, confirmations: queue }) as Promise<Record<string, unknown>>;
                const one = call('Book me a table for Friday');
                const end = Date.now() + 3000;
                while (entered === 0 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
                expect(entered).toBeGreaterThan(0);
                const posts = orbit.posts.length;
                const other = await call('Reserve a table on Friday evening');
                expect(other).toMatchObject({ started: false, earlier: true });
                expect(orbit.posts).toHaveLength(posts);
                release();
                expect(await one).toMatchObject({ started: false, earlier: true });
                expect(orbit.posts).toHaveLength(posts);
                expect(orbit.jobs.size).toBe(1);
                expect(orbit.reservations).toBe(1);
            } finally {
                release();
                spy.mockRestore();
            }
        });

        it('the same ask sent again unchanged is told as an ordinary start (nothing to say about an earlier job)', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await askWith(server, SAID);
            orbit.onPost = 'whole';
            const again = await askWith(server, SAID);
            expect(again).toMatchObject({ started: true });
            expect(again).not.toHaveProperty('earlier');
            expect(String(again.note)).not.toContain('earlier');
        });

        it('the same title with other details, or another way weighed, is a different ask: the resend carries the FIRST words and the answer is told as the earlier job\'s', async () => {
            for (const next of [{ ...SAID, details: 'Use the passport number from my other notes' }, { ...SAID, reads_only: false }, { ...SAID, app_steps: 40 }, { ...SAID, app: 'Outlook' }]) {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onPost = 'limiter-before-commit';
                orbit.onGet = 'none';
                const server = process_(orbit, who);
                await askWith(server, SAID);
                orbit.onPost = 'whole';
                orbit.posts = [];
                const answer = await askWith(server, next);
                expect(orbit.posts[0], JSON.stringify(next)).toMatchObject({ title: 'Fill in my visa form', brief: 'Use the passport number from my notes', writes: false, plan: { app: 'Gmail', steps: 12 } });
                expect(answer, JSON.stringify(next)).toMatchObject({ started: true, earlier: true });
            }
        });

        it('the chat the first ask came from goes with its words: the resend of an open start carries THAT chat as its origin, not the chat of the ask made now', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'limiter-before-commit';
            orbit.onGet = 'none';
            const server = process_(orbit, who);
            await server.ask('Fill in my visa form', { origin: { kind: 'dm', ref: '!room-a:example' } });
            orbit.onPost = 'whole';
            orbit.posts = [];
            const answer = await process_(orbit, who).ask('Book me a table for Friday', { origin: { kind: 'dm', ref: '!room-b:example' } });
            expect(orbit.posts[0]).toMatchObject({ title: 'Fill in my visa form', origin: { kind: 'dm', ref: '!room-a:example' } });
            expect(answer).toMatchObject({ started: true, earlier: true });
        });

        it('a confirmation that fails with an error of its own never breaks the answer to the person', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            const server = process_(orbit, who);
            const rejecting = { startComputerJob: server.context.admin.startComputerJob.bind(server.context.admin), ackComputerStart: vi.fn().mockRejectedValue(new Error('boom')) };
            const answer = await server.ask('Fill in my visa form', { admin: rejecting });
            expect(answer).toMatchObject({ started: true });
            expect(rejecting.ackComputerStart).toHaveBeenCalledTimes(1);
        });

        it('a confirmation that fails with an error of its own, when an earlier job was just found, never breaks the answer either', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onAck = 'lose';
            const server = process_(orbit, who);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            await server.ask('Fill in my visa form');
            forgetSettledStarts(server.memory);
            const rejecting = { startComputerJob: server.context.admin.startComputerJob.bind(server.context.admin), ackComputerStart: vi.fn().mockRejectedValue(new Error('boom')) };
            const answer = await server.ask('Book me a table for Friday', { admin: rejecting });
            expect(answer).toMatchObject({ started: false, earlier: true, found: true });
            expect(rejecting.ackComputerStart).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        for (const [how, fresh] of [
            ['Orbit answers `earlier` (the Redis entry was gone, a fresh process)', true],
            ['a look-up of the earlier send finds it', false],
        ] as const) {
            for (const found of ['done', 'failed', 'running'] as const) {
                it(`G66-1: ${how}, the job is ${found}: EVERY use_computer call in the same turn (a reworded one included) gets that answer and sends nothing; the next message starts a job of its own`, async () => {
                    const who = ids();
                    const orbit = new FakeOrbit();
                    orbit.onPost = 'lose-after-commit';
                    orbit.onGet = 'silent';
                    const before = process_(orbit, who);
                    await before.ask('Fill in my visa form');
                    const original = orbit.posts[0].key;
                    orbit.jobs.get(original)!.status = found;
                    forgetSettledStarts(before.memory);
                    orbit.onPost = 'whole';
                    orbit.onGet = 'truth';
                    if (fresh) await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
                    const server = fresh ? process_(orbit, who) : before;
                    orbit.posts = [];
                    const first = await server.ask('Book me a table for Friday');
                    expect(first).toMatchObject({ started: false, earlier: true });
                    const sentSoFar = orbit.posts.length;
                    // the model words the call again, and again with other words, in the same turn
                    const again = await server.ask('Reserve a table on Friday evening');
                    const third = await server.ask('Fill in my visa form');
                    expect(orbit.posts).toHaveLength(sentSoFar);
                    expect(orbit.jobs.size).toBe(1);
                    expect(orbit.reservations).toBe(1);
                    expect(again).toEqual(first);
                    expect(third).toEqual(first);
                    // the person's next message: a job of its own, with its own key (a job found LIVE by a look-up keeps its start open, as since v63: the next message is still that start, and nothing is sent)
                    forgetSettledStarts(server.memory);
                    orbit.status = 'running';
                    if (!fresh && found === 'running') {
                        expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: false, earlier: true, found: true });
                        expect(orbit.jobs.size).toBe(1);
                        return;
                    }
                    const next = await server.ask('Book me a table for Friday');
                    expect(next).toMatchObject({ started: true });
                    expect(orbit.jobs.size).toBe(2);
                    expect(orbit.reservations).toBe(2);
                    expect(orbit.posts[orbit.posts.length - 1].key).not.toBe(original);
                });
            }
        }

        describe('GPT third note, R1: a lost look-up reply and a look-up that no longer confirms', () => {
            // (On Orbit 6be29335 a read confirmed the job BEFORE it answered, so a lost read reply left a confirmed job the game never saw: two jobs. That was Orbit's to fix: its reads are
            // read-only now, which is what the double models; this was run red against that Orbit first.)
            for (const getConfirms of [false]) {
                it(`Orbit read-only reads: the start reply AND the later look-up reply are lost, Redis is evicted, a fresh process replays: job A, one reservation, truthful words; the deliberate second ask after resolution is B`, async () => {
                    const who = ids();
                    const orbit = new FakeOrbit();
                    orbit.getConfirms = getConfirms;
                    orbit.onPost = 'lose-after-commit';
                    orbit.onGet = 'truth';
                    orbit.loseNextGets = 1;
                    const first = process_(orbit, who);
                    expect(await first.ask('Fill in my visa form')).toMatchObject({ started: false, unknown: true });
                    const original = orbit.posts[0].key;
                    expect(orbit.lookups).toEqual([original]);
                    // the look-up itself confirmed nothing: the guard still stands for the job the game never learned of
                    expect(orbit.jobs.get(original)?.acked).toBe(false);
                    // and the game confirmed nothing either: it never held the result (the reply was lost)
                    expect(orbit.acks).toEqual([]);
                    // the record is gone (24 h life) and the process is a fresh one
                    await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
                    orbit.onPost = 'whole';
                    orbit.posts = [];
                    const fresh = process_(orbit, who);
                    const answer = await fresh.ask('Fill in my visa form');
                    expect([...orbit.jobs.values()].map((one) => one.id), 'jobs').toEqual(['job-1']);
                    expect(orbit.reservations, 'reservations').toBe(1);
                    expect(answer).toMatchObject({ started: false, earlier: true, found: true });
                    expect(orbit.jobs.get(original)?.acked).toBe(true);
                    // resolved: the deliberate second ask in the next message is B
                    forgetSettledStarts(fresh.memory);
                    orbit.jobs.get(original)!.status = 'done';
                    expect(await fresh.ask('Fill in my visa form')).toMatchObject({ started: true });
                    expect(orbit.reservations).toBe(2);
                    expect(orbit.jobs.size).toBe(2);
                });
            }

            for (const getConfirms of [false, true]) {
                it(`${getConfirms ? 'on Orbit 6be29335 (a read confirms)' : 'on a read-only Orbit'}: a look-up of an earlier send that FOUND its job is confirmed by the game (after it holds the result), so the deliberate second ask in the next message is B, not another \`earlier\``, async () => {
                    const who = ids();
                    const orbit = new FakeOrbit();
                    orbit.getConfirms = getConfirms;
                    orbit.onPost = 'lose-after-commit';
                    orbit.onGet = 'silent';
                    const server = process_(orbit, who);
                    await server.ask('Fill in my visa form');
                    const original = orbit.posts[0].key;
                    orbit.onGet = 'truth';
                    orbit.jobs.get(original)!.status = 'done';
                    forgetSettledStarts(server.memory);
                    orbit.onPost = 'whole';
                    orbit.posts = [];
                    expect(await server.ask('Fill in my visa form')).toMatchObject({ done: true, earlier: true });
                    expect(orbit.posts).toEqual([]);
                    expect(orbit.jobs.get(original)?.acked).toBe(true);
                    // the confirmation is the game's own explicit one (an Orbit whose read confirms would make `acked` true on its own, so this is what shows the game sent it): exactly one
                    expect(orbit.acks).toEqual([{ attempt: original, userId: who.userId }]);
                    forgetSettledStarts(server.memory);
                    expect(await server.ask('Fill in my visa form')).toMatchObject({ started: true });
                    expect(orbit.jobs.size).toBe(2);
                    expect(orbit.reservations).toBe(2);
                    expect(orbit.guarded).toBe(0);
                });
            }
        });

        describe('GPT third note, R1b (Opus): a confirmation is the game\'s own word, sent only once the reply that names the job has reached the person', () => {
            it('the tool never confirms while it runs: the answer names the job, 0 confirmations are sent and the record of its key is still in Redis until the reply is delivered; then exactly one confirmation per key and the record goes', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                const server = process_(orbit, who);
                const queue = new ConfirmationQueue();
                expect(await runComputerTool({ job: 'Fill in my visa form' }, { ...server.context, confirmations: queue })).toMatchObject({ started: true });
                expect(orbit.acks).toEqual([]);
                const key = orbit.posts[0].key;
                expect((await held(who))?.key).toBe(key);
                expect(orbit.jobs.get(key)?.acked).toBe(false);
                expect(queue.size).toBe(1);
                // the reply is handed to the chat
                await queue.deliver();
                expect(orbit.acks).toEqual([{ attempt: key, userId: who.userId }]);
                expect(orbit.jobs.get(key)?.acked).toBe(true);
                expect(await held(who)).toBeNull();
                // delivering again sends nothing again
                await queue.deliver();
                expect(orbit.acks).toHaveLength(1);
            });

            it('a reply that FAILS after the tool answered (the turn throws, is replaced, or its send fails): 0 confirmations, the record stays, and the next message, even reworded and from a fresh process, is told of the SAME job: no new job, no new reservation; once THAT reply is delivered the job is confirmed and a deliberate next ask is B', async () => {
                for (const how of ['dropped', 'process lost']) {
                    const who = ids();
                    const orbit = new FakeOrbit();
                    const first = process_(orbit, who);
                    if (how === 'dropped') expect(await first.ask('Fill in my visa form', { deliver: false })).toMatchObject({ started: true });
                    else expect(await runComputerTool({ job: 'Fill in my visa form' }, { ...first.context, confirmations: new ConfirmationQueue() })).toMatchObject({ started: true });
                    const original = orbit.posts[0].key;
                    expect(orbit.acks, how).toEqual([]);
                    expect((await held(who))?.key, how).toBe(original);
                    // the next message: another word, a fresh process
                    orbit.posts = [];
                    const next = process_(orbit, who);
                    const told = await next.ask('Apply for the visa online', { deliver: false });
                    expect(told, how).toMatchObject({ started: false, earlier: true });
                    expect(orbit.jobs.size, how).toBe(1);
                    expect(orbit.reservations, how).toBe(1);
                    expect(orbit.posts, how).toEqual([]);
                    expect(orbit.acks, how).toEqual([]);
                    expect((await held(who))?.key, how).toBe(original);
                    // this reply is delivered (the job has finished by now: a job still live keeps its start open, and its record, until it is over)
                    orbit.jobs.get(original)!.status = 'done';
                    const delivered = process_(orbit, who);
                    expect(await delivered.ask('Apply for the visa online')).toMatchObject({ started: false, done: true, earlier: true });
                    expect(orbit.acks, how).toEqual([{ attempt: original, userId: who.userId }]);
                    expect(await held(who), how).toBeNull();
                    // and the person's deliberate second ask in the next message: a job of its own
                    forgetSettledStarts(delivered.memory);
                    expect(await delivered.ask('Fill in my visa form')).toMatchObject({ started: true });
                    expect(orbit.jobs.size, how).toBe(2);
                    expect(orbit.reservations, how).toBe(2);
                }
            });

            it('GPT fourth note, R1b-2: every job named in a reply queues the fixed sentence that tells the person of it (what is sent when the reply has no words of its own), by what Orbit said of it', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                const server = process_(orbit, who);
                const queue = new ConfirmationQueue();
                await runComputerTool({ job: 'Fill in my visa form' }, { ...server.context, confirmations: queue });
                expect(queue.notes()).toEqual([{ state: 'started', earlier: false, title: 'Fill in my visa form' }]);
                expect(queue.notes().map(jobLine)).toEqual(['I\'m working on "Fill in my visa form" on my computer.']);
                // an earlier job Orbit names, done
                const lostOrbit = new FakeOrbit();
                lostOrbit.onPost = 'lose-after-commit';
                lostOrbit.onGet = 'silent';
                const other = ids();
                const before = process_(lostOrbit, other);
                await before.ask('Fill in my visa form', { deliver: false });
                lostOrbit.jobs.get(lostOrbit.posts[0].key)!.status = 'done';
                forgetSettledStarts(before.memory);
                lostOrbit.onGet = 'truth';
                lostOrbit.onPost = 'whole';
                const done = new ConfirmationQueue();
                await runComputerTool({ job: 'Book me a table for Friday' }, { ...before.context, confirmations: done });
                expect(done.notes()).toEqual([{ state: 'done', earlier: true, title: 'Fill in my visa form' }]);
                expect(done.notes().map(jobLine)).toEqual([jobLine({ state: 'done', earlier: true, title: 'Fill in my visa form' })]);
                await done.deliver();
                expect(done.notes()).toEqual([]);
                const none = new ConfirmationQueue();
                none.add('k', async () => undefined);
                expect(none.notes()).toEqual([]);
            });

            it('a job named twice in one reply (a reworded call, a retried call) is confirmed once', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onPost = 'lose-after-commit';
                orbit.onGet = 'silent';
                const server = process_(orbit, who);
                await server.ask('Fill in my visa form', { deliver: false });
                forgetSettledStarts(server.memory);
                orbit.onGet = 'truth';
                const queue = new ConfirmationQueue();
                await runComputerTool({ job: 'Book me a table for Friday' }, { ...server.context, confirmations: queue });
                await runComputerTool({ job: 'Reserve a table on Friday evening' }, { ...server.context, confirmations: queue });
                await runComputerTool({ job: 'Fill in my visa form' }, { ...server.context, confirmations: queue });
                expect(queue.size).toBe(1);
                await queue.deliver();
                expect(orbit.acks).toHaveLength(1);
            });

            it('two deliveries of one reply that overlap (the send is slow) send each confirmation once', async () => {
                const queue = new ConfirmationQueue();
                const sent: string[] = [];
                queue.add('a', async () => {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    sent.push('a');
                });
                await Promise.all([queue.deliver(), queue.deliver()]);
                expect(sent).toEqual(['a']);
            });

            it('a retried reply of the same turn (its first answer was replaced, a new queue) meets the job already found in this turn: it names it again and confirms it once THAT reply is delivered', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onPost = 'lose-after-commit';
                orbit.onGet = 'silent';
                const server = process_(orbit, who);
                await server.ask('Fill in my visa form', { deliver: false });
                const original = orbit.posts[0].key;
                orbit.jobs.get(original)!.status = 'done';
                forgetSettledStarts(server.memory);
                orbit.onPost = 'whole';
                orbit.onGet = 'truth';
                const first = await server.ask('Book me a table for Friday', { deliver: false });
                expect(first).toMatchObject({ started: false, earlier: true });
                expect(orbit.acks).toEqual([]);
                const retried = await server.ask('Reserve a table on Friday evening');
                expect(retried).toEqual(first);
                expect(orbit.acks).toHaveLength(1);
                expect(orbit.jobs.size).toBe(1);
                expect(orbit.reservations).toBe(1);
            });

            it('the same title asked again with a new queue after the turn-wide answer is gone still names the job found for it and confirms it once delivered', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onPost = 'lose-after-commit';
                orbit.onGet = 'silent';
                const server = process_(orbit, who);
                await server.ask('Fill in my visa form', { deliver: false });
                orbit.jobs.get(orbit.posts[0].key)!.status = 'done';
                forgetSettledStarts(server.memory);
                orbit.onPost = 'whole';
                orbit.onGet = 'truth';
                // Orbit itself names the earlier job (the Redis record is gone, a fresh process)
                await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
                const fresh = process_(orbit, who);
                const first = await fresh.ask('Book me a table for Friday', { deliver: false });
                expect(first).toMatchObject({ started: false, earlier: true });
                fresh.memory.delete(FOUND_EARLIER_SLOT);
                const posts = orbit.posts.length;
                const again = await fresh.ask('Book me a table for Friday');
                expect(again).toEqual(first);
                expect(orbit.posts).toHaveLength(posts);
                expect(orbit.acks).toHaveLength(1);
                expect(orbit.jobs.size).toBe(1);
            });

            it('a confirmation that throws, or is added after the reply was delivered or dropped, changes nothing for the others', async () => {
                const queue = new ConfirmationQueue();
                const sent: string[] = [];
                queue.add('a', async () => {
                    throw new Error('boom');
                });
                queue.add('b', async () => void sent.push('b'));
                await queue.deliver();
                expect(sent).toEqual(['b']);
                queue.add('c', async () => void sent.push('c'));
                await queue.deliver();
                expect(sent).toEqual(['b']);
                const dropped = new ConfirmationQueue();
                dropped.add('d', async () => void sent.push('d'));
                dropped.drop();
                // an answer that names a job after the reply was dropped adds nothing either
                dropped.add('e', async () => void sent.push('e'));
                await dropped.deliver();
                expect(sent).toEqual(['b']);
            });

            it('a tool call with no queue at all (no reply to wait for) confirms nothing and leaves the record', async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                const server = process_(orbit, who);
                await runComputerTool({ job: 'Fill in my visa form' }, server.context);
                expect(orbit.acks).toEqual([]);
                expect((await held(who))?.key).toBe(orbit.posts[0].key);
            });
        });

        for (const [name, record] of [
            ['holds no words (a record from before)', (key: string) => ({ key, at: Date.now() - 5000 })],
            ['holds damaged words', (key: string) => ({ key, at: Date.now() - 5000, payload: { title: 5, brief: { a: 1 } } })],
            ['holds words that are not the shape the game sends', (key: string) => ({ key, at: Date.now() - 5000, payload: { title: '', plan: 'x' } })],
        ] as const) {
            it(`a record that ${name}: its key is only looked up, NOTHING is ever sent under it (not the new ask's words either), and the person is told it could not be checked`, async () => {
                const who = ids();
                const orbit = new FakeOrbit();
                orbit.onGet = 'none';
                const key = `kept-${randomUUID().slice(0, 12)}`;
                await client.set(startKeyNameOf(`${who.botId}|${who.userId}`), JSON.stringify(record(key)), { PX: 60_000 });
                const fresh = process_(orbit, who);
                const answer = await fresh.ask('Book me a table for Friday');
                expect(orbit.posts).toEqual([]);
                expect(orbit.lookups).toEqual([key]);
                expect(answer).toMatchObject({ started: false, unknown: true });
                expect(String(answer.note)).toContain(COULD_NOT_CHECK);
                expect(orbit.jobs.size).toBe(0);
                // it stays: still looked up on the next ask, and when Orbit can say, that job is the answer
                expect((await held(who))?.key).toBe(key);
                orbit.onGet = 'truth';
                orbit.jobs.set(key, { id: 'job-held', status: 'running', title: 'earlier words', scope: `${who.botId}|${who.userId}`, attempt: key, acked: false });
                const found = await fresh.ask('Book me a table for Friday');
                expect(found).toMatchObject({ started: false, found: true, earlier: true });
                expect(orbit.posts).toEqual([]);
            });
        }

        it('EVERY start says it confirms (the header), a start that Orbit names a job for is confirmed to Orbit once, and a refusal, an unknown outcome or a lost answer is confirmed for nothing', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            const server = process_(orbit, who);
            await server.ask('Fill in my visa form');
            expect(orbit.posts.every((one) => one.confirms)).toBe(true);
            expect(orbit.acks).toEqual([{ attempt: orbit.posts[0].key, userId: who.userId }]);
            expect(orbit.jobs.get(orbit.posts[0].key)?.acked).toBe(true);
            for (const mode of ['refuse-200', 'limiter-before-commit'] as const) {
                const other = ids();
                const quiet = new FakeOrbit();
                quiet.onPost = mode;
                quiet.onGet = 'none';
                await process_(quiet, other).ask('Fill in my visa form');
                expect(quiet.acks, mode).toEqual([]);
            }
            // a start whose answer was lost and then found by its key is confirmed by that read itself (the game sends no second request for it)
            const lost = new FakeOrbit();
            lost.onPost = 'lose-after-commit';
            lost.onGet = 'truth';
            const third = ids();
            await process_(lost, third).ask('Fill in my visa form');
            expect(lost.jobs.get(lost.posts[0].key)?.acked).toBe(true);
        });

        it('a confirmation that is lost (and one Orbit cannot take): the ask is answered as ever; the next start meets the job once, is told of it, and confirms it again; only then is a new job made', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onAck = 'lose';
            const server = process_(orbit, who);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            expect(await server.ask('Fill in my visa form')).toMatchObject({ started: true });
            const original = orbit.posts[0].key;
            expect(orbit.jobs.get(original)?.acked).toBe(false);
            // the person's next message asks for something else: Orbit names A, the confirmation is lost again, so A still stands in the way
            forgetSettledStarts(server.memory);
            const second = await server.ask('Book me a table for Friday');
            expect(second).toMatchObject({ started: false, earlier: true, found: true });
            expect(orbit.jobs.size).toBe(1);
            forgetSettledStarts(server.memory);
            expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: false, earlier: true });
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.guarded).toBe(2);
            // the confirmation arrives: the next ask starts
            orbit.onAck = 'ok';
            forgetSettledStarts(server.memory);
            expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: false, earlier: true });
            forgetSettledStarts(server.memory);
            expect(await server.ask('Book me a table for Friday')).toMatchObject({ started: true });
            expect(orbit.jobs.size).toBe(2);
            expect(orbit.reservations).toBe(2);
            warn.mockRestore();
        });

        it('two starts of one person and Brick with keys of their own, made at the same moment while an unconfirmed job stands: both are answered `earlier`, neither makes a job', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            orbit.onPost = 'lose-after-commit';
            orbit.onGet = 'silent';
            await process_(orbit, who).ask('Fill in my visa form');
            const original = orbit.posts[0].key;
            await client.del(startKeyNameOf(`${who.botId}|${who.userId}`));
            orbit.onPost = 'whole';
            orbit.posts = [];
            // two servers that share no record (each with the store it cannot reach: ONE machine each)
            const alone = { claim: async () => undefined, delete: async () => undefined, expected: () => false };
            const answers = await Promise.all([process_(orbit, who).ask('Book me a table for Friday', { startKeyStore: alone }), process_(orbit, who).ask('Send my report to Sam', { startKeyStore: alone })]);
            expect(answers.map((one) => one.earlier)).toEqual([true, true]);
            expect(orbit.guarded).toBe(2);
            expect(orbit.jobs.size).toBe(1);
            expect(orbit.reservations).toBe(1);
            expect(orbit.acks.every((one) => one.attempt === original)).toBe(true);
        });

        it('an Orbit answer of `earlier` that names no job of a key the game can use is read as an answer that said nothing: the key of the start is looked up, never a second start made', async () => {
            const who = ids();
            const orbit = new FakeOrbit();
            const garbled = vi.fn(orbit.call);
            (orbit as unknown as { call: unknown }).call = async (method: string, path: string, body?: unknown, params?: Record<string, string>, t?: number, headers?: Record<string, string>) => {
                if (method === 'post' && !(body as { action?: string }).action) {
                    orbit.posts.push({ key: headers?.['X-Computer-Start-Attempt'] ?? '', title: (body as { title: string }).title, confirms: true });
                    return { data: { ok: false, reason: 'earlier', job: { id: 'job-x', status: 'running', attempt: 'bad key!' } } };
                }
                return garbled(method, path, body, params, t, headers);
            };
            const server = process_(orbit, who);
            const answer = await server.ask('Fill in my visa form');
            expect(answer).toMatchObject({ started: false, unknown: true });
            expect(orbit.lookups).toEqual([orbit.posts[0].key]);
            expect(orbit.acks).toEqual([]);
        });
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
