/**
 * Direct chats with a Brick, after the full review of the release: what a person's own message can claim, who is in the room
 * when a carried chat goes, a newer chat that is never forgotten with an old one, the cap on waiting answers, and the upload
 * receipts that never reach a chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONNECTED_EVENT, APP_CONNECTED_KEY, MatrixDmBridge } from '../matrix/MatrixDmBridge';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const BOB = '@bob:matrix.test';
const ROOM = '!dm:matrix.test';

function makeClient(): any {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async (): Promise<string | null> => 'Nora'),
        joinRoom: vi.fn(async () => undefined),
        leaveRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async () => '$evt'),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BOT_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
    };
}

function makeStores() {
    const rooms = new Map<string, string>();
    const roomsOf = new Map<string, string>();
    const deps: any = {
        getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Nora', enabled: true, aiProviderRef: 'p' }) as never),
        checkAccess: vi.fn(async (): Promise<any> => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async (): Promise<any> => ({ text: 'Hello Alice!', media: [] })),
        appConnected: vi.fn(async () => true),
        rooms: {
            rememberDmRoom: vi.fn(async (r: string, b: string) => void rooms.set(r, b)),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
            rememberDmRoomOf: vi.fn(async (b: string, u: string, r: string) => void roomsOf.set(`${b}|${u}`, r)),
            getDmRoomOf: vi.fn(async (b: string, u: string) => roomsOf.get(`${b}|${u}`) ?? null),
            forgetDmRoomOf: vi.fn(async (b: string, u: string, r?: string) => void (r === undefined || roomsOf.get(`${b}|${u}`) === r ? roomsOf.delete(`${b}|${u}`) : undefined)),
        },
    };
    return { rooms, roomsOf, deps };
}

const invite = (): MatrixEvent => ({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BOT_USER, content: { membership: 'invite', is_direct: true } });
const message = (body: string, extra: Record<string, unknown> = {}): MatrixEvent => ({ type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body, ...extra } });
const joined = (who: string): MatrixEvent => ({ type: 'm.room.member', room_id: ROOM, sender: who, event_id: `$j${Math.random()}`, state_key: who, content: { membership: 'join' } });

describe('MatrixDmBridge after the full review', () => {
    let client: any;
    let stores: ReturnType<typeof makeStores>;
    let bridge: MatrixDmBridge;

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        client = makeClient();
        stores = makeStores();
        bridge = new MatrixDmBridge(config, client as never, stores.deps);
    });
    afterEach(() => vi.restoreAllMocks());

    describe('a line from the system that says an App was connected', () => {
        it('is never taken from the content of a person\'s own message', async () => {
            await bridge.onEvent(invite());
            await bridge.onEvent(message('hello', { [APP_CONNECTED_KEY]: { app: 'notion', name: 'Notion' } }));
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            const hooks = stores.deps.reply.mock.calls[0][4];
            expect(hooks).not.toHaveProperty('note');
            expect(hooks).not.toHaveProperty('connectedApp');
            // Nor does the Brick say what it may do with an App the person only claimed
            expect(client.sendText.mock.calls.map((call: any[]) => call[2]).join('\n')).not.toContain('Notion');
        });

        it('is carried on from the bridge\'s own event, once Orbit confirms the App is connected', async () => {
            await bridge.onEvent(invite());
            await bridge.onEvent({ type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c1', content: { app: 'notion', name: 'Notion' } });
            expect(stores.deps.appConnected).toHaveBeenCalledWith(BOT, 'uuid-alice', 'notion');
            expect(stores.deps.reply.mock.calls[0][4]).toMatchObject({ note: true, connectedApp: { app: 'notion', name: 'Notion' } });
        });

        it('is not carried on when the App is not connected, or Orbit cannot say', async () => {
            await bridge.onEvent(invite());
            stores.deps.appConnected.mockResolvedValueOnce(false);
            await bridge.onEvent({ type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c2', content: { app: 'notion', name: 'Notion' } });
            stores.deps.appConnected.mockRejectedValueOnce(new Error('Orbit down'));
            await bridge.onEvent({ type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c3', content: { app: 'notion', name: 'Notion' } });
            expect(stores.deps.reply).not.toHaveBeenCalled();
        });
    });

    describe('a carried chat', () => {
        it('is not sent into a room someone joined while the chat was being looked at', async () => {
            await bridge.onEvent(invite());
            // The chat is known to the store but not yet by who it is with, so noting it takes a moment, and Bob joins meanwhile
            stores.roomsOf.set(`${BOT}|${ALICE}`, ROOM);
            bridge = new MatrixDmBridge(config, client as never, stores.deps);
            await bridge.onEvent(message('hi'));
            client.sendMessage.mockClear();
            const fresh = new MatrixDmBridge(config, client as never, stores.deps);
            await fresh.onEvent(message('hi again'));
            stores.deps.rooms.rememberDmRoomOf.mockImplementation(async () => {
                await fresh.onEvent(joined(BOB));
            });
            fresh['directRooms'].clear();
            const result = await fresh.carryGuestChat(BOT, ALICE, 'carry-1', [{ from: 'guest', text: 'hello', at: 1 }]);
            expect(result).toBe('wait');
            expect(client.sendMessage).not.toHaveBeenCalled();
        });

        it('is not sent when the room was forgotten while the chat was being looked at, so its members are not known', async () => {
            await bridge.onEvent(invite());
            stores.roomsOf.set(`${BOT}|${ALICE}`, ROOM);
            bridge = new MatrixDmBridge(config, client as never, stores.deps);
            await bridge.onEvent(message('hi'));
            client.sendMessage.mockClear();
            const fresh = new MatrixDmBridge(config, client as never, stores.deps);
            await fresh.onEvent(message('hi again'));
            // Noting the chat takes a moment, and the bot is removed from the room meanwhile: the room's members are forgotten with it
            stores.deps.rooms.rememberDmRoomOf.mockImplementation(async () => {
                await fresh.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$leave', state_key: BOT_USER, content: { membership: 'leave' } });
            });
            fresh['directRooms'].clear();
            const result = await fresh.carryGuestChat(BOT, ALICE, 'carry-gone', [{ from: 'guest', text: 'hello', at: 1 }]);
            expect(fresh['roomMembers'].has(ROOM)).toBe(false);
            expect(result).toBe('wait');
            expect(client.sendMessage).not.toHaveBeenCalled();
        });

        it('never carries a guest\'s upload receipt into the chat', async () => {
            await bridge.onEvent(invite());
            client.sendMessage.mockClear();
            const result = await bridge.carryGuestChat(BOT, ALICE, 'carry-2', [{ from: 'guest', text: '', at: 1, label: true, media: [{ kind: 'file', name: 'cv.pdf', type: 'application/pdf', receipt: 'secret-receipt' }] }]);
            expect(result).toBe('sent');
            const sent = client.sendMessage.mock.calls.at(-1)[2];
            expect(JSON.stringify(sent)).not.toContain('secret-receipt');
            expect(JSON.stringify(sent)).toContain('cv.pdf');
        });
    });

    describe('a direct chat that is not theirs any more', () => {
        it('is forgotten by the room that was seen, so a newer chat noted meanwhile stays', async () => {
            stores.roomsOf.set(`${BOT}|${ALICE}`, ROOM);
            stores.rooms.set(ROOM, BOT);
            // Bob is in the room: it is not theirs
            client.getJoinedMembers.mockResolvedValue([ALICE, BOT_USER, BOB]);
            const answer = await bridge.directChatFor(BOT, ALICE);
            expect(answer).not.toHaveProperty('roomId');
            expect(stores.deps.rooms.forgetDmRoomOf).toHaveBeenCalledWith(BOT, ALICE, ROOM);
        });
    });

    describe('answers waiting for a direct chat', () => {
        it('stay within the cap when one that failed to send is put back', async () => {
            await bridge.onEvent(invite());
            await bridge.keepNearbyAnswer(BOT, ALICE, 'First.');
            const pairs = bridge['nearbyAnswers'] as Map<string, unknown[]>;
            expect(pairs.size).toBe(0);
            // A send that is still on its way while other pairs fill the map to its cap
            let failSend!: (error: Error) => void;
            client.sendMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => void (failSend = reject)));
            const sending = bridge.keepNearbyAnswer(BOT, ALICE, 'Second.');
            await new Promise((resolve) => setTimeout(resolve, 0));
            for (let i = 0; i < 2000; i++) pairs.set(`other-${i}|@x${i}:matrix.test`, [{ text: 'w', at: Date.now(), txnId: String(i) }]);
            failSend(new Error('homeserver down'));
            await sending;
            expect(pairs.size).toBeLessThanOrEqual(2000);
            expect(pairs.has(`${BOT}|${ALICE}`)).toBe(true);
        });
    });
});

describe('a message that arrives while the store that knows the chat is down', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('is kept and answered once the store is back, never dropped', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        // The bot server restarted: the chat is in the store, not yet in the bridge's memory
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        await bridge.onEvent(message('are you there?'));
        expect(stores.deps.reply).not.toHaveBeenCalled();

        down = false;
        await vi.advanceTimersByTimeAsync(2500);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        expect(client.sendText.mock.calls.map((call: any[]) => call[2])).toContain('Hello Alice!');
        bridge.stop();
    });

    it('keeps trying, a little slower each time, while the store stays down', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        await bridge.onEvent(message('hello?'));
        await vi.advanceTimersByTimeAsync(2100); // first retry, still down
        await vi.advanceTimersByTimeAsync(3000); // second retry is not due until four seconds after the first
        expect(stores.deps.reply).not.toHaveBeenCalled();
        down = false;
        await vi.advanceTimersByTimeAsync(2000);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        bridge.stop();
    });

    it('does not answer an older kept message while a newer one in the same chat is being answered, nor after it was', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        let finish: (reply: any) => void = () => undefined;
        stores.deps.reply = vi.fn(() => new Promise((resolve) => (finish = resolve)));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        await bridge.onEvent({ ...message('first'), origin_server_ts: 1000 });
        down = false;
        // The newer message finds the store back and is being answered (its reply is still on its way)
        const second = bridge.onEvent({ ...message('second'), origin_server_ts: 2000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        // The kept older one comes due meanwhile: it does not start a second answer
        await vi.advanceTimersByTimeAsync(2500);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        // The newer answer lands; the older one is let go of at its next try and is never answered
        finish({ text: 'Answer to the second', media: [] });
        await second;
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        expect(client.sendText.mock.calls.map((call: any[]) => call[2])).toEqual(['Answer to the second']);
        bridge.stop();
    });

    it('lets go of a kept message once it is a day old, however many times it was kept again', async () => {
        vi.useFakeTimers({ now: 1_700_000_000_000 });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        await bridge.onEvent({ ...message('are you there?'), origin_server_ts: Date.now() });
        // Every try fails for a day and an hour: it is kept again each time, and its age is the message's own
        await vi.advanceTimersByTimeAsync(25 * 60 * 60_000);
        down = false;
        await vi.advanceTimersByTimeAsync(2 * 60_000);
        expect(stores.deps.reply).not.toHaveBeenCalled();
        bridge.stop();
    });

    it('does not answer an older message after the person wrote again and was answered', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        await bridge.onEvent({ ...message('first'), origin_server_ts: 1000 });
        down = false;
        // The next message finds the store back and is answered straight away
        await bridge.onEvent({ ...message('second'), origin_server_ts: 2000 });
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3000);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        bridge.stop();
    });
});
