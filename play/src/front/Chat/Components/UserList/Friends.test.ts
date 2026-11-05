import { AvailabilityStatus } from "@workadventure/messages";
import type { Friend, FriendSession } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import type { WorldSighting } from "./Friends";
import {
    chatIdsToAsk,
    groupFriends,
    otherWorldFaces,
    placeFriends,
    profileTakesFirstSpot,
    relativeTime,
    savedLook,
    worldOf,
} from "./Friends";

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
        characterTextures: [],
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
        expect(otherWorldFaces([placed])).toEqual([placed]);
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
        expect(relativeTime("2026-10-04T10:00:00Z", now, "en")).toBe("2 hours ago");
        expect(relativeTime("2026-10-04T11:59:30Z", now, "en")).toBe("this minute");
        expect(relativeTime("2026-10-03T12:00:00Z", now, "en")).toBe("yesterday");
        expect(relativeTime("", now, "en")).toBe("");
        expect(relativeTime("not a date", now, "en")).toBe("");
    });
});

describe("profileTakesFirstSpot", () => {
    it("puts View profile first only on rows with neither Walk to nor Go", () => {
        expect(profileTakesFirstSpot(true, false, false)).toBe(true);
        expect(profileTakesFirstSpot(true, true, false)).toBe(false);
        expect(profileTakesFirstSpot(true, false, true)).toBe(false);
        expect(profileTakesFirstSpot(false, false, false)).toBe(false);
    });
});

describe("savedLook", () => {
    const wokas = new Map([["@shahd:chat", "shahd-woka"]]);
    const colourOf = (chatId: string | undefined, name: string) => `colour-of-${name}`;

    it("gives someone the world isn't showing their saved woka, on the colour of their name", () => {
        expect(savedLook({ uuid: "u1", name: "Shahd", chatId: "@shahd:chat" }, wokas, colourOf)).toEqual({
            picture: "shahd-woka",
            color: "colour-of-Shahd",
        });
    });

    it("keeps the default woka when nothing is saved, or without a chat ID", () => {
        expect(savedLook({ uuid: "u2", name: "Mishari", chatId: "@mishari:chat" }, wokas, colourOf).picture).toBe(
            undefined
        );
        expect(savedLook({ uuid: "u3", name: "Yousef", chatId: "" }, wokas, colourOf)).toEqual({
            picture: undefined,
            color: "colour-of-Yousef",
        });
    });

    it("gives nothing for someone not listed", () => {
        expect(savedLook(undefined, wokas, colourOf)).toEqual({});
    });

    it("draws the layers Orbit sent, also for a request that has no chat ID", () => {
        const layers = [{ id: "body", url: "https://assets.test/body.png" }];
        const fromLayers = (person: { characterTextures?: readonly unknown[] }) =>
            person.characterTextures?.length ? "layers-woka" : undefined;
        expect(
            savedLook({ uuid: "u4", name: "Layla", chatId: "", characterTextures: layers }, wokas, colourOf, fromLayers)
        ).toEqual({ picture: "layers-woka", color: "colour-of-Layla" });
        // Their layers win over a saved woka found by chat ID; without layers the saved one still shows
        expect(
            savedLook(
                { uuid: "u1", name: "Shahd", chatId: "@shahd:chat", characterTextures: layers },
                wokas,
                colourOf,
                fromLayers
            ).picture
        ).toBe("layers-woka");
        expect(
            savedLook({ uuid: "u1", name: "Shahd", chatId: "@shahd:chat" }, wokas, colourOf, fromLayers).picture
        ).toBe("shahd-woka");
    });
});

describe("a People search result", () => {
    const wokas = new Map([["@shahd:chat", "shahd-woka"]]);
    const colourOf = (chatId: string | undefined, name: string) => `colour-of-${name}`;
    const found = { uuid: "u1", name: "Shahd", chatId: "@shahd:chat", universes: ["Bawes"], relationship: "none" };

    it("shows the person's saved Woka once Orbit has drawn it, on the colour of their name", () => {
        expect(savedLook(found, wokas, colourOf)).toEqual({ picture: "shahd-woka", color: "colour-of-Shahd" });
    });

    it("keeps the default Woka for someone Orbit has no picture for, or whose answer has no chat ID", () => {
        expect(savedLook({ ...found, chatId: "@unknown:chat" }, wokas, colourOf).picture).toBe(undefined);
        expect(savedLook({ ...found, chatId: "" }, wokas, colourOf).picture).toBe(undefined);
    });

    it("asks Orbit once for each result the world isn't drawing, and never twice for the same person", () => {
        const results = [
            found,
            { ...found, uuid: "here", name: "Here", chatId: "@here:chat" },
            { ...found, uuid: "nochat", name: "No chat", chatId: "" },
        ];
        const asked = new Set<string>();
        expect(chatIdsToAsk(results, (uuid) => uuid === "here", asked)).toEqual(["@shahd:chat"]);
        expect(chatIdsToAsk(results, (uuid) => uuid === "here", asked)).toEqual([]);
    });
});

describe("chatIdsToAsk with layers", () => {
    it("does not ask Orbit about someone whose Woka layers it already sent", () => {
        const people = [
            { uuid: "a", name: "A", chatId: "@a:chat", characterTextures: [{ id: "body", url: "https://x/body.png" }] },
            { uuid: "b", name: "B", chatId: "@b:chat", characterTextures: [] },
        ];
        expect(chatIdsToAsk(people, () => false, new Set())).toEqual(["@b:chat"]);
    });
});

describe("chatIdsToAsk", () => {
    const people = [
        { uuid: "here", name: "Here", chatId: "@here:chat" },
        { uuid: "away", name: "Away", chatId: "@away:chat" },
        { uuid: "nochat", name: "No chat", chatId: "" },
    ];

    it("asks once for each shown person the world isn't drawing", () => {
        const asked = new Set<string>();
        const inWorld = (uuid: string) => uuid === "here";
        expect(chatIdsToAsk(people, inWorld, asked)).toEqual(["@away:chat"]);
        expect(chatIdsToAsk(people, inWorld, asked)).toEqual([]);
    });
});
