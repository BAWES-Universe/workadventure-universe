import { describe, expect, it } from "vitest";
import { centerYClearOfTopCover } from "../MapEditor/ScreenSpace";

// A 900 px tall canvas drawn at 0.5 CSS px per world unit shows 1800 world units; the bar covers the top 106 px.
const VIEW = 900;
const SCALE = 0.5;
const BAR = 106;

describe("centerYClearOfTopCover", () => {
    it("moves a map pinned to the top of the screen down to just below the bar", () => {
        // Centre at 900: the map's top edge is at the top of the screen, under the bar.
        const centerY = centerYClearOfTopCover(900, VIEW, SCALE, BAR);
        expect(centerY).toBeCloseTo(900 - BAR / SCALE);
        // The map's top edge now sits at the bar's bottom.
        expect(VIEW / 2 - centerY * SCALE).toBeCloseTo(BAR);
    });

    it("moves a map whose top edge is partly under the bar only by what is still covered", () => {
        // The map's top edge is 40 px down the screen.
        const centerY = centerYClearOfTopCover(820, VIEW, SCALE, BAR);
        expect(VIEW / 2 - centerY * SCALE).toBeCloseTo(BAR);
    });

    it("leaves a map whose top edge is already below the bar", () => {
        expect(centerYClearOfTopCover(400, VIEW, SCALE, BAR)).toBe(400);
    });

    it("leaves the middle of a tall map, where the top edge is above the screen", () => {
        expect(centerYClearOfTopCover(3000, VIEW, SCALE, BAR)).toBe(3000);
    });

    it("does nothing when no bar covers the top (a phone's bar sits below the map)", () => {
        expect(centerYClearOfTopCover(900, VIEW, SCALE, 0)).toBe(900);
    });
});
