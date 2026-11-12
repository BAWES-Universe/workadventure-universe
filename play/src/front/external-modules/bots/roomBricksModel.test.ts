import { describe, expect, it } from "vitest";
import { livesHere, parseBrickHome, parsePlaced, parseRoomBricks, placedByOthers } from "./roomBricksModel";

const row = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    name: "Recipe Brick",
    characterTextureId: "brick-red",
    ownerName: "Khalid",
    mine: false,
    canTakeOut: true,
    since: "2026-11-10T09:00:00.000Z",
    ...over,
});

describe("the Bricks of a room, as Orbit lists them (#2005)", () => {
    it("reads the Bricks that live here and the person's own that can be added", () => {
        const bricks = parseRoomBricks({
            roomName: " Headquarters ",
            here: [row(), row({ id: "b2", name: "Mine", mine: true })],
            mine: [{ id: "m1", name: "Brick", description: "Your own Brick", characterTextureId: "brick-orange", enabled: true, homeElsewhere: true }],
        });
        expect(bricks?.roomName).toBe("Headquarters");
        expect(bricks?.here.map((one) => [one.id, one.mine, one.look, one.ownerName, one.since])).toEqual([
            ["b1", false, "brick-red", "Khalid", "2026-11-10T09:00:00.000Z"],
            ["b2", true, "brick-red", "Khalid", "2026-11-10T09:00:00.000Z"],
        ]);
        expect(bricks?.mine).toEqual([
            { id: "m1", name: "Brick", description: "Your own Brick", look: "brick-orange", homeElsewhere: true },
        ]);
    });

    it("leaves out what is not a Brick, and a room with no name says so with an empty name", () => {
        const bricks = parseRoomBricks({ here: [row({ id: "" }), null, row({ name: "  " }), row()], mine: [{ id: 3 }] });
        expect(bricks?.here.map((one) => one.id)).toEqual(["b1"]);
        expect(bricks?.mine).toEqual([]);
        expect(bricks?.roomName).toBe("");
    });

    it("is not an answer when it is not shaped like one", () => {
        expect(parseRoomBricks(undefined)).toBeUndefined();
        expect(parseRoomBricks("here")).toBeUndefined();
        expect(parseRoomBricks({ here: [] })).toBeUndefined();
        expect(parseRoomBricks({ error: "Room not found" })).toBeUndefined();
    });

    it("lists under 'Placed by others' only what the person did not place", () => {
        const bricks = parseRoomBricks({ here: [row(), row({ id: "b2", mine: true })], mine: [] });
        expect(placedByOthers(bricks).map((one) => one.id)).toEqual(["b1"]);
        expect(placedByOthers(undefined)).toEqual([]);
    });
});

describe("where a Brick lives, as Orbit tells it (#2005)", () => {
    const home = { roomUrl: "https://play.test/_/acme/hq/lobby.tmj", roomName: "Headquarters", universeName: "Makers Market" };

    it("reads a home, and nowhere", () => {
        expect(parseBrickHome({ home })).toEqual(home);
        expect(parseBrickHome({ home: null })).toBeNull();
        expect(parseBrickHome({ home: { roomUrl: "x" } })).toBeUndefined();
        expect(parseBrickHome({})).toBeUndefined();
        expect(parseBrickHome(null)).toBeUndefined();
    });

    it("says, on 'Add here', whether others cannot talk to it yet because its key is not lent", () => {
        expect(parsePlaced({ home, keyNote: null })).toEqual({ home, keyNotLent: false });
        expect(parsePlaced({ home, keyNote: "not_lent" })).toEqual({ home, keyNotLent: true });
        expect(parsePlaced({ home: null })).toBeUndefined();
    });

    it("tells whether it lives in the room the person is in, whatever the address looks like", () => {
        expect(livesHere(home, "https://play.test/_/acme/hq/lobby.tmj")).toBe(true);
        expect(livesHere(home, "/_/acme/hq/lobby.tmj")).toBe(true);
        expect(livesHere(home, "https://play.test/_/acme/hq/lobby.tmj/")).toBe(true);
        expect(livesHere(home, "https://play.test/_/acme/hq/cafe.tmj")).toBe(false);
        expect(livesHere(null, "https://play.test/_/acme/hq/lobby.tmj")).toBe(false);
        expect(livesHere(home, null)).toBe(false);
    });
});
