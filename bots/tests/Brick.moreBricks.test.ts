/**
 * More Bricks, and deleting one with Undo (game #1996), on the bot server. A person's first Brick makes another Brick
 * the moment they ask, in their own direct messages only. It may suggest one for a job that keeps coming back: Orbit
 * says whether (once per topic, on every device), and the card goes out after the answer. A Brick its owner deleted
 * answers nothing and keeps its chat, so Undo finds it as it was.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import axios from 'axios';

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: (error: any) => !!error?.isAxiosError },
    isAxiosError: (error: any) => !!error?.isAxiosError,
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService } from '../server/AdminApiService';
import { BotAPI } from '../server/BotAPI';
import { BRICK_NOT_MADE_TEXT, DmReplyService, brickMadeText } from '../server/DmReplyService';
import { ConversationMemory } from '../memory/ConversationMemory';
import { BRICK_MADE_KEY, BRICK_MAKE_KEY, BRICK_OFFER_KEY, MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { AIService } from '../ai/AIService';
import { MAKE_BRICK_TOOL, SUGGEST_BRICK_TOOL, brickToolDefinitions, brickToolsNote, isBrickTool, runBrickTool, type BrickNote } from '../ai/BrickTools';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const request = axios.request as unknown as ReturnType<typeof vi.fn>;
const get = axios.get as unknown as ReturnType<typeof vi.fn>;

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const BRICK_USER = `@bot_${BRICK}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';
const MADE = { id: 'made-1', name: 'Recipe Brick', description: "Keeps your mum's recipes", characterTextureId: 'brick-red', enabled: true, isDefault: false, hello: null };
const ASK = { name: 'Recipe Brick', line: "Keeps your mum's recipes", instructions: 'You keep recipes.' };

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('What the bot server asks Orbit about Bricks', () => {
    let service: AdminApiService;
    const tokenBefore = process.env.BOT_SERVICE_TOKEN;

    beforeEach(() => {
        request.mockReset();
        get.mockReset();
        process.env.BOT_SERVICE_TOKEN = 'service-token';
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        service = new AdminApiService('http://orbit.test', 'admin-token');
    });
    afterAll(() => {
        if (tokenBefore === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = tokenBefore;
    });

    it('has a Brick made through the Brick that asks, for the person who asked, with the bot server\'s own token', async () => {
        request.mockResolvedValue({ status: 201, data: { made: true, brick: MADE, bricks: [MADE] } });

        const answer = await service.makeBrickFor(BRICK, 'uuid-alice', { name: 'Recipe Brick', description: "Keeps your mum's recipes" });

        expect(answer).toEqual({ made: true, brick: MADE });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                method: 'post',
                url: `http://orbit.test/api/bots/${BRICK}/bricks`,
                data: { userId: 'uuid-alice', name: 'Recipe Brick', description: "Keeps your mum's recipes" },
                headers: expect.objectContaining({ Authorization: 'Bearer service-token' }),
            })
        );
    });

    it('says so when Orbit refuses or answers without a Brick, so nobody is told a Brick was made that was not', async () => {
        request.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } });
        await expect(service.makeBrickFor(BRICK, 'uuid-bob', { name: 'Mine' })).rejects.toBeTruthy();
        request.mockResolvedValueOnce({ status: 201, data: { made: true } });
        await expect(service.makeBrickFor(BRICK, 'uuid-alice', { name: 'Mine' })).rejects.toThrow();
    });

    it('reads how often a job has to come back and what was already suggested', async () => {
        request.mockResolvedValue({ status: 200, data: { after: 5, topics: [{ topic: 'recipes', answer: 'not_now' }, { topic: 'workouts', answer: null }, { nope: 1 }] } });
        expect(await service.brickOffersFor(BRICK, 'uuid-alice')).toEqual({ after: 5, topics: ['recipes', 'workouts'] });
        expect(request.mock.calls[0][0]).toMatchObject({ method: 'get', url: `http://orbit.test/api/bots/${BRICK}/brick-offers`, params: { userId: 'uuid-alice' } });
    });

    it('asks Orbit whether a suggestion may be shown, and keeps what was tapped without ever failing a reply over it', async () => {
        request.mockResolvedValueOnce({ status: 200, data: { show: true, topic: 'recipes' } });
        expect(await service.claimBrickOffer(BRICK, 'uuid-alice', 'Recipes!')).toEqual({ show: true, topic: 'recipes' });
        request.mockResolvedValueOnce({ status: 200, data: { show: false, topic: 'recipes' } });
        expect(await service.claimBrickOffer(BRICK, 'uuid-alice', 'recipes')).toEqual({ show: false, topic: 'recipes' });

        request.mockRejectedValueOnce(new Error('down'));
        await expect(service.answerBrickOffer(BRICK, 'uuid-alice', 'recipes', 'not_now')).resolves.toBeUndefined();
        expect(request.mock.calls[2][0]).toMatchObject({ method: 'put', data: { userId: 'uuid-alice', topic: 'recipes', answer: 'not_now' } });
    });

    it('has Orbit remove what waited long enough, and takes "could not ask" as nothing removed', async () => {
        request.mockResolvedValueOnce({ status: 200, data: { removed: ['a', 7, 'b'] } });
        expect(await service.sweepBricks()).toEqual(['a', 'b']);
        expect(request.mock.calls[0][0]).toMatchObject({ method: 'post', url: 'http://orbit.test/api/bricks/sweep' });
        request.mockRejectedValueOnce(new Error('down'));
        expect(await service.sweepBricks()).toEqual([]);
    });

    it('reads a Brick that waits deleted as one, and every other Brick as not', async () => {
        const config = { botId: BRICK, name: 'Brick', enabled: false, roomUrl: null, worldUrl: null, createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z' };
        get.mockResolvedValueOnce({ status: 200, data: { ...config, brick: { ownerId: 'user-alice', isDefault: true, deleted: true } } });
        expect((await service.getBotConfiguration(BRICK, undefined, { bricks: true }))!.brick).toEqual({ ownerId: 'user-alice', isDefault: true, deleted: true });
        get.mockResolvedValueOnce({ status: 200, data: { ...config, brick: { ownerId: 'user-alice', isDefault: true, deleted: false } } });
        expect((await service.getBotConfiguration(BRICK, undefined, { bricks: true }))!.brick).toEqual({ ownerId: 'user-alice', isDefault: true });
    });
});

describe('The two Brick tools', () => {
    const admin = { makeBrickFor: vi.fn(), claimBrickOffer: vi.fn() };
    const context = (notes: BrickNote[] = []) => ({ admin, botId: BRICK, userId: 'uuid-alice', notes });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        admin.makeBrickFor.mockResolvedValue({ made: true, brick: MADE });
        admin.claimBrickOffer.mockResolvedValue({ show: true, topic: 'recipes' });
    });

    it('are make_brick and suggest_brick, and nothing else answers to those names', () => {
        expect(brickToolDefinitions().map((tool) => tool.function.name)).toEqual([MAKE_BRICK_TOOL, SUGGEST_BRICK_TOOL]);
        expect(isBrickTool('make_brick') && isBrickTool('suggest_brick')).toBe(true);
        expect(isBrickTool('make_artifact')).toBe(false);
    });

    it('tell the model to make it right away, with no confirming and no questions first', () => {
        const make = brickToolDefinitions()[0].function.description;
        expect(make).toContain('right now');
        expect(make).toContain('Do not ask them to confirm');
        expect(make).toContain('"Bot" and "Brick" mean the same');
    });

    it('make the Brick for the person, and leave a note for the game with its name, line and look', async () => {
        const notes: BrickNote[] = [];
        const result = await runBrickTool(MAKE_BRICK_TOOL, { ...ASK, hello: 'Send me the first recipe.' }, context(notes));

        expect(admin.makeBrickFor).toHaveBeenCalledWith(BRICK, 'uuid-alice', { name: 'Recipe Brick', description: "Keeps your mum's recipes", chatInstructions: 'You keep recipes.', hello: 'Send me the first recipe.' });
        expect(result).toMatchObject({ made: true, name: 'Recipe Brick' });
        expect(notes).toEqual([{ kind: 'made', id: 'made-1', name: 'Recipe Brick', line: "Keeps your mum's recipes", look: 'brick-red', made: true }]);
    });

    it('say so when they already have one of that name, and make a second only when asked for one', async () => {
        admin.makeBrickFor.mockResolvedValue({ made: false, brick: MADE });
        const notes: BrickNote[] = [];
        expect(await runBrickTool(MAKE_BRICK_TOOL, ASK, context(notes))).toMatchObject({ made: false, name: 'Recipe Brick' });
        expect(notes[0]).toMatchObject({ kind: 'made', made: false });
        await runBrickTool(MAKE_BRICK_TOOL, { ...ASK, name: 'Other Brick', second: true }, context());
        expect(admin.makeBrickFor.mock.calls[1][2]).toMatchObject({ evenIfThere: true });
    });

    it('make one Brick per ask: a second call for the same name in one reply makes nothing', async () => {
        const notes: BrickNote[] = [];
        await runBrickTool(MAKE_BRICK_TOOL, ASK, context(notes));
        await runBrickTool(MAKE_BRICK_TOOL, { ...ASK, name: 'recipe brick' }, context(notes));
        expect(admin.makeBrickFor).toHaveBeenCalledTimes(1);
        expect(notes).toHaveLength(1);
    });

    it('tell the model plainly when it did not work, and leave no note', async () => {
        admin.makeBrickFor.mockRejectedValue(new Error('down'));
        const notes: BrickNote[] = [];
        expect(await runBrickTool(MAKE_BRICK_TOOL, ASK, context(notes))).toHaveProperty('error');
        expect(await runBrickTool(MAKE_BRICK_TOOL, { line: 'x' }, context(notes))).toHaveProperty('error');
        expect(notes).toEqual([]);
    });

    it('suggest only when Orbit says the card may be shown, and then leave it for after the answer', async () => {
        const notes: BrickNote[] = [];
        const result = await runBrickTool(SUGGEST_BRICK_TOOL, { topic: 'Recipes', ask: 'You cook a lot. Want a Brick just for recipes?', ...ASK }, context(notes));

        expect(admin.claimBrickOffer).toHaveBeenCalledWith(BRICK, 'uuid-alice', 'Recipes');
        expect(result).toMatchObject({ shown: true });
        expect(notes).toEqual([{ kind: 'offer', topic: 'recipes', ask: 'You cook a lot. Want a Brick just for recipes?', name: 'Recipe Brick', line: "Keeps your mum's recipes", instructions: 'You keep recipes.' }]);
        expect(admin.makeBrickFor).not.toHaveBeenCalled();
    });

    it('suggest nothing a second time: not a topic Orbit already has, not twice in one reply, and not when Orbit cannot be asked', async () => {
        const offer = { topic: 'recipes', ask: 'Want a Brick for recipes?', ...ASK };
        admin.claimBrickOffer.mockResolvedValueOnce({ show: false, topic: 'recipes' });
        const notes: BrickNote[] = [];
        expect(await runBrickTool(SUGGEST_BRICK_TOOL, offer, context(notes))).toMatchObject({ shown: false });
        expect(notes).toEqual([]);

        await runBrickTool(SUGGEST_BRICK_TOOL, offer, context(notes));
        expect(await runBrickTool(SUGGEST_BRICK_TOOL, { ...offer, topic: 'workouts' }, context(notes))).toMatchObject({ shown: false });
        expect(notes).toHaveLength(1);
        expect(admin.claimBrickOffer).toHaveBeenCalledTimes(2);

        admin.claimBrickOffer.mockRejectedValueOnce(new Error('down'));
        expect(await runBrickTool(SUGGEST_BRICK_TOOL, offer, context())).toMatchObject({ shown: false });
        expect(await runBrickTool(SUGGEST_BRICK_TOOL, { ...offer, ask: '' }, context())).toMatchObject({ shown: false });
    });

    it('tell the Brick how often counts, and which topics it must never bring up again', () => {
        expect(brickToolsNote(null)).toContain('make_brick');
        expect(brickToolsNote(null)).not.toContain('suggest_brick');
        const note = brickToolsNote({ after: 4, topics: ['recipes', 'workouts'] });
        expect(note).toContain('at least 4 times');
        expect(note).toContain('only after you finished answering');
        expect(note).toContain('recipes, workouts');
    });
});

describe('Who has the Brick tools', () => {
    function service() {
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, { helperBricks: new Set<string>(), adminApiService: { isConfigured: () => true } });
        return ai as unknown as { noteBrick: AIService['noteBrick']; brickToolsOn(botId?: string, botClient?: unknown): boolean };
    }

    it('a person\'s first Brick, in a direct message', () => {
        const ai = service();
        expect(ai.brickToolsOn(BRICK)).toBe(false);
        ai.noteBrick(BRICK, { isDefault: true });
        expect(ai.brickToolsOn(BRICK)).toBe(true);
    });

    it('not a Brick they made, not a room bot, not a deleted Brick, and never on the map', () => {
        const ai = service();
        ai.noteBrick(BRICK, { isDefault: false });
        expect(ai.brickToolsOn(BRICK)).toBe(false);
        ai.noteBrick(BRICK, undefined);
        expect(ai.brickToolsOn(BRICK)).toBe(false);
        ai.noteBrick(BRICK, { isDefault: true, deleted: true });
        expect(ai.brickToolsOn(BRICK)).toBe(false);
        ai.noteBrick(BRICK, { isDefault: true });
        expect(ai.brickToolsOn(BRICK, {})).toBe(false);
        // Changed back: a Brick that stops being the first one loses them
        ai.noteBrick(BRICK, { isDefault: false });
        expect(ai.brickToolsOn(BRICK)).toBe(false);
    });
});

describe('A reply that made a Brick, or suggests one', () => {
    const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
    const brickConfig = { botId: BRICK, name: 'Brick', aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } };
    const offered = { topic: 'recipes', name: 'Recipe Brick', line: "Keeps your mum's recipes", instructions: 'You keep recipes.' };

    function makeReplies(config: Record<string, unknown>, duringTheTurn: (memory: ConversationMemory, playerId: number) => void = () => undefined) {
        const service = Object.create(DmReplyService.prototype) as DmReplyService;
        const memory = new ConversationMemory();
        const generate = vi.fn(async function* () {
            duringTheTurn(memory, service.playerIdFor(ALICE));
            yield { content: 'Done, here you go.', done: false };
            yield { content: '', done: true, metadata: {} };
        });
        const noteBrick = vi.fn();
        const admin = { makeBrickFor: vi.fn(async () => ({ made: true, brick: MADE })), answerBrickOffer: vi.fn(async () => undefined) };
        Object.assign(service, {
            queues: new Map(),
            waiting: new Map(),
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BRICK]),
            botManager: { getBot: () => null },
            getBotConfig: async () => config,
            aiService: { generateBotResponseStream: generate, noteBrick },
            adminApiService: admin,
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const history = () => (memory.getMemory(BRICK, service.playerIdFor(ALICE))?.conversationHistory ?? []).map((entry) => [entry.sender, entry.message]);
        return { service, generate, noteBrick, admin, history };
    }

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('tells the AI service before each answer whether this is a first Brick', async () => {
        const { service, noteBrick } = makeReplies(brickConfig);
        await service.reply(BRICK, person, 'hello', [], { roomId: ROOM });
        expect(noteBrick).toHaveBeenCalledWith(BRICK, { ownerId: 'user-alice', isDefault: true });
    });

    it('carries what the turn did about Bricks with the reply, once, and nothing left from a turn before', async () => {
        const note: BrickNote = { kind: 'made', id: 'made-1', name: 'Recipe Brick', line: null, look: 'brick-red', made: true };
        const { service } = makeReplies(brickConfig, (memory, playerId) => {
            (memory.getMemory(BRICK, playerId)!.pendingBricks ??= []).push(note);
        });
        expect((await service.reply(BRICK, person, 'make me a recipe bot', [], { roomId: ROOM }))!.bricks).toEqual([note]);

        const plain = makeReplies(brickConfig);
        const first = await plain.service.reply(BRICK, person, 'hello', [], { roomId: ROOM });
        expect(first).not.toHaveProperty('bricks');
    });

    it('makes the suggested Brick at the tap of "Make it", with fixed words and no model, and keeps that it was made', async () => {
        const { service, generate, admin, history } = makeReplies(brickConfig);

        const reply = await service.reply(BRICK, person, 'Make Recipe Brick', [], { roomId: ROOM, makeOffered: offered });

        expect(generate).not.toHaveBeenCalled();
        expect(admin.makeBrickFor).toHaveBeenCalledWith(BRICK, 'uuid-alice', { name: 'Recipe Brick', description: "Keeps your mum's recipes", chatInstructions: 'You keep recipes.' });
        expect(admin.answerBrickOffer).toHaveBeenCalledWith(BRICK, 'uuid-alice', 'recipes', 'made');
        expect(reply).toMatchObject({ text: brickMadeText('Recipe Brick'), bricks: [{ kind: 'made', id: 'made-1', name: 'Recipe Brick', made: true }] });
        reply!.keep!();
        reply!.keep!();
        expect(history()).toEqual([['person', 'Make Recipe Brick'], ['bot', brickMadeText('Recipe Brick')]]);
    });

    it('says it could not when Orbit does not make it, and claims no Brick', async () => {
        const { service, admin } = makeReplies(brickConfig);
        admin.makeBrickFor.mockRejectedValue(new Error('down'));
        const reply = await service.reply(BRICK, person, 'Make Recipe Brick', [], { roomId: ROOM, makeOffered: offered });
        expect(reply).toMatchObject({ text: BRICK_NOT_MADE_TEXT });
        expect(reply).not.toHaveProperty('bricks');
        expect(admin.answerBrickOffer).not.toHaveBeenCalled();
    });

    it('is a first Brick\'s thing only: any other bot answers such a message like any other', async () => {
        for (const config of [{ ...brickConfig, brick: { ownerId: 'user-alice', isDefault: false } }, { botId: BRICK, name: 'Nora', aiProviderRef: 'p', roomUrl: '' }]) {
            const { service, generate, admin } = makeReplies(config);
            await service.reply(BRICK, person, 'Make Recipe Brick', [], { roomId: ROOM, makeOffered: offered });
            expect(generate).toHaveBeenCalledTimes(1);
            expect(admin.makeBrickFor).not.toHaveBeenCalled();
        }
    });

    it('answers nothing for a Brick its owner deleted, and asks no model', async () => {
        const { service, generate } = makeReplies({ ...brickConfig, enabled: false, brick: { ownerId: 'user-alice', isDefault: true, deleted: true } });
        expect(await service.reply(BRICK, person, 'hello?', [], { roomId: ROOM })).toBeNull();
        expect(generate).not.toHaveBeenCalled();
    });

    it('reads a Brick again at once after it was deleted or taken back, instead of within the minute', async () => {
        const admin = { isConfigured: () => true, getBotConfiguration: vi.fn(async () => ({ botId: BRICK })) };
        const replies = Object.create(DmReplyService.prototype) as DmReplyService;
        Object.assign(replies, { botManager: { getBot: () => null, getAdminApiService: () => admin }, configCache: new Map(), missingCache: new Map() });
        await replies.getBotConfig(BRICK);
        await replies.getBotConfig(BRICK);
        expect(admin.getBotConfiguration).toHaveBeenCalledTimes(1);
        replies.forgetConfig(BRICK);
        await replies.getBotConfig(BRICK);
        expect(admin.getBotConfiguration).toHaveBeenCalledTimes(2);
    });
});

function makeClient(): any {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async (): Promise<string | null> => 'Brick'),
        joinRoom: vi.fn(async () => undefined),
        leaveRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async () => '$evt'),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BRICK_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
    };
}

function makeBridge(config: Record<string, unknown> = { botId: BRICK, name: 'Brick', enabled: true, aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } }) {
    const rooms = new Map<string, string>();
    const roomsOf = new Map<string, string>();
    const client = makeClient();
    const deps: any = {
        getBotConfig: vi.fn(async () => config),
        checkAccess: vi.fn(async (): Promise<any> => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async (): Promise<any> => ({ text: 'Hello Alice!', media: [] })),
        rooms: {
            rememberDmRoom: vi.fn(async (r: string, b: string) => void rooms.set(r, b)),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
            rememberDmRoomOf: vi.fn(async (b: string, u: string, r: string) => void roomsOf.set(`${b}|${u}`, r)),
            getDmRoomOf: vi.fn(async (b: string, u: string) => roomsOf.get(`${b}|${u}`) ?? null),
            forgetDmRoomOf: vi.fn(async (b: string, u: string) => void roomsOf.delete(`${b}|${u}`)),
        },
    };
    return { client, deps, config, bridge: new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps) };
}

const invite = (): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BRICK_USER, content: { membership: 'invite', is_direct: true },
});
const message = (body: string, extra: Record<string, unknown> = {}): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body, ...extra },
});

describe("More Bricks in a Brick's chat", () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    it('marks the answer that made a Brick, so the game shows a line for it one tap from its chat', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: 'Done. Recipe Brick is ready.', media: [], bricks: [{ kind: 'made', id: 'made-1', name: 'Recipe Brick', line: "Keeps your mum's recipes", look: 'brick-red', made: true }] });
        await bridge.onEvent(invite());

        await bridge.onEvent(message("make me a bot that keeps my mum's recipes"));

        expect(client.sendMessage.mock.calls).toEqual([
            [BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Done. Recipe Brick is ready.', [BRICK_MADE_KEY]: [{ id: 'made-1', name: 'Recipe Brick', line: "Keeps your mum's recipes", look: 'brick-red', made: true }] }],
        ]);
        expect(client.sendText).not.toHaveBeenCalled();
    });

    it('sends the suggestion as its own card after the answer, never before it and never without one', async () => {
        const offer = { kind: 'offer', topic: 'recipes', ask: 'You cook a lot. Want a Brick just for recipes?', name: 'Recipe Brick', line: 'It keeps your recipes in one place', instructions: 'You keep recipes.' };
        const { bridge, client, deps } = makeBridge();
        const order: string[] = [];
        client.sendText.mockImplementation(async () => void order.push('answer'));
        client.sendMessage.mockImplementation(async () => void order.push('card'));
        deps.reply.mockResolvedValue({ text: 'Here is the pasta recipe.', media: [], bricks: [offer] });
        await bridge.onEvent(invite());

        await bridge.onEvent(message('how do I make pasta again?'));

        expect(order).toEqual(['answer', 'card']);
        const { kind: _kind, ...card } = offer;
        expect(client.sendMessage.mock.calls[0]).toEqual([BRICK_USER, ROOM, { msgtype: 'm.text', body: offer.ask, [BRICK_OFFER_KEY]: card }]);

        client.sendMessage.mockClear();
        deps.reply.mockResolvedValue({ text: '', media: [], bricks: [offer] });
        await bridge.onEvent(message('again'));
        // An empty answer gets the chat's own "could not answer" note, and no card
        expect(client.sendMessage.mock.calls.some(([, , content]) => BRICK_OFFER_KEY in content)).toBe(false);
    });

    it('hands "Make it" on with the Brick the card described, cut to size, and typed words with nothing', async () => {
        const { bridge, deps } = makeBridge();
        await bridge.onEvent(invite());

        await bridge.onEvent(message('Make Recipe Brick', { [BRICK_MAKE_KEY]: { topic: ' recipes ', name: '  Recipe   Brick ', line: 'x'.repeat(300), instructions: 'You keep recipes.', owner: 'someone' } }));
        await bridge.onEvent(message('Make Recipe Brick'));
        await bridge.onEvent(message('Make Recipe Brick', { [BRICK_MAKE_KEY]: { topic: 'recipes' } }));

        expect(deps.reply.mock.calls[0][4].makeOffered).toEqual({ topic: 'recipes', name: 'Recipe Brick', line: 'x'.repeat(120), instructions: 'You keep recipes.' });
        expect(deps.reply.mock.calls[1][4]).not.toHaveProperty('makeOffered');
        expect(deps.reply.mock.calls[2][4]).not.toHaveProperty('makeOffered');
    });

    it('answers nothing, says nothing and keeps nothing for a Brick its owner deleted, and stays in its chat for Undo', async () => {
        const { bridge, client, deps, config } = makeBridge();
        await bridge.onEvent(invite());
        Object.assign(config, { enabled: false, brick: { ownerId: 'user-alice', isDefault: true, deleted: true } });

        await bridge.onEvent(message('are you there?'));

        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendText).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.leaveRoom).not.toHaveBeenCalled();

        // Taken back with Undo: it answers in the same chat
        Object.assign(config, { enabled: true, brick: { ownerId: 'user-alice', isDefault: true } });
        await bridge.onEvent(message('and now?'));
        expect(client.sendText).toHaveBeenCalledWith(BRICK_USER, ROOM, 'Hello Alice!');
    });
});

describe('POST /api/bots/:botId/brick-changed and /brick-offer', () => {
    const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
    const adminApiService = { validateSessionToken: vi.fn(), answerBrickOffer: vi.fn() };
    const brickChanged = vi.fn();
    let server: Server;
    let base: string;

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const api = new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { brickChanged });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (api as any).app;
        server = await new Promise<Server>((resolve) => {
            const started = app.listen(0, () => resolve(started));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => {
        vi.clearAllMocks();
        adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-alice', email: 'a@b.c' });
        adminApiService.answerBrickOffer.mockResolvedValue(undefined);
    });

    const post = (path: string, body: unknown = {}, headers: Record<string, string> = { Authorization: `Bearer ${SESSION}` }) =>
        fetch(`${base}/api/bots/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('has a Brick read again at once when the game says it was deleted or taken back', async () => {
        expect((await post(`${BRICK}/brick-changed`)).status).toBe(204);
        expect(brickChanged).toHaveBeenCalledWith(BRICK);
    });

    it('keeps "Not now" for the person the session names, never for a name in the request', async () => {
        expect((await post(`${BRICK}/brick-offer`, { topic: 'recipes', userId: 'uuid-bob' })).status).toBe(204);
        expect(adminApiService.answerBrickOffer).toHaveBeenCalledWith(BRICK, 'uuid-alice', 'recipes', 'not_now');
    });

    it('needs an Orbit session, a bot id and a topic', async () => {
        expect((await post(`${BRICK}/brick-changed`, {}, {})).status).toBe(401);
        expect((await post(`${BRICK}/brick-offer`, { topic: 'recipes' }, {})).status).toBe(401);
        expect((await post(`${BRICK}/brick-offer`, {})).status).toBe(400);
        expect((await post(`${BRICK}/brick-offer`, { topic: 'x'.repeat(201) })).status).toBe(400);
        expect((await post(`not%20an%20id/brick-changed`)).status).toBe(400);
        expect(brickChanged).not.toHaveBeenCalled();
        expect(adminApiService.answerBrickOffer).not.toHaveBeenCalled();
    });
});
