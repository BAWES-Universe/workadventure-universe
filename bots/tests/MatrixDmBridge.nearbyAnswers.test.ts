/**
 * The one copy of a private answer in direct messages (game #1993). An answer its person got in nearby chat, with others
 * around, is found once in their direct chat with the bot: the same words, sent on as a notice, by no model. It goes only
 * into a room that is this bot's and holds the two of them alone, and it waits while that room is not known.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWERED_NEARBY_KEY, MatrixDmBridge } from '../matrix/MatrixDmBridge';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const OTHER_BOT = '1c8d2e3f-2222-4333-8444-055566667777';
const ALICE = '@alice:matrix.test';
const BOB = '@bob:matrix.test';
const ROOM = '!dm:matrix.test';
const ANSWER = 'Your interview is at 10 on Thursday, at Zain.';

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

function makeDeps() {
    const rooms = new Map<string, string>();
    const roomsOf = new Map<string, string>();
    return {
        rooms,
        roomsOf,
        deps: {
            getBotConfig: vi.fn(async () => ({ botId: BOT, name: 'Nora', enabled: true, aiProviderRef: 'p' }) as never),
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
        } as any,
    };
}

const invite = (overrides: Partial<MatrixEvent> = {}): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BOT_USER, content: { membership: 'invite', is_direct: true }, ...overrides,
});
const message = (body: string, sender = ALICE, roomId = ROOM): MatrixEvent => ({
    type: 'm.room.message', room_id: roomId, sender, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body },
});
const copyOf = (text: string) => ({ msgtype: 'm.notice', body: text, [ANSWERED_NEARBY_KEY]: true });

describe('MatrixDmBridge: an answer from nearby chat, kept once in direct messages (#1993)', () => {
    let client: any;
    let deps: any;
    let stores: ReturnType<typeof makeDeps>;
    let bridge: MatrixDmBridge;
    /** The copies that reached a chat: [room, words]. */
    const copies = () =>
        client.sendMessage.mock.calls.filter((call: any[]) => call[2]?.[ANSWERED_NEARBY_KEY]).map((call: any[]) => [call[0], call[1], call[2].body]);

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        client = makeClient();
        stores = makeDeps();
        deps = stores.deps;
        bridge = new MatrixDmBridge(config, client as never, deps);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('puts it in the direct chat the bot and the person already have, as a notice marked for the game, and asks no model', async () => {
        await bridge.onEvent(invite());
        client.sendMessage.mockClear();

        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        expect(client.sendMessage.mock.calls).toEqual([[BOT_USER, ROOM, copyOf(ANSWER)]]);
        expect(client.sendText).not.toHaveBeenCalled();
        expect(deps.reply).not.toHaveBeenCalled();
    });

    it('sends each answer once, however often it is asked for again', async () => {
        await bridge.onEvent(invite());
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        await bridge.keepNearbyAnswer(BOT, ALICE, 'And bring your portfolio.');
        await bridge.openedFromNearby(BOT, ALICE, ROOM);
        await bridge.onEvent(message('thanks'));

        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER], [BOT_USER, ROOM, 'And bring your portfolio.']]);
    });

    it('waits when the two have no direct chat yet, and goes first when the bot joins the one the person starts', async () => {
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect(client.sendMessage).not.toHaveBeenCalled();

        // They open direct messages and type before the bot is in
        client.getRecentMessages.mockResolvedValue([{ ...message('and where is it?'), origin_server_ts: 2000 }]);
        await bridge.onEvent(invite({ origin_server_ts: 1000 }));

        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);
        // The copy is there before the bot's answer to what they typed
        expect(client.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(client.sendText.mock.invocationCallOrder[0]);
        expect(client.sendText).toHaveBeenCalledWith(BOT_USER, ROOM, 'Hello Alice!');
    });

    it('goes before the reply when the person writes in a chat this server did not know by who it is with', async () => {
        // A chat from before a restart: the bot is known for the room, not the room for the two of them
        stores.rooms.set(ROOM, BOT);
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect(client.sendMessage).not.toHaveBeenCalled();

        await bridge.onEvent(message('and where is it?'));

        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);
        expect(client.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(client.sendText.mock.invocationCallOrder[0]);
        // From now on the chat is known by who it is with, here and in the shared store
        expect(stores.roomsOf.get(`${BOT}|${ALICE}`)).toBe(ROOM);
        client.sendMessage.mockClear();
        await bridge.keepNearbyAnswer(BOT, ALICE, 'One more thing.');
        expect(copies()).toEqual([[BOT_USER, ROOM, 'One more thing.']]);
    });

    it('finds the chat in the shared store after a restart, with no message from the person', async () => {
        stores.rooms.set(ROOM, BOT);
        stores.roomsOf.set(`${BOT}|${ALICE}`, ROOM);

        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);
    });

    it('"Continue privately": goes into the room the person opened, once that room is the bot\'s and theirs alone', async () => {
        stores.rooms.set(ROOM, BOT);
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        await bridge.openedFromNearby(BOT, ALICE, ROOM);
        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);

        // A second tap asks the homeserver nothing more and sends nothing
        client.getJoinedMembers.mockClear();
        await bridge.openedFromNearby(BOT, ALICE, ROOM);
        expect(client.getJoinedMembers).not.toHaveBeenCalled();
        expect(copies()).toHaveLength(1);
    });

    it('looks again shortly at a chat the person just made, which the bot is still joining, one look at a time', async () => {
        vi.useFakeTimers();
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        // The tap comes before the bot is in the room, and they tap again and again
        for (let tap = 0; tap < 5; tap++) await bridge.openedFromNearby(BOT, ALICE, ROOM);
        expect(client.sendMessage).not.toHaveBeenCalled();

        // The bot joined meanwhile (its invite was taken elsewhere)
        stores.rooms.set(ROOM, BOT);
        await vi.advanceTimersByTimeAsync(3000);
        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);
        expect(client.getJoinedMembers).toHaveBeenCalledTimes(1);

        // Nothing is looked at after that
        await vi.advanceTimersByTimeAsync(60_000);
        expect(client.getJoinedMembers).toHaveBeenCalledTimes(1);
        expect((bridge as any).lookingAgain.size).toBe(0);
    });

    it('stops looking after a few times when the room never becomes theirs, and leaves the answer waiting', async () => {
        vi.useFakeTimers();
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        await bridge.openedFromNearby(BOT, ALICE, '!never:matrix.test');
        await vi.advanceTimersByTimeAsync(60_000);

        expect(deps.rooms.getDmRoomBot.mock.calls.filter((call: any[]) => call[0] === '!never:matrix.test')).toHaveLength(3);
        expect((bridge as any).lookingAgain.size).toBe(0);
        expect((bridge as any).nearbyAnswers.size).toBe(1);
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("does not take a device's word for the room: another bot's room, an unknown room, or a room with someone else in it gets nothing", async () => {
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        // A room this bot is not in
        await bridge.openedFromNearby(BOT, ALICE, '!unknown:matrix.test');
        // Another bot's room
        stores.rooms.set('!other:matrix.test', OTHER_BOT);
        await bridge.openedFromNearby(BOT, ALICE, '!other:matrix.test');
        // The bot's room with someone else: Bob's direct chat
        stores.rooms.set('!bob:matrix.test', BOT);
        client.getJoinedMembers.mockResolvedValue([BOB, BOT_USER]);
        await bridge.openedFromNearby(BOT, ALICE, '!bob:matrix.test');
        // The bot's room with a third person in it
        stores.rooms.set(ROOM, BOT);
        client.getJoinedMembers.mockResolvedValue([ALICE, BOB, BOT_USER]);
        await bridge.openedFromNearby(BOT, ALICE, ROOM);

        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(stores.roomsOf.size).toBe(0);

        // It is still waiting, and goes once the chat is theirs alone
        client.getJoinedMembers.mockResolvedValue([ALICE, BOT_USER]);
        await bridge.openedFromNearby(BOT, ALICE, ROOM);
        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER]]);
    });

    it("never puts one person's answer in another person's chat with the bot", async () => {
        // Bob has a direct chat with the bot; Alice has none
        client.getJoinedMembers.mockResolvedValue([BOB, BOT_USER]);
        await bridge.onEvent(invite({ sender: BOB, room_id: '!bob:matrix.test' }));
        client.sendMessage.mockClear();

        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        await bridge.onEvent(message('hello', BOB, '!bob:matrix.test'));

        expect(copies()).toEqual([]);
    });

    it('forgets a chat that stopped being theirs alone, and keeps the answer out of it', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        expect(stores.roomsOf.get(`${BOT}|${ALICE}`)).toBe(ROOM);
        client.sendMessage.mockClear();

        // Someone else is in the room now
        client.getJoinedMembers.mockResolvedValue([ALICE, BOB, BOT_USER]);
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);

        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(stores.roomsOf.has(`${BOT}|${ALICE}`)).toBe(false);
    });

    it('forgets the chat when the bot leaves it', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        await bridge.onEvent({ type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: '$l', state_key: ALICE, content: { membership: 'leave' } });
        expect(stores.roomsOf.has(`${BOT}|${ALICE}`)).toBe(false);
        client.sendMessage.mockClear();

        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('keeps the chat known, and the answer waiting, when the homeserver cannot say who is in the room just now', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        client.sendMessage.mockClear();

        client.getJoinedMembers.mockRejectedValueOnce(new Error('timeout'));
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(stores.roomsOf.get(`${BOT}|${ALICE}`)).toBe(ROOM);

        await bridge.keepNearbyAnswer(BOT, ALICE, 'And bring your portfolio.');
        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER], [BOT_USER, ROOM, 'And bring your portfolio.']]);
    });

    it('gives nothing to someone Orbit says may not message the bot, and waits while Orbit cannot say', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        client.sendMessage.mockClear();
        (bridge as any).accessCache.clear();

        // Orbit is down: it waits
        deps.checkAccess.mockResolvedValueOnce({ allowed: false, reason: 'admin_api_unavailable', user: null });
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect((bridge as any).nearbyAnswers.size).toBe(1);

        // Orbit says no: it is let go
        deps.checkAccess.mockResolvedValueOnce({ allowed: false, reason: 'no_access', user: null });
        await bridge.openedFromNearby(BOT, ALICE, ROOM);
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect((bridge as any).nearbyAnswers.size).toBe(0);
    });

    it('tries again an answer the homeserver did not take, and still sends it once', async () => {
        await bridge.onEvent(invite());
        await bridge.onEvent(message('hi'));
        client.sendMessage.mockClear();

        client.sendMessage.mockRejectedValueOnce(new Error('502'));
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        expect((bridge as any).nearbyAnswers.get(`${BOT}|${ALICE}`)).toHaveLength(1);

        client.sendMessage.mockClear();
        await bridge.keepNearbyAnswer(BOT, ALICE, 'And bring your portfolio.');
        expect(copies()).toEqual([[BOT_USER, ROOM, ANSWER], [BOT_USER, ROOM, 'And bring your portfolio.']]);
        expect((bridge as any).nearbyAnswers.size).toBe(0);
    });

    it('lets an answer go when no direct chat turned up in time, and holds only the newest few', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
        await bridge.keepNearbyAnswer(BOT, ALICE, 'An old one.');
        vi.setSystemTime(new Date('2026-11-11T12:00:01Z'));
        for (let index = 1; index <= 12; index++) await bridge.keepNearbyAnswer(BOT, ALICE, `Answer ${index}.`);

        stores.rooms.set(ROOM, BOT);
        await bridge.openedFromNearby(BOT, ALICE, ROOM);

        expect(copies().map((copy: any[]) => copy[2])).toEqual(Array.from({ length: 10 }, (_, index) => `Answer ${index + 3}.`));
    });

    it('keeps nothing for a bot, or of an answer with no words', async () => {
        await bridge.keepNearbyAnswer(BOT, `@bot_${OTHER_BOT}:matrix.test`, ANSWER);
        await bridge.keepNearbyAnswer(BOT, ALICE, '   ');
        await bridge.openedFromNearby(BOT, `@bot_${OTHER_BOT}:matrix.test`, ROOM);
        expect((bridge as any).nearbyAnswers.size).toBe(0);
        expect(client.getJoinedMembers).not.toHaveBeenCalled();
    });

    it('never throws, whatever the stores or the homeserver do', async () => {
        deps.rooms.getDmRoomOf.mockRejectedValue(new Error('redis down'));
        deps.rooms.getDmRoomBot.mockRejectedValue(new Error('redis down'));
        deps.checkAccess.mockRejectedValue(new Error('orbit down'));
        await expect(bridge.keepNearbyAnswer(BOT, ALICE, ANSWER)).resolves.toBeUndefined();
        await expect(bridge.openedFromNearby(BOT, ALICE, ROOM)).resolves.toBeUndefined();
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('does not answer its own copy: a notice is nobody\'s message to the bot', async () => {
        await bridge.onEvent(invite());
        await bridge.keepNearbyAnswer(BOT, ALICE, ANSWER);
        await bridge.onEvent({ type: 'm.room.message', room_id: ROOM, sender: BOT_USER, event_id: '$copy', content: copyOf(ANSWER) });
        expect(deps.reply).not.toHaveBeenCalled();
    });
});
