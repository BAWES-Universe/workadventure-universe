/**
 * The Brick for guests (game #1997), on the bot server. It answers a guest who writes to it, on Universe AI and nothing
 * of a host's, in this order: what steers it, may this guest have one more reply (Orbit counts it), the model, then the
 * turn is closed with totals. Its hello is the game's own text and never comes here. A chat a guest took along when they
 * signed in is brought into their own Brick's chat once.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { BotAPI } from '../server/BotAPI';
import { CARRIED_BYTES_MAX, CARRIED_LINES_MAX, CARRIED_LINE_CHARS, GuestBrickService, guestTurn, readCarriedLines, readHistory, readMark, NEEDS_ACCOUNT_MARK } from '../server/GuestBrickService';
import { GUEST_CHAT_KEY, MatrixDmBridge } from '../matrix/MatrixDmBridge';
import type { GuestBrickAllowance, GuestBrickSetup } from '../server/AdminApiService';

const GUEST = '5d0a1c3e-1111-4222-8333-944455556666';
const TURN = 'turn-1';
const ROOM_URL = 'https://play.test/@/bawes/main/lobby';

const SETUP: GuestBrickSetup = {
    brick: { name: 'Brick', description: 'A helper for this place', characterTextureId: 'brick-orange', chatInstructions: 'You are Brick.\n\nThis place:\nUniverse: BAWES' },
    credentials: {
        providerId: 'universe-ai',
        name: 'Universe AI',
        type: 'openai',
        enabled: true,
        endpoint: 'https://ai.test/v1',
        apiKeyEncrypted: 'iv:tag:data',
        model: 'm1',
        temperature: 0.7,
        maxTokens: 900,
        supportsStreaming: true,
        source: 'universe-ai',
        limits: { replyTokens: 900, messages: 4, readChars: 30, waitSeconds: 7 },
    },
};

function makeService(overrides: Partial<{ allowance: GuestBrickAllowance; answer: string; throws: boolean; ready: boolean }> = {}) {
    const generate = vi.fn(async (..._args: unknown[]): Promise<{ content: string; tokensUsed: number; latency: number; usage?: { promptTokens: number; completionTokens: number } }> => {
        if (overrides.throws) throw new Error('provider down');
        return { content: overrides.answer ?? 'Second row, next to Zaatar & Co.', tokensUsed: 120, latency: 5, usage: { promptTokens: 100, completionTokens: 20 } };
    });
    const admin = {
        isConfigured: vi.fn(() => true),
        getGuestBrick: vi.fn(async () => SETUP),
        claimGuestBrickReply: vi.fn(async (): Promise<GuestBrickAllowance> => overrides.allowance ?? { allowed: true }),
        finishGuestBrickReply: vi.fn(async () => undefined),
    };
    const providers = { getOrCreateProvider: vi.fn(() => ({ isReady: () => overrides.ready !== false, generate })) };
    return { admin, generate, providers, service: new GuestBrickService(admin as never, providers as never, () => new Date('2026-11-12T08:00:00Z')) };
}

const ask = (overrides: Record<string, unknown> = {}) => ({ guestId: GUEST, turnId: TURN, roomUrl: ROOM_URL, message: "Where's the coffee here?", history: [], saidNeedsAccount: false, ...overrides });

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('The Brick for guests answers a guest', () => {
    it("reads what steers it for the guest's room, asks Orbit first, runs Universe AI and closes the turn with totals", async () => {
        const { service, admin, generate } = makeService();
        const order: string[] = [];
        admin.getGuestBrick.mockImplementation(async () => (order.push('setup'), SETUP));
        admin.claimGuestBrickReply.mockImplementation(async () => (order.push('claim'), { allowed: true } as GuestBrickAllowance));
        generate.mockImplementation(async () => (order.push('model'), { content: 'Second row.', tokensUsed: 120, latency: 5, usage: { promptTokens: 100, completionTokens: 20 } }));
        admin.finishGuestBrickReply.mockImplementation(async () => void order.push('finish'));

        expect(await service.reply(ask())).toEqual({ kind: 'reply', text: 'Second row.', needsAccount: false });

        expect(order).toEqual(['setup', 'claim', 'model', 'finish']);
        expect(admin.getGuestBrick).toHaveBeenCalledWith(ROOM_URL);
        expect(admin.claimGuestBrickReply).toHaveBeenCalledWith({ guestId: GUEST, turnId: TURN, roomUrl: ROOM_URL });
        // Universe AI's credentials, with the wait Orbit says; the steering is Orbit's, with the place, and nothing else of a bot's
        const [system, userMessage, config] = generate.mock.calls[0] as [string, string, { providerId: string; settings: { timeout: number }; maxTokens: number }];
        expect(system.startsWith(SETUP.brick.chatInstructions)).toBe(true);
        expect(system).toContain('Universe: BAWES');
        expect(userMessage).toBe("Where's the coffee here?");
        expect(config).toMatchObject({ providerId: 'universe-ai', maxTokens: 900, settings: { timeout: 7000 } });
        // Only totals go back to Orbit: never what was said
        const [turnId, totals] = admin.finishGuestBrickReply.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(turnId).toBe(TURN);
        expect(Object.keys(totals).sort()).toEqual(['costMicros', 'tokensUsed']);
        expect(totals.tokensUsed).toBe(120);
        expect(JSON.stringify(admin.finishGuestBrickReply.mock.calls)).not.toContain('coffee');
    });

    it('asks no model when the guest has used their own allowance or the universe its pool, and says which and until when', async () => {
        for (const allowance of [
            { allowed: false, limit: 'guest', resetsAt: '2026-11-12T10:00:00.000Z' },
            { allowed: false, limit: 'universe', resetsAt: '2026-11-12T11:00:00.000Z' },
        ] as GuestBrickAllowance[]) {
            const { service, generate, admin } = makeService({ allowance });
            const answer = await service.reply(ask());
            expect(answer).toEqual({ kind: 'limit', limit: (allowance as { limit: string }).limit, resetsAt: (allowance as { resetsAt: string }).resetsAt });
            expect(generate).not.toHaveBeenCalled();
            expect(admin.finishGuestBrickReply).not.toHaveBeenCalled();
        }
    });

    it('spends nothing when Orbit cannot be asked: no allowance answer, no model', async () => {
        const { service, admin, generate } = makeService();
        admin.claimGuestBrickReply.mockRejectedValue(new Error('timeout'));
        expect(await service.reply(ask())).toEqual({ kind: 'failed' });
        admin.getGuestBrick.mockRejectedValue(new Error('503'));
        expect(await service.reply(ask())).toEqual({ kind: 'failed' });
        expect(generate).not.toHaveBeenCalled();
    });

    it('gives the reply back when the AI fails, so a guest is never charged an allowance for an answer they did not get', async () => {
        const { service, admin } = makeService({ throws: true });
        expect(await service.reply(ask())).toEqual({ kind: 'failed' });
        expect(admin.finishGuestBrickReply).toHaveBeenCalledWith(TURN, { failed: true });

        const empty = makeService({ answer: '   ' });
        expect(await empty.service.reply(ask())).toEqual({ kind: 'failed' });
        expect(empty.admin.finishGuestBrickReply).toHaveBeenCalledWith(TURN, { failed: true });

        const notReady = makeService({ ready: false });
        expect(await notReady.service.reply(ask())).toEqual({ kind: 'failed' });
        expect(notReady.admin.finishGuestBrickReply).toHaveBeenCalledWith(TURN, { failed: true });
    });

    it('answers one message of a guest at a time, so two taps never spend two replies on one question', async () => {
        const { service, generate } = makeService();
        let release: () => void = () => undefined;
        generate.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ content: 'ok', tokensUsed: 1, latency: 1 }))));

        const first = service.reply(ask());
        await new Promise((resolve) => setImmediate(resolve));
        expect(await service.reply(ask({ turnId: 'turn-2' }))).toEqual({ kind: 'busy' });
        release();
        expect(await first).toMatchObject({ kind: 'reply' });
        // And the guest can write again once it is answered
        expect(await service.reply(ask({ turnId: 'turn-3' }))).toBeDefined();
    });

    it('gives the model the chat so far, only the newest lines Orbit says it reads, each cut to the length Orbit says', async () => {
        const { service, generate } = makeService();
        const history = Array.from({ length: 6 }, (_, index) => ({ from: index % 2 === 0 ? 'guest' : 'brick', text: `line ${index} ${'x'.repeat(60)}` }));

        await service.reply(ask({ history, message: 'one more' }));

        const turn = generate.mock.calls[0][1] as string;
        expect(turn).not.toContain('line 0');
        expect(turn).not.toContain('line 1');
        expect(turn).toContain('Guest: line 4');
        expect(turn).toContain('You: line 5');
        expect(turn).not.toContain('x'.repeat(31));
        expect(turn.endsWith('The guest now writes:\none more')).toBe(true);
    });
});

describe('When an answer says that something needs an account', () => {
    it('asks the model for the mark the first time, strips it, and tells the game so it can offer to sign in', async () => {
        const { service, generate } = makeService({ answer: `I can only remember things once I'm yours. ${NEEDS_ACCOUNT_MARK}` });

        const answer = await service.reply(ask());

        expect(answer).toEqual({ kind: 'reply', text: "I can only remember things once I'm yours.", needsAccount: true });
        expect(generate.mock.calls[0][0]).toContain(`end that answer with ${NEEDS_ACCOUNT_MARK}`);
    });

    it('says it once: after the game says it did, the model is told not to and a stray mark is never shown or offered again', async () => {
        const { service, generate } = makeService({ answer: `Still the same. ${NEEDS_ACCOUNT_MARK}` });

        const answer = await service.reply(ask({ saidNeedsAccount: true }));

        expect(answer).toEqual({ kind: 'reply', text: 'Still the same.', needsAccount: false });
        expect(generate.mock.calls[0][0]).toContain('Do not say it again');
        expect(generate.mock.calls[0][0]).not.toContain(`end that answer with ${NEEDS_ACCOUNT_MARK}`);
    });

    it('reads the mark anywhere in the answer, in any case, and shows none of it', () => {
        expect(readMark('A [needs_account] B')).toEqual({ text: 'A B', needsAccount: true });
        expect(readMark('Nothing to say.')).toEqual({ text: 'Nothing to say.', needsAccount: false });
    });
});

describe('What the bot server takes in', () => {
    it('keeps only well formed lines of the chat, the newest ones, cut to length', () => {
        const lines = readHistory([{ from: 'guest', text: ' hi ' }, { from: 'robot', text: 'no' }, { from: 'brick', text: '' }, null, 7, { from: 'brick', text: 'hello there' }], 1, 5);
        expect(lines).toEqual([{ from: 'brick', text: 'hello' }]);
        expect(readHistory('nope', 5, 5)).toEqual([]);
    });

    it('writes the chat as the guest and the Brick said it', () => {
        expect(guestTurn([{ from: 'guest', text: 'hi' }, { from: 'brick', text: 'hello' }], 'ok')).toBe('The chat so far:\nGuest: hi\nYou: hello\n\nThe guest now writes:\nok');
        expect(guestTurn([], 'ok')).toBe('ok');
    });

    it('takes the lines a device brings along with when each was said, and nothing that is not a line', () => {
        expect(readCarriedLines([{ from: 'guest', text: 'hi', at: 5 }, { from: 'brick', text: 'hello' }, { from: 'x', text: 'no' }, { from: 'guest', text: ' ' }]).map((line) => [line.from, line.text, line.at === 5 ? 5 : 'now'])).toEqual([
            ['guest', 'hi', 5],
            ['brick', 'hello', 'now'],
        ]);
    });

    it('keeps a carried chat to the newest lines that fit in one message, each cut, so it never goes past what a homeserver takes', () => {
        const many = Array.from({ length: 400 }, (_, index) => ({ from: 'guest', text: `line ${index + 1}`, at: index + 1 }));
        const kept = readCarriedLines(many);
        expect(kept).toHaveLength(CARRIED_LINES_MAX);
        expect(kept[kept.length - 1].at).toBe(400);

        const long = Array.from({ length: 40 }, (_, index) => ({ from: 'brick', text: 'é'.repeat(5000), at: index + 1 }));
        const cut = readCarriedLines(long);
        expect(cut.length).toBeGreaterThan(0);
        expect(cut.every((line) => line.text.length === CARRIED_LINE_CHARS)).toBe(true);
        expect(cut.reduce((all, line) => all + Buffer.byteLength(line.text, 'utf8'), 0)).toBeLessThanOrEqual(CARRIED_BYTES_MAX);
        expect(cut[cut.length - 1].at).toBe(40);
    });
});

describe('POST /api/guest-brick/reply', () => {
    const SECRET = 'test-secret';
    const adminApiService = { isConfigured: vi.fn(), validateSessionToken: vi.fn(), checkDmAccess: vi.fn() };
    const guestBrick = { available: vi.fn(), reply: vi.fn() };
    let server: Server;
    let base: string;
    let off: Server;
    let baseOff: string;

    const listen = async (api: BotAPI): Promise<[Server, string]> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (api as any).app;
        const s = await new Promise<Server>((resolve) => {
            const started = app.listen(0, () => resolve(started));
        });
        return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
    };
    const token = (identifier: string) => jwt.sign({ identifier }, SECRET, { algorithm: 'HS256' });

    beforeAll(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.env.SECRET_KEY = SECRET;
        [server, base] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { guestBrick: guestBrick as never }));
        [off, baseOff] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { guestBrick: null }));
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => off.close(() => resolve()));
        delete process.env.SECRET_KEY;
    });
    beforeEach(() => {
        vi.clearAllMocks();
        guestBrick.available.mockReturnValue(true);
        guestBrick.reply.mockResolvedValue({ kind: 'reply', text: 'Second row.', needsAccount: false });
    });

    const post = (body: unknown, headers: Record<string, string> = { 'X-WA-Auth': token(GUEST) }, at = base) =>
        fetch(`${at}/api/guest-brick/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const message = { turnId: TURN, roomUrl: ROOM_URL, message: 'Where is the coffee?', history: [{ from: 'brick', text: 'Hi' }], saidNeedsAccount: true };

    it("answers the guest the game token names, and takes nobody's word for who is asking", async () => {
        const response = await post({ ...message, guestId: 'someone-else' });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ kind: 'reply', text: 'Second row.', needsAccount: false });
        expect(guestBrick.reply).toHaveBeenCalledWith({ guestId: GUEST, turnId: TURN, roomUrl: ROOM_URL, message: 'Where is the coffee?', history: message.history, saidNeedsAccount: true });
    });

    it('needs the game token, and only a guest id counts: a member has their own Brick', async () => {
        expect((await post(message, {})).status).toBe(401);
        expect((await post(message, { 'X-WA-Auth': 'garbage' })).status).toBe(401);
        expect((await post(message, { 'X-WA-Auth': token('alice@example.test') })).status).toBe(403);
        expect(guestBrick.reply).not.toHaveBeenCalled();
    });

    it('takes a try id, a room, and words', async () => {
        for (const bad of [{ ...message, turnId: undefined }, { ...message, turnId: 'a b' }, { ...message, roomUrl: '' }, { ...message, message: '   ' }, { ...message, message: 7 }]) {
            expect((await post(bad)).status).toBe(400);
        }
        expect(guestBrick.reply).not.toHaveBeenCalled();
    });

    it('says a limit as an answer, not an error, and a busy guest or a failed try as one the guest can try again', async () => {
        guestBrick.reply.mockResolvedValueOnce({ kind: 'limit', limit: 'guest', resetsAt: '2026-11-12T10:00:00.000Z' });
        const limited = await post(message);
        expect(limited.status).toBe(200);
        expect(await limited.json()).toEqual({ kind: 'limit', limit: 'guest', resetsAt: '2026-11-12T10:00:00.000Z' });

        guestBrick.reply.mockResolvedValueOnce({ kind: 'busy' });
        expect((await post(message)).status).toBe(429);
        guestBrick.reply.mockResolvedValueOnce({ kind: 'failed' });
        expect((await post(message)).status).toBe(502);
        guestBrick.reply.mockRejectedValueOnce(new Error('boom'));
        expect((await post(message)).status).toBe(502);
    });

    it('is not there when Orbit is not set up for it or it is turned off', async () => {
        guestBrick.available.mockReturnValue(false);
        expect((await post(message)).status).toBe(404);
        expect((await post(message, undefined, baseOff)).status).toBe(404);
    });
});

describe("A guest's chat, brought along when they sign in", () => {
    const ALICE = '@alice:matrix.test';
    const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
    const BRICK_USER = `@bot_${BRICK}:matrix.test`;
    const ROOM = '!dm:matrix.test';
    const LINES = [
        { from: 'guest', text: "Where's the coffee here?", at: 1 },
        { from: 'brick', text: 'Second row.', at: 2 },
    ] as const;

    function bridgeWithChat(hasChat: boolean) {
        const client = { sendMessage: vi.fn(async (..._args: unknown[]) => '$evt'), getJoinedMembers: vi.fn(async () => [ALICE, BRICK_USER]) };
        const deps: any = {
            getBotConfig: vi.fn(),
            checkAccess: vi.fn(),
            reply: vi.fn(),
            rooms: {
                getDmRoomOf: vi.fn(async () => (hasChat ? ROOM : null)),
                getDmRoomBot: vi.fn(async () => (hasChat ? BRICK : null)),
                forgetDmRoomOf: vi.fn(async () => undefined),
                rememberDmRoomOf: vi.fn(async () => undefined),
            },
        };
        return { client, bridge: new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps) };
    }

    it("says the Brick's one message in the person's own chat, with each line as it was said", async () => {
        const { bridge, client } = bridgeWithChat(true);

        expect(await bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).toBe('sent');

        expect(client.sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, {
            msgtype: 'm.text',
            body: "You: Where's the coffee here?\nBrick: Second row.",
            [GUEST_CHAT_KEY]: LINES,
        }, expect.stringMatching(/^[0-9a-f]{64}$/));
    });

    it('tries again with the same transaction id, so a message the homeserver took before it timed out is sent once', async () => {
        const { bridge, client } = bridgeWithChat(true);
        client.sendMessage.mockRejectedValueOnce(new Error('timed out'));
        await expect(bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).rejects.toThrow('timed out');
        await bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES]);

        const [first, second] = client.sendMessage.mock.calls.map((call: unknown[]) => call[3]);
        expect(first).toBeTruthy();
        expect(second).toBe(first);
        // Another hand-over, or another person, is a message of its own
        await bridge.carryGuestChat(BRICK, ALICE, 'another-guest', [...LINES]);
        expect((client.sendMessage.mock.calls[2] as unknown[])[3]).not.toBe(first);
    });

    it('brings one hand-over once, however many times a device or a second tab asks, even all at once', async () => {
        const { bridge, client } = bridgeWithChat(true);

        const answers = await Promise.all([bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES]), bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])]);

        expect(answers.sort()).toEqual(['already', 'sent']);
        expect(await bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).toBe('already');
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        // A different hand-over is its own
        expect(await bridge.carryGuestChat(BRICK, ALICE, 'another-guest', [...LINES])).toBe('sent');
    });

    it('waits when the chat is not there yet, and brings it after a failed send on the next ask', async () => {
        const none = bridgeWithChat(false);
        expect(await none.bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).toBe('wait');
        expect(none.client.sendMessage).not.toHaveBeenCalled();

        const { bridge, client } = bridgeWithChat(true);
        client.sendMessage.mockRejectedValueOnce(new Error('homeserver down'));
        await expect(bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).rejects.toThrow('homeserver down');
        expect(await bridge.carryGuestChat(BRICK, ALICE, GUEST, [...LINES])).toBe('sent');
    });

    it('sends a message within what a homeserver takes in an event, even for the longest chat a device may bring', async () => {
        const { bridge, client } = bridgeWithChat(true);
        const worst = Array.from({ length: 400 }, (_, index) => ({ from: index % 2 ? 'brick' : 'guest', text: '"\n€'.repeat(700), at: index + 1 }));

        expect(await bridge.carryGuestChat(BRICK, ALICE, GUEST, readCarriedLines(worst))).toBe('sent');

        const content = client.sendMessage.mock.calls[0][2];
        expect(Buffer.byteLength(JSON.stringify(content), 'utf8')).toBeLessThan(65536);
    });

    it('is not for a bot account', async () => {
        const { bridge, client } = bridgeWithChat(true);
        expect(await bridge.carryGuestChat(BRICK, '@bot_other:matrix.test', GUEST, [...LINES])).toBe('wait');
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    describe('POST /api/bots/:botId/carried-chat', () => {
        const SESSION = `orb_sess_v2_${'a'.repeat(64)}`;
        const adminApiService = { validateSessionToken: vi.fn(), checkDmAccess: vi.fn() };
        const carryGuestChat = vi.fn();
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
            [server, base] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never, [], { carryGuestChat }));
            [withoutDms, baseWithoutDms] = await listen(new BotAPI({ getAccessGate: vi.fn() } as never, adminApiService as never, {} as never));
        });
        afterAll(async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await new Promise<void>((resolve) => withoutDms.close(() => resolve()));
        });
        beforeEach(() => {
            vi.clearAllMocks();
            adminApiService.validateSessionToken.mockResolvedValue({ userId: 'u1', uuid: 'uuid-alice', email: 'a@b.c' });
            adminApiService.checkDmAccess.mockResolvedValue({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } });
            carryGuestChat.mockResolvedValue('sent');
        });
        const carry = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${SESSION}` }, at = base) =>
            fetch(`${at}/api/bots/${BRICK}/carried-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        const body = { chatId: ALICE, carryId: GUEST, lines: LINES };

        it("brings the chat into the person's own Brick's chat, for the person the session names", async () => {
            const response = await carry(body);

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ result: 'sent' });
            expect(adminApiService.checkDmAccess).toHaveBeenCalledWith(BRICK, ALICE);
            expect(carryGuestChat).toHaveBeenCalledWith(BRICK, ALICE, GUEST, [...LINES]);
        });

        it("refuses a chat that is someone else's, a bot that is not their own Brick, and nobody", async () => {
            adminApiService.checkDmAccess.mockResolvedValueOnce({ allowed: true, reason: null, user: { uuid: 'uuid-bob', name: 'Bob', isGuest: false } });
            expect((await carry(body)).status).toBe(403);
            adminApiService.checkDmAccess.mockResolvedValueOnce({ allowed: false, reason: 'not_allowed', user: null });
            expect((await carry(body)).status).toBe(403);
            carryGuestChat.mockResolvedValueOnce('not_brick');
            expect((await carry(body)).status).toBe(403);
            expect((await carry(body, {})).status).toBe(401);
            expect(carryGuestChat).toHaveBeenCalledTimes(1);
        });

        it('says "try again" and not "refused" when Orbit cannot be asked, so the device keeps the chat', async () => {
            adminApiService.checkDmAccess.mockResolvedValueOnce({ allowed: false, reason: 'admin_api_error', user: null });
            const response = await carry(body);

            expect(response.status).toBe(503);
            expect(await response.json()).toMatchObject({ code: 'cannot_check' });
            expect(carryGuestChat).not.toHaveBeenCalled();
        });

        it('takes a chat address, an id of the hand-over, and lines', async () => {
            for (const bad of [{ ...body, chatId: 'alice' }, { ...body, carryId: undefined }, { ...body, lines: 'no' }, { ...body, lines: [] }, { ...body, lines: [{ from: 'x', text: 'y' }] }]) {
                expect((await carry(bad)).status).toBe(400);
            }
            expect(carryGuestChat).not.toHaveBeenCalled();
        });

        it('passes on that the chat is not there yet, and is not there while direct messages are off', async () => {
            carryGuestChat.mockResolvedValueOnce('wait');
            expect(await (await carry(body)).json()).toEqual({ result: 'wait' });
            expect((await carry(body, undefined, baseWithoutDms)).status).toBe(404);
        });
    });
});
