import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runComputerTool, OPEN_START_KEEP_MS } from '../ai/ComputerTools';
import { RedisStartKeys, startKeyNameOf } from '../server/ComputerStartKeys';

/**
 * The two scripts of the start key store (claim and delete) against a real Redis (the unit tests run their meaning in JavaScript, so a change to the Lua would not show there). Runs
 * when BOTS_TEST_REDIS_URL is given and is skipped when there is none; CI sets BOTS_REQUIRE_REDIS, and there a missing Redis fails the run. Every scope is new for each run
 * and deleted at the end: nothing else in the database is touched.
 */
const REAL_REDIS = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(process.env.BOTS_REQUIRE_REDIS === '1' && !REAL_REDIS)('the real Redis for the start key tests', () => {
    it('is given when the run requires it (CI): the start keys are never left untested', () => {
        expect(REAL_REDIS, 'BOTS_TEST_REDIS_URL is not set while BOTS_REQUIRE_REDIS=1').toBeTruthy();
    });
});
describe.skipIf(!REAL_REDIS)('the start key of a computer job, on a real Redis (the scripts themselves)', () => {
    let client!: ReturnType<typeof createClient>;
    let opened = false;
    const run = randomUUID();
    const scopes: string[] = [];
    const scope = (name: string) => {
        const one = `${name}-${run}`;
        scopes.push(one);
        return one;
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

    const LIFE = OPEN_START_KEEP_MS;

    it('keeps the key and the moment it was first sent, with the life asked for, and answers the entry it holds', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('keeps');
        const at = Date.now();
        expect(await store.claim(s, { key: 'a-start-key-0001', at }, LIFE, LIFE)).toEqual({ key: 'a-start-key-0001', at });
        const life = await client.pTTL(startKeyNameOf(s));
        expect(life).toBeGreaterThan(LIFE - 10_000);
        expect(life).toBeLessThanOrEqual(LIFE);
        expect(JSON.parse((await client.get(startKeyNameOf(s))) ?? 'null')).toEqual({ key: 'a-start-key-0001', at });
    });

    it('answers the FIRST key to every later ask while it is good, keeps its life as it was (never a new safety life), and leaves the entry as it is', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('first');
        const at = Date.now();
        await store.claim(s, { key: 'first-key-00001', at }, 120_000, LIFE);
        const before = await client.get(startKeyNameOf(s));
        expect(await store.claim(s, { key: 'second-key-0002', at: at + 1 }, LIFE, LIFE)).toEqual({ key: 'first-key-00001', at });
        expect(await client.get(startKeyNameOf(s))).toBe(before);
        expect(await client.pTTL(startKeyNameOf(s))).toBeLessThanOrEqual(120_000);
    });

    it('takes the caller\'s key over an entry whose first send is older than the life given (the store has not expired it yet), and over a value that is not an entry', async () => {
        const store = new RedisStartKeys(() => client as never);
        const old = scope('old');
        const at = Date.now();
        await client.set(startKeyNameOf(old), JSON.stringify({ key: 'old-key-0000001', at: at - LIFE - 5000 }), { PX: 60_000 });
        expect(await store.claim(old, { key: 'new-key-0000001', at }, LIFE, LIFE)).toEqual({ key: 'new-key-0000001', at });
        const foreign = scope('foreign-claim');
        await client.set(startKeyNameOf(foreign), 'not json', { PX: 60_000 });
        expect(await store.claim(foreign, { key: 'new-key-0000002', at }, LIFE, LIFE)).toEqual({ key: 'new-key-0000002', at });
        // an entry of the right shape with the wrong types is not one either
        const odd = scope('odd');
        await client.set(startKeyNameOf(odd), JSON.stringify({ key: 7, at: 'x' }), { PX: 60_000 });
        expect(await store.claim(odd, { key: 'new-key-0000003', at }, LIFE, LIFE)).toEqual({ key: 'new-key-0000003', at });
    });

    it('lets the key go by itself when its life is over (the life the claim set, never one the test sets)', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('expires');
        await store.claim(s, { key: 'a-start-key-0001', at: Date.now() }, 1, LIFE);
        // the claim sets the life (at least a second): it is there, and it is the one asked for
        const life = await client.pTTL(startKeyNameOf(s));
        expect(life).toBeGreaterThan(0);
        expect(life).toBeLessThanOrEqual(1000);
        await new Promise((resolve) => setTimeout(resolve, life + 150));
        expect(await client.get(startKeyNameOf(s))).toBeNull();
    });

    it('replaces an entry whose key is not of the shape Orbit takes, in the claim itself, and answers the caller\'s key: a held key is returned only when it can be sent (8 to 64 of letters, digits, _ and -)', async () => {
        const store = new RedisStartKeys(() => client as never);
        const at = Date.now();
        const bad: Array<[string, string]> = [
            ['empty', ''],
            ['short', 'abc1234'],
            ['long', 'k'.repeat(65)],
            ['space', 'has a space-01'],
            ['dot', 'has.dot.in.it-1'],
            ['newline', 'line-one\nline-two'],
            ['slash', 'a/b/c/d/e/f/g/h'],
            ['quote', 'quote"key-000001'],
        ];
        for (const [name, key] of bad) {
            const s = scope(`bad-${name}`);
            await client.set(startKeyNameOf(s), JSON.stringify({ key, at }), { PX: 60_000 });
            expect(await store.claim(s, { key: 'caller-key-00001', at }, LIFE, LIFE), name).toEqual({ key: 'caller-key-00001', at });
            expect(JSON.parse((await client.get(startKeyNameOf(s))) ?? 'null'), name).toEqual({ key: 'caller-key-00001', at });
        }
        // the shape is checked by the script itself: the raw answer of the script is never a bad key
        const raw = scope('bad-raw');
        await client.set(startKeyNameOf(raw), JSON.stringify({ key: 'has a space-01', at }), { PX: 60_000 });
        const { CLAIM_START_KEY } = await import('../server/ComputerStartKeys');
        const answer = await client.eval(CLAIM_START_KEY, { keys: [startKeyNameOf(raw)], arguments: [JSON.stringify({ key: 'caller-key-00002', at }), '60000', String(at - LIFE)] });
        expect(JSON.parse(String(answer)).key).toBe('caller-key-00002');
    });

    it('leaves a held entry whose key is of the shape alone, at both ends of it (8 and 64 characters, with _ and -)', async () => {
        const store = new RedisStartKeys(() => client as never);
        const at = Date.now();
        for (const [name, key] of [['eight', 'a_b-1234'], ['sixty-four', `A${'z9_-'.repeat(15)}kkk`]] as const) {
            expect(key.length === 8 || key.length === 64, name).toBe(true);
            const s = scope(`good-${name}`);
            await client.set(startKeyNameOf(s), JSON.stringify({ key, at: at - 1000 }), { PX: 60_000 });
            expect(await store.claim(s, { key: 'caller-key-00001', at }, LIFE, LIFE), name).toEqual({ key, at: at - 1000 });
            expect(JSON.parse((await client.get(startKeyNameOf(s))) ?? 'null'), name).toEqual({ key, at: at - 1000 });
        }
    });

    it('two servers asking at the same moment with nothing held agree on ONE key (many at once, each with a key of its own)', async () => {
        const a = new RedisStartKeys(() => client as never);
        const b = new RedisStartKeys(() => client as never);
        const s = scope('race');
        const at = Date.now();
        const answers = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? a : b).claim(s, { key: `racer-key-${String(index).padStart(4, '0')}`, at: at + index }, LIFE, LIFE)));
        expect(new Set(answers.map((one) => one?.key)).size).toBe(1);
        const held = JSON.parse((await client.get(startKeyNameOf(s))) ?? 'null') as { key: string };
        expect(answers[0]?.key).toBe(held.key);
    });

    it('two servers handling the same ask at the same moment (empty memory on both) send the SAME X-Computer-Start-Attempt: one job, never two', async () => {
        const s = 'brick-race';
        // a record a run that was cut short left in a shared Redis must not decide this one
        await client.del(startKeyNameOf('brick-race|uuid-race'));
        const ask = () => {
            const sent: string[] = [];
            const admin = {
                startComputerJob: vi.fn(async (_bot: string, _user: string, body: { startKey: string }) => {
                    sent.push(body.startKey);
                    return { ok: false, reason: 'unknown' };
                }),
            };
            const store = new RedisStartKeys(() => client as never);
            return { sent, run: () => runComputerTool({ job: `Race ${s} ${run}` }, { admin: admin as never, botId: 'brick-race', userId: 'uuid-race', startKeys: new Map(), startKeyStore: store }) };
        };
        const servers = Array.from({ length: 6 }, ask);
        await Promise.all(servers.map((one) => one.run()));
        const keys = servers.flatMap((one) => one.sent);
        expect(keys).toHaveLength(6);
        expect(new Set(keys).size).toBe(1);
        // tidy: the scope this test made (its name is a hash of the Brick and person)
        const name = startKeyNameOf('brick-race|uuid-race');
        expect(JSON.parse((await client.get(name)) ?? 'null')).toMatchObject({ key: keys[0] });
        await client.del(name);
    });

    it('a new ask racing a stored one between a read and a write has no gap: the stored key is the one sent, after a restart too (a fresh memory)', async () => {
        const store = new RedisStartKeys(() => client as never);
        const job = `Stored ${run}`;
        const sent: string[] = [];
        const admin = {
            startComputerJob: vi.fn(async (_bot: string, _user: string, body: { startKey: string }) => {
                sent.push(body.startKey);
                return { ok: false, reason: 'starting' };
            }),
        };
        const ask = () => runComputerTool({ job }, { admin: admin as never, botId: 'brick-stored', userId: 'uuid-stored', startKeys: new Map(), startKeyStore: store });
        await ask();
        await Promise.all([ask(), ask(), ask()]);
        expect(new Set(sent).size).toBe(1);
        await client.del(startKeyNameOf('brick-stored|uuid-stored'));
    });

    it('deletes only the key it is told: the key of an ask that started again since stays, and a missing key is nothing', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('delete');
        await store.claim(s, { key: 'the-first-key-01', at: Date.now() }, LIFE, LIFE);
        await store.delete(s, 'another-key-0002');
        expect(JSON.parse((await client.get(startKeyNameOf(s))) ?? 'null')).toMatchObject({ key: 'the-first-key-01' });
        await store.delete(s, 'the-first-key-01');
        expect(await client.get(startKeyNameOf(s))).toBeNull();
        await store.delete(s, 'the-first-key-01');
    });

    it('leaves a value that is not JSON alone when deleting (and does not throw): it is not ours to delete', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('foreign');
        await client.set(startKeyNameOf(s), 'not json', { PX: 60_000 });
        await store.delete(s, 'the-first-key-01');
        expect(await client.get(startKeyNameOf(s))).toBe('not json');
    });

    it('is a different entry for a different scope', async () => {
        const store = new RedisStartKeys(() => client as never);
        const a = scope('a');
        const b = scope('b');
        await store.claim(a, { key: 'key-for-a-00001', at: Date.now() }, 60_000, LIFE);
        await store.claim(b, { key: 'key-for-b-00001', at: Date.now() }, 60_000, LIFE);
        expect((await store.claim(a, { key: 'other-key-00001', at: Date.now() }, LIFE, LIFE))?.key).toBe('key-for-a-00001');
        expect((await store.claim(b, { key: 'other-key-00002', at: Date.now() }, LIFE, LIFE))?.key).toBe('key-for-b-00001');
    });
});
