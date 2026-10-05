import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendPresence, FriendsUpdateMessage } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { FriendsSocket, PresenceSession } from "../../src/pusher/services/FriendsPresence";
import {
    cleanRoomName,
    computePresence,
    FriendsPresence,
    liveStatus,
    mostAvailableStatus,
} from "../../src/pusher/services/FriendsPresence";
import type { FriendPlace } from "../../src/pusher/services/FriendsService";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));

type FakeSocketData = ReturnType<FriendsSocket["getUserData"]>;

class FakeSocket implements FriendsSocket {
    public readonly data: FakeSocketData;
    constructor(userUuid: string, roomId = "", options: Partial<FakeSocketData> = {}) {
        this.data = {
            userUuid,
            isLogged: true,
            roomId,
            roomName: "Room",
            availabilityStatus: AvailabilityStatus.ONLINE,
            disconnecting: false,
            tags: [],
            characterTextures: [],
            ...options,
        };
    }
    getUserData(): FakeSocketData {
        return this.data;
    }
}

const ROOM_A = "https://play.test/@/acme/office/lobby";
const ROOM_B = "https://play.test/@/acme/office/garden";

const PLACES: Record<string, FriendPlace> = {
    [ROOM_A]: { universe: "Acme", world: "Office", room: "Lobby" },
    [ROOM_B]: { universe: "Acme", world: "Office", room: "Garden" },
};

function setup(lookupPlaces = vi.fn((uris: string[]) => Promise.resolve(lookupFrom(uris)))) {
    const sent: { socket: FakeSocket; message: FriendsUpdateMessage }[] = [];
    const presence = new FriendsPresence<FakeSocket>({
        send: (socket, message) => sent.push({ socket, message }),
        lookupPlaces,
    });
    return { presence, sent, lookupPlaces };
}

function lookupFrom(uris: string[]): Record<string, FriendPlace | null> {
    return Object.fromEntries(uris.map((uri) => [uri, PLACES[uri] ?? null]));
}

function presencesSentTo(sent: { socket: FakeSocket; message: FriendsUpdateMessage }[], socket: FakeSocket) {
    return sent
        .filter((entry) => entry.socket === socket)
        .map((entry) => (entry.message.update?.$case === "presence" ? entry.message.update.presence : undefined));
}

function session(playUri: string, availabilityStatus: AvailabilityStatus, joinedAt: number): PresenceSession {
    return { playUri, roomName: "Fallback", availabilityStatus, joinedAt, woka: [] };
}

describe("computePresence", () => {
    const places = new Map<string, FriendPlace | null>(Object.entries(PLACES));

    it("is offline with no session", () => {
        expect(computePresence([], true, places)).toEqual({
            online: false,
            locationHidden: false,
            availabilityStatus: AvailabilityStatus.UNCHANGED,
            sessions: [],
        } satisfies FriendPresence);
    });

    it("lists the most recently joined session first, with the room names", () => {
        const presence = computePresence(
            [session(ROOM_A, AvailabilityStatus.AWAY, 1), session(ROOM_B, AvailabilityStatus.BUSY, 2)],
            true,
            places
        );
        expect(presence.online).toBe(true);
        expect(presence.locationHidden).toBe(false);
        expect(presence.sessions.map((s) => s.roomName)).toEqual(["Garden", "Lobby"]);
        expect(presence.sessions[0]).toEqual({
            playUri: ROOM_B,
            universeName: "Acme",
            worldName: "Office",
            roomName: "Garden",
            availabilityStatus: AvailabilityStatus.BUSY,
        });
    });

    it("takes the most available status of the sessions", () => {
        const presence = computePresence(
            [
                session(ROOM_A, AvailabilityStatus.DO_NOT_DISTURB, 1),
                session(ROOM_B, AvailabilityStatus.AWAY, 2),
                session(ROOM_B, AvailabilityStatus.BUSY, 3),
            ],
            true,
            places
        );
        expect(presence.availabilityStatus).toBe(AvailabilityStatus.AWAY);
        expect(mostAvailableStatus([AvailabilityStatus.BUSY, AvailabilityStatus.ONLINE])).toBe(
            AvailabilityStatus.ONLINE
        );
        expect(mostAvailableStatus([AvailabilityStatus.UNCHANGED])).toBe(AvailabilityStatus.ONLINE);
        expect(mostAvailableStatus([])).toBe(AvailabilityStatus.UNCHANGED);
    });

    it("hides the sessions when the friend keeps their location to themselves", () => {
        expect(computePresence([session(ROOM_A, AvailabilityStatus.BUSY, 1)], false, places)).toEqual({
            online: true,
            locationHidden: true,
            availabilityStatus: AvailabilityStatus.BUSY,
            sessions: [],
        } satisfies FriendPresence);
    });

    it("falls back to the tab's room name when the room is unknown", () => {
        const presence = computePresence(
            [session("https://play.test/@/x/y/z", AvailabilityStatus.ONLINE, 1)],
            true,
            places
        );
        expect(presence.sessions[0]).toMatchObject({ universeName: "", worldName: "", roomName: "Fallback" });
    });

    it("trims and caps the room name sent by the browser", () => {
        expect(cleanRoomName("  Lobby  ")).toBe("Lobby");
        expect(cleanRoomName("x".repeat(200))).toHaveLength(80);
    });
});

describe("FriendsPresence", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("tracks only signed-in sockets", () => {
        const { presence } = setup();
        const guest = new FakeSocket("guest", ROOM_A, { isLogged: false });
        const alice = new FakeSocket("alice", ROOM_A);
        presence.track(guest);
        presence.track(alice);
        expect(presence.socketsOf("guest")).toEqual([]);
        expect(presence.socketsOf("alice")).toEqual([alice]);
        presence.untrack(alice);
        expect(presence.socketsOf("alice")).toEqual([]);
    });

    it("sends one update for a burst of changes", async () => {
        const { presence, sent } = setup();
        const watcher = new FakeSocket("bob");
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);

        // A room change: the old tab leaves, the new one joins.
        const oldTab = new FakeSocket("alice", ROOM_A);
        presence.track(oldTab);
        await vi.advanceTimersByTimeAsync(600);
        sent.length = 0;

        presence.untrack(oldTab);
        presence.track(new FakeSocket("alice", ROOM_B));
        await vi.advanceTimersByTimeAsync(600);

        const updates = presencesSentTo(sent, watcher);
        expect(updates).toHaveLength(1);
        expect(updates[0]?.uuid).toBe("alice");
        expect(updates[0]?.presence?.online).toBe(true);
        expect(updates[0]?.presence?.sessions.map((s) => s.roomName)).toEqual(["Garden"]);
    });

    it("tells watchers about status changes and leaving", async () => {
        const { presence, sent } = setup();
        const watcher = new FakeSocket("bob");
        const alice = new FakeSocket("alice", ROOM_A);
        presence.track(alice);
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);

        presence.setStatus(alice, AvailabilityStatus.BUSY);
        await vi.advanceTimersByTimeAsync(600);
        expect(presencesSentTo(sent, watcher).at(-1)?.presence?.availabilityStatus).toBe(AvailabilityStatus.BUSY);

        presence.setStatus(alice, AvailabilityStatus.UNCHANGED);
        presence.setStatus(alice, AvailabilityStatus.BUSY);
        await vi.advanceTimersByTimeAsync(600);
        expect(presencesSentTo(sent, watcher)).toHaveLength(1);

        presence.untrack(alice);
        await vi.advanceTimersByTimeAsync(600);
        expect(presencesSentTo(sent, watcher).at(-1)?.presence).toEqual({
            online: false,
            locationHidden: false,
            availabilityStatus: AvailabilityStatus.UNCHANGED,
            sessions: [],
        });
    });

    it("sends each watcher the presence their friendship allows", async () => {
        const { presence, sent, lookupPlaces } = setup();
        const seesLocation = new FakeSocket("bob");
        const doesNot = new FakeSocket("carol");
        presence.watch(seesLocation, [{ uuid: "alice", shareLocation: true }]);
        presence.watch(doesNot, [{ uuid: "alice", shareLocation: false }]);

        presence.track(new FakeSocket("alice", ROOM_A));
        await vi.advanceTimersByTimeAsync(600);

        expect(presencesSentTo(sent, seesLocation)[0]?.presence?.sessions).toHaveLength(1);
        expect(presencesSentTo(sent, doesNot)[0]?.presence).toMatchObject({
            online: true,
            locationHidden: true,
            sessions: [],
        });
        expect(lookupPlaces).toHaveBeenCalledTimes(1);
    });

    it("re-pushes the presence with the new location setting", async () => {
        const { presence, sent } = setup();
        const watcher = new FakeSocket("bob");
        presence.track(new FakeSocket("alice", ROOM_A));
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);
        await vi.advanceTimersByTimeAsync(600);
        sent.length = 0;

        presence.setShareLocation("alice", false);
        await vi.advanceTimersByTimeAsync(600);
        expect(presencesSentTo(sent, watcher)[0]?.presence?.locationHidden).toBe(true);
    });

    it("replaces a socket's watches when its list is fetched again", async () => {
        const { presence, sent } = setup();
        const watcher = new FakeSocket("bob");
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);
        presence.watch(watcher, [{ uuid: "dave", shareLocation: true }]);

        presence.track(new FakeSocket("alice", ROOM_A));
        presence.track(new FakeSocket("dave", ROOM_B));
        await vi.advanceTimersByTimeAsync(600);

        expect(presencesSentTo(sent, watcher).map((update) => update?.uuid)).toEqual(["dave"]);
    });

    it("stops pushing to a closed or closing socket", async () => {
        const { presence, sent } = setup();
        const closed = new FakeSocket("bob");
        const closing = new FakeSocket("carol");
        presence.watch(closed, [{ uuid: "alice", shareLocation: true }]);
        presence.watch(closing, [{ uuid: "alice", shareLocation: true }]);
        presence.untrack(closed);
        closing.data.disconnecting = true;

        presence.track(new FakeSocket("alice", ROOM_A));
        await vi.advanceTimersByTimeAsync(600);
        expect(sent).toEqual([]);
    });

    it("unlinks two players on every tab, both ways", async () => {
        const { presence, sent } = setup();
        const aliceTab = new FakeSocket("alice", ROOM_A);
        const bobTab = new FakeSocket("bob", ROOM_B);
        presence.track(aliceTab);
        presence.track(bobTab);
        presence.watch(aliceTab, [{ uuid: "bob", shareLocation: true }]);
        presence.watch(bobTab, [
            { uuid: "alice", shareLocation: true },
            { uuid: "dave", shareLocation: true },
        ]);
        await vi.advanceTimersByTimeAsync(600);
        sent.length = 0;

        presence.unlink("alice", "bob");
        presence.setStatus(aliceTab, AvailabilityStatus.BUSY);
        presence.setStatus(bobTab, AvailabilityStatus.BUSY);
        presence.track(new FakeSocket("dave", ROOM_A));
        await vi.advanceTimersByTimeAsync(600);

        expect(
            sent.map((entry) => [entry.socket.data.userUuid, presencesSentTo([entry], entry.socket)[0]?.uuid])
        ).toEqual([["bob", "dave"]]);
    });

    it("looks room names up once and caches them", async () => {
        const { presence, lookupPlaces } = setup();
        presence.track(new FakeSocket("alice", ROOM_A));
        presence.track(new FakeSocket("dave", ROOM_A));
        presence.track(new FakeSocket("erin", ROOM_B));

        const friends = [
            { uuid: "alice", shareLocation: true },
            { uuid: "dave", shareLocation: true },
            { uuid: "erin", shareLocation: true },
            { uuid: "frank", shareLocation: true },
        ];
        const presences = await presence.presencesOf(friends);
        expect(presences.get("alice")?.sessions[0]?.roomName).toBe("Lobby");
        expect(presences.get("frank")?.online).toBe(false);
        expect(lookupPlaces).toHaveBeenCalledTimes(1);
        expect(lookupPlaces.mock.calls[0]?.[0].sort()).toEqual([ROOM_A, ROOM_B].sort());

        await presence.presencesOf(friends);
        expect(lookupPlaces).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
        await presence.presencesOf(friends);
        expect(lookupPlaces).toHaveBeenCalledTimes(2);
    });

    it("asks for at most 50 rooms at a time", async () => {
        const { presence, lookupPlaces } = setup();
        const friends = Array.from({ length: 120 }, (_, i) => {
            presence.track(new FakeSocket(`user${i}`, `https://play.test/@/u/w/room${i}`));
            return { uuid: `user${i}`, shareLocation: true };
        });
        await presence.presencesOf(friends);
        expect(lookupPlaces.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 20]);
    });

    it("sends the tab's room name when the lookup fails", async () => {
        const { presence, sent } = setup(vi.fn(() => Promise.reject(new Error("Orbit is down"))));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const watcher = new FakeSocket("bob");
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);
        presence.track(new FakeSocket("alice", ROOM_A, { roomName: "  My lobby " }));
        await vi.advanceTimersByTimeAsync(600);

        expect(presencesSentTo(sent, watcher)[0]?.presence?.sessions[0]).toMatchObject({
            universeName: "",
            worldName: "",
            roomName: "My lobby",
        });
    });

    it("does not wait for a lookup that never answers", async () => {
        const { presence, sent } = setup(vi.fn(() => new Promise<Record<string, FriendPlace | null>>(() => {})));
        const watcher = new FakeSocket("bob");
        presence.watch(watcher, [{ uuid: "alice", shareLocation: true }]);
        presence.track(new FakeSocket("alice", ROOM_A));

        await vi.advanceTimersByTimeAsync(600);
        expect(sent).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(3000);
        expect(presencesSentTo(sent, watcher)[0]?.presence?.sessions[0]?.roomName).toBe("Room");
    });
});

describe("FriendsPresence.snapshot", () => {
    it("lists signed-in players with their tabs, status and Woka, and only counts guests and bots", () => {
        const { presence } = setup();
        const woka = [{ id: "body", url: "https://play.test/woka/body.png" }] as FakeSocketData["characterTextures"];
        presence.track(new FakeSocket("alice", ROOM_A, { characterTextures: woka }));
        presence.track(new FakeSocket("alice", ROOM_B, { availabilityStatus: AvailabilityStatus.BUSY }));
        presence.track(new FakeSocket("guest-1", ROOM_A, { isLogged: false }));
        presence.track(new FakeSocket("bot-7", ROOM_A, { isLogged: false, tags: ["bot"] }));

        const snapshot = presence.snapshot();
        expect(snapshot.users).toHaveLength(1);
        expect(snapshot.users[0]).toMatchObject({ uuid: "alice", status: "online" });
        expect(snapshot.users[0].sessions.map((s) => s.playUri).sort()).toEqual([ROOM_A, ROOM_B].sort());
        expect(snapshot.rooms).toEqual({ [ROOM_A]: { guests: 1, bots: 1 } });
    });

    it("forgets a guest or a bot once their socket closes", () => {
        const { presence } = setup();
        const guest = new FakeSocket("guest-1", ROOM_A, { isLogged: false });
        presence.track(guest);
        presence.untrack(guest);
        expect(presence.snapshot()).toMatchObject({ users: [], rooms: {} });
    });

    it("reads meetings and calls as busy, a short break as away", () => {
        expect(liveStatus(AvailabilityStatus.ONLINE)).toBe("online");
        expect(liveStatus(AvailabilityStatus.LIVEKIT)).toBe("busy");
        expect(liveStatus(AvailabilityStatus.DO_NOT_DISTURB)).toBe("busy");
        expect(liveStatus(AvailabilityStatus.BACK_IN_A_MOMENT)).toBe("away");
    });
});
