/**
 * A start that fails part-way leaves nothing behind (Sentry on #2023): when the registry cannot be reached after the Brick's
 * client has connected, the client is disconnected and forgotten, so no Brick stands on the map that nobody can end.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

let disconnectFails = false;
const clients: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; setBehavior: ReturnType<typeof vi.fn> }> = [];
vi.mock('../client/BotClient', () => ({
    BotClient: vi.fn().mockImplementation(() => {
        const client = {
            connect: vi.fn(async () => undefined),
            disconnect: vi.fn(async () => {
                if (disconnectFails) throw new Error('already gone');
            }),
            isConnected: () => true,
            setAsks: () => undefined,
            setAccessGate: () => undefined,
            setFullConfig: () => undefined,
            setBehavior: vi.fn(),
            onDisconnect: undefined,
        };
        clients.push(client);
        return client;
    }),
}));

import { BotManager } from '../server/BotManager';
import type { BotConfiguration } from '../server/AdminApiService';

const AT = { x: 100, y: 200 };
const ROOM = 'https://play.test/_/acme/hq/lobby.tmj';
const config = {
    botId: 'brick-1',
    name: 'Brick',
    roomUrl: ROOM,
    brick: { ownerId: 'user-khalid', isDefault: true, visiting: { ownerUuid: 'uuid-khalid', ownerName: 'Khalid' } },
    behaviorType: 'idle',
    behaviorConfig: {},
    assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
    enabled: true,
    characterTextureIds: [],
} as unknown as BotConfiguration;

function manager(assign: () => Promise<void>) {
    const botManager = new BotManager({ isConfigured: () => true, getVisitingBricks: vi.fn(async () => [config]) } as never, {} as never);
    const internals = botManager as unknown as {
        bots: Map<string, unknown>;
        visitors: Map<string, unknown>;
        botRegistry: { assignBot: () => Promise<void>; unassignBot?: () => Promise<void> };
    };
    internals.botRegistry = { assignBot: assign, unassignBot: async () => undefined } as never;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { botManager, internals };
}

describe('a Brick whose start fails part-way', () => {
    it('is disconnected and forgotten when the registry cannot be reached, and the next sync starts it again', async () => {
        clients.length = 0;
        let down = true;
        const { botManager, internals } = manager(async () => {
            if (down) throw new Error('registry down');
        });

        await expect(botManager.syncVisitingBrick(ROOM, { uuid: 'uuid-khalid' }, AT)).rejects.toThrow('registry down');
        expect(clients).toHaveLength(1);
        expect(clients[0].disconnect).toHaveBeenCalledTimes(1);
        expect(internals.bots.has('brick-1')).toBe(false);
        expect(internals.visitors.has('uuid-khalid')).toBe(false);

        // Nothing connected-looking is left to be found and skipped: the next sync puts the Brick on the map
        down = false;
        expect(await botManager.syncVisitingBrick(ROOM, { uuid: 'uuid-khalid' }, AT)).toEqual({ botId: 'brick-1' });
        expect(clients).toHaveLength(2);
        expect(internals.bots.has('brick-1')).toBe(true);
        expect(internals.visitors.has('uuid-khalid')).toBe(true);
    });

    it('still reports the start failure when the disconnect fails too', async () => {
        clients.length = 0;
        disconnectFails = true;
        const { botManager, internals } = manager(async () => {
            throw new Error('registry down');
        });
        await expect(botManager.spawnBot('brick-1', config)).rejects.toThrow('registry down');
        expect(internals.bots.has('brick-1')).toBe(false);
        disconnectFails = false;
    });
});

describe('a Brick leaving because its person did (Sentry on #2023)', () => {
    it('goes through the same one-at-a-time line as a sync, so a sync never finds it half taken off', async () => {
        clients.length = 0;
        const { botManager, internals } = manager(async () => undefined);
        await botManager.syncVisitingBrick(ROOM, { uuid: 'uuid-khalid' }, AT);
        expect(internals.bots.has('brick-1')).toBe(true);

        // Its person is gone: the Brick's own behaviour says so
        const behavior = clients[0].setBehavior.mock.calls[0][0] as { onOwnerGone: () => void };
        const order: string[] = [];
        let finishUnassign: () => void = () => undefined;
        internals.botRegistry = {
            assignBot: async () => undefined,
            unassignBot: () =>
                new Promise<void>((resolve) => {
                    order.push('taking off');
                    finishUnassign = () => {
                        order.push('taken off');
                        resolve();
                    };
                }),
        } as never;
        behavior.onOwnerGone();
        await vi.waitFor(() => expect(order).toEqual(['taking off']));

        // The person is back and a sync arrives while the Brick is being taken off: it waits for that to finish
        const sync = botManager.syncVisitingBrick(ROOM, { uuid: 'uuid-khalid' }, AT).then((answer) => {
            order.push('sync done');
            return answer;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(order).toEqual(['taking off']);
        finishUnassign();
        expect(await sync).toEqual({ botId: 'brick-1' });
        expect(order).toEqual(['taking off', 'taken off', 'sync done']);
        // and it was put on the map again, a new client, not the one that was going
        expect(clients).toHaveLength(2);
        expect(internals.bots.has('brick-1')).toBe(true);
    });
});
