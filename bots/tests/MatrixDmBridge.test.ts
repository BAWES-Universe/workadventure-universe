import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { createMatrixAppServiceRouter, type MatrixEvent } from '../matrix/MatrixAppServiceRouter';
import { botIdFromMatrixId, botMatrixId, readMatrixConfig } from '../matrix/MatrixConfig';
import { BOT_STATUS_KEY, availabilityOf, detectLanguage, statusNoteContent } from '../matrix/BotStatusNotes';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';

// Loosely typed so tests can reach the vi.fn helpers on each method.
function makeClient(): any {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async (): Promise<string | null> => 'Guide'),
        joinRoom: vi.fn(async () => undefined),
        leaveRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async () => '$evt'),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BOT_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
        uploadMedia: vi.fn(async () => 'mxc://matrix.test/abc'),
        downloadMedia: vi.fn(async () => ({ data: Buffer.from('hi'), contentType: 'text/plain' })),
    };
}

function makeDeps(): any {
    const rooms = new Map<string, string>();
    return {
        getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' }) as never),
        checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async (): Promise<any> => ({ text: 'Hello Alice!', media: [] })),
        restingLine: vi.fn(async () => 'The ship is in the harbour, come back later!'),
        rooms: {
            rememberDmRoom: vi.fn(async (r: string, b: string) => void rooms.set(r, b)),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
        },
    };
}

const invite = (overrides: Partial<MatrixEvent> = {}, content: Record<string, unknown> = { membership: 'invite', is_direct: true }): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$i', state_key: BOT_USER, content, ...overrides,
});
const message = (body: string, sender = ALICE): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body },
});

describe('MatrixConfig', () => {
    it('is off unless all four values are set', () => {
        expect(readMatrixConfig({ MATRIX_HOMESERVER_URL: 'http://hs' } as never)).toBeNull();
        expect(readMatrixConfig({ MATRIX_HOMESERVER_URL: 'http://hs/', MATRIX_DOMAIN: 'd', MATRIX_AS_TOKEN: 'a', MATRIX_HS_TOKEN: 'h' } as never))
            .toEqual({ homeserverUrl: 'http://hs', domain: 'd', asToken: 'a', hsToken: 'h' });
    });

    it('maps bot ids to Matrix IDs and back, only inside our namespace', () => {
        expect(botMatrixId('matrix.test', BOT)).toBe(BOT_USER);
        expect(botMatrixId('matrix.test', 'Has Upper')).toBeUndefined();
        expect(botIdFromMatrixId('matrix.test', BOT_USER)).toBe(BOT);
        expect(botIdFromMatrixId('matrix.test', ALICE)).toBeNull();
        expect(botIdFromMatrixId('matrix.test', `@bot_${BOT}:elsewhere.org`)).toBeNull();
    });
});

describe('MatrixDmBridge', () => {
    let client: any;
    let deps: any;
    let bridge: MatrixDmBridge;

    beforeEach(() => {
        client = makeClient();
        deps = makeDeps();
        bridge = new MatrixDmBridge(config, client as never, deps);
    });

    it('creates the bot account on first lookup and names it after the bot', async () => {
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        expect(client.ensureRegistered).toHaveBeenCalledWith(`bot_${BOT}`);
        expect(client.setDisplayName).toHaveBeenCalledWith(BOT_USER, 'Guide');
        expect(await bridge.userExists(ALICE)).toBe(false);
        // A resting bot still exists, so a chat with it can open and explain; a deleted one does not.
        deps.getBotConfig.mockResolvedValueOnce({ enabled: false } as never);
        expect(await bridge.userExists(BOT_USER)).toBe(true);
        deps.getBotConfig.mockResolvedValueOnce(null as never);
        expect(await bridge.userExists(BOT_USER)).toBe(false);
    });

    it('joins a direct chat from someone allowed, and replies to their messages', async () => {
        await bridge.onEvent(invite());
        expect(deps.checkAccess).toHaveBeenCalledWith(BOT, ALICE);
        expect(client.joinRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        await bridge.onEvent(message('hi there'));
        expect(deps.reply).toHaveBeenCalledWith(BOT, { matrixUserId: ALICE, uuid: 'uuid-alice', name: 'Alice', isGuest: false }, 'hi there', [], expect.anything());
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'Hello Alice!');
        // A quick reply needs no typing notice.
        expect(client.setTyping).not.toHaveBeenCalled();
    });

    it('shows typing while a slow reply is on its way, then clears it', async () => {
        vi.useFakeTimers();
        try {
            let finish: (v: unknown) => void = () => undefined;
            deps.reply.mockImplementationOnce(() => new Promise((r) => (finish = r)));
            await bridge.onEvent(invite());
            const pending = bridge.onEvent(message('think hard'));
            await vi.advanceTimersByTimeAsync(1000);
            expect(client.setTyping).toHaveBeenCalledWith(BOT_USER, ROOM, true);
            finish({ text: 'Done thinking.', media: [] });
            await pending;
            expect(client.setTyping).toHaveBeenLastCalledWith(BOT_USER, ROOM, false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('checks room members once and then follows membership events', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('one'));
        await bridge.onEvent(message('two'));
        expect(client.getJoinedMembers).toHaveBeenCalledTimes(1);
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$j', state_key: '@carol:matrix.test', content: { membership: 'join' } });
        await bridge.onEvent(message('three'));
        expect(deps.reply).toHaveBeenCalledTimes(2);
    });

    it('answers a message typed before it joined, once, even if Synapse also pushes it', async () => {
        const early = { ...message('are you there?'), origin_server_ts: 2000 };
        client.getRecentMessages.mockResolvedValueOnce([
            { type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$c', state_key: ALICE, content: { membership: 'join' }, origin_server_ts: 1000 },
            early,
        ]);
        await bridge.onEvent(invite({ origin_server_ts: 1500 }));
        await bridge.onEvent(early);
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply.mock.calls[0][2]).toBe('are you there?');
    });

    it('sends what the bot says before a tool call as its own message', async () => {
        deps.reply.mockImplementationOnce(async (_b: string, _p: unknown, _t: string, _a: unknown, hooks: any) => {
            await hooks.onInterimMessage('Let me look.');
            return { text: 'Found it.', media: [] };
        });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('find it'));
        expect(client.sendText.mock.calls.map((c) => c[2])).toEqual(['Let me look.', 'Found it.']);
    });

    it('still sends the answer when the interim message fails to send', async () => {
        deps.reply.mockImplementationOnce(async (_b: string, _p: unknown, _t: string, _a: unknown, hooks: any) => {
            await hooks.onInterimMessage('Let me look.');
            return { text: 'Found it.', media: [] };
        });
        client.sendText.mockRejectedValueOnce(new Error('timeout'));
        await bridge.onEvent(invite());
        await bridge.onEvent(message('find it'));
        expect(client.sendText).toHaveBeenLastCalledWith(BOT_USER, ROOM, 'Found it.');
    });

    it('checks access only once the bot has joined, so a ban during the join still applies', async () => {
        const order: string[] = [];
        client.joinRoom.mockImplementation(async () => void order.push('join'));
        deps.checkAccess.mockImplementation(async () => {
            order.push('access');
            return { allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } };
        });
        await bridge.onEvent(invite());
        expect(order).toEqual(['join', 'access']);
    });

    it('says why and leaves when the person may not reach the bot', async () => {
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'no_room_access', user: null });
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalled();
        expect(client.sendMessage).toHaveBeenCalledWith(BOT_USER, ROOM, expect.objectContaining({
            msgtype: 'm.notice',
            body: "You can chat with Guide once you can visit the bot's room.",
            [BOT_STATUS_KEY]: expect.objectContaining({ state: 'no_access' }),
        }));
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('turns down invites to rooms that are not direct chats, like area chats', async () => {
        await bridge.onEvent(invite({}, { membership: 'invite' }));
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM, expect.any(String));
        expect(deps.checkAccess).not.toHaveBeenCalled();
    });

    it('retries a failed join and then answers as usual', async () => {
        (bridge as any).joinRetryDelaysMs = [0, 0];
        client.joinRoom.mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('timeout'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalledTimes(3);
        await bridge.onEvent(message('hello'));
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'Hello Alice!');
    });

    it('declines the invite when every join attempt fails, so it is not left hanging', async () => {
        (bridge as any).joinRetryDelaysMs = [0, 0];
        client.joinRoom.mockRejectedValue(new Error('down'));
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalledTimes(3);
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.rememberDmRoom).not.toHaveBeenCalled();
    });

    it('keeps the access cache bounded, dropping the oldest pairs first', async () => {
        const access = (chatId: string) => (bridge as any).access(BOT, chatId);
        for (let i = 0; i <= 5000; i++) await access(`@p${i}:matrix.test`);
        const cache: Map<string, unknown> = (bridge as any).accessCache;
        expect(cache.size).toBe(5000);
        expect(cache.has(`${BOT}|@p0:matrix.test`)).toBe(false);
        expect(cache.has(`${BOT}|@p5000:matrix.test`)).toBe(true);
    });

    it('stays quiet once a third person is in the room, and ignores other bots and edits', async () => {
        await bridge.onEvent(invite());
        client.getJoinedMembers.mockResolvedValueOnce([ALICE, BOT_USER, '@carol:matrix.test']);
        await bridge.onEvent(message('hi all'));
        await bridge.onEvent(message('loop', `@bot_other:matrix.test`));
        await bridge.onEvent({ ...message('fixed'), content: { msgtype: 'm.text', body: '* fixed', 'm.relates_to': { rel_type: 'm.replace' } } });
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('stops answering when access is lost, refusing once rather than every message', async () => {
        await bridge.onEvent(invite());
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'banned', user: null });
        // The invite cached an allowed answer; a fresh bridge state is what a minute later looks like.
        (bridge as any).accessCache.clear();
        await bridge.onEvent(message('one'));
        await bridge.onEvent(message('two'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        expect(client.sendText).not.toHaveBeenCalled();
    });

    it('remembers its rooms across a restart through the shared store', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        await restarted.onEvent(message('still there?'));
        expect(deps.reply).toHaveBeenCalledTimes(1);
    });

    it('leaves and forgets the room when the person leaves', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
        await bridge.onEvent(message('hello?'));
        expect(deps.reply).not.toHaveBeenCalled();
    });

    const noteStates = () =>
        client.sendMessage.mock.calls.map((call: any[]) => call[2]?.[BOT_STATUS_KEY]?.state).filter(Boolean);
    const resting = { botId: BOT, name: 'Guide', enabled: false, aiProviderRef: 'p' };

    it('a resting bot says so in character once, adds the plain note, and keeps the message for later', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('Are you around?'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(deps.restingLine).toHaveBeenCalledWith(resting, 'Are you around?');
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'The ship is in the harbour, come back later!');
        expect(noteStates()).toEqual(['resting']);
        expect(client.sendMessage.mock.calls[0][2].body).toBe(
            "Guide is resting. The bot's owner turned it off for now, so it can't reply until it's back on."
        );

        // A second message soon after: no second AI line and no second note.
        await bridge.onEvent(message('Hello??'));
        expect(deps.restingLine).toHaveBeenCalledTimes(1);
        expect(noteStates()).toEqual(['resting']);

        // Back on: the bot answers the last message left in this chat, once.
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'Hello??', [], expect.anything());
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledTimes(1);
    });

    it('drops waiting messages older than a day, and checks with a fresh config', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent({ ...message('from yesterday'), origin_server_ts: Date.now() - 25 * 60 * 60 * 1000 });
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.getBotConfig).toHaveBeenCalledWith(BOT, true);
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('answers waiting messages as soon as someone else gets an answer', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('left while resting'));
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.onEvent(message('now?'));
        await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(2));
        expect(deps.reply.mock.calls.map((call: any[]) => call[2])).toEqual(['now?', 'left while resting']);
    });

    it('keeps waiting messages in the shared store when there is one', async () => {
        const store = new Map<string, string>();
        deps.waiting = {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async (_b: string, r: string, m: string) => void store.set(r, m)),
            waitingDmBots: vi.fn(async () => (store.size ? [BOT] : [])),
            hasWaitingDms: vi.fn(async () => store.size > 0),
            takeWaitingDms: vi.fn(async () => {
                const all = [...store.values()];
                store.clear();
                return all;
            }),
        };
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('saved for later'));
        expect(deps.waiting.rememberWaitingDm).toHaveBeenCalledWith(BOT, ROOM, expect.stringContaining('saved for later'));
        expect((bridge as any).localWaiting.size).toBe(0);
        deps.getBotConfig.mockResolvedValue({ ...resting, enabled: true } as never);
        await bridge.checkWaiting();
        expect(deps.reply).toHaveBeenCalledWith(BOT, expect.anything(), 'saved for later', [], expect.anything());
    });

    it('a bot with no AI provider leaves one "not ready" note instead of silence', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: true } as never);
        await bridge.onEvent(message('Hi!'));
        await bridge.onEvent(message('Hello??'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(noteStates()).toEqual(['unready']);
    });

    it('says the problem is on our side when the AI fails, the reply throws, or Orbit is down', async () => {
        await bridge.onEvent(invite());
        deps.reply.mockResolvedValueOnce({ text: '', media: [], failed: true });
        await bridge.onEvent(message('Tell me about the island'));
        deps.reply.mockRejectedValueOnce(new Error('boom'));
        await bridge.onEvent(message('again'));
        deps.getBotConfig.mockRejectedValueOnce(new Error('orbit down'));
        await bridge.onEvent(message('and again'));
        expect(noteStates()).toEqual(['trouble', 'trouble', 'trouble']);
        expect(client.sendMessage.mock.calls[0][2].body).toBe("Guide couldn't answer that just now. Send it again in a minute.");
        expect(client.sendText).not.toHaveBeenCalled();
    });

    it('a deleted bot says goodbye once, leaves, and forgets the chat', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(null as never);
        await bridge.onEvent(message('Hello?'));
        expect(noteStates()).toEqual(['gone']);
        expect(client.sendMessage.mock.calls[0][2].body).toBe(
            "Guide isn't around anymore. The bot was removed, so this chat is closed."
        );
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms!.forgetDmRoom).toHaveBeenCalledWith(ROOM);
    });

    it('names a deleted bot from its Matrix profile after a restart', async () => {
        await bridge.onEvent(invite());
        const restarted = new MatrixDmBridge(config, client as never, deps);
        client.getDisplayName.mockResolvedValueOnce('Captain Mira');
        deps.getBotConfig.mockResolvedValue(null as never);
        await restarted.onEvent(message('Hello?'));
        expect(client.getDisplayName).toHaveBeenCalledWith(BOT_USER);
        expect(client.sendMessage.mock.calls[0][2].body).toContain('Captain Mira');
    });

    it('writes the note in the language of the message', async () => {
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue(resting as never);
        await bridge.onEvent(message('مرحبا، هل أنت موجودة؟'));
        const note = client.sendMessage.mock.calls[0][2];
        expect(note[BOT_STATUS_KEY]).toMatchObject({ state: 'resting', lang: 'ar', title: 'في استراحة' });
    });

    it('keeps typing showing through a long answer', async () => {
        vi.useFakeTimers();
        try {
            let finish: (v: unknown) => void = () => undefined;
            deps.reply.mockImplementationOnce(() => new Promise((r) => (finish = r)));
            await bridge.onEvent(invite());
            const pending = bridge.onEvent(message('write me an essay'));
            await vi.advanceTimersByTimeAsync(45000);
            const typingOn = client.setTyping.mock.calls.filter((call: any[]) => call[2] === true).length;
            expect(typingOn).toBeGreaterThanOrEqual(3);
            finish({ text: 'Done.', media: [] });
            await pending;
            const after = client.setTyping.mock.calls.length;
            await vi.advanceTimersByTimeAsync(60000);
            expect(client.setTyping.mock.calls.length).toBe(after);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Matrix application service routes', () => {
    let server: Server;
    let base: string;
    const handler = { onEvent: vi.fn(async () => undefined), userExists: vi.fn(async (u: string) => u === BOT_USER) };

    beforeAll(async () => {
        const app = express();
        app.use(createMatrixAppServiceRouter(config, handler));
        app.use(express.json());
        app.get('/health', (_req, res) => {
            res.json({ ok: true });
        });
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
    beforeEach(() => vi.clearAllMocks());

    const put = (path: string, body: unknown, token?: string) =>
        fetch(`${base}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        });

    it('refuses anyone without the homeserver token', async () => {
        expect((await put('/_matrix/app/v1/transactions/1', { events: [] })).status).toBe(403);
        expect((await put('/_matrix/app/v1/transactions/1', { events: [] }, 'as-secret')).status).toBe(403);
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(BOT_USER)}`)).status).toBe(403);
        expect(handler.onEvent).not.toHaveBeenCalled();
    });

    it('keeps one room in order while other rooms run alongside it', async () => {
        const order: string[] = [];
        let releaseSlow: () => void = () => undefined;
        handler.onEvent.mockImplementation(async (e: MatrixEvent) => {
            if (e.content.body === 'slow') await new Promise<void>((r) => (releaseSlow = r));
            order.push(`${e.room_id}:${e.content.body}`);
        });
        const slow = { ...message('slow'), room_id: '!a' };
        const afterSlow = { ...message('after'), room_id: '!a' };
        const other = { ...message('other'), room_id: '!b' };
        await put('/_matrix/app/v1/transactions/order', { events: [slow, afterSlow, other] }, 'hs-secret');
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['!b:other']);
        releaseSlow();
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['!b:other', '!a:slow', '!a:after']);
        handler.onEvent.mockImplementation(async () => undefined);
    });

    it('hands each event over once, even when Synapse retries a transaction', async () => {
        const events = [message('a'), message('b')];
        expect((await put('/_matrix/app/v1/transactions/t1', { events }, 'hs-secret')).status).toBe(200);
        expect((await put('/_matrix/app/v1/transactions/t1', { events }, 'hs-secret')).status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        expect(handler.onEvent).toHaveBeenCalledTimes(2);
    });

    it('answers user queries for bots only, and leaves other routes alone', async () => {
        const auth = { headers: { Authorization: 'Bearer hs-secret' } };
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(BOT_USER)}`, auth)).status).toBe(200);
        expect((await fetch(`${base}/_matrix/app/v1/users/${encodeURIComponent(ALICE)}`, auth)).status).toBe(404);
        expect((await fetch(`${base}/health`)).status).toBe(200);
    });
});

describe('DmReplyService ids', () => {
    it('gives each person a stable negative id and forgets the least recent once full', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        Object.assign(service, { playerIds: new Map(), nextPlayerId: -1 });
        const first = service.playerIdFor('@p0:matrix.test');
        expect(first).toBeLessThan(0);
        expect(service.playerIdFor('@p0:matrix.test')).toBe(first);
        for (let i = 1; i <= 10000; i++) service.playerIdFor(`@p${i}:matrix.test`);
        const ids: Map<string, number> = (service as any).playerIds;
        expect(ids.size).toBe(10000);
        expect(ids.has('@p0:matrix.test')).toBe(false);
        expect(service.playerIdFor('@p0:matrix.test')).not.toBe(first);
    });
});

describe('Bot status notes', () => {
    it('guesses the language from the script or common words, English when unsure', () => {
        expect(detectLanguage('مرحبا')).toBe('ar');
        expect(detectLanguage('こんにちは、元気？')).toBe('ja');
        expect(detectLanguage('안녕하세요')).toBe('ko');
        expect(detectLanguage('你好，你在吗')).toBe('zh');
        expect(detectLanguage('Bonjour, tu es là ?')).toBe('fr');
        expect(detectLanguage('Hola, ¿estás ahí?')).toBe('es');
        expect(detectLanguage('Hallo, bist du da?')).toBe('de');
        expect(detectLanguage('Olá, você está aí?')).toBe('pt');
        expect(detectLanguage('Ciao, come stai?')).toBe('it');
        expect(detectLanguage('Hoi, ben je er?')).toBe('nl');
        expect(detectLanguage('Bon dia, com estàs?')).toBe('ca');
        expect(detectLanguage('Hello?')).toBe('en');
        expect(detectLanguage('ok')).toBe('en');
        expect(detectLanguage('')).toBe('en');
    });

    it('builds a notice other apps can read and the game can draw as a card', () => {
        const note = statusNoteContent('unready', 'en', 'Gate Keeper');
        expect(note).toEqual({
            msgtype: 'm.notice',
            body: "Gate Keeper isn't ready to chat yet. The bot's owner still needs to finish setting it up. Try again another day.",
            [BOT_STATUS_KEY]: {
                state: 'unready',
                title: 'Not ready yet',
                text: "The bot's owner still needs to finish setting it up. Try again another day.",
                lang: 'en',
            },
        });
    });

    it('reads a bot state from its configuration', () => {
        expect(availabilityOf(null)).toBe('gone');
        expect(availabilityOf({ enabled: false, aiProviderRef: 'p' } as never)).toBe('resting');
        expect(availabilityOf({ enabled: true } as never)).toBe('unready');
        expect(availabilityOf({ aiProviderRef: 'p' } as never)).toBe('online');
    });
});

describe('DmReplyService resting line', () => {
    it('asks the bot for one short in-character line, and gives up quietly', async () => {
        const { DmReplyService } = await import('../server/DmReplyService');
        const service = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
        const quickGenerate = vi.fn(async () => 'Not now, sailor!');
        Object.assign(service, { aiService: { quickGenerate } });
        const config = { botId: BOT, name: 'Mira', aiProviderRef: 'p', chatInstructions: 'You are a pirate.' } as never;
        expect(await service.restingLine(config, 'Are you around?')).toBe('Not now, sailor!');
        expect(quickGenerate).toHaveBeenCalledWith('p', expect.stringContaining('You are a pirate.'), 'Are you around?');
        quickGenerate.mockRejectedValueOnce(new Error('provider down'));
        expect(await service.restingLine(config, 'hi')).toBe('');
        expect(await service.restingLine({ botId: BOT } as never, 'hi')).toBe('');
    });
});

describe('MatrixDmBridge waiting messages', () => {
    it('forgets messages kept in this process after a day, even if the bot stays off', async () => {
        const client = makeClient();
        const deps = makeDeps();
        const bridge = new MatrixDmBridge(config, client as never, deps);
        await bridge.onEvent(invite());
        deps.getBotConfig.mockResolvedValue({ botId: BOT, name: 'Guide', enabled: false, aiProviderRef: 'p' } as never);
        await bridge.onEvent(message('anyone?'));
        expect((bridge as any).localWaiting.size).toBe(1);
        const rooms: Map<string, { at: number }> = (bridge as any).localWaiting.get(BOT);
        rooms.get(ROOM)!.at -= 24 * 60 * 60 * 1000;
        await bridge.checkWaiting();
        expect((bridge as any).localWaiting.size).toBe(0);
    });
});
