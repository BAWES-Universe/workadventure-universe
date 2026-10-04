import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MatrixDmBridge, type MatrixDmBridgeDeps } from '../matrix/MatrixDmBridge';
import { createMatrixAppServiceRouter, type MatrixEvent } from '../matrix/MatrixAppServiceRouter';
import { botIdFromMatrixId, botMatrixId, readMatrixConfig } from '../matrix/MatrixConfig';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';

function makeClient() {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
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

function makeDeps(): MatrixDmBridgeDeps & { [k: string]: any } {
    const rooms = new Map<string, string>();
    return {
        getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' }) as never),
        checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async () => ({ text: 'Hello Alice!', media: [] })),
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
    let client: ReturnType<typeof makeClient>;
    let deps: ReturnType<typeof makeDeps>;
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
        deps.getBotConfig.mockResolvedValueOnce({ enabled: false } as never);
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

    it('says why and leaves when the person may not reach the bot', async () => {
        deps.checkAccess.mockResolvedValue({ allowed: false, reason: 'no_room_access', user: null });
        await bridge.onEvent(invite());
        expect(client.joinRoom).toHaveBeenCalled();
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, expect.stringContaining('can only chat'));
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
        expect(client.sendText).toHaveBeenCalledTimes(1);
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
