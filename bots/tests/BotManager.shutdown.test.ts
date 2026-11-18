import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotManager } from '../server/BotManager';
import { BotClient } from '../client/BotClient';

/** A manager with the given bots standing in it, whose clients disconnect as `disconnects` says. */
function manager(bots: Record<string, () => Promise<void>>, registry: { unassignBot?: (botId: string) => Promise<void> } = {}) {
    const registryFake = { unassignBot: registry.unassignBot ?? (async () => undefined), disconnect: vi.fn(async () => undefined) };
    const botManager = new BotManager({ isConfigured: () => false } as never, registryFake as never);
    const internals = botManager as unknown as { bots: Map<string, unknown> };
    for (const [botId, disconnect] of Object.entries(bots)) internals.bots.set(botId, { botId, client: { disconnect }, config: {}, status: 'connected', lastHeartbeat: 0 });
    return { botManager, internals, registryFake };
}

afterEach(() => vi.restoreAllMocks());

describe('a bot that leaves while the server keeps running', () => {
    it('does not hold up whoever despawned it for what its call still has to send: that goes on in the background', async () => {
        let drained!: () => void;
        const { botManager, internals } = manager({ b1: () => new Promise<void>((resolve) => (drained = resolve)) });
        await botManager.despawnBot('b1');
        // It is gone and its place is free, while its voice is still draining
        expect(internals.bots.has('b1')).toBe(false);
        drained();
    });
});

describe('switching the server off', () => {
    it('waits for what every call and bot still has to send to Orbit', async () => {
        let drained!: () => void;
        const waiting = new Promise<void>((resolve) => (drained = resolve));
        vi.spyOn(BotClient, 'drained').mockReturnValue(waiting);
        const { botManager, registryFake } = manager({ b1: async () => undefined });
        let over = false;
        const done = botManager.shutdown().then(() => (over = true));
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(over).toBe(false);
        expect(registryFake.disconnect).not.toHaveBeenCalled();
        drained();
        await done;
        expect(registryFake.disconnect).toHaveBeenCalledTimes(1);
    });

    it('still waits for the drains, and goes on with the rest, when one bot fails to despawn', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const drains = vi.spyOn(BotClient, 'drained').mockResolvedValue(undefined);
        const despawned: string[] = [];
        const { botManager, registryFake } = manager(
            { b1: async () => undefined, b2: async () => undefined },
            { unassignBot: async (botId) => (botId === 'b1' ? Promise.reject(new Error('Redis is down')) : void despawned.push(botId)) }
        );
        await botManager.shutdown();
        expect(despawned).toEqual(['b2']);
        expect(drains).toHaveBeenCalledTimes(1);
        expect(registryFake.disconnect).toHaveBeenCalledTimes(1);
    });
});
