/**
 * A deleted Brick keeps nothing in chat (register R29; Khalid, 17 Nov). Its profile is blanked, everything it said is redacted, and it leaves
 * and forgets each room it was in. What people said stays with them. Nothing is done twice, and anything that fails is asked for again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ALICE = '@alice:matrix.test';
const BOB = '@bob:matrix.test';
const ROOM_A = '!a:matrix.test';
const ROOM_B = '!b:matrix.test';

const said = (id: string, sender: string, room: string, over: Partial<MatrixEvent> = {}): MatrixEvent => ({
    type: 'm.room.message', room_id: room, sender, event_id: id, content: { msgtype: 'm.text', body: `from ${sender}` }, ...over,
});

/** A homeserver that holds the history of each room, newest first, in pages of two. */
function makeClient(history: Record<string, MatrixEvent[]>, joined: string[] | null = Object.keys(history)): any {
    const redacted: string[] = [];
    return {
        redacted,
        getJoinedRooms: vi.fn(async () => (joined === null ? null : [...joined])),
        clearProfile: vi.fn(async () => undefined),
        getProfile: vi.fn(async (): Promise<{ displayName: string | null; avatarUrl: string | null }> => ({ displayName: null, avatarUrl: null })),
        getJoinedMembers: vi.fn(async (_u: string, room: string) => (room === ROOM_A ? [ALICE, BOT_USER] : [BOB, BOT_USER])),
        getMessagesPage: vi.fn(async (_u: string, room: string, from?: string) => {
            const all = (history[room] ?? []).filter((event) => !redacted.includes(event.event_id));
            const start = from ? Number(from) : 0;
            const events = (history[room] ?? []).slice(start, start + 2);
            const next = start + 2;
            return { events, end: next < (history[room] ?? []).length ? String(next) : undefined, all };
        }),
        redactEvent: vi.fn(async (_u: string, _room: string, eventId: string) => void redacted.push(eventId)),
        leaveRoom: vi.fn(async () => undefined),
        forgetRoom: vi.fn(async () => undefined),
    };
}

function makeDeps() {
    const rooms = new Map<string, string>([[ROOM_A, BOT], [ROOM_B, BOT]]);
    const roomsOf = new Map<string, string>([[`${BOT}|${ALICE}`, ROOM_A], [`${BOT}|${BOB}`, ROOM_B]]);
    return {
        rooms,
        roomsOf,
        deps: {
            getBotConfig: vi.fn(async () => null),
            checkAccess: vi.fn(),
            reply: vi.fn(),
            rooms: {
                rememberDmRoom: vi.fn(async () => undefined),
                getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
                forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
                forgetDmRoomOf: vi.fn(async (b: string, u: string) => void roomsOf.delete(`${b}|${u}`)),
            },
            waiting: {
                hasSharedStore: () => true,
                rememberWaitingDm: vi.fn(),
                waitingDmBots: vi.fn(async () => []),
                hasWaitingDms: vi.fn(async () => false),
                takeWaitingDms: vi.fn(async () => ['{"waiting":"a person\'s words"}']),
            },
        } as any,
    };
}

describe('MatrixDmBridge: purging a deleted Brick\'s chats (R29)', () => {
    let stores: ReturnType<typeof makeDeps>;

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        stores = makeDeps();
    });
    afterEach(() => vi.restoreAllMocks());

    const history = () => ({
        [ROOM_A]: [
            said('$a5', BOT_USER, ROOM_A),
            said('$a4', ALICE, ROOM_A),
            said('$a3', BOT_USER, ROOM_A, { type: 'm.reaction', content: { 'm.relates_to': { key: '👍' } } }),
            said('$a2', BOT_USER, ROOM_A, { type: 'm.room.member', state_key: BOT_USER, content: { membership: 'join', displayname: 'Nora', avatar_url: 'mxc://x/y' } }),
            said('$a1', ALICE, ROOM_A),
        ],
        [ROOM_B]: [said('$b2', BOB, ROOM_B), said('$b1', BOT_USER, ROOM_B)],
    });

    it('blanks the profile, redacts only what the Brick said in every page, then leaves and forgets each room', async () => {
        const client = makeClient(history());
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);

        expect(await bridge.purgeChats(BOT)).toBe(true);

        expect(client.clearProfile).toHaveBeenCalledWith(BOT_USER);
        // The Brick's message, reaction and old named join event, in two rooms: never what Alice or Bob said
        expect(client.redacted.sort()).toEqual(['$a2', '$a3', '$a5', '$b1']);
        expect(client.redactEvent.mock.calls.every((call: any[]) => call[0] === BOT_USER)).toBe(true);
        expect(client.redactEvent.mock.calls.map((call: any[]) => call[3])).toEqual(expect.arrayContaining(['purge-$a5', 'purge-$b1']));
        // The profile goes first; in each room every redaction comes before the leave, and the leave before the forget
        expect(client.clearProfile.mock.invocationCallOrder[0]).toBeLessThan(client.redactEvent.mock.invocationCallOrder[0]);
        for (const room of [ROOM_A, ROOM_B]) {
            const at = (fn: any, pick: 'last' | 'first') => {
                const orders = fn.mock.calls.map((call: any[], i: number) => (call[1] === room ? fn.mock.invocationCallOrder[i] : -1)).filter((n: number) => n >= 0);
                return pick === 'last' ? Math.max(...orders) : Math.min(...orders);
            };
            expect(at(client.redactEvent, 'last')).toBeLessThan(at(client.leaveRoom, 'first'));
            expect(at(client.leaveRoom, 'first')).toBeLessThan(at(client.forgetRoom, 'first'));
        }
        expect(client.leaveRoom.mock.calls.map((call: any[]) => call[1]).sort()).toEqual([ROOM_A, ROOM_B]);
        expect(client.forgetRoom.mock.calls.map((call: any[]) => call[1]).sort()).toEqual([ROOM_A, ROOM_B]);
        // The shared store forgets the rooms and who they were with
        expect(stores.rooms.size).toBe(0);
        expect(stores.roomsOf.size).toBe(0);
        // Messages left with the Brick while it rested are dropped
        expect(stores.deps.waiting.takeWaitingDms).toHaveBeenCalledWith(BOT);
    });

    it('leaves already-redacted events and the Brick\'s redactions alone, and never redacts a join event that holds no name', async () => {
        const client = makeClient({
            [ROOM_A]: [
                said('$r2', BOT_USER, ROOM_A, { type: 'm.room.redaction', content: {} }),
                said('$r1', BOT_USER, ROOM_A, { content: {}, unsigned: { redacted_because: { event_id: '$r2' } } }),
                said('$j1', BOT_USER, ROOM_A, { type: 'm.room.member', state_key: BOT_USER, content: { membership: 'join' } }),
                said('$t1', BOT_USER, ROOM_A, { type: 'm.room.topic', state_key: '', content: { topic: 'x' } }),
            ],
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.redactEvent).not.toHaveBeenCalled();
        expect(client.leaveRoom).toHaveBeenCalledTimes(1);
    });

    it('stays in a room whose members it cannot read, so the shared store\'s links to it are dropped on a later try, not lost', async () => {
        const client = makeClient(history());
        client.getJoinedMembers.mockRejectedValueOnce(new Error('Matrix 502'));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        // The room it could not read was neither redacted nor left; the other was cleared
        expect(client.leaveRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_B]);
        expect(stores.roomsOf.has(`${BOT}|${ALICE}`)).toBe(true);
        client.getJoinedRooms.mockResolvedValue([ROOM_A]);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(stores.roomsOf.size).toBe(0);
        expect(stores.rooms.size).toBe(0);
    });

    it('does nothing at the homeserver for a Brick that never had a chat account, and says it is done', async () => {
        const client = makeClient({}, null);
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.clearProfile).not.toHaveBeenCalled();
        expect(client.redactEvent).not.toHaveBeenCalled();
        expect(client.leaveRoom).not.toHaveBeenCalled();
    });

    it('stays in a room whose redactions failed, so the next try finds the room again; the other room is still cleared', async () => {
        const client = makeClient(history());
        client.redactEvent.mockImplementation(async (_u: string, room: string, eventId: string) => {
            if (room === ROOM_A) throw new Error('Matrix redact failed: 500');
            client.redacted.push(eventId);
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_B]);
        expect(client.forgetRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_B]);
        expect(client.redacted).toEqual(['$b1']);
        // The next try: the homeserver now lists only the room still joined, and finishes it
        client.getJoinedRooms.mockResolvedValue([ROOM_A]);
        client.redactEvent.mockImplementation(async (_u: string, _room: string, eventId: string) => void client.redacted.push(eventId));
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.leaveRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_B, ROOM_A]);
        expect(client.redacted.sort()).toEqual(['$a2', '$a3', '$a5', '$b1']);
    });

    it('is asked again when the profile cannot be blanked or still shows a name, and leaves no room before that', async () => {
        const client = makeClient(history());
        client.clearProfile.mockRejectedValueOnce(new Error('down'));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        client.getProfile.mockResolvedValue({ displayName: 'Nora', avatarUrl: null });
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        // A picture that stays counts the same as a name that stays
        client.getProfile.mockResolvedValue({ displayName: null, avatarUrl: 'mxc://x/y' });
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        // A profile that cannot be read is not blank
        client.getProfile.mockRejectedValue(new Error('Matrix profile: 502'));
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();

        // An account that answers with its own ID holds nothing of the Brick
        client.getProfile.mockResolvedValue({ displayName: BOT_USER, avatarUrl: null });
        expect(await bridge.purgeChats(BOT)).toBe(true);
    });

    it('is asked again when the shared store cannot drop a link to a room, and the room stays joined until it can', async () => {
        const client = makeClient(history());
        stores.deps.rooms.forgetDmRoom.mockRejectedValueOnce(new Error('The shared store is down'));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        // The room whose link could not be dropped was not left; the other was
        expect(client.leaveRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_B]);
        client.getJoinedRooms.mockResolvedValue([ROOM_A]);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(stores.rooms.size).toBe(0);
        expect(stores.roomsOf.size).toBe(0);
    });

    it('finishes forgetting a room it left when the forget failed, even though the homeserver no longer lists the room', async () => {
        const client = makeClient(history());
        client.forgetRoom.mockImplementation(async (_u: string, room: string) => {
            if (room === ROOM_A) throw new Error('Matrix forget: 502');
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        client.forgetRoom.mockClear();
        client.forgetRoom.mockImplementation(async () => undefined);
        // The left room is not in the joined list any more, yet its forget is still finished
        client.getJoinedRooms.mockResolvedValue([]);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.forgetRoom.mock.calls.map((call: any[]) => call[1])).toEqual([ROOM_A]);
        // And it is not asked again once it went through
        client.forgetRoom.mockClear();
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect(client.forgetRoom).not.toHaveBeenCalled();
    });

    it('goes on from the page it reached when a history is longer than one try, and redacts nothing twice in a row', async () => {
        const events = Array.from({ length: 6 }, (_, i) => said(`$e${6 - i}`, BOT_USER, ROOM_A));
        const client = makeClient({ [ROOM_A]: events });
        let failAt: string | undefined = '2';
        const page = client.getMessagesPage.getMockImplementation()!;
        client.getMessagesPage.mockImplementation(async (u: string, room: string, from?: string) => {
            if (from && from === failAt) throw new Error('Matrix messages: 502');
            return page(u, room, from);
        });
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.redacted).toEqual(['$e6', '$e5']);
        expect(client.leaveRoom).not.toHaveBeenCalled();
        failAt = undefined;
        client.getMessagesPage.mockClear();
        expect(await bridge.purgeChats(BOT)).toBe(true);
        // The next try starts at the saved page, not at the newest message
        expect(client.getMessagesPage.mock.calls[0][2]).toBe('2');
        expect(client.redacted).toEqual(['$e6', '$e5', '$e4', '$e3', '$e2', '$e1']);
    });

    it('fails a room whose history read does not move on, rather than looping on it', async () => {
        const client = makeClient({ [ROOM_A]: [said('$only', BOT_USER, ROOM_A)] });
        client.getMessagesPage.mockImplementation(async () => ({ events: [], end: 'same' }));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        // One page forward is allowed to move; a repeat of the same token is the stall
        expect(client.getMessagesPage.mock.calls.length).toBeLessThanOrEqual(3);
        expect(client.leaveRoom).not.toHaveBeenCalled();
    });

    it('writes nothing for a Brick once its purge has begun: no profile, no waiting message, no goodbye', async () => {
        const client = makeClient(history());
        client.ensureRegistered = vi.fn(async () => undefined);
        client.setDisplayName = vi.fn(async () => undefined);
        const bridge = new MatrixDmBridge(config, client as never, stores.deps) as any;
        expect(await bridge.purgeChats(BOT)).toBe(true);
        await bridge.ensureBotAccount(BOT, { name: 'Nora' });
        expect(client.ensureRegistered).not.toHaveBeenCalled();
        expect(client.setDisplayName).not.toHaveBeenCalled();
        await bridge.rememberWaiting(BOT, said('$w1', ALICE, ROOM_A));
        expect(bridge.localWaiting.has(BOT)).toBe(false);
        expect(stores.deps.waiting.rememberWaitingDm).not.toHaveBeenCalled();
    });

    it('waits for a profile write already under way, so it cannot put the name back after the clear', async () => {
        const client = makeClient(history());
        let release!: () => void;
        client.ensureRegistered = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
        client.setDisplayName = vi.fn(async () => undefined);
        const bridge = new MatrixDmBridge(config, client as never, stores.deps) as any;
        const writing = bridge.ensureBotAccount(BOT, { name: 'Nora' });
        const purging = bridge.purgeChats(BOT);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(client.clearProfile).not.toHaveBeenCalled();
        release();
        await writing;
        expect(await purging).toBe(true);
        // The write that was under way noticed the purge and left the name unset
        expect(client.setDisplayName).not.toHaveBeenCalled();
        expect(client.clearProfile).toHaveBeenCalledTimes(1);
    });

    it('is asked again when the homeserver cannot say which rooms the Brick is in, and when the shared store cannot drop what waits', async () => {
        const client = makeClient(history());
        client.getJoinedRooms.mockRejectedValueOnce(new Error('Matrix joined rooms: 502'));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.clearProfile).not.toHaveBeenCalled();

        stores.deps.waiting.takeWaitingDms.mockRejectedValueOnce(new Error('The shared store is down'));
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();
        expect(await bridge.purgeChats(BOT)).toBe(true);
    });

    it('never touches an id that cannot be a Matrix localpart', async () => {
        const client = makeClient(history());
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats('../../etc')).toBe(true);
        expect(client.getJoinedRooms).not.toHaveBeenCalled();
    });

    it('does not run twice for one Brick at once', async () => {
        const client = makeClient(history());
        let release!: () => void;
        client.getJoinedRooms.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([]))));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        const first = bridge.purgeChats(BOT);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        release();
        expect(await first).toBe(true);
    });

    it('fails a room whose history is longer than one purge reads, rather than leaving it half done', async () => {
        const client = makeClient({ [ROOM_A]: [said('$only', BOT_USER, ROOM_A)] });
        // A homeserver that never says the history ends
        client.getMessagesPage.mockImplementation(async (_u: string, _room: string, from?: string) => ({ events: [said(`$n${from ?? 0}`, ALICE, ROOM_A)], end: String(Number(from ?? 0) + 1) }));
        const bridge = new MatrixDmBridge(config, client as never, stores.deps);
        expect(await bridge.purgeChats(BOT)).toBe(false);
        expect(client.leaveRoom).not.toHaveBeenCalled();
    });

    it('drops what the process kept for the Brick, and only for that Brick', async () => {
        const client = makeClient(history());
        const bridge = new MatrixDmBridge(config, client as never, stores.deps) as any;
        const other = '1c8d2e3f-2222-4333-8444-055566667777';
        bridge.nearbyAnswers.set(`${BOT}|${ALICE}`, [{ text: 'private', at: 1 }]);
        bridge.nearbyAnswers.set(`${other}|${ALICE}`, [{ text: 'other', at: 1 }]);
        bridge.localWaiting.set(BOT, new Map([[ROOM_A, { message: '{}', at: Date.now() }]]));
        bridge.roomBots.set(ROOM_A, BOT);
        bridge.roomBots.set('!c:matrix.test', other);
        expect(await bridge.purgeChats(BOT)).toBe(true);
        expect([...bridge.nearbyAnswers.keys()]).toEqual([`${other}|${ALICE}`]);
        expect(bridge.localWaiting.has(BOT)).toBe(false);
        expect([...bridge.roomBots.entries()]).toEqual([['!c:matrix.test', other]]);
    });
});
