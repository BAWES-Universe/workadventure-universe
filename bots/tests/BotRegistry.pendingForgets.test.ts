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

    it('is quiet when there is no shared store at all, and fails when one that was in use is down', async () => {
        const registry = registryWith(undefined);
        await registry.rememberPendingForget('@bot_a:hs', '!one:hs');
        expect(await registry.pendingForgetsOf('@bot_a:hs')).toEqual([]);
        await registry.clearPendingForget('@bot_a:hs', '!one:hs');

        registry.sharedStoreSeen = true;
        await expect(registry.rememberPendingForget('@bot_a:hs', '!one:hs')).rejects.toThrow('shared store is down');
        await expect(registry.pendingForgetsOf('@bot_a:hs')).rejects.toThrow('shared store is down');
        await expect(registry.clearPendingForget('@bot_a:hs', '!one:hs')).rejects.toThrow('shared store is down');
        await expect(registry.allPendingForgets()).rejects.toThrow('shared store is down');
    });
});
