/**
 * A Brick that lives in a room names its owner for everything it does for itself (game #2005, Orbit #933): when it is put
 * on the map, the AI service is told whose it is, so a small call, a goal or a task run with nobody named is asked as its
 * owner (never as nobody, which Orbit answers as for others), and what is said by someone else is still asked as them.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));
vi.mock('../client/BotClient', () => ({
    BotClient: vi.fn().mockImplementation(() => ({
        connect: vi.fn(async () => {
            order.push('connect');
        }),
        disconnect: vi.fn(async () => undefined),
        isConnected: () => true,
        setAsks: () => undefined,
        setAccessGate: () => undefined,
        setFullConfig: () => undefined,
        setBehavior: vi.fn(),
        onDisconnect: undefined,
    })),
}));

import { BotManager } from '../server/BotManager';
import type { BotConfiguration } from '../server/AdminApiService';

const ROOM = 'https://play.test/_/acme/hq/lobby.tmj';
const order: string[] = [];
const brickIn = (brick: Record<string, unknown>) =>
    ({
        botId: 'brick-1',
        name: 'Brick',
        roomUrl: ROOM,
        brick: { ownerId: 'user-khalid', isDefault: false, ...brick },
        behaviorType: 'idle',
        behaviorConfig: {},
        assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
        enabled: true,
        characterTextureIds: [],
    }) as unknown as BotConfiguration;

async function spawn(config: BotConfiguration) {
    const botManager = new BotManager({ isConfigured: () => true } as never, {} as never);
    const internals = botManager as unknown as { botRegistry: unknown; aiService: { noteRoomBrick: (botId: string, brick: unknown) => void } };
    internals.botRegistry = { assignBot: async () => undefined, unassignBot: async () => undefined };
    order.length = 0;
    const original = internals.aiService.noteRoomBrick.bind(internals.aiService);
    const noteRoomBrick = vi.spyOn(internals.aiService, 'noteRoomBrick').mockImplementation((botId, brick) => {
        order.push(brick ? 'noted' : 'cleared');
        original(botId, brick);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await botManager.spawnBot('brick-1', config);
    return noteRoomBrick;
}

describe('whose a Brick on the map is told to the AI service', () => {
    it('names the owner of a Brick that lives in the room, as for one that visits', async () => {
        const home = await spawn(brickIn({ home: { ownerUuid: 'uuid-khalid', ownerName: 'Khalid' } }));
        expect(home).toHaveBeenCalledWith('brick-1', { ownerUuid: 'uuid-khalid', ownerName: 'Khalid', roomUrl: ROOM });
        const visit = await spawn(brickIn({ visiting: { ownerUuid: 'uuid-khalid', ownerName: 'Khalid' } }));
        expect(visit).toHaveBeenCalledWith('brick-1', { ownerUuid: 'uuid-khalid', ownerName: 'Khalid', roomUrl: ROOM });
    });

    it('tells the AI service whose it is before the bot can hear anyone (before it connects)', async () => {
        await spawn(brickIn({ home: { ownerUuid: 'uuid-khalid', ownerName: 'Khalid' } }));
        expect(order).toEqual(['noted', 'connect']);
    });
});
