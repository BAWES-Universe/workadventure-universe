import { describe, expect, it } from 'vitest';
import { BotRegistry } from '../server/BotRegistry';

/**
 * A small in-memory stand-in for the Redis commands the waiting-message store uses. `arrive` runs once, at the moment
 * a separate command could slip in between two of ours: before a set removal, or right after a script (which Redis runs
 * as one step).
 */
function fakeRedis(arrive: () => Promise<void>) {
    const hashes = new Map<string, Map<string, string>>();
    const sets = new Map<string, Set<string>>();
    let arrived = false;
    const once = async () => {
        if (arrived) return;
        arrived = true;
        await arrive();
    };
    const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
    const set = (key: string) => sets.get(key) ?? sets.set(key, new Set()).get(key)!;
    const redis = {
        isOpen: true,
        hashes,
        sets,
        multi() {
            const ops: Array<() => unknown> = [];
            const chain = {
                hSet: (k: string, f: string, v: string) => (ops.push(() => (hash(k).set(f, v), 1)), chain),
                expire: () => (ops.push(() => 1), chain),
                sAdd: (k: string, m: string) => (ops.push(() => (set(k).add(m), 1)), chain),
                hGet: (k: string, f: string) => (ops.push(() => hash(k).get(f) ?? null), chain),
                hDel: (k: string, f: string) => (ops.push(() => (hash(k).delete(f) ? 1 : 0)), chain),
                exec: async () => ops.map((op) => op()),
            };
            return chain;
        },
        hKeys: async (k: string) => [...hash(k).keys()],
        hLen: async (k: string) => hash(k).size,
        exists: async (k: string) => (hash(k).size ? 1 : 0),
        sMembers: async (k: string) => [...set(k)],
        sIsMember: async (k: string, m: string) => set(k).has(m),
        sRem: async (k: string, m: string) => {
            await once();
            return set(k).delete(m) ? 1 : 0;
        },
        eval: async (_script: string, opts: { keys: string[]; arguments: string[] }) => {
            const [hashKey, setKey] = opts.keys;
            const dropped = hash(hashKey).size === 0 && set(setKey).delete(opts.arguments[0]) ? 1 : 0;
            await once();
            return dropped;
        },
    };
    return redis;
}

function registryWith(redis: unknown): BotRegistry {
    const registry = new BotRegistry('test');
    (registry as unknown as { redis: unknown }).redis = redis;
    return registry;
}

describe('BotRegistry waiting messages', () => {
    it('keeps a bot listed when a message for it arrives while its last one is taken', async () => {
        let registry: BotRegistry;
        const redis = fakeRedis(() => registry.rememberWaitingDm('b1', '!room2', 'newer'));
        registry = registryWith(redis);
        await registry.rememberWaitingDm('b1', '!room1', 'older');

        expect(await registry.takeWaitingDms('b1')).toEqual(['older']);

        expect(await registry.hasWaitingDms('b1')).toBe(true);
        expect(await registry.waitingDmBots()).toEqual(['b1']);
        expect(await registry.takeWaitingDms('b1')).toEqual(['newer']);
    });

    it('keeps a bot listed when a message for it arrives while its expired list entry is cleaned up', async () => {
        let registry: BotRegistry;
        const redis = fakeRedis(() => registry.rememberWaitingDm('b1', '!room1', 'new'));
        registry = registryWith(redis);
        redis.sets.set('bots:matrix:dm-waiting', new Set(['b1']));

        await registry.waitingDmBots();

        expect(await registry.hasWaitingDms('b1')).toBe(true);
        expect(await registry.takeWaitingDms('b1')).toEqual(['new']);
    });

    it('drops a bot from the list once nothing waits for it', async () => {
        const registry = registryWith(fakeRedis(async () => {}));
        await registry.rememberWaitingDm('b1', '!room1', 'hi');

        expect(await registry.takeWaitingDms('b1')).toEqual(['hi']);

        expect(await registry.hasWaitingDms('b1')).toBe(false);
        expect(await registry.waitingDmBots()).toEqual([]);
    });
});
