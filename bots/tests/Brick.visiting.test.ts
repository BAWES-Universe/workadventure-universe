/**
 * Bringing a Brick along (game #2005), on the bot server: Orbit says which Brick walks beside a person, the Brick is put
 * on the map of the room they are in and follows them room to room, it is asked about by the room it is in, it never uses
 * its owner's things for anyone else, and where its owner's key is not lent it answers nobody but says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService, KEY_NOT_LENT_LINE, type BotConfiguration } from '../server/AdminApiService';
import { BotAccessGate } from '../server/BotAccessGate';
import { BotManager } from '../server/BotManager';
import { AIService } from '../ai/AIService';
import { visitingRule } from '../ai/systemPrompt';
import { VisitingBrickBehavior, spotBeside, VISIT_GONE_AFTER_MS, VISIT_LOOK_ACROSS_AFTER_MS, VISIT_WALK_AFTER } from '../behaviors/VisitingBrickBehavior';

const KHALID = 'uuid-khalid';
const NOURA = 'uuid-noura';
const AT = { x: 100, y: 200 };
const ROOM_A = 'https://play.test/_/acme/hq/lobby.tmj';
const ROOM_B = 'https://play.test/_/acme/hq/cafe.tmj';

const visitingConfig = (botId = 'brick-1', roomUrl = ROOM_A, ownerUuid = KHALID): BotConfiguration =>
    ({
        botId,
        name: 'Brick',
        roomUrl,
        worldUrl: 'https://play.test/_/acme/hq',
        brick: { ownerId: 'user-khalid', isDefault: true, visiting: { ownerUuid, ownerName: 'Khalid' } },
        behaviorType: 'idle',
        behaviorConfig: {},
        assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
        enabled: true,
        characterTextureIds: ['brick-orange'],
        createdAt: new Date(),
        updatedAt: new Date(),
    }) as unknown as BotConfiguration;

describe('what Orbit says about visiting Bricks', () => {
    let server: http.Server;
    let service: AdminApiService;
    let last: { method?: string; url?: string; auth?: string; body?: Record<string, unknown> } = {};
    let answer: { status: number; body: unknown } = { status: 200, body: [] };

    beforeAll(async () => {
        process.env.BOT_SERVICE_TOKEN = 'service-token';
        server = http.createServer((request, response) => {
            let body = '';
            request.on('data', (chunk) => (body += chunk));
            request.on('end', () => {
                last = { method: request.method, url: request.url, auth: request.headers.authorization, body: body ? JSON.parse(body) : undefined };
                response.statusCode = answer.status;
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(answer.body));
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
        answer = { status: 200, body: [] };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('asks for the Brick beside a person in a room with the service token', async () => {
        answer = { status: 200, body: [JSON.parse(JSON.stringify(visitingConfig()))] };
        const configs = await service.getVisitingBricks(ROOM_A, [KHALID]);
        expect(last).toMatchObject({ method: 'POST', url: '/api/brick-visits/room', auth: 'Bearer service-token', body: { roomUrl: ROOM_A, people: [KHALID] } });
        expect(configs).toHaveLength(1);
        expect(configs[0].brick?.visiting).toEqual({ ownerUuid: KHALID, ownerName: 'Khalid' });
    });

    it('asks nothing when there is nobody to ask about', async () => {
        expect(await service.getVisitingBricks(ROOM_A, [])).toEqual([]);
        expect(last).toEqual({});
    });

    it('takes only a Brick that names the person it walks beside', async () => {
        const stranger = JSON.parse(JSON.stringify(visitingConfig('brick-2')));
        delete stranger.brick.visiting;
        const roomBot = JSON.parse(JSON.stringify(visitingConfig('bot-3')));
        delete roomBot.brick;
        answer = { status: 200, body: [stranger, roomBot, JSON.parse(JSON.stringify(visitingConfig('brick-1')))] };
        expect((await service.getVisitingBricks(ROOM_A, [KHALID])).map((config) => config.botId)).toEqual(['brick-1']);
    });

    it('asks about who is being answered, and where, only when the Brick walks beside its owner', async () => {
        answer = { status: 200, body: { source: 'universe-ai' } };
        await service.getBotAiCredentials('brick-1', { asker: NOURA, roomUrl: ROOM_A });
        const asked = new URL(last.url ?? '', 'http://orbit.test');
        expect(asked.pathname).toBe('/api/bots/brick-1/ai-credentials');
        expect(asked.searchParams.get('asker')).toBe(NOURA);
        expect(asked.searchParams.get('roomUrl')).toBe(ROOM_A);
        await service.getBotAiCredentials('bot-9');
        expect(last.url).toBe('/api/bots/bot-9/ai-credentials');
    });

    it('turns "the owner has not lent the key here" into a line, not a failure and not another key', async () => {
        answer = { status: 403, body: { error: 'no', code: 'key_not_lent' } };
        expect(await service.getBotAiCredentials('brick-1', { asker: NOURA, roomUrl: ROOM_A })).toEqual({ source: 'resting', keyOwnerId: '', restingLine: KEY_NOT_LENT_LINE });
    });

    it('sends the room with a chat question, for a visiting Brick only', async () => {
        answer = { status: 200, body: { allowed: true, code: 'allowed', reason: null } };
        await service.checkBotAccess('brick-1', 'chat', { signedIn: true, identifier: NOURA }, ROOM_A);
        expect(last.body).toMatchObject({ action: 'chat', roomUrl: ROOM_A });
        await service.checkBotAccess('bot-9', 'chat', { signedIn: true, identifier: NOURA });
        expect(last.body).not.toHaveProperty('roomUrl');
    });
});

describe('the access gate for a Brick in a room', () => {
    it('keeps an answer for each room, so a Brick that moved is not judged by where it was', async () => {
        const checkBotAccess = vi.fn(async (_id: string, _action: string, _person: unknown, roomUrl?: string) => ({ allowed: roomUrl === ROOM_A, code: roomUrl === ROOM_A ? 'allowed' : 'not_allowed', reason: 'no' }) as never);
        const gate = new BotAccessGate({ isConfigured: () => true, checkBotAccess } as never);
        const person = { signedIn: true, identifier: NOURA };
        expect((await gate.check('brick-1', 'chat', person, 'Brick', ROOM_A)).allowed).toBe(true);
        expect((await gate.check('brick-1', 'chat', person, 'Brick', ROOM_B)).allowed).toBe(false);
        expect((await gate.check('brick-1', 'chat', person, 'Brick', ROOM_A)).allowed).toBe(true);
        expect(checkBotAccess).toHaveBeenCalledTimes(2);
    });
});

describe('where a visiting Brick stands', () => {
    it('rests beside its person on the side it is already on, never on top of them', () => {
        expect(spotBeside({ x: 100, y: 100 }, { x: 300, y: 100 })).toEqual({ x: 156, y: 100 });
        expect(spotBeside({ x: 100, y: 100 }, { x: 100, y: 0 })).toEqual({ x: 100, y: 44 });
        expect(spotBeside({ x: 100, y: 100 }, { x: 100, y: 100 })).toEqual({ x: 156, y: 100 });
    });
});

describe('a visiting Brick on the map', () => {
    const config = (onOwnerGone: () => void) =>
        ({ type: 'idle', responseRadius: 0, greetingMessages: [], ownerUuid: KHALID, onOwnerGone }) as unknown as ConstructorParameters<typeof VisitingBrickBehavior>[0];

    function brickAt(position: { x: number; y: number }, person: { x: number; y: number } | undefined) {
        const walks: { x: number; y: number }[] = [];
        const bot = {
            getPlayerPositionByUuid: vi.fn(() => person),
            getState: () => ({ getPosition: () => position, isMoving: () => false }),
            getIsFollowingPath: () => false,
            lookAcrossTheRoom: vi.fn(),
            moveToWithPathfinding: vi.fn(async (x: number, y: number) => {
                walks.push({ x, y });
                return true;
            }),
            getBotId: () => 'brick-1',
            getNearbyPlayers: () => [],
            cancelPathfinding: vi.fn(),
            stop: vi.fn(),
        };
        const gone = vi.fn();
        const behavior = new VisitingBrickBehavior(config(gone));
        (behavior as unknown as { bot: unknown }).bot = bot;
        return { behavior, bot, walks, gone };
    }

    it('stays put while its person is near', () => {
        vi.useFakeTimers();
        const { behavior, walks } = brickAt({ x: 100, y: 100 }, { x: 100 + VISIT_WALK_AFTER - 10, y: 100 });
        behavior.update(16);
        expect(walks).toEqual([]);
        vi.useRealTimers();
    });

    it('walks to a spot beside its person when they move off', () => {
        vi.useFakeTimers();
        const { behavior, walks } = brickAt({ x: 100, y: 100 }, { x: 500, y: 100 });
        behavior.update(16);
        expect(walks).toEqual([{ x: 444, y: 100 }]);
        vi.useRealTimers();
    });

    it('leaves the map once its person has not been seen in the room for a while, and says so once', () => {
        vi.useFakeTimers();
        const { behavior, gone } = brickAt({ x: 100, y: 100 }, undefined);
        behavior.update(16);
        expect(gone).not.toHaveBeenCalled();
        vi.advanceTimersByTime(VISIT_GONE_AFTER_MS + 1000);
        behavior.update(16);
        vi.advanceTimersByTime(2000);
        behavior.update(16);
        expect(gone).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('asks to see the whole room once before it decides its person has left: on a large map they may only be out of view (Sentry on #2023)', () => {
        vi.useFakeTimers();
        const { behavior, bot, gone } = brickAt({ x: 100, y: 100 }, undefined);
        behavior.update(16);
        expect(bot.lookAcrossTheRoom).not.toHaveBeenCalled();
        vi.advanceTimersByTime(VISIT_LOOK_ACROSS_AFTER_MS + 1000);
        behavior.update(16);
        expect(bot.lookAcrossTheRoom).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2000);
        behavior.update(16);
        expect(bot.lookAcrossTheRoom).toHaveBeenCalledTimes(1);
        expect(gone).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('stays when asking to see the room finds its person, and asks again the next time they go missing', () => {
        vi.useFakeTimers();
        let person: { x: number; y: number } | undefined;
        const { behavior, bot, gone } = brickAt({ x: 100, y: 100 }, undefined);
        (bot.getPlayerPositionByUuid as ReturnType<typeof vi.fn>).mockImplementation(() => person);
        behavior.update(16);
        vi.advanceTimersByTime(VISIT_LOOK_ACROSS_AFTER_MS + 1000);
        behavior.update(16);
        expect(bot.lookAcrossTheRoom).toHaveBeenCalledTimes(1);
        person = { x: 120, y: 100 };
        vi.advanceTimersByTime(1000);
        behavior.update(16);
        person = undefined;
        vi.advanceTimersByTime(VISIT_LOOK_ACROSS_AFTER_MS + 1000);
        behavior.update(16);
        expect(bot.lookAcrossTheRoom).toHaveBeenCalledTimes(2);
        expect(gone).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('greets nobody', () => {
        const { behavior } = brickAt({ x: 0, y: 0 }, { x: 0, y: 0 });
        const greet = vi.fn();
        (behavior as unknown as { generateAIGreeting: unknown }).generateAIGreeting = greet;
        (behavior as unknown as { onMemoryReady: (space: string, user: { id: number }) => void }).onMemoryReady('space', { id: 7 });
        expect(greet).not.toHaveBeenCalled();
    });
});

describe('putting the Brick on the map', () => {
    function manager() {
        const orbit = { answer: [] as BotConfiguration[], fail: false };
        const admin = {
            isConfigured: () => true,
            getVisitingBricks: vi.fn(async (roomUrl: string) => {
                if (orbit.fail) throw new Error('down');
                return orbit.answer.filter((config) => config.roomUrl === roomUrl);
            }),
        };
        const botManager = new BotManager(admin as never, {} as never);
        const internals = botManager as unknown as { bots: Map<string, { botId: string; client: { setFullConfig: () => void }; config: BotConfiguration; status: string; lastHeartbeat: number }> };
        const spawn = vi.spyOn(botManager, 'spawnBot').mockImplementation(async (botId: string, cfg: BotConfiguration) => {
            internals.bots.set(botId, { botId, client: { setFullConfig: () => undefined }, config: cfg, status: 'connected', lastHeartbeat: 0 });
            return {} as never;
        });
        const despawn = vi.spyOn(botManager, 'despawnBot').mockImplementation(async (botId: string) => {
            internals.bots.delete(botId);
        });
        return { botManager, orbit, spawn, despawn, internals };
    }

    it('spawns the Brick Orbit names beside the person, once however often it is asked', async () => {
        const { botManager, orbit, spawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, { x: 40, y: 50 })).toEqual({ botId: 'brick-1' });
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(spawn.mock.calls[0][2]).toEqual({ position: { x: 40, y: 50 } });
    });

    it('runs one sync at a time for a person however many calls queue behind it (Sentry on #2023)', async () => {
        const { botManager, orbit, spawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        const internals = botManager as unknown as { runVisitSync: (...args: unknown[]) => Promise<{ botId: string | null }> };
        const real = internals.runVisitSync.bind(botManager);
        let running = 0;
        let most = 0;
        internals.runVisitSync = async (...args: unknown[]) => {
            running += 1;
            most = Math.max(most, running);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
            });
            try {
                return await real(...args);
            } finally {
                running -= 1;
            }
        };
        const answers = await Promise.all([1, 2, 3, 4].map(() => botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT)));
        expect(most).toBe(1);
        expect(answers.every((answer) => answer.botId === 'brick-1')).toBe(true);
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('takes a Brick off the map when only taking off is allowed, and never puts one on (Sentry on #2023)', async () => {
        const { botManager, orbit, spawn, despawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        expect(spawn).toHaveBeenCalledTimes(1);
        orbit.answer = [];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, undefined, false);
        expect(despawn).toHaveBeenCalledWith('brick-1');

        orbit.answer = [visitingConfig('brick-2', ROOM_A)];
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, undefined, false)).toEqual({ botId: null });
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('takes it off the map when the visit has ended', async () => {
        const { botManager, orbit, despawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        orbit.answer = [];
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT)).toEqual({ botId: null });
        expect(despawn).toHaveBeenCalledWith('brick-1');
    });

    it('forgets a Brick whose despawn failed, and drops its visitor, and still says it failed (Sentry on #2023)', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        despawn.mockImplementationOnce(async () => {
            throw new Error('registry unreachable');
        });
        orbit.answer = [];
        await expect(botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT)).rejects.toThrow('registry unreachable');
        expect(internals.bots.has('brick-1')).toBe(false);
        expect((botManager as unknown as { visitors: Map<string, unknown> }).visitors.has(KHALID)).toBe(false);
    });

    it('keeps its visitor listed until the despawn is done', async () => {
        const { botManager, orbit, despawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        const visitors = (botManager as unknown as { visitors: Map<string, unknown> }).visitors;
        let listedDuringDespawn: boolean | null = null;
        despawn.mockImplementationOnce(async () => {
            listedDuringDespawn = visitors.has(KHALID);
        });
        orbit.answer = [];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        expect(listedDuringDespawn).toBe(true);
        expect(visitors.has(KHALID)).toBe(false);
    });

    it('counts a visiting Brick as no person when it checks whether a room is empty (Sentry on #2023)', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        internals.bots.set('room-bot', { botId: 'room-bot', client: { setFullConfig: () => undefined }, config: visitingConfig('room-bot', ROOM_A), status: 'connected', lastHeartbeat: 0 });
        const rooms = (botManager as unknown as { roomsWithBots: Map<string, { botIds: Set<string>; lastActivity: number }> }).roomsWithBots;
        rooms.set(ROOM_A, { botIds: new Set(['room-bot']), lastActivity: Date.now() });
        const query = vi.spyOn(botManager as unknown as { queryWorkAdventureRooms: () => Promise<Map<string, number>> }, 'queryWorkAdventureRooms');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        // The game counts the room bot and the visiting Brick, and no person: the room is empty
        query.mockResolvedValue(new Map([[ROOM_A, 2]]));
        await botManager.verifyRoomOccupancy();
        expect(despawn).toHaveBeenCalledWith('room-bot');
        expect(rooms.has(ROOM_A)).toBe(false);
    });

    it('does not take a room with a person in it for empty because a visiting Brick is there', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        internals.bots.set('room-bot', { botId: 'room-bot', client: { setFullConfig: () => undefined }, config: visitingConfig('room-bot', ROOM_A), status: 'connected', lastHeartbeat: 0 });
        const rooms = (botManager as unknown as { roomsWithBots: Map<string, { botIds: Set<string>; lastActivity: number }> }).roomsWithBots;
        rooms.set(ROOM_A, { botIds: new Set(['room-bot']), lastActivity: Date.now() });
        vi.spyOn(botManager as unknown as { queryWorkAdventureRooms: () => Promise<Map<string, number>> }, 'queryWorkAdventureRooms').mockResolvedValue(new Map([[ROOM_A, 3]]));
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        await botManager.verifyRoomOccupancy();
        expect(despawn).not.toHaveBeenCalledWith('room-bot');
        expect(rooms.has(ROOM_A)).toBe(true);
    });

    it('follows its person to the next room: off the old map, on the new one', async () => {
        const { botManager, orbit, spawn, despawn } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A), visitingConfig('brick-1', ROOM_B)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        await botManager.syncVisitingBrick(ROOM_B, { uuid: KHALID }, AT);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(spawn.mock.calls[1][1].roomUrl).toBe(ROOM_B);
    });

    it('swaps one Brick for another the person brings along', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        orbit.answer = [visitingConfig('brick-2', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect([...internals.bots.keys()]).toEqual(['brick-2']);
    });

    it('leaves the map as it is when Orbit cannot answer', async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        orbit.fail = true;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT)).toEqual({ botId: 'brick-1' });
        expect(despawn).not.toHaveBeenCalled();
        expect(internals.bots.has('brick-1')).toBe(true);
    });

    it("never takes off someone else's Brick, and each person has their own", async () => {
        const { botManager, orbit, despawn, internals } = manager();
        orbit.answer = [visitingConfig('brick-1', ROOM_A, KHALID), visitingConfig('brick-9', ROOM_A, NOURA)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        await botManager.syncVisitingBrick(ROOM_A, { uuid: NOURA }, AT);
        expect([...internals.bots.keys()].sort()).toEqual(['brick-1', 'brick-9']);
        orbit.answer = [visitingConfig('brick-9', ROOM_A, NOURA)];
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT);
        expect(despawn).toHaveBeenCalledTimes(1);
        expect(despawn).toHaveBeenCalledWith('brick-1');
        expect(internals.bots.has('brick-9')).toBe(true);
    });
});

describe('a Brick in a room and the person talking to it', () => {
    it('is judged by who is asking, and never takes a person it cannot name for its owner', () => {
        const ai = new (AIService as unknown as new (...args: unknown[]) => AIService)();
        ai.noteRoomBrick('brick-1', { ownerUuid: KHALID, ownerName: 'Khalid', roomUrl: ROOM_A });
        const read = (ai as unknown as { roomBrickFor: (id: string, talker?: string) => unknown }).roomBrickFor.bind(ai);
        expect(read('brick-1', KHALID)).toEqual({ asker: KHALID, roomUrl: ROOM_A, ownerName: 'Khalid', forOthers: false });
        expect(read('brick-1', NOURA)).toEqual({ asker: NOURA, roomUrl: ROOM_A, ownerName: 'Khalid', forOthers: true });
        expect(read('brick-1', undefined)).toMatchObject({ asker: 'unknown', forOthers: true });
        expect(read('room-bot', NOURA)).toBeUndefined();
        ai.noteRoomBrick('brick-1', undefined);
        expect(read('brick-1', NOURA)).toBeUndefined();
    });

    it("tells it to keep its owner's things to itself with anyone else, and nothing odd to its owner", () => {
        const others = visitingRule('Khalid', true);
        expect(others).toContain("never use Khalid's apps, files or computer");
        expect(others).toContain('never repeat or hint at anything Khalid told you');
        expect(visitingRule('Khalid', false)).not.toContain('never use');
    });
});

describe('a Brick with no place to start from (Sentry on #2023)', () => {
    function manager() {
        const admin = { isConfigured: () => true, getVisitingBricks: vi.fn(async () => [visitingConfig('brick-1', ROOM_A)]) };
        const botManager = new BotManager(admin as never, {} as never);
        const spawn = vi.spyOn(botManager, 'spawnBot').mockResolvedValue({} as never);
        return { botManager, spawn };
    }

    it('is not put on the map at all, never at the map corner, and says there was no position', async () => {
        const { botManager, spawn } = manager();
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID })).toEqual({ botId: null, reason: 'no_position' });
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, { x: Number.NaN, y: 3 })).toEqual({ botId: null, reason: 'no_position' });
        expect(spawn).not.toHaveBeenCalled();
    });

    it('is put on the map beside its person once the next try has one', async () => {
        const { botManager, spawn } = manager();
        await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID });
        expect(await botManager.syncVisitingBrick(ROOM_A, { uuid: KHALID }, AT)).toEqual({ botId: 'brick-1' });
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(spawn.mock.calls[0][2]).toEqual({ position: AT });
    });
});
