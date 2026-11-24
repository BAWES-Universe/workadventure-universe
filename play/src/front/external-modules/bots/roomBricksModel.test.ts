import { describe, expect, it } from "vitest";
import {
    livesHere,
    parseBrickHome,
    parsePlaced,
    parseRoomBricks,
    placedByOthers,
    placementOf,
    spotOf,
} from "./roomBricksModel";

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
            mine: [
                {
                    id: "m1",
                    name: "Brick",
                    description: "Your own Brick",
                    characterTextureId: "brick-orange",
                    enabled: true,
                    homeElsewhere: true,
                },
            ],
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
        const bricks = parseRoomBricks({
            here: [row({ id: "" }), null, row({ name: "  " }), row()],
            mine: [{ id: 3 }],
        });
        expect(bricks?.here.map((one) => one.id)).toEqual(["b1"]);
        expect(bricks?.mine).toEqual([]);
        expect(bricks?.roomName).toBe("");
    });

    it("reads the spot a Brick stands at, and none when Orbit does not give a point", () => {
        const at = (behaviorConfig: unknown) =>
            parseRoomBricks({ here: [row({ behaviorConfig })], mine: [] })?.here[0].spot;
        expect(at({ assignedSpace: { center: { x: 320, y: 160 }, radius: 0 } })).toEqual({ x: 320, y: 160 });
        expect(at({})).toBeNull();
        expect(at(undefined)).toBeNull();
        expect(spotOf({ assignedSpace: { center: { x: "1", y: 2 } } })).toBeNull();
        expect(spotOf({ assignedSpace: { center: { x: Infinity, y: 2 } } })).toBeNull();
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
    const home = {
        roomUrl: "https://play.test/_/acme/hq/lobby.tmj",
        roomName: "Headquarters",
        universeName: "Makers Market",
    };

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

describe("what is sent when a Brick is placed at a spot", () => {
    const spot = { behaviorConfig: { assignedSpace: { center: { x: 64, y: 96 }, radius: 0 } } };

    it("is the spot alone for a Brick that did not stand here", () => {
        expect(placementOf(undefined, spot)).toEqual({ behaviorConfig: spot.behaviorConfig });
        expect(placementOf({ behaviorType: null, behaviorConfig: null }, spot)).toEqual({
            behaviorConfig: spot.behaviorConfig,
        });
    });

    it("keeps how a Brick behaves where it stands already, and moves only its spot", () => {
        const placed = placementOf(
            {
                behaviorType: "social",
                behaviorConfig: { assignedSpace: { center: { x: 1, y: 2 }, radius: 50 }, approachDistance: 90 },
            },
            spot
        );
        expect(placed).toEqual({
            behaviorType: "social",
            behaviorConfig: { assignedSpace: { center: { x: 64, y: 96 }, radius: 50 }, approachDistance: 90 },
        });
    });

    it("reads how a Brick behaves from the room's list", () => {
        const read = parseRoomBricks({
            here: [
                row({ behaviorType: "patrol", behaviorConfig: { wanderSpeed: 2 } }),
                row({ id: "b2", behaviorType: "x" }),
            ],
            mine: [],
        });
        expect(read?.here.map((one) => one.behaviorType)).toEqual(["patrol", null]);
        expect(read?.here[0].behaviorConfig).toEqual({ wanderSpeed: 2 });
        expect(read?.here[1].behaviorConfig).toBeNull();
    });
});
