import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_START_KEY, DELETE_START_KEY, RedisStartKeys, START_KEY_PREFIX, startKeyNameOf, wireComputerStartKeys, type StartKeyStore } from '../server/ComputerStartKeys';
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
            if (script === CLAIM_START_KEY) {
                const old = held.get(options.keys[0]);
                if (old) {
                    try {
                        const entry = JSON.parse(old.value) as { key?: unknown; at?: unknown };
                        if (typeof entry.key === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(entry.key) && typeof entry.at === 'number' && entry.at >= Number(options.arguments[2])) return old.value;
                    } catch {
                        /* not an entry: written over */
                    }
                }
                held.set(options.keys[0], { value: options.arguments[0], px: Number(options.arguments[1]) });
                return options.arguments[0];
            }
            if (script === DELETE_START_KEY) {
                const entry = held.get(options.keys[0]);
                if (entry && (JSON.parse(entry.value) as { key: string }).key === options.arguments[0]) {
                    held.delete(options.keys[0]);
                    return 1;
                }
                return 0;
            }
            return null;
        }),
        ...over,
    } as unknown as EvidenceRedis;
    return { redis, held, evalCalls };
}

const LIFE = 600_000;
describe('the start key store', () => {
    it('keeps the key under a name that is a hash of the scope: no title, chat or person is in a key name or a value, and answers the key it holds', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        const scope = 'brick-1|uuid-alice|["dm","!room:chat.test","visa form"]';
        const at = Date.now();
        expect(await store.claim(scope, { key: 'a-start-key-0001', at }, LIFE, LIFE)).toEqual({ key: 'a-start-key-0001', at });
        const [[name, entry]] = [...held.entries()];
        expect(name).toBe(startKeyNameOf(scope));
        expect(name).toMatch(new RegExp(`^${START_KEY_PREFIX}[0-9a-f]{40}$`));
        expect(name).not.toMatch(/visa|alice|room|brick/i);
        expect(JSON.parse(entry.value)).toEqual({ key: 'a-start-key-0001', at });
        expect(entry.value).not.toMatch(/visa|alice|room|brick/i);
        expect(entry.px).toBe(LIFE);
        // another scope is another name
        expect(startKeyNameOf(`${scope}x`)).not.toBe(name);
    });

    it('answers the key already held, never the caller\'s own, while the held one is still good: the first key of an ask wins', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        const at = Date.now();
        expect(await store.claim('s', { key: 'first-key-00001', at }, LIFE, LIFE)).toEqual({ key: 'first-key-00001', at });
        expect(await store.claim('s', { key: 'second-key-0002', at: at + 5 }, LIFE, LIFE)).toEqual({ key: 'first-key-00001', at });
        expect(held.size).toBe(1);
        expect((JSON.parse([...held.values()][0].value) as { key: string }).key).toBe('first-key-00001');
    });

    it('takes the caller\'s key over a held one that is older than the life it is given (not yet expired by the store), and over a foreign value', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        const at = Date.now();
        await store.claim('s', { key: 'old-key-0000001', at: at - LIFE - 1000 }, LIFE, LIFE);
        expect(await store.claim('s', { key: 'new-key-0000001', at }, LIFE, LIFE)).toEqual({ key: 'new-key-0000001', at });
        held.set(startKeyNameOf('t'), { value: 'not json', px: 1000 });
        expect(await store.claim('t', { key: 'new-key-0000002', at }, LIFE, LIFE)).toEqual({ key: 'new-key-0000002', at });
    });

    it('sends the oldest good moment and the life to the script: a second at least, a fraction rounded, the life the caller says counted back from now', async () => {
        const { redis, evalCalls } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
        await store.claim('s1', { key: 'a-start-key-0001', at: 1 }, 12, 600_000);
        await store.claim('s2', { key: 'a-start-key-0001', at: 1 }, 5000.6, 600_000);
        expect(evalCalls.map((one) => one.args[1])).toEqual(['1000', '5001']);
        expect(evalCalls.map((one) => one.args[2])).toEqual([String(Date.parse('2026-11-21T10:00:00Z') - 600_000), String(Date.parse('2026-11-21T10:00:00Z') - 600_000)]);
    });

    it('takes a key back only while it holds exactly that key: an ask that started again since (another key) stays', async () => {
        const { redis, held } = fakeRedis();
        const store = new RedisStartKeys(() => redis);
        await store.claim('s', { key: 'the-first-key-01', at: Date.now() }, LIFE, LIFE);
        await store.delete('s', 'another-key-0002');
        expect(held.size).toBe(1);
        await store.delete('s', 'the-first-key-01');
        expect(held.size).toBe(0);
        await store.delete('s', 'the-first-key-01');
    });

    it('answers only an entry of the shape it wrote: another key shape, a moment that is not a number, or something that is not JSON is nothing', async () => {
        const bads = ['not json', 'null', '"text"', '7', '{}', JSON.stringify({ key: 'short', at: 1 }), JSON.stringify({ key: 'has space in it!!', at: 1 }), JSON.stringify({ key: 'x'.repeat(65), at: 1 }), JSON.stringify({ key: 'a-start-key-0001', at: '1' }), JSON.stringify({ key: 'a-start-key-0001' }), JSON.stringify({ key: 7, at: 1 }), '{"key":"a-start-key-0001","at":1e999}'];
        for (const bad of bads) {
            const store = new RedisStartKeys(() => fakeRedis({ eval: vi.fn().mockResolvedValue(bad) }).redis);
            expect(await store.claim('s', { key: 'a-start-key-0001', at: 1 }, LIFE, LIFE), bad).toBeUndefined();
        }
        const odd = new RedisStartKeys(() => fakeRedis({ eval: vi.fn().mockResolvedValue(7) }).redis);
        expect(await odd.claim('s', { key: 'a-start-key-0001', at: 1 }, LIFE, LIFE)).toBeUndefined();
        const extra = new RedisStartKeys(() => fakeRedis({ eval: vi.fn().mockResolvedValue(JSON.stringify({ key: 'a-start-key-0001', at: 5, title: 'Visa form', extra: true })) }).redis);
        expect(await extra.claim('s', { key: 'a-start-key-0001', at: 5 }, LIFE, LIFE)).toEqual({ key: 'a-start-key-0001', at: 5 });
    });

    it('never throws: no store connected, a failing store and a store gone silent are all "no answer" and "nothing kept"', async () => {
        const none = new RedisStartKeys(() => null);
        expect(await none.claim('s', { key: 'a-start-key-0001', at: 1 }, LIFE, LIFE)).toBeUndefined();
        await expect(none.delete('s', 'a-start-key-0001')).resolves.toBeUndefined();

        const broken = new RedisStartKeys(() => fakeRedis({ eval: vi.fn().mockRejectedValue(new Error('down')) }).redis);
        expect(await broken.claim('s', { key: 'a-start-key-0001', at: 1 }, LIFE, LIFE)).toBeUndefined();
        await expect(broken.delete('s', 'a-start-key-0001')).resolves.toBeUndefined();

        vi.useFakeTimers();
        const silent = new RedisStartKeys(() => fakeRedis({ eval: vi.fn(() => new Promise(() => undefined)) }).redis, 1000);
        const results = Promise.all([silent.claim('s', { key: 'a-start-key-0001', at: 1 }, LIFE, LIFE), silent.delete('s', 'a-start-key-0001')]);
        await vi.advanceTimersByTimeAsync(1001);
        expect(await results).toEqual([undefined, undefined]);
    });

    it('asks the store for its client at every call: a store that reconnects is used again', async () => {
        const { redis, held } = fakeRedis();
        let client: EvidenceRedis | null = null;
        const store = new RedisStartKeys(() => client);
        await store.claim('s', { key: 'a-start-key-0001', at: Date.now() }, LIFE, LIFE);
        expect(held.size).toBe(0);
        client = redis;
        await store.claim('s', { key: 'a-start-key-0001', at: Date.now() }, LIFE, LIFE);
        expect(held.size).toBe(1);
    });
});

describe('the start-up wiring of the start keys', () => {
    it('gives the AI service a store that uses the shared client the server gives it, and answers that store', async () => {
        const given: Array<StartKeyStore | undefined> = [];
        const { redis, held } = fakeRedis();
        const wired = wireComputerStartKeys({ setComputerStartKeys: (store) => given.push(store) }, () => redis);
        expect(given).toEqual([wired]);
        expect(wired).toBeInstanceOf(RedisStartKeys);
        await wired.claim('s', { key: 'a-start-key-0001', at: Date.now() }, LIFE, LIFE);
        expect(held.size).toBe(1);
    });

    it('tells whether a shared store is expected (set up) from the answer the server gives, and expects one when none is given', () => {
        const { redis } = fakeRedis();
        expect(new RedisStartKeys(() => redis).expected()).toBe(true);
        expect(wireComputerStartKeys({ setComputerStartKeys: () => undefined }, () => redis, () => false).expected()).toBe(false);
        expect(wireComputerStartKeys({ setComputerStartKeys: () => undefined }, () => redis, () => true).expected()).toBe(true);
    });

    it('is called by the server at start-up, with the AI service and the shared client of the bot registry (the server cannot be started in a test, so its source is read: losing the call would silently leave every key in memory)', () => {
        const source = readFileSync(join(__dirname, '..', 'server', 'index.ts'), 'utf8');
        expect(source).toMatch(/import \{ wireComputerStartKeys \} from '\.\/ComputerStartKeys';/);
        expect(source).toContain('wireComputerStartKeys(aiService, () => botRegistry.evidenceClient(), () => botRegistry.sharedStoreExpected());');
        // and not behind a condition or inside a function that may never run: it is a statement of the module, on a line of its own
        expect(source).toMatch(/^wireComputerStartKeys\(aiService, \(\) => botRegistry\.evidenceClient\(\), \(\) => botRegistry\.sharedStoreExpected\(\)\);$/m);
    });
});
