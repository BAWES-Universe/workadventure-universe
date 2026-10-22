import { describe, expect, it } from "vitest";
import {
    clampOpenHereRatio,
    nearestWidthStop,
    OPEN_HERE_START_RATIO,
    OPEN_HERE_WIDTH_STOPS,
    stepWidthStop,
} from "./OpenHereWidth";

describe("Open here window width", () => {
    it("starts at a third, and snaps to a third, a half or two thirds", () => {
        expect(OPEN_HERE_START_RATIO).toBeCloseTo(0.33);
        expect(nearestWidthStop(0.2)).toBeCloseTo(0.33);
        expect(nearestWidthStop(0.45)).toBeCloseTo(1 / 2);
        expect(nearestWidthStop(0.6)).toBeCloseTo(2 / 3);
        expect(nearestWidthStop(0.9)).toBeCloseTo(2 / 3);
    });

    it("steps one stop at a time from any width and stays on the last", () => {
        expect(stepWidthStop(0.33, 1)).toBeCloseTo(1 / 2);
        expect(stepWidthStop(1 / 2, 1)).toBeCloseTo(2 / 3);
        expect(stepWidthStop(2 / 3, 1)).toBeCloseTo(2 / 3);
        expect(stepWidthStop(2 / 3, -1)).toBeCloseTo(1 / 2);
        expect(stepWidthStop(0.33, -1)).toBeCloseTo(0.33);
        // A width the map asked for (70%) is not a stop: narrower goes to the next stop below it.
        expect(stepWidthStop(0.7, -1)).toBeCloseTo(2 / 3);
        expect(OPEN_HERE_WIDTH_STOPS).toHaveLength(3);
    });

    it("keeps a width the map asked for within what fits", () => {
        expect(clampOpenHereRatio(0.1)).toBe(0.25);
        expect(clampOpenHereRatio(0.7)).toBe(0.7);
        expect(clampOpenHereRatio(1)).toBe(0.9);
    });
});
