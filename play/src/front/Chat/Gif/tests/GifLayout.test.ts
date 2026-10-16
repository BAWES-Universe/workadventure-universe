import { describe, expect, it } from "vitest";
import {
    gifColumnsFor,
    gifNeighbour,
    pickerWidthFor,
    shortestColumn,
    skeletonColumns,
    skeletonMoreRow,
    tileColumnsFor,
    tileNeighbour,
} from "../GifLayout";

describe("GifLayout", () => {
    it("puts the next GIF in the shortest column, the left one when they are level", () => {
        expect(shortestColumn([0, 0])).toBe(0);
        expect(shortestColumn([2, 1, 1])).toBe(1);
    });

    it("takes the width of the chat panel minus 8px each side, between 280px and 640px", () => {
        expect(pickerWidthFor(360)).toBe(344);
        expect(pickerWidthFor(296)).toBe(280);
        expect(pickerWidthFor(200)).toBe(280);
        expect(pickerWidthFor(680)).toBe(640);
        expect(pickerWidthFor(1200)).toBe(640);
    });

    it("gives the columns of the sizes table", () => {
        expect([280, 439].map(tileColumnsFor)).toEqual([2, 2]);
        expect([440, 640].map(tileColumnsFor)).toEqual([3, 3]);
        expect([280, 439].map(gifColumnsFor)).toEqual([2, 2]);
        expect([440, 559].map(gifColumnsFor)).toEqual([3, 3]);
        expect([560, 640].map(gifColumnsFor)).toEqual([4, 4]);
    });

    it("makes grey boxes of mixed heights, as many columns as the GIFs will have", () => {
        for (const count of [2, 3, 4]) {
            const columns = skeletonColumns(count);
            expect(columns).toHaveLength(count);
            expect(columns.every((column) => column.length >= 3)).toBe(true);
            expect(new Set(columns.flat()).size).toBeGreaterThan(3);
            expect(skeletonMoreRow(count)).toHaveLength(count);
        }
    });

    describe("tileNeighbour", () => {
        it("moves along a row and down a row", () => {
            expect(tileNeighbour(0, 9, 2, "right")).toBe(1);
            expect(tileNeighbour(1, 9, 2, "right")).toBeUndefined();
            expect(tileNeighbour(2, 9, 2, "left")).toBeUndefined();
            expect(tileNeighbour(2, 9, 2, "down")).toBe(4);
            expect(tileNeighbour(4, 9, 2, "up")).toBe(2);
        });

        it("goes to the search box above the first row", () => {
            expect(tileNeighbour(1, 9, 2, "up")).toBe("search");
        });

        it("goes to the last tile when the last row is shorter", () => {
            // 9 tiles in 2 columns: the last row has one.
            expect(tileNeighbour(7, 9, 2, "down")).toBe(8);
            expect(tileNeighbour(8, 9, 2, "down")).toBeUndefined();
            expect(tileNeighbour(8, 9, 2, "right")).toBeUndefined();
        });
    });

    describe("gifNeighbour", () => {
        // Heights as a share of the column's width.
        const heights = [
            [1, 1, 1],
            [0.5, 2, 0.5],
        ];

        it("stays in the column going up and down", () => {
            expect(gifNeighbour(heights, { column: 0, row: 0 }, "down")).toEqual({ column: 0, row: 1 });
            expect(gifNeighbour(heights, { column: 0, row: 2 }, "down")).toBeUndefined();
            expect(gifNeighbour(heights, { column: 0, row: 1 }, "up")).toEqual({ column: 0, row: 0 });
            expect(gifNeighbour(heights, { column: 0, row: 0 }, "up")).toBe("search");
        });

        it("goes sideways to the GIF that is level with this one", () => {
            // The middle of row 1 of the left column is at 1.5: the tall GIF on the right is centred there.
            expect(gifNeighbour(heights, { column: 0, row: 1 }, "right")).toEqual({ column: 1, row: 1 });
            expect(gifNeighbour(heights, { column: 0, row: 2 }, "right")).toEqual({ column: 1, row: 2 });
            expect(gifNeighbour(heights, { column: 0, row: 0 }, "right")).toEqual({ column: 1, row: 0 });
            expect(gifNeighbour(heights, { column: 1, row: 2 }, "left")).toEqual({ column: 0, row: 2 });
        });

        it("stops at the edges and at an empty column", () => {
            expect(gifNeighbour(heights, { column: 0, row: 0 }, "left")).toBeUndefined();
            expect(gifNeighbour(heights, { column: 1, row: 0 }, "right")).toBeUndefined();
            expect(gifNeighbour([[1], []], { column: 0, row: 0 }, "right")).toBeUndefined();
        });
    });
});
