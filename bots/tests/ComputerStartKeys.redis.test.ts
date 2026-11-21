import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisStartKeys, startKeyNameOf } from '../server/ComputerStartKeys';

/**
 * The two scripts of the start key store against a real Redis (the unit tests run their meaning in JavaScript, so a change to the Lua would not show there). Runs
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

    it('keeps the key and the moment it was first sent, with a life that is what was asked for, and reads them back', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('keeps');
        await store.set(s, { key: 'a-start-key-0001', at: 1700000000000 }, 600_000);
        expect(await store.get(s)).toEqual({ key: 'a-start-key-0001', at: 1700000000000 });
        const life = await client.pTTL(startKeyNameOf(s));
        expect(life).toBeGreaterThan(590_000);
        expect(life).toBeLessThanOrEqual(600_000);
        // a second set (the same ask sent again) keeps the first moment it is given and takes the new, shorter life
        await store.set(s, { key: 'a-start-key-0001', at: 1700000000000 }, 120_000);
        expect(await client.pTTL(startKeyNameOf(s))).toBeLessThanOrEqual(120_000);
    });

    it('lets the key go by itself when its life is over', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('expires');
        await store.set(s, { key: 'a-start-key-0001', at: 1 }, 1);
        expect(await client.pTTL(startKeyNameOf(s))).toBeLessThanOrEqual(1000);
        await client.pExpire(startKeyNameOf(s), 30);
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(await store.get(s)).toBeUndefined();
    });

    it('deletes only the key it is told: the key of an ask that started again since stays, and a missing key is nothing', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('delete');
        await store.set(s, { key: 'the-first-key-01', at: 1 }, 600_000);
        await store.delete(s, 'another-key-0002');
        expect(await store.get(s)).toEqual({ key: 'the-first-key-01', at: 1 });
        await store.delete(s, 'the-first-key-01');
        expect(await store.get(s)).toBeUndefined();
        await store.delete(s, 'the-first-key-01');
    });

    it('leaves a value that is not JSON alone (and does not throw): it is not ours to delete', async () => {
        const store = new RedisStartKeys(() => client as never);
        const s = scope('foreign');
        await client.set(startKeyNameOf(s), 'not json', { PX: 60_000 });
        await store.delete(s, 'the-first-key-01');
        expect(await client.get(startKeyNameOf(s))).toBe('not json');
        expect(await store.get(s)).toBeUndefined();
    });

    it('is a different entry for a different scope', async () => {
        const store = new RedisStartKeys(() => client as never);
        const a = scope('a');
        const b = scope('b');
        await store.set(a, { key: 'key-for-a-00001', at: 1 }, 60_000);
        await store.set(b, { key: 'key-for-b-00001', at: 2 }, 60_000);
        expect((await store.get(a))?.key).toBe('key-for-a-00001');
        expect((await store.get(b))?.key).toBe('key-for-b-00001');
    });
});
