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

        // CodeRabbit on #2114: the continuation goes with the ORIGINAL event's hook and has an identity made from it
        it('carries the original event\'s paid hook, and the same continuation has the same identity wherever it is handled', async () => {
            const original: MatrixEvent = { type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c9', content: { app: 'notion', name: 'Notion' } };
            await bridge.onEvent(invite());
            const paid = vi.fn(async () => undefined);
            await bridge.onEvent(original, { paid });
            expect(paid).toHaveBeenCalledTimes(1);
            const first = stores.deps.reply.mock.calls[0][4].eventId as string;
            expect(first).toMatch(/^\$app-[0-9a-f]{32}$/);
            // another server (a fresh bridge) handles the same event: the same continuation, so a start it makes carries the same key
            const other = new MatrixDmBridge(config, client as never, stores.deps);
            await other.onEvent(invite());
            await other.onEvent(original, { paid });
            expect(stores.deps.reply.mock.calls[1][4].eventId).toBe(first);
        });

        it('a failure before anything was paid for goes back to the inbox (it throws); after that, and with no inbox, it is a lost line that costs nothing', async () => {
            const original: MatrixEvent = { type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c10', content: { app: 'notion', name: 'Notion' } };
            await bridge.onEvent(invite());
            stores.deps.checkAccess.mockClear();
            vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60_000 });
            try {
                stores.deps.checkAccess.mockRejectedValueOnce(new Error('Orbit unreachable'));
                await expect(bridge.onEvent(original, { paid: async () => undefined })).rejects.toThrow('Orbit unreachable');
                // handed out again: carried on now
                await bridge.onEvent(original, { paid: async () => undefined });
                expect(stores.deps.reply).toHaveBeenCalledTimes(1);
                // with no inbox hooks the same failure is only a line that is lost. The access answer is cached for a while, so the clock goes past that: the bare event does ask Orbit afresh
                const bare: MatrixEvent = { ...original, event_id: '$c11' };
                vi.setSystemTime(Date.now() + 5 * 60_000);
                stores.deps.checkAccess.mockClear();
                stores.deps.checkAccess.mockRejectedValueOnce(new Error('Orbit unreachable'));
                await expect(bridge.onEvent(bare)).resolves.toBeUndefined();
                // it did ask (and was refused), and nothing was answered again
                expect(stores.deps.checkAccess).toHaveBeenCalledTimes(1);
                expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
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

    // CodeRabbit on #2114 (review of d098522a), and Opus's design for a store that is down: the event is HELD here, under its own acquisition and paid hook, never counted as a try
    describe('an event the inbox holds while the chat store or the App lookup is down', () => {
        const down = (minutes: number) => minutes * 60_000;
        const storeDown = (stores: ReturnType<typeof makeStores>, isDown: { now: boolean }) => {
            stores.rooms.set(ROOM, BOT);
            stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
                if (isDown.now) throw new Error('Redis is reconnecting');
                return stores.rooms.get(room) ?? null;
            });
        };

        it('a lookup that fails for three minutes and then recovers is answered once, with one paid start, and nothing was given back', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const client = makeClient();
            const stores = makeStores();
            const isDown = { now: true };
            storeDown(stores, isDown);
            const bridge = new MatrixDmBridge(config, client as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            let outcome: 'pending' | 'returned' | 'threw' = 'pending';
            const held = bridge.onEvent(message('are you there?'), { paid }).then(
                () => (outcome = 'returned'),
                () => (outcome = 'threw')
            );
            await vi.advanceTimersByTimeAsync(down(3));
            // still held: not answered, not given back, nothing paid, nothing kept in this process
            expect(outcome).toBe('pending');
            expect(stores.deps.reply).not.toHaveBeenCalled();
            expect(paid).not.toHaveBeenCalled();
            expect((bridge as any).unplaced.size).toBe(0);
            isDown.now = false;
            await vi.advanceTimersByTimeAsync(down(1));
            await held;
            expect(outcome).toBe('returned');
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            expect(paid).toHaveBeenCalledTimes(1);
            bridge.stop();
        });

        it('still down after an hour: the failure goes back (the entry is given back as a try); nothing is kept in this process', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const client = makeClient();
            const stores = makeStores();
            storeDown(stores, { now: true });
            const bridge = new MatrixDmBridge(config, client as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            const held = bridge.onEvent(message('are you there?'), { paid });
            const outcome = held.then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(down(59));
            await vi.advanceTimersByTimeAsync(down(3));
            expect(await outcome).toBe('Redis is reconnecting');
            expect((bridge as any).unplaced.size).toBe(0);
            expect(paid).not.toHaveBeenCalled();
            expect(stores.deps.reply).not.toHaveBeenCalled();
            bridge.stop();
        });

        it('a bridge that stops ends the wait at once and gives the event back', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            storeDown(stores, { now: true });
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            const held = bridge.onEvent(message('hello?'), { paid: async () => undefined });
            const outcome = held.then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(5000);
            void bridge.stop();
            await vi.advanceTimersByTimeAsync(0);
            expect(await outcome).toBe('Redis is reconnecting');
        });

        // CodeRabbit on 27ab3385: the wait ends on stop(), and a lookup that happens to succeed on the way out must not start a paid reply during shutdown
        it('a bridge that stops while the lookup has just recovered still gives the event back, with no reply and no paid start', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            const isDown = { now: true };
            storeDown(stores, isDown);
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            const outcome = bridge.onEvent(message('hello?'), { paid }).then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(5000);
            isDown.now = false;
            void bridge.stop();
            await vi.advanceTimersByTimeAsync(0);
            expect(await outcome).toBe('Redis is reconnecting');
            expect(stores.deps.reply).not.toHaveBeenCalled();
            expect(paid).not.toHaveBeenCalled();
        });

        // CodeRabbit on a767269a: the FIRST lookup, with no failure before it, is no different once the bridge is stopping
        it('the first lookup, in flight when the bridge stops, and that then succeeds is not taken: no reply, no paid start, and the event goes back', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            stores.rooms.set(ROOM, BOT);
            let finish: (bot: string | null) => void = () => undefined;
            stores.deps.rooms.getDmRoomBot = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            const outcome = bridge.onEvent(message('hello?'), { paid }).then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(100);
            void bridge.stop();
            finish(BOT);
            await vi.advanceTimersByTimeAsync(0);
            expect(await outcome).toMatch(/stopping/i);
            expect(stores.deps.reply).not.toHaveBeenCalled();
            expect(paid).not.toHaveBeenCalled();
        });

        it('a retry already in flight when the bridge stops, and that then succeeds, is not taken: the event goes back', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            stores.rooms.set(ROOM, BOT);
            let calls = 0;
            let finish: (bot: string | null) => void = () => undefined;
            stores.deps.rooms.getDmRoomBot = vi.fn(async () => {
                calls += 1;
                if (calls === 1) throw new Error('Redis is reconnecting');
                return new Promise<string | null>((resolve) => (finish = resolve));
            });
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            const outcome = bridge.onEvent(message('hello?'), { paid }).then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(2500);
            expect(calls).toBe(2);
            void bridge.stop();
            finish(BOT);
            await vi.advanceTimersByTimeAsync(0);
            expect(await outcome).toBe('Redis is reconnecting');
            expect(stores.deps.reply).not.toHaveBeenCalled();
            expect(paid).not.toHaveBeenCalled();
        });

        // CodeRabbit on 27ab3385: the router gives EVERY event the hook; only an event the inbox holds may be held (the room waits behind it)
        it('an event with no durable inbox entry is never held: it goes to the local list at once, so the room is not blocked', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            const isDown = { now: true };
            storeDown(stores, isDown);
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            const paid = vi.fn(async () => undefined);
            await bridge.onEvent(message('hello?'), { paid, durable: false });
            expect((bridge as any).unplaced.size).toBe(1);
            expect(paid).not.toHaveBeenCalled();
            isDown.now = false;
            await vi.advanceTimersByTimeAsync(2500);
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            bridge.stop();
        });

        it('an event with no hooks is kept here and tried again, as it always was', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const stores = makeStores();
            const isDown = { now: true };
            storeDown(stores, isDown);
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            await bridge.onEvent(message('hello?'));
            expect((bridge as any).unplaced.size).toBe(1);
            isDown.now = false;
            await vi.advanceTimersByTimeAsync(2500);
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            bridge.stop();
        });

        it('a lookup of an App connection that fails for three minutes is held and then carried on once; an explicit "no" still stops, and one that stays down an hour goes back', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            vi.spyOn(console, 'info').mockImplementation(() => undefined);
            const stores = makeStores();
            const bridge = new MatrixDmBridge(config, makeClient() as never, stores.deps);
            await bridge.onEvent(invite());
            const original: MatrixEvent = { type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: '$c20', content: { app: 'notion', name: 'Notion' } };
            let orbitDown = true;
            stores.deps.appConnected.mockImplementation(async () => {
                if (orbitDown) throw new Error('Orbit down');
                return true;
            });
            const paid = vi.fn(async () => undefined);
            const held = bridge.onEvent(original, { paid });
            await vi.advanceTimersByTimeAsync(down(3));
            expect(stores.deps.reply).not.toHaveBeenCalled();
            orbitDown = false;
            await vi.advanceTimersByTimeAsync(down(1));
            await held;
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            expect(paid).toHaveBeenCalledTimes(1);
            // an explicit "no" from Orbit stops without a turn and without a failure
            stores.deps.appConnected.mockImplementation(async () => false);
            await expect(bridge.onEvent({ ...original, event_id: '$c21' }, { paid: async () => undefined })).resolves.toBeUndefined();
            expect(stores.deps.reply).toHaveBeenCalledTimes(1);
            // down for good: after the hour it goes back
            orbitDown = true;
            stores.deps.appConnected.mockImplementation(async () => {
                throw new Error('Orbit down');
            });
            const forever = bridge.onEvent({ ...original, event_id: '$c22' }, { paid: async () => undefined });
            const outcome = forever.then(
                () => 'returned',
                (error: Error) => error.message
            );
            await vi.advanceTimersByTimeAsync(down(62));
            expect(await outcome).toBe('Orbit down');
            bridge.stop();
        });

        it('an event that ran out of tries tells the person it was not answered (never silence) and reports it to Sentry; work that had begun is only reported', async () => {
            const client = makeClient();
            const stores = makeStores();
            const bridge = new MatrixDmBridge(config, client as never, stores.deps);
            await bridge.onEvent(invite());
            await bridge.onGaveUp(message('hello?'), 'tries');
            const notes = client.sendMessage.mock.calls.map((call: any[]) => call[2]);
            expect(notes).toHaveLength(1);
            expect(JSON.stringify(notes[0])).toMatch(/trouble|couldn|answer/i);
            client.sendMessage.mockClear();
            await bridge.onGaveUp(message('hello?'), 'paid');
            expect(client.sendMessage).not.toHaveBeenCalled();
            // a chat that cannot be resolved is only reported, and never throws
            await expect(bridge.onGaveUp({ ...message('hi'), room_id: '!unknown:matrix.test' }, 'tries')).resolves.toBeUndefined();
        });
    });

    it('the reply is kept as something the person was told only when Matrix gave the id of its text: a send that was suppressed keeps nothing', async () => {
        const client = makeClient();
        const stores = makeStores();
        const keep = vi.fn();
        stores.deps.reply = vi.fn(async () => ({ text: 'Your job is running.', media: [], keep }));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        await bridge.onEvent(invite());
        // the text did not go out (no event id comes back: the chat was cleared meanwhile)
        client.sendText.mockResolvedValueOnce(undefined);
        await bridge.onEvent(message('hello'));
        expect(keep).not.toHaveBeenCalled();
        // the text went out: kept with the id Matrix gave
        client.sendText.mockResolvedValueOnce('$text-event');
        await bridge.onEvent(message('hello again'));
        expect(keep).toHaveBeenCalledTimes(1);
        expect(keep).toHaveBeenCalledWith('$text-event');
    });

    it('keeps a bot\'s leave whose room could not be looked up, and clears the room once the store answers', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        // After a restart: the room is in the store, not yet in the bridge's memory, and the store is not answering for longer than the lookup waits
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        (bridge as any).roomLookupWaitMs = 0;
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: BOT_USER, event_id: '$leave1', state_key: BOT_USER, content: { membership: 'leave' } });
        // Not cleared yet: it could not be told whose room it is
        expect(stores.deps.rooms.forgetDmRoom).not.toHaveBeenCalled();
        expect((bridge as any).pendingBotRemovals.get(ROOM)).toBe(BOT);
        // Still down at the first try: kept
        await vi.advanceTimersByTimeAsync(2100);
        expect(stores.deps.rooms.forgetDmRoom).not.toHaveBeenCalled();
        expect((bridge as any).pendingBotRemovals.size).toBe(1);
        // The store is back: the room is cleared, and nothing is waiting any more
        down = false;
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.rooms.forgetDmRoom).toHaveBeenCalledWith(ROOM);
        expect(stores.rooms.has(ROOM)).toBe(false);
        expect((bridge as any).pendingBotRemovals.size).toBe(0);
        bridge.stop();
    });

    it('does not keep a bot\'s leave from a room the store says is not its own, and clears nothing for it', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: BOT_USER, event_id: '$leave2', state_key: BOT_USER, content: { membership: 'leave' } });
        expect((bridge as any).pendingBotRemovals.size).toBe(0);
        expect(stores.deps.rooms.forgetDmRoom).not.toHaveBeenCalled();
        bridge.stop();
    });

    it('does not answer an older kept message while a newer one in the same chat is being answered, nor after it was', async () => {
        vi.useFakeTimers({ now: 1_700_000_000_000 });
        // The messages' own times are the fake clock's, so they are young: a kept message is dropped for age only after a day
        const sent = Date.now();
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

        await bridge.onEvent({ ...message('first'), origin_server_ts: sent });
        down = false;
        // The newer message finds the store back and is being answered (its reply is still on its way)
        const second = bridge.onEvent({ ...message('second'), origin_server_ts: sent + 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        // The kept older one comes due meanwhile: it does not start a second answer
        await vi.advanceTimersByTimeAsync(2500);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        // ... and it is not dropped either: it is still kept until the newer answer lands
        expect((bridge as any).unplaced.get(ROOM)?.event.content.body).toBe('first');
        // The newer answer lands; the older one is let go of at its next try and is never answered
        finish({ text: 'Answer to the second', media: [] });
        await second;
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        expect(client.sendText.mock.calls.map((call: any[]) => call[2])).toEqual(['Answer to the second']);
        bridge.stop();
    });

    it('does not answer a recovered message after a newer one was answered while it waited on Orbit', async () => {
        vi.useFakeTimers({ now: 1_700_000_000_000 });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        // The first answer to be started waits on Orbit for the Brick's settings
        let release: () => void = () => undefined;
        let asked = 0;
        stores.deps.getBotConfig = vi.fn(async () => {
            if (++asked === 1) await new Promise<void>((resolve) => (release = resolve));
            return { botId: BOT, name: 'Nora', enabled: true, aiProviderRef: 'p' } as never;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        const sent = Date.now();
        await bridge.onEvent({ ...message('first'), origin_server_ts: sent });
        down = false;
        // The kept first message is tried again and waits on Orbit; a newer one then arrives and is answered
        await vi.advanceTimersByTimeAsync(2100);
        expect(asked).toBe(1);
        await bridge.onEvent({ ...message('second'), origin_server_ts: sent + 1000 });
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        release();
        await vi.advanceTimersByTimeAsync(5000);
        // The older one is not answered after the newer one
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        expect(stores.deps.reply.mock.calls[0][2]).toBe('second');
        bridge.stop();
    });

    it('does not close or count against the cards of a newer message when a recovered older one is dropped as stale', async () => {
        vi.useFakeTimers({ now: 1_700_000_000_000 });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        stores.deps.approvals = { newRequest: vi.fn(), onPersonMessage: vi.fn(async () => undefined) };
        let down = true;
        stores.deps.rooms.getDmRoomBot = vi.fn(async (room: string) => {
            if (down) throw new Error('Redis is reconnecting');
            return stores.rooms.get(room) ?? null;
        });
        let release: () => void = () => undefined;
        let asked = 0;
        stores.deps.getBotConfig = vi.fn(async () => {
            if (++asked === 1) await new Promise<void>((resolve) => (release = resolve));
            return { botId: BOT, name: 'Nora', enabled: true, aiProviderRef: 'p' } as never;
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        const sent = Date.now();
        await bridge.onEvent({ ...message('first'), origin_server_ts: sent });
        down = false;
        await vi.advanceTimersByTimeAsync(2100);
        await bridge.onEvent({ ...message('second'), origin_server_ts: sent + 1000 });
        expect(stores.deps.approvals.onPersonMessage).toHaveBeenCalledTimes(1);
        expect(stores.deps.approvals.newRequest).toHaveBeenCalledTimes(1);
        release();
        await vi.advanceTimersByTimeAsync(5000);
        // The stale one never reached the cards: the newer message's card is not cancelled by it
        expect(stores.deps.approvals.onPersonMessage).toHaveBeenCalledTimes(1);
        expect(stores.deps.approvals.newRequest).toHaveBeenCalledTimes(1);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        bridge.stop();
    });

    it('keeps a bot\'s leave when the shared store could not be cleared, and tries the whole clearing again', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        (bridge as any).directRooms.set('bot|user', ROOM);
        let failing = true;
        stores.deps.rooms.forgetDmRoom = vi.fn(async (room: string) => {
            if (failing) throw new Error('Redis is reconnecting');
            stores.rooms.delete(room);
        });
        (bridge as any).keepBotRemoval(ROOM, BOT);
        await vi.advanceTimersByTimeAsync(2100);
        // Still owed: the store did not let the room go
        expect(stores.deps.rooms.forgetDmRoom).toHaveBeenCalledTimes(1);
        expect((bridge as any).pendingBotRemovals.get(ROOM)).toBe(BOT);
        expect(stores.rooms.has(ROOM)).toBe(true);
        failing = false;
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.rooms.has(ROOM)).toBe(false);
        expect((bridge as any).pendingBotRemovals.size).toBe(0);
        // The person's own room entry went on the first try and is not asked again
        expect(stores.deps.rooms.forgetDmRoomOf).toHaveBeenCalledTimes(1);
        expect((bridge as any).directRooms.size).toBe(0);
        bridge.stop();
    });

    it('does not remove a room the bot joined again after its leave was queued, nor while the store is being asked', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const client = makeClient();
        const stores = makeStores();
        stores.rooms.set(ROOM, BOT);
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        (bridge as any).keepBotRemoval(ROOM, BOT);
        // Joined again before the first try
        await (bridge as any).rememberRoom(ROOM, BOT);
        expect((bridge as any).pendingBotRemovals.size).toBe(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.rooms.forgetDmRoom).not.toHaveBeenCalled();
        expect((bridge as any).roomBots.get(ROOM)).toBe(BOT);

        // Joined again while a try is waiting for the store's answer
        (bridge as any).roomBots.delete(ROOM);
        let answer: (bot: string) => void = () => undefined;
        stores.deps.rooms.getDmRoomBot = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
        (bridge as any).keepBotRemoval(ROOM, BOT);
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.rooms.getDmRoomBot).toHaveBeenCalled();
        await (bridge as any).rememberRoom(ROOM, BOT);
        answer(BOT);
        await vi.advanceTimersByTimeAsync(5000);
        expect(stores.deps.rooms.forgetDmRoom).not.toHaveBeenCalled();
        expect((bridge as any).roomBots.get(ROOM)).toBe(BOT);
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
        vi.useFakeTimers({ now: 1_700_000_000_000 });
        const sent = Date.now();
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

        await bridge.onEvent({ ...message('first'), origin_server_ts: sent });
        down = false;
        // The next message finds the store back and is answered straight away
        await bridge.onEvent({ ...message('second'), origin_server_ts: sent + 1000 });
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3000);
        expect(stores.deps.reply).toHaveBeenCalledTimes(1);
        bridge.stop();
    });
});
