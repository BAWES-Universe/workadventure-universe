import { describe, expect, it } from "vitest";
import {
    MAP_EDITOR_SHEET_PEEK_HEIGHT,
    MAP_EDITOR_SHEET_TOP_GAP,
    clampSheetHeight,
    getSheetSnapHeights,
    nearestSheetSnap,
    nextSheetSnap,
} from "../MapEditorSheet";

describe("MapEditorSheet", () => {
    it("sizes the snaps from the viewport", () => {
        expect(getSheetSnapHeights(844)).toEqual({
            peek: MAP_EDITOR_SHEET_PEEK_HEIGHT,
            half: 422,
            full: 844 - MAP_EDITOR_SHEET_TOP_GAP,
        });
    });

    it("never makes a snap smaller than the one below it on a short screen", () => {
        const { peek, half, full } = getSheetSnapHeights(100);
        expect(half).toBeGreaterThanOrEqual(peek);
        expect(full).toBeGreaterThanOrEqual(half);
    });

    it("snaps a released drag to the closest height", () => {
        expect(nearestSheetSnap(90, 844)).toBe("peek");
        expect(nearestSheetSnap(400, 844)).toBe("half");
        expect(nearestSheetSnap(700, 844)).toBe("full");
    });

    it("keeps a drag between peek and full", () => {
        expect(clampSheetHeight(0, 844)).toBe(MAP_EDITOR_SHEET_PEEK_HEIGHT);
        expect(clampSheetHeight(2000, 844)).toBe(844 - MAP_EDITOR_SHEET_TOP_GAP);
    });

    it("steps up through the snaps on tap, then back to peek", () => {
        expect(nextSheetSnap("peek")).toBe("half");
        expect(nextSheetSnap("half")).toBe("full");
        expect(nextSheetSnap("full")).toBe("peek");
    });
});
