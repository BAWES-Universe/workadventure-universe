/** The record of a room a purged Brick left and still has to forget (R29): kept in the shared store, strict while a store that was in use is down. */
import { describe, expect, it } from 'vitest';
import { BotRegistry } from '../server/BotRegistry';

function registryWith(redis: any): any {
    const registry = new BotRegistry('test') as any;
    registry.redis = redis;
    return registry;
}

function fakeRedis() {
    const hash = new Map<string, string>();
    return {
        isOpen: true,
        hash,
        hSet: async (_k: string, f: string, v: string) => void hash.set(f, v),
        hDel: async (_k: string, f: string) => void hash.delete(f),
        hKeys: async () => [...hash.keys()],
    };
}

describe('BotRegistry: rooms a purged Brick still has to forget', () => {
    it('keeps the record per user and clears it room by room', async () => {
        const redis = fakeRedis();
        const registry = registryWith(redis);
        await registry.rememberPendingForget('@bot_a:hs', '!one:hs');
        await registry.rememberPendingForget('@bot_a:hs', '!two:hs');
        await registry.rememberPendingForget('@bot_b:hs', '!three:hs');
        expect((await registry.pendingForgetsOf('@bot_a:hs')).sort()).toEqual(['!one:hs', '!two:hs']);
        await registry.clearPendingForget('@bot_a:hs', '!one:hs');
        expect(await registry.pendingForgetsOf('@bot_a:hs')).toEqual(['!two:hs']);
        expect(await registry.pendingForgetsOf('@bot_b:hs')).toEqual(['!three:hs']);
        expect((await registry.allPendingForgets()).map((one: any) => `${one.matrixUserId}|${one.roomId}`).sort()).toEqual(['@bot_a:hs|!two:hs', '@bot_b:hs|!three:hs']);
    });

    it('fails, never guesses, when there is no shared store or the one in use is down', async () => {
        const registry = registryWith(undefined);
        await expect(registry.rememberPendingForget('@bot_a:hs', '!one:hs')).rejects.toThrow('no shared store');
        await expect(registry.pendingForgetsOf('@bot_a:hs')).rejects.toThrow('no shared store');
        await expect(registry.allPendingForgets()).rejects.toThrow('no shared store');

        registry.sharedStoreSeen = true;
        await expect(registry.rememberPendingForget('@bot_a:hs', '!one:hs')).rejects.toThrow('shared store is down');
        await expect(registry.pendingForgetsOf('@bot_a:hs')).rejects.toThrow('shared store is down');
        await expect(registry.clearPendingForget('@bot_a:hs', '!one:hs')).rejects.toThrow('shared store is down');
        await expect(registry.allPendingForgets()).rejects.toThrow('shared store is down');
    });
});

describe('BotRegistry: every chat link of a purged bot', () => {
    it('drops the links of every person for that bot only, including people no room holds any more', async () => {
        const links = new Map<string, string>([['bot1|@a:hs', '!1'], ['bot1|@b:hs', '!2'], ['bot10|@a:hs', '!3'], ['bot2|@a:hs', '!4']]);
        const redis = {
            isOpen: true,
            hDel: async (_k: string, f: string) => void links.delete(f),
            hScanIterator: async function* () { for (const [field, value] of [...links]) yield { field, value }; },
        };
        await registryWith(redis).forgetDmRoomsOfBot('bot1');
        expect([...links.keys()].sort()).toEqual(['bot10|@a:hs', 'bot2|@a:hs']);
    });

    it('throws while a store that was in use is down, and does nothing with no store', async () => {
        const registry = registryWith(undefined);
        await expect(registry.forgetDmRoomsOfBot('bot1')).resolves.toBeUndefined();
        registry.sharedStoreSeen = true;
        await expect(registry.forgetDmRoomsOfBot('bot1')).rejects.toThrow('shared store is down');
    });
});

describe('BotRegistry: a goal step\'s card that was not shown', () => {
    it('says the shared store is unavailable instead of marking or answering "none" when it is down', async () => {
        const registry = registryWith(undefined);
        await expect(registry.markTaskCardUnshown('act_1')).rejects.toThrow('not connected');
        await expect(registry.taskCardUnshown('act_1')).rejects.toThrow('not connected');
        // Clearing says so too: the caller must know the old marker may still be there
        await expect(registry.clearTaskCardUnshown('act_1')).rejects.toThrow('not connected');
    });

    it('marks, reads and clears it when the store is up', async () => {
        const keys = new Set<string>();
        const registry = registryWith({ isOpen: true, isReady: true, set: async (k: string) => void keys.add(k), exists: async (k: string) => (keys.has(k) ? 1 : 0), del: async (k: string) => void keys.delete(k) });
        await registry.markTaskCardUnshown('act_1');
        expect(await registry.taskCardUnshown('act_1')).toBe(true);
        await registry.clearTaskCardUnshown('act_1');
        expect(await registry.taskCardUnshown('act_1')).toBe(false);
    });
});
