/**
 * What a Brick's own chat code may still do once its purge has begun (register R29): nothing is written for it, and a chat closed because the
 * Brick is gone is cleared by the purge like any other. Each case starts a purge while an ordinary path is in the middle of its work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';

const message = (id: string, ts = 1): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: id, origin_server_ts: ts, content: { msgtype: 'm.text', body: `from ${id}` },
});

function makeClient(): any {
    const sent: MatrixEvent[] = [];
    return {
        sent,
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async () => 'Guide'),
        leaveRoom: vi.fn(async () => undefined),
        forgetRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async (_u: string, room: string, content: any) => {
            sent.push({ type: 'm.room.message', room_id: room, sender: BOT_USER, event_id: `$note${sent.length}`, content });
            return `$note${sent.length}`;
        }),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BOT_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
        getJoinedRooms: vi.fn(async () => [ROOM]),
        clearProfile: vi.fn(async () => undefined),
        getProfile: vi.fn(async () => ({ displayName: null, avatarUrl: null })),
        getMessagesPage: vi.fn(async () => ({ events: sent.filter((event) => !redacted.has(event.event_id)), end: undefined })),
        redactEvent: vi.fn(async (_u: string, _room: string, eventId: string) => void redacted.add(eventId)),
    };
}
let redacted: Set<string>;

function makeDeps(): any {
    const rooms = new Map<string, string>([[ROOM, BOT]]);
    return {
        getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' }) as never),
        checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async () => ({ text: 'Hello Alice!', media: [] })),
        rooms: {
            rememberDmRoom: vi.fn(async () => undefined),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
            forgetDmRoomOf: vi.fn(async () => undefined),
        },
        waiting: {
            hasSharedStore: () => true,
            rememberWaitingDm: vi.fn(async () => undefined),
            waitingDmBots: vi.fn(async () => []),
            hasWaitingDms: vi.fn(async () => false),
            takeWaitingDms: vi.fn(async () => []),
        },
    };
}

describe('MatrixDmBridge: a purge that begins in the middle of ordinary work (R29)', () => {
    let client: any;
    let deps: any;
    let bridge: any;

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        redacted = new Set();
        client = makeClient();
        deps = makeDeps();
        bridge = new MatrixDmBridge(config, client as never, deps) as any;
        bridge.roomBots.set(ROOM, BOT);
        bridge.roomMembers.set(ROOM, new Set([ALICE, BOT_USER]));
    });
    afterEach(() => vi.restoreAllMocks());

    it('does not put the picture back when a message already in flight reaches it after the purge began', async () => {
        const update = vi.fn(async () => undefined);
        bridge.avatars = { update };
        // The purge begins while the person's card approvals are being closed, which is just before the picture is refreshed
        deps.approvals = { newRequest: vi.fn(), onPersonMessage: vi.fn(() => { bridge.purgedBots.add(BOT); return Promise.resolve(); }) };
        await bridge.onEvent(message('$m1'));
        expect(update).not.toHaveBeenCalled();
        expect(deps.reply).not.toHaveBeenCalled();
        // And for a Brick not being purged, the picture is still refreshed
        bridge.purgedBots.delete(BOT);
        deps.approvals = undefined;
        await bridge.onEvent(message('$m2'));
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('answers nothing for a Brick whose purge began while its configuration was loading', async () => {
        deps.getBotConfig.mockImplementation(async () => {
            bridge.purgedBots.add(BOT);
            return { botId: BOT, name: 'Guide', enabled: true, aiProviderRef: 'p' };
        });
        await bridge.onEvent(message('$m1'));
        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('says no goodbye and leaves no room for a Brick being purged: closeChat and checkWaiting both stand aside', async () => {
        bridge.purgedBots.add(BOT);
        await bridge.closeChat(BOT, ROOM, 'en');
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.leaveRoom).not.toHaveBeenCalled();
        // A message that was waiting is neither kept again nor answered
        bridge.localWaiting.set(BOT, new Map([[ROOM, { message: JSON.stringify(message('$w1')), at: Date.now() }]]));
        await bridge.checkWaiting();
        expect(deps.reply).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.leaveRoom).not.toHaveBeenCalled();
        expect(deps.waiting.rememberWaitingDm).not.toHaveBeenCalled();
    });

    it('a Brick deleted before this change, whose chat closes on a message, has everything it said redacted (its earlier messages and the note) and leaves', async () => {
        // What it said earlier in the room, newest first
        const said = [
            { type: 'm.room.message', room_id: ROOM, sender: BOT_USER, event_id: '$b2', content: { msgtype: 'm.text', body: 'a goodbye from an older version' } },
            message('$a1'),
            { type: 'm.room.message', room_id: ROOM, sender: BOT_USER, event_id: '$b1', content: { msgtype: 'm.text', body: 'hello' } },
        ] as MatrixEvent[];
        client.getMessagesPage.mockImplementation(async () => ({ events: said.filter((event) => !redacted.has(event.event_id)), end: undefined }));
        await bridge.closeChat(BOT, ROOM, 'en');
        // Only what the Brick said, and before it leaves; no new note is written
        expect([...redacted].sort()).toEqual(['$b1', '$b2']);
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.redactEvent.mock.invocationCallOrder.at(-1)).toBeLessThan(client.leaveRoom.mock.invocationCallOrder[0]);
        expect(client.leaveRoom).toHaveBeenCalledWith(BOT_USER, ROOM, 'Brick deleted');
        expect(client.forgetRoom).toHaveBeenCalledWith(BOT_USER, ROOM);
        expect(deps.rooms.forgetDmRoom).toHaveBeenCalledWith(ROOM);
    });

    it('a chat that cannot be cleared when it closes stays joined and is tried again, and a purge reaching the same room shares the one run', async () => {
        client.redactEvent.mockRejectedValueOnce(new Error('Matrix redact failed: 500'));
        client.getMessagesPage.mockResolvedValue({ events: [{ type: 'm.room.message', room_id: ROOM, sender: BOT_USER, event_id: '$b1', content: {} } as MatrixEvent], end: undefined });
        await bridge.closeChat(BOT, ROOM, 'en');
        expect(client.leaveRoom).not.toHaveBeenCalled();
        await bridge.closeChat(BOT, ROOM, 'en');
        expect(client.leaveRoom).toHaveBeenCalledTimes(1);
        // A purge and a closing chat on one room at once clear it once
        client.leaveRoom.mockClear();
        client.redactEvent.mockClear();
        let release!: () => void;
        client.getJoinedMembers.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([ALICE, BOT_USER]))));
        const closing = bridge.closeChat(BOT, ROOM, 'en');
        const purging = bridge.purgeChats(BOT);
        await new Promise((resolve) => setTimeout(resolve, 5));
        release();
        await Promise.all([closing, purging]);
        expect(client.leaveRoom).toHaveBeenCalledTimes(1);
    });

    it('stops answering waiting messages the moment a purge begins, and drops the rest of the queue', async () => {
        const now = Date.now();
        // Only the newest message of a room is answered, so each waits in a room of its own
        const waiting = [1, 2, 3].map((n) => ({ ...message(`$w${n}`, now - (4 - n) * 1000), room_id: `!r${n}:matrix.test` }));
        for (const event of waiting) bridge.roomBots.set(event.room_id, BOT);
        deps.waiting.takeWaitingDms.mockResolvedValue(waiting.map((event) => JSON.stringify(event)));
        const answered: string[] = [];
        vi.spyOn(bridge, 'handleMessage').mockImplementation(async (event: any) => {
            answered.push(event.event_id);
            // The purge begins while the first one is being answered
            bridge.purgedBots.add(BOT);
        });
        await bridge.runDrain(BOT);
        expect(answered).toEqual(['$w1']);
        expect(bridge.drainQueues.has(BOT)).toBe(false);
    });

    it('goes on past an empty page of history when the homeserver gives a token that moves on, and finishes at the end', async () => {
        const note = { type: 'm.room.message', room_id: ROOM, sender: BOT_USER, event_id: '$old', content: { msgtype: 'm.text', body: 'old' } } as MatrixEvent;
        client.getMessagesPage.mockImplementation(async (_u: string, _room: string, from?: string) => {
            if (!from) return { events: [], end: 't1' };
            if (from === 't1') return { events: [note], end: 't2' };
            return { events: [], end: undefined };
        });
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.getMessagesPage.mock.calls.map((call: any[]) => call[2])).toEqual([undefined, 't1', 't2']);
        expect([...redacted]).toEqual(['$old']);
        expect(client.leaveRoom).toHaveBeenCalledTimes(1);
    });

    it('writes a room down as owed before it leaves, and clears the record once the forget went through', async () => {
        const order: string[] = [];
        deps.rooms.rememberPendingForget = vi.fn(async () => void order.push('remember'));
        deps.rooms.clearPendingForget = vi.fn(async () => void order.push('clear'));
        deps.rooms.pendingForgetsOf = vi.fn(async () => []);
        client.leaveRoom.mockImplementation(async () => void order.push('leave'));
        client.forgetRoom.mockImplementation(async () => void order.push('forget'));
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(order).toEqual(['remember', 'leave', 'forget', 'clear']);
    });

    it('does not leave a room it could not write down as owed, so the next try finds it still joined', async () => {
        deps.rooms.rememberPendingForget = vi.fn(async () => { throw new Error('The shared store is down'); });
        deps.rooms.pendingForgetsOf = vi.fn(async () => []);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();
    });

    it('finishes a forget the shared store says is owed after a restart, though the room is no longer joined, then clears it', async () => {
        const store = new Set<string>([`${BOT_USER}|!old:matrix.test`]);
        deps.rooms.rememberPendingForget = vi.fn(async (u: string, r: string) => void store.add(`${u}|${r}`));
        deps.rooms.pendingForgetsOf = vi.fn(async (u: string) => [...store].filter((k) => k.startsWith(`${u}|`)).map((k) => k.slice(u.length + 1)));
        deps.rooms.clearPendingForget = vi.fn(async (u: string, r: string) => void store.delete(`${u}|${r}`));
        client.getJoinedRooms.mockResolvedValue([]);
        // A forget that fails keeps the record and says not done
        client.forgetRoom.mockRejectedValueOnce(new Error('Matrix forget: 502'));
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(store.size).toBe(1);
        // A fresh process reads it and finishes
        const restarted = new MatrixDmBridge(config, client as never, deps) as any;
        expect(await restarted.purgeChats(BOT)).toBe(true);
        expect(client.forgetRoom).toHaveBeenLastCalledWith(BOT_USER, '!old:matrix.test');
        expect(store.size).toBe(0);
    });
});
