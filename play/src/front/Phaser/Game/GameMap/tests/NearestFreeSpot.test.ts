import { describe, expect, it } from "vitest";
import { findNearestFreeTile } from "../NearestFreeSpot";

// A room of 3x3 tiles (x 1 to 3, y 1 to 3) with walls around it and a door at the bottom (x 2, y 4).
const W = 1;
const _ = 0;
const grid = [
    [W, W, W, W, W],
    [W, _, _, _, W],
    [W, _, _, _, W],
    [W, _, _, _, W],
    [W, W, _, W, W],
    [_, _, _, _, _],
];
const size = { width: 5, height: 6 };
const walkable = (x: number, y: number) => grid[y][x] === _;
const insideRoom = (x: number, y: number) => x >= 1 && x <= 3 && y >= 1 && y <= 3;

describe("findNearestFreeTile", () => {
    it("walks out through the door, never through a wall", () => {
        expect(findNearestFreeTile(size, { x: 1, y: 1 }, walkable, (x, y) => !insideRoom(x, y))).toEqual({
            x: 2,
            y: 4,
        });
    });

    it("stays where it is when the start is allowed", () => {
        expect(findNearestFreeTile(size, { x: 0, y: 5 }, walkable, () => true)).toEqual({ x: 0, y: 5 });
    });

    it("finds nothing when no walkable tile is allowed, or the start is off the map", () => {
        expect(findNearestFreeTile(size, { x: 1, y: 1 }, walkable, () => false)).toBeUndefined();
        expect(findNearestFreeTile(size, { x: 9, y: 9 }, walkable, () => true)).toBeUndefined();
    });
});
