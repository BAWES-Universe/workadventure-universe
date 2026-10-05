import { describe, expect, it } from "vitest";
import type { SheetSizes } from "../BottomSheet";
import { clampHeight, getSnapHeights, nearestSnap, nextSnap } from "../BottomSheet";
import {
    CHAT_SHEET_FIT_MARGIN,
    CHAT_SHEET_SIZES,
    CHAT_SHEET_TOP_GAP,
    chatSheetFitHeight,
    chatSheetRestingHeight,
} from "../../../Chat/ChatSheetSizes";

const sizes: SheetSizes = { peek: () => 64, topGap: 96 };

describe("BottomSheet", () => {
    it("sizes the snaps from the viewport", () => {
        expect(getSnapHeights(844, sizes)).toEqual({ peek: 64, half: 422, full: 748 });
    });

    it("never makes a snap smaller than the one below it on a short screen", () => {
        const { peek, half, full } = getSnapHeights(100, sizes);
        expect(half).toBeGreaterThanOrEqual(peek);
        expect(full).toBeGreaterThanOrEqual(half);
    });

    it("keeps a drag between peek and full, or a lower minimum when given", () => {
        expect(clampHeight(0, 844, sizes)).toBe(64);
        expect(clampHeight(2000, 844, sizes)).toBe(748);
        expect(clampHeight(10, 844, sizes, 0)).toBe(10);
    });

    it("snaps a released drag to the closest height and steps through them on tap", () => {
        expect(nearestSnap(90, 844, sizes)).toBe("peek");
        expect(nearestSnap(400, 844, sizes)).toBe("half");
        expect(nearestSnap(700, 844, sizes)).toBe("full");
        expect(nextSnap("peek")).toBe("half");
        expect(nextSnap("full")).toBe("peek");
    });

    it("gives the chat sheet room for the last messages at its lowest, and a row of faces above it at its tallest", () => {
        const { peek, half, full } = getSnapHeights(844, CHAT_SHEET_SIZES);
        expect(peek).toBe(287);
        // It opens at 60% of the screen, so the list and the conversation can be read without dragging it up.
        expect(half).toBe(506);
        expect(full).toBe(844 - CHAT_SHEET_TOP_GAP);
        // A short phone: the lowest height never goes past half the screen.
        expect(getSnapHeights(560, CHAT_SHEET_SIZES).peek).toBeLessThanOrEqual(280);
        // Other sheets keep half the screen.
        expect(getSnapHeights(844, sizes).half).toBe(422);
    });

    it("keeps the chat sheet where it was dragged to, between its lowest height and full", () => {
        expect(chatSheetRestingHeight("half", 844)).toBe(506);
        expect(chatSheetRestingHeight(0.42, 844)).toBe(354);
        expect(chatSheetRestingHeight(0.05, 844)).toBe(287);
        expect(chatSheetRestingHeight(1, 844)).toBe(844 - CHAT_SHEET_TOP_GAP);
    });

    it("grows a chat opened by a bubble just enough to show the latest message, never shrinking it", () => {
        // The message fits: the sheet stays as it is.
        expect(chatSheetFitHeight(287, 150, 60, 844)).toBe(287);
        // A tall message: the sheet grows by what is missing.
        expect(chatSheetFitHeight(287, 150, 200, 844)).toBe(287 + 200 + CHAT_SHEET_FIT_MARGIN - 150);
        // Never past full.
        expect(chatSheetFitHeight(287, 150, 2000, 844)).toBe(844 - CHAT_SHEET_TOP_GAP);
    });
});
