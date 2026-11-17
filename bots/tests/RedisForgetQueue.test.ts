/**
 * The forgets Orbit has not taken yet, kept in the bot servers' shared store (Redis): one entry per thing, so two bot servers never
 * overwrite each other, written together in one transaction, and a damaged entry never stops a bot server starting.
 */
import { describe, expect, it } from 'vitest';
import { forgetKeyOf, MAX_PENDING_FORGETS, PUT_SCRIPT, REMOVE_SCRIPT, RedisForgetQueue, type ForgetQueueRedis } from '../memory/ForgetQueue';

/** The few Redis hash commands the queue uses, in memory. `execs` counts transactions. */
function fakeRedis() {
    const hashes = new Map<string, Map<string, string>>();
    const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
    const state = { execs: 0, failExec: false };
    const client: ForgetQueueRedis = {
        hGetAll: async (key) => Object.fromEntries(hash(key)),
        multi: () => {
            const steps: Array<() => void> = [];
            const chain = {
                hSet: (key: string, field: string, value: string) => (steps.push(() => hash(key).set(field, value)), chain),
                hDel: (key: string, field: string) => (steps.push(() => hash(key).delete(field)), chain),
                // The two scripts, as Redis runs them: a put does not replace a later ask, a removal does not remove one
                eval: (script: string, options: { keys: string[]; arguments: string[] }) => {
                    steps.push(() => {
                        const [field, second, third] = options.arguments;
                        const stored = hash(options.keys[0]).get(field);
                        const rank = (since: number) => (since === 0 ? Infinity : since);
                        let storedSince: number | undefined;
                        try {
                            storedSince = (JSON.parse(stored ?? 'null') as { since?: number } | null)?.since;
                        } catch {
                            storedSince = undefined;
                        }
                        if (script === PUT_SCRIPT) {
                            if (storedSince !== undefined && rank(storedSince) > rank(Number(third))) return;
                            hash(options.keys[0]).set(field, second);
                        } else if (script === REMOVE_SCRIPT) {
                            if (stored === undefined) return;
                            if (storedSince !== undefined && rank(storedSince) > rank(Number(second))) return;
                            hash(options.keys[0]).delete(field);
                        }
                    });
                    return chain;
                },
                exec: async () => {
                    if (state.failExec) throw new Error('Redis went away');
                    state.execs++;
                    steps.forEach((step) => step());
                    return [];
                },
            };
            return chain;
        },
    };
    return { client, hashes, state, hash };
}

const pending = (itemKey: string, since = 10) => ({ botId: 'bot-1', userUuid: 'uuid-sara', itemKey, kind: 'pref', since, first: since });
const forgotten = (itemKey: string, since = 10) => ({ botId: 'bot-1', userUuid: 'uuid-sara', itemKey, since });

describe('the forget queue in the shared store', () => {
    it('writes each thing as its own entry and reads them back, the waiting list and the ledger apart', async () => {
        const redis = fakeRedis();
        const queue = new RedisForgetQueue(() => redis.client);
        await queue.write({ pending: { put: [pending('a'), pending('b', 20)], del: [] }, ledger: { put: [forgotten('a'), forgotten('b', 20)], del: [] } });
        expect(redis.hash('bots:forgets:pending').size).toBe(2);
        const kept = await queue.load();
        expect(kept.pending.map((entry) => entry.itemKey)).toEqual(['a', 'b']);
        expect(kept.ledger.map((entry) => entry.itemKey)).toEqual(['a', 'b']);
        // Only the thing that changed is touched: another server's entries stay
        redis.hash('bots:forgets:pending').set('bot-2|uuid-x|z', JSON.stringify({ ...pending('z'), botId: 'bot-2', userUuid: 'uuid-x' }));
        await queue.write({ pending: { put: [], del: [{ key: forgetKeyOf(pending('a')), since: 10 }] }, ledger: { put: [], del: [] } });
        expect([...redis.hash('bots:forgets:pending').keys()].sort()).toEqual(['bot-1|uuid-sara|b', 'bot-2|uuid-x|z']);
    });

    it('writes a change as one transaction, so a forget is never in the ledger without being owed', async () => {
        const redis = fakeRedis();
        const queue = new RedisForgetQueue(() => redis.client);
        await queue.write({ pending: { put: [pending('a')], del: [] }, ledger: { put: [forgotten('a')], del: [] } });
        expect(redis.state.execs).toBe(1);
    });

    it('fails, rather than pretend it wrote, while the shared store is not connected or the write is refused', async () => {
        const queue = new RedisForgetQueue(() => null);
        await expect(queue.load()).rejects.toThrow('not connected');
        await expect(queue.write({ pending: { put: [pending('a')], del: [] }, ledger: { put: [], del: [] } })).rejects.toThrow('not connected');
        const redis = fakeRedis();
        redis.state.failExec = true;
        await expect(new RedisForgetQueue(() => redis.client).write({ pending: { put: [pending('a')], del: [] }, ledger: { put: [], del: [] } })).rejects.toThrow('Redis went away');
    });

    it('reads an empty store as nothing waiting, and ignores a damaged entry instead of stopping', async () => {
        const redis = fakeRedis();
        const queue = new RedisForgetQueue(() => redis.client);
        expect(await queue.load()).toEqual({ pending: [], ledger: [] });
        redis.hash('bots:forgets:pending').set('x', '{ not json');
        redis.hash('bots:forgets:pending').set('y', JSON.stringify({ botId: 'bot-1' }));
        redis.hash('bots:forgets:pending').set('z', JSON.stringify(pending('good')));
        expect((await queue.load()).pending.map((entry) => entry.itemKey)).toEqual(['good']);
    });

    it('lets go of the oldest beyond the safety limit, so the store cannot grow without end', async () => {
        const redis = fakeRedis();
        for (let i = 0; i < MAX_PENDING_FORGETS + 3; i++) redis.hash('bots:forgets:pending').set(`k${i}`, JSON.stringify(pending(`k${i}`, i + 1)));
        const kept = await new RedisForgetQueue(() => redis.client).load();
        expect(kept.pending).toHaveLength(MAX_PENDING_FORGETS);
        expect(kept.pending[0].itemKey).toBe('k3');
        expect(redis.hash('bots:forgets:pending').size).toBe(MAX_PENDING_FORGETS);
    });

    it('fails when the shared store does not answer in time, so a silent connection never holds a memory load or save', async () => {
        const redis = fakeRedis();
        const silent: ForgetQueueRedis = { hGetAll: () => new Promise(() => undefined), multi: () => ({ hSet: () => undefined, hDel: () => undefined, eval: () => undefined, exec: () => new Promise(() => undefined) }) };
        const queue = new RedisForgetQueue(() => silent, () => true, 20);
        await expect(queue.load()).rejects.toThrow('did not answer in time');
        await expect(queue.write({ pending: { put: [pending('a')], del: [] }, ledger: { put: [], del: [] } })).rejects.toThrow('did not answer in time');
        expect(redis.state.execs).toBe(0);
    });

    it('says it is in use only once the shared store has been reached', () => {
        let seen = false;
        const queue = new RedisForgetQueue(() => null, () => seen);
        expect(queue.inUse()).toBe(false);
        seen = true;
        expect(queue.inUse()).toBe(true);
    });

    it('never replaces or removes a later ask that another bot server stored (Sentry)', async () => {
        const redis = fakeRedis();
        const queue = new RedisForgetQueue(() => redis.client);
        const key = forgetKeyOf(pending('a'));
        // This server held the ask at time 10 and is told Orbit took it; another server asked again at time 30 meanwhile
        await queue.write({ pending: { put: [pending('a', 30)], del: [] }, ledger: { put: [], del: [] } });
        await queue.write({ pending: { put: [], del: [{ key, since: 10 }] }, ledger: { put: [], del: [] } });
        expect(JSON.parse(redis.hash('bots:forgets:pending').get(key)!).since).toBe(30);
        // An older ask from this server does not replace the later one either
        await queue.write({ pending: { put: [pending('a', 20)], del: [] }, ledger: { put: [], del: [] } });
        expect(JSON.parse(redis.hash('bots:forgets:pending').get(key)!).since).toBe(30);
        // The same ask, or an earlier one, is removed
        await queue.write({ pending: { put: [], del: [{ key, since: 30 }] }, ledger: { put: [], del: [] } });
        expect(redis.hash('bots:forgets:pending').has(key)).toBe(false);
        // "Whenever it was said" (0) is the latest of all, in the ledger
        await queue.write({ pending: { put: [], del: [] }, ledger: { put: [forgotten('a', 0)], del: [] } });
        await queue.write({ pending: { put: [], del: [] }, ledger: { put: [forgotten('a', 50)], del: [{ key, since: 50 }] } });
        expect(JSON.parse(redis.hash('bots:forgets:ledger').get(key)!).since).toBe(0);
    });
});
