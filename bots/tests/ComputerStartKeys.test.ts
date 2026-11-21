import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE_START_KEY, RedisStartKeys, SET_START_KEY, START_KEY_PREFIX, startKeyNameOf } from '../server/ComputerStartKeys';
import type { EvidenceRedis } from '../server/ComputerEvidenceStore';

/**
 * The place a computer job's start key waits while its outcome is open (Opus ruling on GPT round 3, finding 3): what it asks of the shared store, and that no failure of
 * the store ever reaches a tool call. The scripts themselves run on a real Redis in ComputerStartKeys.redis.test.ts.
 */
afterEach(() => vi.useRealTimers());

/** A store that holds what the scripts below write, by running their meaning in JavaScript. */
function fakeRedis(over: Partial<EvidenceRedis> = {}) {
    const held = new Map<string, { value: string; px: number }>();
    const evalCalls: { script: string; keys: string[]; args: string[] }[] = [];
    const redis = {
        eval: vi.fn(async (script: string, options: { keys: string[]; arguments: string[] }) => {
            evalCalls.push({ script, keys: options.keys, args: options.arguments });
            if (script === SET_START_KEY) {
                held.set(options.keys[0], { value: options.arguments[0], px: Number(options.arguments[1]) });
                return 1;
            }
            if (script === DELETE_START_KEY) {
                const entry = held.get(options.keys[0]);
                if (entry && (JSON.parse(entry.value) as { key: string }).key === options.arguments[0]) {
                    held.delete(options.keys[0]);
                    return 1;
                }
                return 0;
            }
            return held.get(options.keys[0])?.value ?? null;
        }),
        ...over,
    } as unknown as EvidenceRedis;
    return { redis, held, evalCalls };
}

describe('the start key store', () => {
    it('keeps the key under a name that is a hash of the scope: no title, chat or person is in a key name or a value', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        const scope = 'brick-1|uuid-alice|["dm","!room:chat.test","visa form"]';
        await store.set(scope, { key: 'a-start-key-0001', at: 1700000000000 }, 600_000);
        const [[name, entry]] = [...held.entries()];
        expect(name).toBe(startKeyNameOf(scope));
        expect(name).toMatch(new RegExp(`^${START_KEY_PREFIX}[0-9a-f]{40}$`));
        expect(name).not.toMatch(/visa|alice|room|brick/i);
        expect(JSON.parse(entry.value)).toEqual({ key: 'a-start-key-0001', at: 1700000000000 });
        expect(entry.value).not.toMatch(/visa|alice|room|brick/i);
        expect(entry.px).toBe(600_000);
        expect(await store.get(scope)).toEqual({ key: 'a-start-key-0001', at: 1700000000000 });
        // another scope is another name
        expect(startKeyNameOf(`${scope}x`)).not.toBe(name);
        expect(await store.get(`${scope}x`)).toBeUndefined();
    });

    it('keeps it for at least a second, and rounds a fraction of a millisecond', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        await store.set('s1', { key: 'a-start-key-0001', at: 1 }, 12);
        await store.set('s2', { key: 'a-start-key-0001', at: 1 }, 5000.6);
        expect([...held.values()].map((entry) => entry.px)).toEqual([1000, 5001]);
    });

    it('takes a key back only while it holds exactly that key: an ask that started again since (another key) stays', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        await store.set('s', { key: 'the-first-key-01', at: 1 }, 600_000);
        await store.delete('s', 'another-key-0002');
        expect(held.size).toBe(1);
        await store.delete('s', 'the-first-key-01');
        expect(held.size).toBe(0);
        await store.delete('s', 'the-first-key-01');
    });

    it('reads only an entry of the shape it wrote: another key shape, a moment that is not a number, or something that is not JSON is nothing', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        const put = (value: string) => held.set(startKeyNameOf('s'), { value, px: 1000 });
        for (const bad of ['not json', 'null', '"text"', '7', '{}', JSON.stringify({ key: 'short', at: 1 }), JSON.stringify({ key: 'has space in it!!', at: 1 }), JSON.stringify({ key: 'x'.repeat(65), at: 1 }), JSON.stringify({ key: 'a-start-key-0001', at: '1' }), JSON.stringify({ key: 'a-start-key-0001' }), JSON.stringify({ key: 7, at: 1 }), '{"key":"a-start-key-0001","at":1e999}']) {
            put(bad);
            expect(await store.get('s'), bad).toBeUndefined();
        }
        put(JSON.stringify({ key: 'a-start-key-0001', at: 5, title: 'Visa form', extra: true }));
        expect(await store.get('s')).toEqual({ key: 'a-start-key-0001', at: 5 });
    });

    it('never throws: no store connected, a failing store and a store gone silent are all "nothing held" and "nothing kept"', async () => {
        const none = new RedisStartKeys(() => null);
        expect(await none.get('s')).toBeUndefined();
        await expect(none.set('s', { key: 'a-start-key-0001', at: 1 }, 1000)).resolves.toBeUndefined();
        await expect(none.delete('s', 'a-start-key-0001')).resolves.toBeUndefined();

        const broken = new RedisStartKeys(() => fakeRedis({ eval: vi.fn().mockRejectedValue(new Error('down')) }).redis);
        expect(await broken.get('s')).toBeUndefined();
        await expect(broken.set('s', { key: 'a-start-key-0001', at: 1 }, 1000)).resolves.toBeUndefined();
        await expect(broken.delete('s', 'a-start-key-0001')).resolves.toBeUndefined();

        vi.useFakeTimers();
        const silent = new RedisStartKeys(() => fakeRedis({ eval: vi.fn(() => new Promise(() => undefined)) }).redis, 1000);
        const results = Promise.all([silent.get('s'), silent.set('s', { key: 'a-start-key-0001', at: 1 }, 1000), silent.delete('s', 'a-start-key-0001')]);
        await vi.advanceTimersByTimeAsync(1001);
        expect(await results).toEqual([undefined, undefined, undefined]);
    });

    it('asks the store for its client at every call: a store that reconnects is used again', async () => {
        const { redis, held } = fakeRedis();
        let client: EvidenceRedis | null = null;
        const store = new RedisStartKeys(() => client);
        await store.set('s', { key: 'a-start-key-0001', at: 1 }, 1000);
        expect(held.size).toBe(0);
        client = redis;
        await store.set('s', { key: 'a-start-key-0001', at: 1 }, 1000);
        expect(held.size).toBe(1);
    });
});
