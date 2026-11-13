/**
 * The Brick everyone gets (game #1995), on the bot server. A Brick lives in its owner's chats and stands in no room:
 * only direct messages read one, it is never put on a map, it talks its own way, its "what I can do" is fixed words that
 * ask no model, and however many devices open its chat at once there is one chat.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import axios from 'axios';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), isAxiosError: (error: any) => !!error?.isAxiosError }, isAxiosError: (error: any) => !!error?.isAxiosError }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService } from '../server/AdminApiService';
import { BotAPI } from '../server/BotAPI';
import { BotManager } from '../server/BotManager';
import { BotRegistry } from '../server/BotRegistry';
import { BRICK_IDEAS_TEXT, DmReplyService, instructionsFor, STARTER_IDEAS } from '../server/DmReplyService';
import { ConversationMemory } from '../memory/ConversationMemory';
import { BRICK_IDEAS_KEY, MatrixDmBridge, STARTER_KEY } from '../matrix/MatrixDmBridge';
import { buildSystemPrompt } from '../ai/systemPrompt';
import { AIService } from '../ai/AIService';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const get = axios.get as unknown as ReturnType<typeof vi.fn>;

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const BRICK_USER = `@bot_${BRICK}:matrix.test`;
const ALICE = '@alice:matrix.test';
const BOB = '@bob:matrix.test';
const ROOM = '!dm:matrix.test';

/** What Orbit answers for a Brick asked for with `bricks=1` (Orbit #916). */
const orbitBrick = (overrides: Record<string, unknown> = {}) => ({
    botId: BRICK,
    name: 'Brick',
    brick: { ownerId: 'user-alice', isDefault: true },
    roomUrl: null,
    worldUrl: null,
    universeUrl: null,
    userId: 'user-alice',
    behaviorType: 'idle',
    behaviorConfig: { showToolCalls: true, behaviorType: 'idle', assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } },
    assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
    enabled: true,
    characterTextureIds: ['brick-orange'],
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
    aiProviderRef: 'universe-ai',
    chatInstructions: null,
    movementInstructions: null,
    toolTimeoutSeconds: null,
    maxReplyTokens: null,
    maxSteps: null,
    companionTextureId: null,
    voiceEnabled: false,
    ...overrides,
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('A Brick is read for direct messages only', () => {
    let service: AdminApiService;

    beforeEach(() => {
        get.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        service = new AdminApiService('http://orbit.test', 'admin-token');
    });

    it('asks Orbit for a Brick by name only when the caller says it takes one, and reads "no room" as an empty address', async () => {
        get.mockResolvedValue({ status: 200, data: orbitBrick() });

        const config = await service.getBotConfiguration(BRICK, 5000, { bricks: true });

        expect(get).toHaveBeenCalledWith(
            `http://orbit.test/api/bots/configuration/${BRICK}`,
            expect.objectContaining({ params: { bricks: 1 }, timeout: 5000, headers: { Authorization: 'Bearer admin-token' } })
        );
        expect(config).toMatchObject({
            botId: BRICK,
            brick: { ownerId: 'user-alice', isDefault: true },
            roomUrl: '',
            worldUrl: '',
            aiProviderRef: 'universe-ai',
            voiceEnabled: false,
        });
        expect(config!.universeUrl).toBeUndefined();
        expect(config!.createdAt).toBeInstanceOf(Date);
    });

    it('asks as before for everyone else, who still hear "no such bot" for a Brick: from Orbit, or here if Orbit ever sent one unasked', async () => {
        get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } });
        expect(await service.getBotConfiguration(BRICK)).toBeNull();
        expect(get.mock.calls[0][1]).not.toHaveProperty('params');

        get.mockResolvedValueOnce({ status: 200, data: orbitBrick() });
        expect(await service.getBotConfiguration(BRICK, 2000)).toBeNull();
    });

    it('leaves a room bot exactly as it was, with or without the Brick question', async () => {
        const roomBot = { ...orbitBrick(), brick: undefined, roomUrl: 'http://play.test/@/u/w/r', worldUrl: 'http://play.test/@/u/w', universeUrl: 'http://play.test/@/u' };
        get.mockResolvedValue({ status: 200, data: roomBot });

        for (const options of [undefined, { bricks: true }]) {
            const config = await service.getBotConfiguration(BRICK, undefined, options);
            expect(config).toMatchObject({ roomUrl: 'http://play.test/@/u/w/r', worldUrl: 'http://play.test/@/u/w', universeUrl: 'http://play.test/@/u' });
            expect(config!.brick).toBeUndefined();
        }
    });

    it('takes nothing for a Brick that does not say whose it is', async () => {
        for (const brick of [{}, { ownerId: '' }, { ownerId: 7 }, 'yes', null]) {
            get.mockResolvedValueOnce({ status: 200, data: orbitBrick({ brick, roomUrl: 'http://play.test/@/u/w/r' }) });
            expect((await service.getBotConfiguration(BRICK, undefined, { bricks: true }))!.brick).toBeUndefined();
        }
    });

    it('is the one question direct messages ask, and its answer is cached like any bot', async () => {
        const admin = { isConfigured: () => true, getBotConfiguration: vi.fn(async () => ({ botId: BRICK, brick: { ownerId: 'user-alice', isDefault: true } })) };
        const replies = Object.create(DmReplyService.prototype) as DmReplyService;
        Object.assign(replies, { botManager: { getBot: () => null, getAdminApiService: () => admin }, configCache: new Map(), missingCache: new Map() });

        expect(await replies.getBotConfig(BRICK)).toMatchObject({ brick: { ownerId: 'user-alice' } });
        await replies.getBotConfig(BRICK);

        expect(admin.getBotConfiguration.mock.calls).toEqual([[BRICK, 10_000, { bricks: true }]]);
    });
});

describe('A Brick is never put on a map', () => {
    it('refuses to spawn a Brick, or any bot with no room, before anything is connected', async () => {
        const manager = Object.create(BotManager.prototype) as BotManager;
        Object.assign(manager, { bots: new Map() });
        const brick = { botId: BRICK, name: 'Brick', roomUrl: '', worldUrl: '', brick: { ownerId: 'user-alice', isDefault: true } };

        await expect(manager.spawnBot(BRICK, brick as never)).rejects.toThrow('has no room');
        await expect(manager.spawnBot(BRICK, { ...brick, brick: undefined } as never)).rejects.toThrow('has no room');
        // Even one that somehow came with a room address
        await expect(manager.spawnBot(BRICK, { ...brick, roomUrl: 'http://play.test/@/u/w/r' } as never)).rejects.toThrow('has no room');
    });
});

describe("A Brick's own way of talking", () => {
    it('gives a room bot its own instructions, or the old default, untouched', () => {
        expect(instructionsFor({ name: 'Nora', chatInstructions: 'You are a pirate.' })).toBe('You are a pirate.');
        expect(instructionsFor({ name: 'Nora', chatInstructions: undefined })).toBe('You are a helpful bot.');
    });

    it('gives a Brick a built-in personality until its owner writes one, and always what is true of every Brick', () => {
        const builtIn = instructionsFor({ name: 'Brick', chatInstructions: undefined, brick: { ownerId: 'u', isDefault: true } });
        const own = instructionsFor({ name: 'Sunny', chatInstructions: 'You are a pirate.', brick: { ownerId: 'u', isDefault: false } });

        expect(builtIn).toContain("this person's own helper in Universe");
        expect(own.startsWith('You are a pirate.')).toBe(true);
        expect(own).not.toContain("this person's own helper in Universe");
        for (const [text, name] of [[builtIn, 'Brick'], [own, 'Sunny']] as const) {
            expect(text).toContain(`Your name is ${name}.`);
            // "Bot" and "Brick" are the same word to it
            expect(text).toContain('People also say "bot": to you the two words mean the same thing');
            // It lives in its owner's chats
            expect(text).toContain('you live in their chats, not in a room on the map');
            // No gender
            expect(text).toContain('neither a "he" nor a "she"');
            // Only what works today
            expect(text).toContain('Only offer what you can do in this chat today');
        }
    });

    it('never tells the model to say what it is, and carries no limits or legal lines', () => {
        const text = instructionsFor({ name: 'Brick', chatInstructions: undefined, brick: { ownerId: 'u', isDefault: true } });
        expect(text).not.toMatch(/\bAI\b|artificial|language model|terms|privacy|limit of|\d+ (messages|replies)/i);
    });
});

describe('The rules of a direct message with a bot that has no room', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const brick = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', noRoom: true, now });
    const roomBot = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', now });

    it('speak of no room: nothing to name, nobody to invite, no card to send', () => {
        expect(brick).toContain("You live in this person's chats, not in a room on the map.");
        expect(brick).toContain('never add [ROOM_CARD] to a reply');
        expect(brick).not.toContain('You still live in the room named in your location context');
        expect(brick).not.toContain('invite them to come find you in your room');
        expect(brick).not.toContain('who is in your room right now');
    });

    it('leave a room bot in a direct message, and every bot on the map, word for word as they were', () => {
        expect(roomBot).toContain('You still live in the room named in your location context');
        expect(roomBot).not.toContain("You live in this person's chats");
        expect(buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', noRoom: false, now })).toBe(roomBot);
        const world = buildSystemPrompt({ chatInstructions: 'You are Nora.', now });
        expect(buildSystemPrompt({ chatInstructions: 'You are Nora.', noRoom: true, now })).toBe(world);
    });

    it('differ from the room rules in that one block only, so everything else a bot is told stays the same', () => {
        const before = roomBot.indexOf('**DIRECT MESSAGE');
        const after = roomBot.indexOf('**FOLLOW-UP QUESTIONS');
        expect(brick.slice(0, brick.indexOf('**DIRECT MESSAGE'))).toBe(roomBot.slice(0, before));
        expect(brick.slice(brick.indexOf('**FOLLOW-UP QUESTIONS'))).toBe(roomBot.slice(after));
    });
});

describe('A second try at an answer in a direct message', () => {
    it('does not fail for want of a bot on the map (the retry after a repeat passes none)', async () => {
        const ai = new AIService(null!, null!, '');
        const turns: unknown[][] = [];
        Object.assign(ai, {
            generateTurn: async function* (...args: unknown[]) {
                turns.push(args);
                yield { content: 'A different answer.', done: false };
                yield { content: '', done: true, metadata: {} };
            },
        });
        const chunks: Array<{ content: string; done: boolean }> = [];
        // As BaseBehavior.regenerateOnRepetition calls it from DmReplyService: `this.bot` is null there, and it is a retry
        for await (const chunk of ai.generateBotResponseStream('bot1', -1, 'hi', 'You are Brick.', 'p', 'matrix-dm', '', null as never, undefined, undefined, undefined, 'dm', null, '', null, true)) {
            chunks.push(chunk);
        }
        expect(chunks.map((chunk) => chunk.content).join('')).toBe('A different answer.');
        expect(chunks.at(-1)?.done).toBe(true);
        expect(turns).toHaveLength(1);
    });
});

describe("A Brick's fixed \"what I can do\"", () => {
    const person = { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false };
    const SAID = 'What can you do for me?';

    function makeReplies(config: Record<string, unknown>) {
        const service = Object.create(DmReplyService.prototype) as DmReplyService;
        const memory = new ConversationMemory();
        const generate = vi.fn(async function* () {
            yield { content: 'From the model.', done: false };
            yield { content: '', done: true, metadata: {} };
        });
        Object.assign(service, {
            queues: new Map(),
            waiting: new Map(),
            playerIds: new Map(),
            nextPlayerId: -1,
            loadedBots: new Set([BRICK]),
            botManager: { getBot: () => null },
            getBotConfig: async () => config,
            aiService: { generateBotResponseStream: generate },
            conversationMemory: memory,
            conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        });
        const history = () => (memory.getMemory(BRICK, service.playerIdFor(ALICE))?.conversationHistory ?? []).map((entry) => [entry.sender, entry.message]);
        return { service, generate, history };
    }
    const brickConfig = { botId: BRICK, name: 'Brick', aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } };

    it('answers the starter with fixed words and asks no model', async () => {
        const { service, generate, history } = makeReplies(brickConfig);

        const reply = await service.reply(BRICK, person, SAID, [], { roomId: ROOM, starter: STARTER_IDEAS });

        expect(reply).toMatchObject({ text: BRICK_IDEAS_TEXT, media: [], ideas: true });
        expect(generate).not.toHaveBeenCalled();
        // What they tapped is remembered at once; what the Brick said, once it reached them
        expect(history()).toEqual([['person', SAID]]);
        reply!.keep!();
        reply!.keep!();
        expect(history()).toEqual([['person', SAID], ['bot', BRICK_IDEAS_TEXT]]);
    });

    it('asks the model as usual when the same words are typed, and gives it the Brick instructions and no room', async () => {
        const { service, generate } = makeReplies(brickConfig);

        const reply = await service.reply(BRICK, person, SAID, [], { roomId: ROOM });

        expect(reply).toMatchObject({ text: 'From the model.' });
        expect(reply!.ideas).toBeUndefined();
        const args = generate.mock.calls[0] as unknown[];
        expect(args[3]).toBe(instructionsFor(brickConfig as never));
        expect(args[11]).toBe('dm');
        // Its home room: none, so no location is read and no room card is made
        expect(args[13]).toBe('');
        expect(reply!.roomLink).toBeUndefined();
    });

    it('is a Brick thing only: a room bot answers a message with the marker like any other', async () => {
        const { service, generate } = makeReplies({ botId: BRICK, name: 'Nora', aiProviderRef: 'p', roomUrl: '' });

        const reply = await service.reply(BRICK, person, SAID, [], { roomId: ROOM, starter: STARTER_IDEAS });

        expect(reply).toMatchObject({ text: 'From the model.' });
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('never answers a tapped starter together with typed words that waited, in either order', async () => {
        const service = Object.create(DmReplyService.prototype) as DmReplyService;
        let release!: () => void;
        const first = new Promise<void>((resolve) => (release = resolve));
        const asked: Array<[string, string | undefined]> = [];
        const replyNow = vi.fn(async (_bot: string, _person: unknown, text: string, _files: unknown, hooks: { starter?: string }) => {
            asked.push([text, hooks.starter]);
            if (asked.length === 1) await first;
            return { text: `answer to ${text}`, media: [] };
        });
        Object.assign(service, { queues: new Map(), waiting: new Map(), replyNow });

        const answering = service.reply(BRICK, person, 'hi');
        const typed = service.reply(BRICK, person, 'are you there');
        const tapped = service.reply(BRICK, person, SAID, [], { starter: STARTER_IDEAS });
        const after = service.reply(BRICK, person, 'and one more thing');
        release();
        await Promise.all([answering, typed, tapped, after]);

        expect(asked).toEqual([
            ['hi', undefined],
            ['are you there', undefined],
            [SAID, STARTER_IDEAS],
            ['and one more thing', undefined],
        ]);
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
    return { client, deps, roomsOf, bridge: new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps) };
}

const invite = (overrides: Partial<MatrixEvent> = {}): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BRICK_USER, content: { membership: 'invite', is_direct: true }, ...overrides,
});
const message = (body: string, extra: Record<string, unknown> = {}): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body, ...extra },
});

describe('One chat for a person and their Brick, however many devices open it', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    it('tells the first device to make the chat and every other one to ask again, then gives them all the chat the bot joined', async () => {
        const { bridge } = makeBridge();

        // Two devices, and a double tap, at the same moment
        const answers = await Promise.all([bridge.directChatFor(BRICK, ALICE), bridge.directChatFor(BRICK, ALICE), bridge.directChatFor(BRICK, ALICE)]);
        expect(answers.filter((answer) => 'create' in answer)).toHaveLength(1);
        expect(answers.filter((answer) => 'wait' in answer)).toHaveLength(2);

        // The first device made it and the bot joined
        await bridge.onEvent(invite());

        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
    });

    it('tells the device that makes the chat which account to invite: the Brick\'s own chat address', async () => {
        const { bridge } = makeBridge();

        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ create: true, botChatId: BRICK_USER });
        // A bot id that cannot be a chat address has no chat to make
        expect(await bridge.directChatFor('not a bot id', ALICE)).toEqual({ wait: true });
    });

    it('lets another device make it when the first never did, after a few seconds and not before', async () => {
        vi.useFakeTimers();
        const { bridge } = makeBridge();

        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
        vi.advanceTimersByTime(19_000);
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
        vi.advanceTimersByTime(2_000);
        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
    });

    it("holds nobody else back: one person's claim is theirs alone, and one Brick's is that Brick's", async () => {
        const { bridge } = makeBridge();
        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
        expect(await bridge.directChatFor(BRICK, BOB)).toMatchObject({ create: true });
        expect(await bridge.directChatFor('another-brick', ALICE)).toMatchObject({ create: true });
    });

    it('goes by the shared store when there is one, so two bot servers still hand out one turn', async () => {
        const { bridge, deps } = makeBridge();
        deps.rooms.claimDirectChat = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
        expect(deps.rooms.claimDirectChat).toHaveBeenCalledWith(BRICK, ALICE, 20_000, expect.any(String));

        // No shared store at all (one bot server): the bridge keeps its own turn
        deps.rooms.claimDirectChat = vi.fn().mockResolvedValue(null);
        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
    });

    it('has nobody make the chat while the shared claim cannot be asked, instead of keeping its own turn', async () => {
        const { bridge, deps } = makeBridge();
        deps.rooms.claimDirectChat = vi.fn().mockRejectedValue(new Error('redis timeout'));
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
    });

    it('holds the turn while the bot takes the chat a device just made, however long that takes, then lets it go', async () => {
        const { bridge, deps } = makeBridge();
        deps.rooms.claimDirectChat = vi.fn().mockResolvedValue(null);
        deps.rooms.holdDirectChat = vi.fn(async () => undefined);
        deps.rooms.releaseDirectChat = vi.fn(async () => undefined);
        let configRead: () => void = () => undefined;
        const config = deps.getBotConfig.getMockImplementation();
        deps.getBotConfig.mockImplementationOnce(() => new Promise((resolve) => (configRead = () => resolve(config()))));

        const taking = bridge.onEvent(invite());
        // The first hold takes the claim over, under this invite's own token
        await vi.waitFor(() => expect(deps.rooms.holdDirectChat).toHaveBeenCalledWith(BRICK, ALICE, 20_000, expect.any(String), true));
        // Another device asks while the bot is still taking it: it waits (the turn is renewed until the bot is done)
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
        configRead();
        await taking;
        expect(deps.rooms.releaseDirectChat).toHaveBeenCalledWith(BRICK, ALICE, expect.any(String));
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
    });

    it('keeps renewing the turn through an invite longer than the claim, also after one renewal failed', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        try {
            const { bridge, deps } = makeBridge();
            deps.rooms.claimDirectChat = vi.fn().mockResolvedValue(null);
            // The second renewal fails (Redis blipped); the ones after it go through again
            deps.rooms.holdDirectChat = vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('redis timeout'))
                .mockResolvedValue(undefined);
            deps.rooms.releaseDirectChat = vi.fn(async () => undefined);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            let configRead: () => void = () => undefined;
            const config = deps.getBotConfig.getMockImplementation();
            deps.getBotConfig.mockImplementationOnce(() => new Promise((resolve) => (configRead = () => resolve(config()))));

            const taking = bridge.onEvent(invite());
            await vi.advanceTimersByTimeAsync(45_000);
            // Renewed every 5 seconds for 45 seconds, the failed one included: never left to lapse
            expect((deps.rooms.holdDirectChat as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(9);
            expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
            configRead();
            await taking;
            expect(deps.rooms.releaseDirectChat).toHaveBeenCalledWith(BRICK, ALICE, expect.any(String));
            const renewals = (deps.rooms.holdDirectChat as ReturnType<typeof vi.fn>).mock.calls.length;
            await vi.advanceTimersByTimeAsync(30_000);
            // Once the bot has the chat, nothing renews it
            expect((deps.rooms.holdDirectChat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(renewals);
            warn.mockRestore();
        } finally {
            vi.useRealTimers();
        }
    });

    it('never lets a second bot server make the chat while this one takes it, even across a failed renewal', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
        try {
            // One Redis for both servers: a key with its expiry, as SET NX PX and SET PX keep it
            const store = new Map<string, { owner: string; until: number }>();
            const live = (key: string) => {
                const entry = store.get(key);
                return entry && entry.until > Date.now() ? entry : undefined;
            };
            const shared = (server: string) => ({
                claimDirectChat: vi.fn(async (botId: string, user: string, forMs: number) => {
                    const key = `${botId}|${user}`;
                    if (live(key)) return false;
                    store.set(key, { owner: server, until: Date.now() + forMs });
                    return true;
                }),
                holdDirectChat: vi.fn(async (botId: string, user: string, forMs: number) => {
                    store.set(`${botId}|${user}`, { owner: server, until: Date.now() + forMs });
                }),
                releaseDirectChat: vi.fn(async (botId: string, user: string) => {
                    store.delete(`${botId}|${user}`);
                }),
            });
            const first = makeBridge();
            const second = makeBridge();
            Object.assign(first.deps.rooms, shared('server-1'));
            Object.assign(second.deps.rooms, shared('server-2'));
            // The first server's second renewal does not reach Redis
            const hold = first.deps.rooms.holdDirectChat as ReturnType<typeof vi.fn>;
            const realHold = hold.getMockImplementation()!;
            let renewals = 0;
            // and the ones after it take half a second to reach it
            hold.mockImplementation(async (...args: [string, string, number]) => {
                const renewal = ++renewals;
                if (renewal === 2) throw new Error('redis timeout');
                if (renewal > 2) await new Promise((resolve) => setTimeout(resolve, 500));
                return realHold(...args);
            });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            let configRead: () => void = () => undefined;
            const config = first.deps.getBotConfig.getMockImplementation();
            first.deps.getBotConfig.mockImplementationOnce(() => new Promise((resolve) => (configRead = () => resolve(config()))));

            const taking = first.bridge.onEvent(invite());
            // Four times a second for 45 seconds, the person's other device asks the other server
            for (let tick = 0; tick < 180; tick++) {
                await vi.advanceTimersByTimeAsync(250);
                expect(await second.bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
            }
            configRead();
            await taking;
            expect(store.size).toBe(0);
            warn.mockRestore();
        } finally {
            vi.useRealTimers();
        }
    });

    it('renews and lets go under the token it took the claim with, taking it over only the first time', async () => {
        const { bridge, deps } = makeBridge();
        deps.rooms.claimDirectChat = vi.fn().mockResolvedValue(null);
        deps.rooms.holdDirectChat = vi.fn(async () => undefined);
        deps.rooms.releaseDirectChat = vi.fn(async () => undefined);
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        try {
            let configRead: () => void = () => undefined;
            const config = deps.getBotConfig.getMockImplementation();
            deps.getBotConfig.mockImplementationOnce(() => new Promise((resolve) => (configRead = () => resolve(config()))));
            const taking = bridge.onEvent(invite());
            await vi.advanceTimersByTimeAsync(11_000);
            const holds = (deps.rooms.holdDirectChat as ReturnType<typeof vi.fn>).mock.calls;
            expect(holds.length).toBeGreaterThanOrEqual(3);
            const token = holds[0][3];
            expect(holds.map((call: unknown[]) => call[3])).toEqual(holds.map(() => token));
            expect(holds.map((call: unknown[]) => call[4])).toEqual([true, ...holds.slice(1).map(() => false)]);
            configRead();
            await taking;
            expect(deps.rooms.releaseDirectChat).toHaveBeenCalledWith(BRICK, ALICE, token);
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives the chat another device just noted, instead of making a second, when it was noted while the claim was asked', async () => {
        const { bridge, deps } = makeBridge();
        deps.rooms.releaseDirectChat = vi.fn(async () => undefined);
        // Between this device's first look and its claim, the other device's invite was taken, noted and its claim let go
        deps.rooms.claimDirectChat = vi.fn(async () => {
            await bridge.onEvent(invite());
            return true;
        });

        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
        // The claim it was given goes back at once, under its own token: no device is held up by it
        const claim = vi.mocked(deps.rooms.claimDirectChat).mock.calls[0][3];
        expect(claim).toEqual(expect.any(String));
        expect(deps.rooms.releaseDirectChat).toHaveBeenLastCalledWith(BRICK, ALICE, claim);
    });

    it('never lets go of a claim another device made since, when its own second look took longer than the claim', async () => {
        const { bridge, deps } = makeBridge();
        // The shared claim: one key, as the registry keeps it. Without a token it is let go whoever holds it
        let held: string | undefined;
        deps.rooms.claimDirectChat = vi.fn(async (_botId: string, _user: string, _forMs: number, token?: string) => {
            if (held) return false;
            held = token;
            return true;
        });
        deps.rooms.releaseDirectChat = vi.fn(async (_botId: string, _user: string, token?: string) => {
            if (token === undefined || held === token) held = undefined;
        });
        const firstLook = deps.rooms.getDmRoomOf;
        let looks = 0;
        deps.rooms.getDmRoomOf = vi.fn(async (botId: string, user: string) => {
            looks++;
            if (looks === 2) {
                // This device's second look is slow: its claim runs out, another device claims, and a chat is noted
                held = 'other-device';
                await bridge.onEvent(invite());
                held = 'other-device';
            }
            return firstLook(botId, user);
        });

        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
        await Promise.resolve();
        expect(deps.rooms.releaseDirectChat).toHaveBeenLastCalledWith(BRICK, ALICE, vi.mocked(deps.rooms.claimDirectChat).mock.calls[0][3]);
        expect(held).toBe('other-device');
    });

    it('never has a second chat made while the one they have could not be looked at', async () => {
        const { bridge, client } = makeBridge();
        await bridge.onEvent(invite());
        client.getJoinedMembers.mockRejectedValue(new Error('homeserver down'));

        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
    });

    it('forgets a chat that is no longer theirs alone, and has a new one made', async () => {
        const { bridge, client, roomsOf } = makeBridge();
        await bridge.onEvent(invite());
        client.getJoinedMembers.mockResolvedValue([ALICE, BRICK_USER, BOB]);

        expect(await bridge.directChatFor(BRICK, ALICE)).toMatchObject({ create: true });
        expect(roomsOf.size).toBe(0);
    });

    it('knows the chat after a restart, from the shared store, once it has checked it is still theirs', async () => {
        const first = makeBridge();
        await first.bridge.onEvent(invite());
        const second = makeBridge();
        second.deps.rooms.getDmRoomOf = first.deps.rooms.getDmRoomOf;
        second.deps.rooms.getDmRoomBot = first.deps.rooms.getDmRoomBot;

        expect(await second.bridge.directChatFor(BRICK, ALICE)).toEqual({ roomId: ROOM });
        expect(second.client.getJoinedMembers).toHaveBeenCalledWith(BRICK_USER, ROOM);
    });

    it('is not for bots: a bot account asking is told to wait and claims nothing', async () => {
        const { bridge } = makeBridge();
        expect(await bridge.directChatFor(BRICK, '@bot_other:matrix.test')).toEqual({ wait: true });
        expect(await bridge.directChatFor(BRICK, '@bot_other:matrix.test')).toEqual({ wait: true });
    });
});

describe('BotRegistry: one turn to make a chat, across bot servers', () => {
    it('sets the claim only if nobody holds it, for as long as asked, and says who got it', async () => {
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
        Object.assign(registry, { redis: { isOpen: true, set }, serverId: 'server-1' });

        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBe(true);
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBe(false);
        expect(set).toHaveBeenCalledWith(`bots:matrix:dm-claim:${BRICK}|${ALICE}`, 'server-1', { NX: true, PX: 20_000 });
    });

    it('holds and lets go of the claim for whoever has it', async () => {
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        const set = vi.fn().mockResolvedValue('OK');
        const del = vi.fn().mockResolvedValue(1);
        Object.assign(registry, { redis: { isOpen: true, set, del }, serverId: 'server-2' });
        await registry.holdDirectChat(BRICK, ALICE, 20_000);
        expect(set).toHaveBeenCalledWith(`bots:matrix:dm-claim:${BRICK}|${ALICE}`, 'server-2', { PX: 20_000 });
        await registry.releaseDirectChat(BRICK, ALICE);
        expect(del).toHaveBeenCalledWith(`bots:matrix:dm-claim:${BRICK}|${ALICE}`);
    });

    it('says it cannot tell without Redis, so the caller keeps its own', async () => {
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        Object.assign(registry, { redis: { isOpen: false }, serverId: 'server-1' });
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBeNull();
    });

    it('counts Redis as in use from the moment it connected, before any request can come in', async () => {
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        const redis = { isOpen: false, connect: vi.fn(async () => { redis.isOpen = true; }) };
        Object.assign(registry, { redis, serverId: 'server-1', sharedStoreSeen: false });
        // Configured but never connected: there is no server taking requests yet, and no claim is shared
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBeNull();
        await registry.connect();
        // The connection drops later: the claim fails rather than fall back to a claim of this server alone
        redis.isOpen = false;
        await expect(registry.claimDirectChat(BRICK, ALICE, 20_000)).rejects.toThrow('The shared store is down');
    });

    it("never lets an invite that ran past its claim take back, or let go of, a claim another device took since", async () => {
        // One Redis key with its value, and the two scripts the registry runs on it
        const store = new Map<string, string>();
        const redis = {
            isOpen: true,
            set: vi.fn(async (key: string, value: string, options: { NX?: boolean }) => {
                if (options?.NX && store.has(key)) return null;
                store.set(key, value);
                return 'OK';
            }),
            eval: vi.fn(async (script: string, { keys: [key], arguments: args }: { keys: string[]; arguments: string[] }) => {
                const held = store.get(key);
                if (script.includes("'DEL'")) {
                    if (held !== args[0]) return 0;
                    store.delete(key);
                    return 1;
                }
                if (args[2] === '1' || held === undefined || held === args[0]) {
                    store.set(key, args[0]);
                    return 1;
                }
                return 0;
            }),
            del: vi.fn(async (key: string) => Number(store.delete(key))),
        };
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        Object.assign(registry, { redis, serverId: 'server-1', sharedStoreSeen: true });
        const key = `bots:matrix:dm-claim:${BRICK}|${ALICE}`;

        // The device that made the chat claimed it under its claim's token; the invite takes it over under its own token
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000, 'claim-1')).toBe(true);
        expect(store.get(key)).toBe('claim-1');
        // Letting go under another token leaves it
        await registry.releaseDirectChat(BRICK, ALICE, 'claim-0');
        expect(store.get(key)).toBe('claim-1');
        await registry.holdDirectChat(BRICK, ALICE, 20_000, 'invite-1', true);
        expect(store.get(key)).toBe('invite-1');
        // Renewed while it is still the invite's
        await registry.holdDirectChat(BRICK, ALICE, 20_000, 'invite-1', false);
        expect(store.get(key)).toBe('invite-1');

        // Its claim ran out, and another device claimed through another server
        store.delete(key);
        Object.assign(registry, { serverId: 'server-2' });
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBe(true);
        // The late invite neither takes it back nor lets it go
        await registry.holdDirectChat(BRICK, ALICE, 20_000, 'invite-1', false);
        expect(store.get(key)).toBe('server-2');
        await registry.releaseDirectChat(BRICK, ALICE, 'invite-1');
        expect(store.get(key)).toBe('server-2');
        expect(await registry.claimDirectChat(BRICK, ALICE, 20_000)).toBe(false);

        // An invite that still holds its own claim lets it go
        await registry.holdDirectChat(BRICK, ALICE, 20_000, 'invite-2', true);
        await registry.releaseDirectChat(BRICK, ALICE, 'invite-2');
        expect(store.has(key)).toBe(false);
        // A renewal of a claim nobody holds takes it again: the invite is still being taken
        await registry.holdDirectChat(BRICK, ALICE, 20_000, 'invite-3', false);
        expect(store.get(key)).toBe('invite-3');
    });

    it('fails the claim while a Redis it was using is down, so nobody makes the chat on their own', async () => {
        const registry = Object.create(BotRegistry.prototype) as BotRegistry;
        Object.assign(registry, { redis: { isOpen: false }, serverId: 'server-1', sharedStoreSeen: true });
        await expect(registry.claimDirectChat(BRICK, ALICE, 20_000)).rejects.toThrow('The shared store is down');

        // And the bridge waits on that, rather than use its own claim
        const { bridge, deps } = makeBridge();
        deps.rooms.claimDirectChat = (botId: string, user: string, forMs: number) => registry.claimDirectChat(botId, user, forMs);
        expect(await bridge.directChatFor(BRICK, ALICE)).toEqual({ wait: true });
    });
});

describe("A Brick in its owner's chat", () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    it('takes its owner into the chat even while it is switched off; a room bot that is off still declines', async () => {
        const off = makeBridge({ botId: BRICK, name: 'Brick', enabled: false, aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } });
        await off.bridge.onEvent(invite());
        expect(off.client.joinRoom).toHaveBeenCalledWith(BRICK_USER, ROOM);
        expect(off.client.leaveRoom).not.toHaveBeenCalled();

        const roomBot = makeBridge({ botId: BRICK, name: 'Nora', enabled: false, aiProviderRef: 'p', roomUrl: 'http://play.test/@/u/w/r' });
        await roomBot.bridge.onEvent(invite());
        expect(roomBot.client.joinRoom).not.toHaveBeenCalled();
        expect(roomBot.client.leaveRoom).toHaveBeenCalledWith(BRICK_USER, ROOM);
    });

    it('still asks Orbit before it joins: a Brick never joins the chat of someone who is not its owner', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'not_allowed', user: null });

        await bridge.onEvent(invite({ sender: BOB }));

        expect(deps.checkAccess).toHaveBeenCalledWith(BRICK, BOB);
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BRICK_USER, ROOM);
    });

    it('hands a tapped starter on as one, and sends the fixed answer marked for the game to show its ideas', async () => {
        const { bridge, client, deps } = makeBridge();
        const keep = vi.fn();
        deps.reply.mockResolvedValue({ text: BRICK_IDEAS_TEXT, media: [], ideas: true, keep });
        await bridge.onEvent(invite());

        await bridge.onEvent(message('What can you do for me?', { [STARTER_KEY]: STARTER_IDEAS }));

        expect(deps.reply.mock.calls[0][2]).toBe('What can you do for me?');
        expect(deps.reply.mock.calls[0][4]).toMatchObject({ roomId: ROOM, starter: STARTER_IDEAS });
        expect(client.sendMessage.mock.calls).toEqual([[BRICK_USER, ROOM, { msgtype: 'm.text', body: BRICK_IDEAS_TEXT, [BRICK_IDEAS_KEY]: true }]]);
        expect(client.sendText).not.toHaveBeenCalled();
        expect(keep).toHaveBeenCalledTimes(1);
    });

    it('hands typed words on with no starter, whatever other marker they carry, and sends the answer as plain text', async () => {
        const { bridge, client, deps } = makeBridge();
        await bridge.onEvent(invite());

        await bridge.onEvent(message('What can you do for me?'));
        await bridge.onEvent(message('What can you do for me?', { [STARTER_KEY]: 'something-else' }));

        for (const call of deps.reply.mock.calls) expect(call[4]).not.toHaveProperty('starter');
        expect(client.sendText.mock.calls).toEqual([[BRICK_USER, ROOM, 'Hello Alice!'], [BRICK_USER, ROOM, 'Hello Alice!']]);
        expect(client.sendMessage).not.toHaveBeenCalled();
    });
});

describe('POST /api/bots/:botId/direct-chat', () => {
    const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
    const adminApiService = { validateSessionToken: vi.fn(), checkDmAccess: vi.fn() };
    const directChat = vi.fn();
    let server: Server;
    let base: string;
    let withoutDms: Server;
    let baseWithoutDms: string;

    const listen = async (api: BotAPI): Promise<[Server, string]> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (api as any).app;
        const s = await new Promise<Server>((resolve) => {
            const started = app.listen(0, () => resolve(started));
        });
        return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
    };

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        [server, base] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { directChat }));
        [withoutDms, baseWithoutDms] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never));
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => withoutDms.close(() => resolve()));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-alice', email: 'a@b.c' });
        adminApiService.checkDmAccess.mockResolvedValue({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } });
        directChat.mockResolvedValue({ create: true, botChatId: BRICK_USER });
    });

    const ask = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${SESSION}` }, at = base, botId = BRICK) =>
        fetch(`${at}/api/bots/${botId}/direct-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('answers the person the session names, about the chat address Orbit says is theirs', async () => {
        for (const answer of [{ create: true, botChatId: BRICK_USER }, { wait: true }, { roomId: ROOM }]) {
            directChat.mockResolvedValueOnce(answer);
            const response = await ask({ chatId: ALICE });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(answer);
        }
        expect(adminApiService.checkDmAccess).toHaveBeenCalledWith(BRICK, ALICE);
        expect(directChat).toHaveBeenCalledWith(BRICK, ALICE);
    });

    it("refuses a chat address that is someone else's, and claims nothing for it", async () => {
        adminApiService.checkDmAccess.mockResolvedValue({ allowed: true, reason: null, user: { uuid: 'uuid-bob', name: 'Bob', isGuest: false } });

        const response = await ask({ chatId: BOB });

        expect(response.status).toBe(403);
        expect(directChat).not.toHaveBeenCalled();
    });

    it('refuses someone Orbit says may not message the bot, such as anyone but the owner of a Brick', async () => {
        adminApiService.checkDmAccess.mockResolvedValue({ allowed: false, reason: 'not_allowed', user: null });

        const response = await ask({ chatId: ALICE });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'not_allowed' });
        expect(directChat).not.toHaveBeenCalled();
    });

    it('says it could not check when Orbit does not answer, which is not a no', async () => {
        adminApiService.checkDmAccess.mockResolvedValue({ allowed: false, reason: 'admin_api_error', user: null });

        const response = await ask({ chatId: ALICE });

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'cannot_check' });
        expect(directChat).not.toHaveBeenCalled();
    });

    it('needs an Orbit session: a guest, or nobody, gets nothing', async () => {
        expect((await ask({ chatId: ALICE }, {})).status).toBe(401);
        adminApiService.validateSessionToken.mockResolvedValue(null);
        expect((await ask({ chatId: ALICE })).status).toBe(401);
        expect(adminApiService.checkDmAccess).not.toHaveBeenCalled();
        expect(directChat).not.toHaveBeenCalled();
    });

    it('takes only a chat address and a bot id', async () => {
        for (const chatId of [undefined, 7, '', 'alice', '@alice', 'alice:matrix.test', '@al ice:matrix.test', `@${'a'.repeat(300)}:matrix.test`]) {
            expect((await ask({ chatId })).status).toBe(400);
        }
        expect((await ask({ chatId: ALICE }, undefined, base, 'not%20an%20id')).status).toBe(400);
        expect(adminApiService.checkDmAccess).not.toHaveBeenCalled();
    });

    it('is not there while direct messages are off', async () => {
        expect((await ask({ chatId: ALICE }, undefined, baseWithoutDms)).status).toBe(404);
    });
});
