import { describe, expect, it, vi } from 'vitest';
import { BotManager } from '../server/BotManager';

type Config = { botId: string; name: string; behaviorType: string; voiceEnabled: boolean; characterTextureIds: string[]; assignedSpace: unknown };

function config(voiceEnabled: boolean): Config {
    return { botId: 'b1', name: 'Linear', behaviorType: 'idle', voiceEnabled, characterTextureIds: ['t'], assignedSpace: { center: { x: 1, y: 1 }, radius: 0 } };
}

/** A manager whose Orbit answer is whatever `orbit.answer` holds and whose spawning is faked: a spawn is a bot that stays until despawned. */
function manager(orbit: { answer: Config[]; delay?: number }) {
    const syncs = { running: 0, peak: 0 };
    const admin = {
        isConfigured: () => false,
        getBotConfigurations: vi.fn(async () => {
            syncs.running++;
            syncs.peak = Math.max(syncs.peak, syncs.running);
            if (orbit.delay) await new Promise((resolve) => setTimeout(resolve, orbit.delay));
            syncs.running--;
            return orbit.answer;
        }),
    };
    const registry = {};
    const botManager = new BotManager(admin as never, registry as never);
    const internals = botManager as unknown as {
        bots: Map<string, { botId: string; client: { setFullConfig: () => void }; config: Config; status: string; lastHeartbeat: number }>;
        roomsWithBots: Map<string, { botIds: Set<string>; lastActivity: number }>;
    };
    const live = { running: 0, peak: 0 };
    const spawn = vi.spyOn(botManager, 'spawnBot').mockImplementation(async (botId: string, cfg: never) => {
        live.running++;
        live.peak = Math.max(live.peak, live.running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        internals.bots.set(botId, { botId, client: { setFullConfig: () => undefined }, config: cfg, status: 'connected', lastHeartbeat: 0 });
        return {} as never;
    });
    const despawn = vi.spyOn(botManager, 'despawnBot').mockImplementation(async (botId: string) => {
        if (!internals.bots.delete(botId)) return;
        live.running--;
        // As the real one: a room left with no bots is no longer listed
        for (const [roomId, room] of internals.roomsWithBots) {
            room.botIds.delete(botId);
            if (room.botIds.size === 0) internals.roomsWithBots.delete(roomId);
        }
    });
    return { botManager, internals, spawn, despawn, live, syncs };
}

describe('BotManager voice switch', () => {
    it('respawns a running bot when voice is switched on, and keeps its room listed', async () => {
        const orbit = { answer: [config(false)] };
        const { botManager, internals, spawn, despawn } = manager(orbit);
        await botManager.handlePlayerEnterRoom('room-1');
        expect(spawn).toHaveBeenCalledTimes(1);

        orbit.answer = [config(true)];
        await botManager.handlePlayerEnterRoom('room-1');

        expect(despawn).toHaveBeenCalledTimes(1);
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(internals.bots.get('b1')?.config.voiceEnabled).toBe(true);
        // The only bot of the room was despawned and spawned again: the room is still listed with it
        expect(internals.roomsWithBots.get('room-1')?.botIds.has('b1')).toBe(true);
    });

    it('respawns a running bot when voice is switched off', async () => {
        const orbit = { answer: [config(true)] };
        const { botManager, internals, spawn } = manager(orbit);
        await botManager.handlePlayerEnterRoom('room-1');

        orbit.answer = [config(false)];
        await botManager.handlePlayerEnterRoom('room-1');

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(internals.bots.get('b1')?.config.voiceEnabled).toBe(false);
        expect(internals.roomsWithBots.get('room-1')?.botIds.has('b1')).toBe(true);
    });

    it('never runs two syncs of a room at once when several arrive together', async () => {
        const orbit = { answer: [config(false)], delay: 20 };
        const { botManager, internals, spawn, live, syncs } = manager(orbit);
        await botManager.handlePlayerEnterRoom('room-1');

        // The switch flipped twice in a row while a sync is still running: three calls for the same room, two of them waiting
        orbit.answer = [config(true)];
        await Promise.all([
            botManager.handlePlayerEnterRoom('room-1'),
            botManager.handlePlayerEnterRoom('room-1'),
            botManager.handlePlayerEnterRoom('room-1'),
        ]);

        // Each sync reads Orbit once: they ran one after another, never side by side
        expect(syncs.peak).toBe(1);
        expect(live.peak).toBe(1);
        expect(internals.bots.size).toBe(1);
        // One respawn for the change, and the later calls find nothing to change
        expect(spawn).toHaveBeenCalledTimes(2);
    });
});
