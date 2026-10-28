import { describe, expect, it } from "vitest";
import { pageDragOffset, tabAfterPageSwipe, tabAfterPillDrag } from "../SwipeTabs";

describe("dragging the tab pill", () => {
    const step = 100;
    it("lands on the tab it is nearer when let go slowly", () => {
        expect(tabAfterPillDrag({ from: 0, position: 40, step, count: 3, velocity: 0 })).toBe(0);
        expect(tabAfterPillDrag({ from: 0, position: 60, step, count: 3, velocity: 0 })).toBe(1);
        expect(tabAfterPillDrag({ from: 0, position: 170, step, count: 3, velocity: 0.1 })).toBe(2);
    });

    it("goes one tab the way it was flicked", () => {
        expect(tabAfterPillDrag({ from: 1, position: 110, step, count: 3, velocity: 0.8 })).toBe(2);
        expect(tabAfterPillDrag({ from: 1, position: 90, step, count: 3, velocity: -0.8 })).toBe(0);
    });

    it("never goes past the first or last tab", () => {
        expect(tabAfterPillDrag({ from: 2, position: 200, step, count: 3, velocity: 2 })).toBe(2);
        expect(tabAfterPillDrag({ from: 0, position: 0, step, count: 3, velocity: -2 })).toBe(0);
        expect(tabAfterPillDrag({ from: 0, position: 900, step, count: 3, velocity: 0 })).toBe(2);
    });
});

describe("swiping the page sideways", () => {
    it("moves to the next tab when swiped toward the start, the previous when swiped toward the end", () => {
        expect(tabAfterPageSwipe(0, -80, 3)).toBe(1);
        expect(tabAfterPageSwipe(2, 80, 3)).toBe(1);
    });

    it("stays for a short swipe or past either end", () => {
        expect(tabAfterPageSwipe(1, -30, 3)).toBe(1);
        expect(tabAfterPageSwipe(0, 120, 3)).toBe(0);
        expect(tabAfterPageSwipe(2, -120, 3)).toBe(2);
    });

    it("follows the finger, and only a quarter of the way past either end", () => {
        expect(pageDragOffset(1, -60, 3)).toBe(-60);
        expect(pageDragOffset(0, 60, 3)).toBe(15);
        expect(pageDragOffset(2, -60, 3)).toBe(-15);
    });
});
