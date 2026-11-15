/**
 * A Brick that lives in a room (game #2005), on the bot server: Orbit lists the Bricks that live in a room, they stand
 * on its map like room bots, they stay when Orbit cannot answer, they go when taken out, and they greet nobody. They are
 * asked about, and answered, by the room they live in, like a visiting Brick.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService, type BotConfiguration } from '../server/AdminApiService';
import { BotManager } from '../server/BotManager';
import { HomedBrickBehavior } from '../behaviors/HomedBrickBehavior';
import { IdleBehavior } from '../behaviors/IdleBehavior';

const KHALID = 'uuid-khalid';
const ROOM = 'https://play.test/_/acme/hq/lobby.tmj';

const homed = (botId = 'brick-1', roomUrl = ROOM): BotConfiguration =>
    ({
        botId,
        name: 'Recipe Brick',
        roomUrl,
        worldUrl: 'https://play.test/_/acme/hq',
        brick: { ownerId: 'user-khalid', isDefault: false, home: { ownerUuid: KHALID, ownerName: 'Khalid' } },
        behaviorType: 'idle',
        behaviorConfig: {},
        assignedSpace: { center: { x: 320, y: 160 }, radius: 0 },
        enabled: true,
        characterTextureIds: ['brick-red'],
        createdAt: new Date(),
        updatedAt: new Date(),
    }) as unknown as BotConfiguration;

const roomBot = (botId = 'bot-1'): BotConfiguration =>
    ({ botId, name: 'Front Desk', roomUrl: ROOM, behaviorType: 'idle', behaviorConfig: {}, assignedSpace: { center: { x: 10, y: 10 }, radius: 0 }, enabled: true, characterTextureIds: ['woka'], createdAt: new Date(), updatedAt: new Date() }) as unknown as BotConfiguration;

describe('what Orbit says about Bricks that live in a room', () => {
    let server: http.Server;
    let service: AdminApiService;
    let last: { method?: string; url?: string; auth?: string; body?: Record<string, unknown> } = {};
    let answer: unknown = [];

    beforeAll(async () => {
        process.env.BOT_SERVICE_TOKEN = 'service-token';
        server = http.createServer((request, response) => {
            let body = '';
            request.on('data', (chunk) => (body += chunk));
            request.on('end', () => {
                last = { method: request.method, url: request.url, auth: request.headers.authorization, body: body ? JSON.parse(body) : undefined };
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(answer));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => {
        last = {};
        answer = [];
    });

    it('asks for the Bricks of a room with the service token, and reads whose each one is', async () => {
        answer = [JSON.parse(JSON.stringify(homed()))];
        const configs = await service.getHomedBricks(ROOM);
        expect(last).toMatchObject({ method: 'POST', url: '/api/brick-homes/room', auth: 'Bearer service-token', body: { roomUrl: ROOM } });
        expect(configs.map((config) => [config.botId, config.brick?.home])).toEqual([['brick-1', { ownerUuid: KHALID, ownerName: 'Khalid' }]]);
    });

    it('takes only a Brick that names whose it is and where it stands', async () => {
        const stranger = JSON.parse(JSON.stringify(homed('brick-2')));
        delete stranger.brick.home;
        const nowhere = JSON.parse(JSON.stringify(homed('brick-3')));
        delete nowhere.roomUrl;
        answer = [stranger, nowhere, JSON.parse(JSON.stringify(roomBot())), JSON.parse(JSON.stringify(homed('brick-1')))];
        expect((await service.getHomedBricks(ROOM)).map((config) => config.botId)).toEqual(['brick-1']);
    });
});

describe('a Brick at home on the map', () => {
    function manager() {
        const orbit = { rooms: [roomBot()] as BotConfiguration[], homes: [homed()] as BotConfiguration[], homesDown: false };
        const admin = {
            isConfigured: () => true,
            getBotConfigurations: vi.fn(async () => orbit.rooms),
            getHomedBricks: vi.fn(async () => {
                if (orbit.homesDown) throw new Error('down');
                return orbit.homes;
            }),
        };
        const botManager = new BotManager(admin as never, {} as never);
        const internals = botManager as unknown as {
            bots: Map<string, { botId: string; client: { setFullConfig: () => void }; config: BotConfiguration; status: string; lastHeartbeat: number }>;
            roomsWithBots: Map<string, { botIds: Set<string>; lastActivity: number }>;
        };
        const spawn = vi.spyOn(botManager, 'spawnBot').mockImplementation(async (botId: string, cfg: BotConfiguration) => {
            internals.bots.set(botId, { botId, client: { setFullConfig: () => undefined }, config: cfg, status: 'connected', lastHeartbeat: 0 });
            return {} as never;
        });
        const despawn = vi.spyOn(botManager, 'despawnBot').mockImplementation(async (botId: string) => {
            internals.bots.delete(botId);
            for (const room of internals.roomsWithBots.values()) room.botIds.delete(botId);
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        return { botManager, orbit, spawn, despawn, internals };
    }

    it('stands on the map with the room bots, each spawned once however often the room is read', async () => {
        const { botManager, spawn, internals } = manager();
        await botManager.handlePlayerEnterRoom(ROOM);
        await botManager.handlePlayerEnterRoom(ROOM);
        expect([...internals.bots.keys()].sort()).toEqual(['bot-1', 'brick-1']);
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(internals.bots.get('brick-1')?.config.assignedSpace.center).toEqual({ x: 320, y: 160 });
    });

    it('goes when it is taken out, and the room bots stay', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        await botManager.handlePlayerEnterRoom(ROOM);
        orbit.homes = [];
        await botManager.handlePlayerEnterRoom(ROOM);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect([...internals.bots.keys()]).toEqual(['bot-1']);
    });

    it('stays on the map when Orbit cannot say which Bricks live here', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        await botManager.handlePlayerEnterRoom(ROOM);
        orbit.homesDown = true;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await botManager.handlePlayerEnterRoom(ROOM);
        expect(despawn).not.toHaveBeenCalled();
        expect(internals.bots.has('brick-1')).toBe(true);
    });

    it('is moved when its owner moves it', async () => {
        const { botManager, orbit, despawn, spawn } = manager();
        await botManager.handlePlayerEnterRoom(ROOM);
        orbit.homes = [{ ...homed(), assignedSpace: { center: { x: 400, y: 200 }, radius: 0 } } as BotConfiguration];
        await botManager.handlePlayerEnterRoom(ROOM);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect(spawn).toHaveBeenCalledTimes(3);
    });

    it('is still not put on a map when it has no home and does not visit', async () => {
        const botManager = new BotManager({ isConfigured: () => true } as never, {} as never);
        const lone = { ...homed(), brick: { ownerId: 'user-khalid', isDefault: true } } as unknown as BotConfiguration;
        await expect(botManager.spawnBot('brick-9', lone)).rejects.toThrow(/cannot be put on a map/);
    });
});

describe('a Brick that lives in a room, moved and returned by Orbit', () => {
    const ROOM_B = 'https://play.test/_/acme/hq/studio.tmj';

    function manager(homesOf: (roomUrl: string, call: number) => BotConfiguration[]) {
        const calls = new Map<string, number>();
        const admin = {
            isConfigured: () => true,
            getBotConfigurations: vi.fn(async () => [] as BotConfiguration[]),
            getHomedBricks: vi.fn(async (roomUrl: string) => {
                const call = (calls.get(roomUrl) ?? 0) + 1;
                calls.set(roomUrl, call);
                return homesOf(roomUrl, call);
            }),
        };
        const botManager = new BotManager(admin as never, {} as never);
        const internals = botManager as unknown as {
            bots: Map<string, { botId: string; client: { setFullConfig: () => void }; config: BotConfiguration; status: string; lastHeartbeat: number }>;
            roomsWithBots: Map<string, { botIds: Set<string>; lastActivity: number }>;
            queryWorkAdventureRooms: () => Promise<Map<string, number>>;
        };
        const spawn = vi.spyOn(botManager, 'spawnBot').mockImplementation(async (botId: string, cfg: BotConfiguration) => {
            internals.bots.set(botId, { botId, client: { setFullConfig: () => undefined }, config: cfg, status: 'connected', lastHeartbeat: 0 });
            return {} as never;
        });
        const despawn = vi.spyOn(botManager, 'despawnBot').mockImplementation(async (botId: string) => {
            internals.bots.delete(botId);
            for (const room of internals.roomsWithBots.values()) room.botIds.delete(botId);
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        return { botManager, admin, spawn, despawn, internals };
    }

    it('joins the room it was moved to when its spot is the same, and leaves the one it was in', async () => {
        let movedTo: string = ROOM;
        const { botManager, spawn, despawn, internals } = manager((roomUrl) => (roomUrl === movedTo ? [homed('brick-1', roomUrl)] : []));
        await botManager.handlePlayerEnterRoom(ROOM);
        expect(internals.bots.get('brick-1')?.config.roomUrl).toBe(ROOM);
        movedTo = ROOM_B;
        await botManager.handlePlayerEnterRoom(ROOM_B);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(internals.bots.get('brick-1')?.config.roomUrl).toBe(ROOM_B);
    });

    it('is not put back in the room it left by a list that was read before it moved', async () => {
        // Room A's sync read its list (with the Brick) just before the Brick was moved to B and stood there; A now answers that nobody lives in it
        const { botManager, admin, spawn, despawn, internals } = manager((roomUrl, call) => (roomUrl === ROOM_B ? [homed('brick-1', ROOM_B)] : call === 1 ? [homed('brick-1', ROOM)] : []));
        await botManager.handlePlayerEnterRoom(ROOM_B);
        expect(internals.bots.get('brick-1')?.config.roomUrl).toBe(ROOM_B);
        spawn.mockClear();
        await botManager.handlePlayerEnterRoom(ROOM);
        expect(admin.getHomedBricks).toHaveBeenCalledWith(ROOM);
        expect(despawn).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
        expect(internals.bots.get('brick-1')?.config.roomUrl).toBe(ROOM_B);
    });

    it('is read again while people are in the room, so a return Orbit makes by itself is never kept', async () => {
        let lives = true;
        const { botManager, despawn, internals } = manager(() => (lives ? [homed()] : []));
        await botManager.handlePlayerEnterRoom(ROOM);
        internals.queryWorkAdventureRooms = async () => new Map([[ROOM, 3]]);
        lives = false;
        await botManager.verifyRoomOccupancy();
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect(internals.bots.has('brick-1')).toBe(false);
    });

    it('is not read again by that check in a room that has no Brick living in it', async () => {
        const { botManager, admin, internals } = manager(() => []);
        admin.getBotConfigurations.mockResolvedValue([roomBot()]);
        await botManager.handlePlayerEnterRoom(ROOM);
        internals.queryWorkAdventureRooms = async () => new Map([[ROOM, 3]]);
        admin.getBotConfigurations.mockClear();
        await botManager.verifyRoomOccupancy();
        expect(admin.getBotConfigurations).not.toHaveBeenCalled();
    });
});

describe('a Brick at home greets nobody', () => {
    const fakeBot = () => ({
        getBotId: () => 'brick-1',
        getNearbyPlayers: () => [{ userId: 7 }],
    });
    const behaviorOf = (Behavior: typeof IdleBehavior) => {
        const behavior = new Behavior({ type: 'idle', responseRadius: 0, greetingMessages: [] } as unknown as ConstructorParameters<typeof IdleBehavior>[0]);
        const internals = behavior as unknown as {
            bot: unknown;
            justCompletedLeading: { targetPersonId: number; followerUuid: string } | null;
            generateAIGreeting: () => Promise<void>;
            generateAIGreetingWithLeadingContext: () => Promise<void>;
            onMemoryReady: (space: string, user: { id: number }) => void;
        };
        internals.bot = fakeBot();
        const welcome = vi.fn(async () => undefined);
        const welcomeAfterLeading = vi.fn(async () => undefined);
        internals.generateAIGreeting = welcome;
        internals.generateAIGreetingWithLeadingContext = welcomeAfterLeading;
        return { behavior, internals, welcome, welcomeAfterLeading };
    };

    it('(control) an ordinary room bot greets the person who comes up to it', () => {
        const { internals, welcome } = behaviorOf(IdleBehavior);
        internals.onMemoryReady('space', { id: 7 });
        expect(welcome).toHaveBeenCalledTimes(1);
    });

    it('(control) an ordinary room bot greets after leading someone to a person', () => {
        const { behavior, internals, welcomeAfterLeading } = behaviorOf(IdleBehavior);
        internals.justCompletedLeading = { targetPersonId: 7, followerUuid: 'uuid-f' };
        behavior.onSpaceJoined('space');
        expect(welcomeAfterLeading).toHaveBeenCalledTimes(1);
    });

    it('does not welcome people, so its owner’s key pays for nothing nobody asked for', () => {
        const { internals, welcome } = behaviorOf(HomedBrickBehavior);
        internals.onMemoryReady('space', { id: 7 });
        expect(welcome).not.toHaveBeenCalled();
    });

    it('does not welcome the person it led somewhere either', () => {
        const { behavior, internals, welcome, welcomeAfterLeading } = behaviorOf(HomedBrickBehavior);
        internals.justCompletedLeading = { targetPersonId: 7, followerUuid: 'uuid-f' };
        behavior.onSpaceJoined('space');
        internals.onMemoryReady('space', { id: 7 });
        expect(welcomeAfterLeading).not.toHaveBeenCalled();
        expect(welcome).not.toHaveBeenCalled();
    });
});
