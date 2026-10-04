import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendsUpdateMessage } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { RingsSocket } from "../../src/pusher/services/FriendsRings";
import { FriendsRings } from "../../src/pusher/services/FriendsRings";
import type { FriendPlace, OrbitFriendRelationship } from "../../src/pusher/services/FriendsService";
import { FriendsError } from "../../src/pusher/services/FriendsService";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));

type FakeSocketData = ReturnType<RingsSocket["getUserData"]>;

class FakeSocket implements RingsSocket {
    public readonly data: FakeSocketData;
    constructor(userUuid: string, roomId: string, name = userUuid) {
        this.data = { userUuid, isLogged: true, name, roomId, roomName: " Lobby room ", disconnecting: false };
    }
    getUserData(): FakeSocketData {
        return this.data;
    }
}

const ROOM_A = "https://play.test/@/acme/office/lobby";
const ROOM_B = "https://play.test/@/acme/office/garden";
const PLACES: Record<string, FriendPlace> = {
    [ROOM_A]: { universe: "Acme", world: "Office", room: "Lobby" },
};

function friends(ringFrom = "friends"): OrbitFriendRelationship {
    return { relationship: "friends", target: { ringFrom, friendsSeeLocation: true } };
}

function setup() {
    const sent: { socket: FakeSocket; message: FriendsUpdateMessage }[] = [];
    const sockets = new Map<string, FakeSocket[]>();
    const statuses = new Map<string, AvailabilityStatus>();
    const getRelationship = vi.fn((_userUuid: string, _targetUuid: string) => Promise.resolve(friends()));
    let nextId = 0;
    const rings = new FriendsRings<FakeSocket>({
        send: (socket, message) => sent.push({ socket, message }),
        socketsOf: (userUuid) => sockets.get(userUuid) ?? [],
        statusOf: (userUuid) => statuses.get(userUuid) ?? AvailabilityStatus.ONLINE,
        getRelationship,
        lookupPlace: (playUri) => Promise.resolve(PLACES[playUri] ?? null),
        newId: () => `ring-${++nextId}`,
    });
    const connect = (userUuid: string, roomId: string): FakeSocket => {
        const socket = new FakeSocket(userUuid, roomId, userUuid === "alice" ? "Alice" : userUuid);
        sockets.set(userUuid, [...(sockets.get(userUuid) ?? []), socket]);
        return socket;
    };
    // What cleanupSocket does: the socket is disconnecting and no longer a session, then the rings hear of it.
    const close = (socket: FakeSocket): void => {
        socket.data.disconnecting = true;
        const userUuid = socket.data.userUuid;
        sockets.set(
            userUuid,
            (sockets.get(userUuid) ?? []).filter((other) => other !== socket)
        );
        rings.closed(socket);
    };
    const updatesTo = (socket: FakeSocket) =>
        sent.filter((entry) => entry.socket === socket).map((entry) => entry.message.update);
    return { rings, sent, sockets, statuses, getRelationship, connect, close, updatesTo };
}

describe("FriendsRings", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("rings every tab of the friend with where the caller is", async () => {
        const { rings, connect, updatesTo, getRelationship } = setup();
        const alice = connect("alice", ROOM_A);
        const bob1 = connect("bob", ROOM_B);
        const bob2 = connect("bob", ROOM_B);

        await expect(rings.ring(alice, "bob")).resolves.toEqual({
            outcome: "ringing",
            ringId: "ring-1",
            retryAfterSeconds: 0,
        });
        expect(getRelationship).toHaveBeenCalledWith("alice", "bob");
        for (const bob of [bob1, bob2]) {
            expect(updatesTo(bob)).toEqual([
                {
                    $case: "ringIncoming",
                    ringIncoming: {
                        ringId: "ring-1",
                        fromUuid: "alice",
                        fromName: "Alice",
                        playUri: ROOM_A,
                        roomName: "Lobby",
                        worldName: "Office",
                        universeName: "Acme",
                        expiresInMs: 30000,
                    },
                },
            ]);
        }
        expect(updatesTo(alice)).toEqual([]);
    });

    it("falls back to the socket's room name when the room is unknown", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice = connect("alice", ROOM_B);
        const bob = connect("bob", ROOM_A);
        await rings.ring(alice, "bob");
        expect(updatesTo(bob)[0]).toMatchObject({
            ringIncoming: { playUri: ROOM_B, roomName: "Lobby room", worldName: "", universeName: "" },
        });
    });

    it("refuses to ring yourself, a non-friend, or a friend who takes no rings", async () => {
        const { rings, connect, getRelationship } = setup();
        const alice = connect("alice", ROOM_A);
        connect("bob", ROOM_B);

        expect((await rings.ring(alice, "alice")).outcome).toBe("not_allowed");
        expect(getRelationship).not.toHaveBeenCalled();

        // Each of these players stands with Alice as their name says.
        const strangers = ["none", "request_sent", "request_received", "blocked_by_me", "blocked_by_them"];
        getRelationship.mockImplementation((_userUuid, targetUuid) =>
            Promise.resolve({ ...friends(), relationship: targetUuid })
        );
        const answers = await Promise.all(strangers.map((stranger) => rings.ring(alice, stranger)));
        expect(answers.map((answer) => answer.outcome)).toEqual(strangers.map(() => "not_friends"));

        getRelationship.mockResolvedValueOnce(friends("nobody"));
        expect((await rings.ring(alice, "bob")).outcome).toBe("not_allowed");

        getRelationship.mockResolvedValueOnce(friends("friends_and_members"));
        expect((await rings.ring(alice, "bob")).outcome).toBe("ringing");
    });

    it("lets Orbit's refusals through", async () => {
        const { rings, connect, getRelationship } = setup();
        const alice = connect("alice", ROOM_A);
        getRelationship.mockRejectedValueOnce(new FriendsError("player_not_found", 404));
        await expect(rings.ring(alice, "ghost")).rejects.toMatchObject({ code: "player_not_found" });
    });

    it("says offline when the friend has no open tab", async () => {
        const { rings, connect } = setup();
        const alice = connect("alice", ROOM_A);
        expect((await rings.ring(alice, "bob")).outcome).toBe("offline");
    });

    it("says busy for a friend who does not want to be disturbed", async () => {
        const { rings, connect, statuses, sent } = setup();
        const alice = connect("alice", ROOM_A);
        const statusOf: Record<string, AvailabilityStatus> = {
            bob: AvailabilityStatus.BUSY,
            carol: AvailabilityStatus.DO_NOT_DISTURB,
            dave: AvailabilityStatus.BACK_IN_A_MOMENT,
        };
        for (const [userUuid, status] of Object.entries(statusOf)) {
            connect(userUuid, ROOM_B);
            statuses.set(userUuid, status);
        }
        const answers = await Promise.all(Object.keys(statusOf).map((userUuid) => rings.ring(alice, userUuid)));
        expect(answers.map((answer) => answer.outcome)).toEqual(["busy", "busy", "busy"]);
        expect(sent).toEqual([]);

        statuses.set("bob", AvailabilityStatus.AWAY);
        expect((await rings.ring(alice, "bob")).outcome).toBe("ringing");
    });

    it("says busy for a friend someone else is already ringing", async () => {
        const { rings, connect } = setup();
        const alice = connect("alice", ROOM_A);
        const carol = connect("carol", ROOM_A);
        connect("bob", ROOM_B);
        expect((await rings.ring(carol, "bob")).outcome).toBe("ringing");
        expect((await rings.ring(alice, "bob")).outcome).toBe("busy");
    });

    it("rings one friend at a time, from any tab", async () => {
        const { rings, connect } = setup();
        const alice1 = connect("alice", ROOM_A);
        const alice2 = connect("alice", ROOM_B);
        connect("bob", ROOM_B);
        connect("carol", ROOM_B);
        expect((await rings.ring(alice1, "bob")).outcome).toBe("ringing");
        expect((await rings.ring(alice1, "carol")).outcome).toBe("already_ringing");
        expect((await rings.ring(alice2, "carol")).outcome).toBe("already_ringing");
    });

    it("does not start two rings when the caller rings twice at once", async () => {
        const { rings, connect } = setup();
        const alice = connect("alice", ROOM_A);
        connect("bob", ROOM_B);
        connect("carol", ROOM_B);
        const answers = await Promise.all([rings.ring(alice, "bob"), rings.ring(alice, "carol")]);
        expect(answers.map((answer) => answer.outcome)).toEqual(["ringing", "already_ringing"]);
    });

    it("does not ring for a caller who left while Orbit was asked", async () => {
        const { rings, connect, close, getRelationship, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        let answer: (relationship: OrbitFriendRelationship) => void = () => undefined;
        getRelationship.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const ringing = rings.ring(alice, "bob");
        close(alice);
        answer(friends());
        expect((await ringing).outcome).toBe("not_allowed");
        expect(updatesTo(bob)).toEqual([]);
    });

    it("stops after 30 seconds with no answer, and holds the caller back for 10 minutes", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");

        vi.advanceTimersByTime(29_999);
        expect(updatesTo(alice)).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(updatesTo(bob)[1]).toEqual({ $case: "ringEnded", ringEnded: { ringId: "ring-1", reason: "expired" } });
        expect(updatesTo(alice)).toEqual([
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "no_answer" } },
        ]);
        expect(vi.getTimerCount()).toBe(0);

        vi.advanceTimersByTime(500);
        expect(await rings.ring(alice, "bob")).toEqual({ outcome: "too_soon", ringId: "", retryAfterSeconds: 600 });
        vi.advanceTimersByTime(10 * 60 * 1000 - 1000);
        expect((await rings.ring(alice, "bob")).retryAfterSeconds).toBe(1);
        vi.advanceTimersByTime(500);
        expect((await rings.ring(alice, "bob")).outcome).toBe("ringing");
    });

    it("holds back only that caller, towards only that friend", async () => {
        const { rings, connect, close } = setup();
        const alice = connect("alice", ROOM_A);
        const carol = connect("carol", ROOM_A);
        connect("bob", ROOM_B);
        const dave = connect("dave", ROOM_B);
        await rings.ring(alice, "bob");
        vi.advanceTimersByTime(30_000);
        expect((await rings.ring(alice, "dave")).outcome).toBe("ringing");
        expect((await rings.ring(carol, "bob")).outcome).toBe("ringing");
        close(dave);
        close(carol);
        // Bob may ring Alice: the cooldown is one way.
        const bob = connect("bob", ROOM_B);
        expect((await rings.ring(bob, "alice")).outcome).toBe("ringing");
    });

    it("lets the caller stop the ring from any of their tabs", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice1 = connect("alice", ROOM_A);
        const alice2 = connect("alice", ROOM_B);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice1, "bob");

        expect(rings.reply(bob, "ring-1", "stop").ok).toBe(false);
        expect(rings.reply(alice2, "ring-1", "stop")).toEqual({ ok: true, playUri: "", callerUuid: "" });
        expect(updatesTo(bob)[1]).toEqual({ $case: "ringEnded", ringEnded: { ringId: "ring-1", reason: "stopped" } });
        expect(updatesTo(alice1)).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(rings.reply(alice2, "ring-1", "stop").ok).toBe(false);
        expect((await rings.ring(alice1, "bob")).outcome).toBe("too_soon");
    });

    it("sends the friend to the caller's room when they accept", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob1 = connect("bob", ROOM_B);
        const bob2 = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");

        expect(rings.reply(alice, "ring-1", "accept").ok).toBe(false);
        expect(rings.reply(bob1, "ring-1", "accept")).toEqual({ ok: true, playUri: ROOM_A, callerUuid: "alice" });
        expect(updatesTo(bob1)).toHaveLength(1);
        expect(updatesTo(bob2)[1]).toEqual({ $case: "ringEnded", ringEnded: { ringId: "ring-1", reason: "answered" } });
        expect(updatesTo(alice)).toEqual([
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "accepted" } },
        ]);
        expect(rings.reply(bob2, "ring-1", "decline").ok).toBe(false);

        // No timeout after an answer, and no cooldown after an accept.
        vi.advanceTimersByTime(30_000);
        expect(updatesTo(alice)).toHaveLength(1);
        expect((await rings.ring(alice, "bob")).outcome).toBe("ringing");
    });

    it("tells the caller once when their friend walks into their room", async () => {
        const { rings, connect, close, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");
        rings.reply(bob, "ring-1", "accept");
        close(bob);

        rings.joined(connect("carol", ROOM_A));
        rings.joined(connect("bob", ROOM_B));
        expect(updatesTo(alice)).toHaveLength(1);

        rings.joined(connect("bob", ROOM_A));
        rings.joined(connect("bob", ROOM_A));
        expect(updatesTo(alice)).toEqual([
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "accepted" } },
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "arrived" } },
        ]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("stops waiting for the friend after 3 minutes", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");
        rings.reply(bob, "ring-1", "accept");

        vi.advanceTimersByTime(3 * 60 * 1000);
        expect(vi.getTimerCount()).toBe(0);
        rings.joined(connect("bob", ROOM_A));
        expect(updatesTo(alice)).toHaveLength(1);
    });

    it("stops waiting for the friend when the caller's tab closes", async () => {
        const { rings, connect, close, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");
        rings.reply(bob, "ring-1", "accept");

        close(alice);
        expect(vi.getTimerCount()).toBe(0);
        rings.joined(connect("bob", ROOM_A));
        expect(updatesTo(alice)).toHaveLength(1);
    });

    it("tells the caller when the friend declines, and holds them back", async () => {
        const { rings, connect, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob1 = connect("bob", ROOM_B);
        const bob2 = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");

        expect(rings.reply(alice, "ring-1", "decline").ok).toBe(false);
        expect(rings.reply(bob2, "ring-1", "decline")).toEqual({ ok: true, playUri: "", callerUuid: "" });
        expect(updatesTo(bob1)[1]).toEqual({ $case: "ringEnded", ringEnded: { ringId: "ring-1", reason: "answered" } });
        expect(updatesTo(bob2)).toHaveLength(1);
        expect(updatesTo(alice)).toEqual([
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "declined" } },
        ]);
        expect(vi.getTimerCount()).toBe(0);
        expect((await rings.ring(alice, "bob")).outcome).toBe("too_soon");
    });

    it("refuses unknown rings and actions", async () => {
        const { rings, connect } = setup();
        const alice = connect("alice", ROOM_A);
        const bob = connect("bob", ROOM_B);
        expect(rings.reply(bob, "nope", "accept")).toEqual({ ok: false, playUri: "", callerUuid: "" });
        await rings.ring(alice, "bob");
        expect(rings.reply(bob, "ring-1", "snooze").ok).toBe(false);
        expect(rings.reply(connect("carol", ROOM_B), "ring-1", "accept").ok).toBe(false);
    });

    it("stops the ring when the caller's tab closes", async () => {
        const { rings, connect, close, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const otherAlice = connect("alice", ROOM_B);
        const bob = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");

        // Another tab of the caller closing changes nothing.
        close(otherAlice);
        expect(updatesTo(bob)).toHaveLength(1);

        close(alice);
        expect(updatesTo(bob)[1]).toEqual({ $case: "ringEnded", ringEnded: { ringId: "ring-1", reason: "stopped" } });
        expect(updatesTo(alice)).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect((await rings.ring(connect("alice", ROOM_A), "bob")).outcome).toBe("too_soon");
    });

    it("ends as no answer when the friend's last tab closes", async () => {
        const { rings, connect, close, updatesTo } = setup();
        const alice = connect("alice", ROOM_A);
        const bob1 = connect("bob", ROOM_B);
        const bob2 = connect("bob", ROOM_B);
        await rings.ring(alice, "bob");

        close(bob1);
        expect(updatesTo(alice)).toEqual([]);
        close(bob2);
        expect(updatesTo(alice)).toEqual([
            { $case: "ringResult", ringResult: { ringId: "ring-1", targetUuid: "bob", result: "no_answer" } },
        ]);
        expect(vi.getTimerCount()).toBe(0);
        connect("bob", ROOM_B);
        expect((await rings.ring(alice, "bob")).outcome).toBe("too_soon");
    });

    it("forgets cooldowns that are over", async () => {
        const { rings, connect } = setup();
        const alice = connect("alice", ROOM_A);
        connect("bob", ROOM_B);
        connect("carol", ROOM_B);
        const cooldowns = (rings as unknown as { cooldowns: Map<string, number> }).cooldowns;

        await rings.ring(alice, "bob");
        rings.reply(alice, "ring-1", "stop");
        expect(cooldowns.size).toBe(1);

        vi.advanceTimersByTime(10 * 60 * 1000);
        await rings.ring(alice, "carol");
        rings.reply(alice, "ring-2", "stop");
        expect(Array.from(cooldowns.keys())).toEqual(["alice carol"]);
    });
});
