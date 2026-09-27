import { describe, expect, it } from "vitest";
import { isQuickTap } from "./QuickTap";

const pointer = (duration: number, dx = 0, dy = 0) => ({
    downX: 100,
    downY: 100,
    upX: 100 + dx,
    upY: 100 + dy,
    getDuration: () => duration,
});

describe("isQuickTap", () => {
    it("counts a short press released where it began", () => {
        expect(isQuickTap(pointer(120))).toBe(true);
        expect(isQuickTap(pointer(250, 6, 6))).toBe(true);
    });

    it("never counts a hold", () => {
        expect(isQuickTap(pointer(400))).toBe(false);
    });

    it("never counts the start of a joystick drag", () => {
        expect(isQuickTap(pointer(120, 30, 0))).toBe(false);
        expect(isQuickTap(pointer(120, 8, 8))).toBe(false);
    });
});
