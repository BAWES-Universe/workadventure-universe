import { AvailabilityStatus } from "@workadventure/messages";
import type { Friend, FriendSession } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import type { WorldSighting } from "./Friends";
import { groupFriends, otherWorldFaces, placeFriends, relativeTime, worldOf } from "./Friends";

const HERE = "https://play.test/@/bawes/hub/lobby";
const SAME_WORLD = "https://play.test/@/bawes/hub/cafe";
const OTHER_WORLD = "https://play.test/@/nebula/library/main";

function session(playUri: string, status = AvailabilityStatus.ONLINE): FriendSession {
    return { playUri, universeName: "U", worldName: "W", roomName: "R", availabilityStatus: status };
}

function friend(name: string, sessions: FriendSession[] = [], extra: Partial<Friend> = {}): Friend {
    return {
        uuid: `uuid-${name}`,
        name,
        chatId: `@${name}:chat`,
        lastSeenAt: "",
        presence: {
            online: sessions.length > 0,
            locationHidden: false,
            availabilityStatus: sessions[0]?.availabilityStatus ?? AvailabilityStatus.UNCHANGED,
            sessions,
        },
        ...extra,
    };
}

const nowhere = (): WorldSighting | undefined => undefined;

describe("worldOf", () => {
    it("is the universe and world of a Universe room, and the path of other maps", () => {
        expect(worldOf(HERE)).toBe("/@/bawes/hub");
        expect(worldOf(SAME_WORLD)).toBe("/@/bawes/hub");
        expect(worldOf("https://play.test/_/global/maps/a.json")).toBe("/_/global/maps/a.json");
        expect(worldOf(undefined)).toBeUndefined();
    });
});

describe("placeFriends", () => {
    it("groups friends by where their sessions are, preferring the one here", () => {
        const placed = placeFriends(
            [
                friend("Sara", [session(OTHER_WORLD), session(HERE)]),
                friend("Tariq", [session(SAME_WORLD)]),
                friend("Mishari", [session(OTHER_WORLD)]),
                friend("Hamad"),
            ],
            HERE,
            nowhere,
            true
        );
        expect(placed.map((p) => [p.friend.name, p.group])).toEqual([
            ["Sara", "here"],
            ["Tariq", "inThisWorld"],
            ["Mishari", "otherWorlds"],
            ["Hamad", "offline"],
        ]);
        expect(placed[0].session?.playUri).toBe(HERE);
    });

    it("trusts the world list for friends in this world, even without presence", () => {
        const sighting: WorldSighting = { playUri: SAME_WORLD, roomName: "Cafe", status: AvailabilityStatus.BUSY };
        const placed = placeFriends(
            [friend("Tariq"), friend("Lina", [session(OTHER_WORLD)])],
            HERE,
            (uuid) => (uuid === "uuid-Tariq" ? sighting : undefined),
            false
        );
        expect(placed[0]).toEqual(
            expect.objectContaining({ group: "inThisWorld", status: AvailabilityStatus.BUSY, locationUnknown: false })
        );
        // Presence unavailable: everyone else is listed with their status unknown.
        expect(placed[1]).toEqual(expect.objectContaining({ group: "offline", locationUnknown: true }));
    });

    it("keeps a hidden location hidden", () => {
        const hidden = friend("Lina");
        hidden.presence = {
            online: true,
            locationHidden: true,
            availabilityStatus: AvailabilityStatus.ONLINE,
            sessions: [],
        };
        const [placed] = placeFriends([hidden], HERE, nowhere, true);
        expect(placed).toEqual(
            expect.objectContaining({ group: "otherWorlds", locationUnknown: true, session: undefined })
        );
        expect(otherWorldFaces([placed])).toEqual([]);
    });
});

describe("groupFriends and otherWorldFaces", () => {
    it("sorts each group by name and puts free friends first in the faces row", () => {
        const placed = placeFriends(
            [
                friend("omar", [session(OTHER_WORLD, AvailabilityStatus.BUSY)]),
                friend("Dana", [session(OTHER_WORLD)]),
                friend("bilal", [session(OTHER_WORLD)]),
            ],
            HERE,
            nowhere,
            true
        );
        expect(groupFriends(placed).otherWorlds.map((p) => p.friend.name)).toEqual(["bilal", "Dana", "omar"]);
        expect(otherWorldFaces(placed).map((p) => p.friend.name)).toEqual(["bilal", "Dana", "omar"]);
    });
});

describe("relativeTime", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    it("says how long ago, in the player's language", () => {
        expect(relativeTime("2026-10-04T10:00:00Z", now, "en")).toBe("2 hr. ago");
        expect(relativeTime("2026-10-04T11:59:30Z", now, "en")).toBe("this minute");
        expect(relativeTime("2026-10-03T12:00:00Z", now, "en")).toBe("yesterday");
        expect(relativeTime("", now, "en")).toBe("");
        expect(relativeTime("not a date", now, "en")).toBe("");
    });
});
