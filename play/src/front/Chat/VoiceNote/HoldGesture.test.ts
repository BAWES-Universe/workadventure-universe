import { describe, expect, it } from "vitest";
import { HOLD_CANCEL_PX, HOLD_DIRECTION_PX, HOLD_LOCK_PX, holdMove, holdRelease } from "./HoldGesture";

describe("a finger holding the mic", () => {
    it("stays put until it has moved a few pixels", () => {
        const move = holdMove(HOLD_DIRECTION_PX - 2, 0, undefined);
        expect(move.axis).toBeUndefined();
        expect(move.cancel).toBe(0);
        expect(move.lock).toBe(0);
    });

    it("cancels by sliding left: the mic follows, and a release at the end cancels", () => {
        const half = holdMove(-HOLD_CANCEL_PX / 2, 4, undefined);
        expect(half.axis).toBe("x");
        expect(half.cancel).toBeCloseTo(0.5);
        expect(half.offsetX).toBe(-HOLD_CANCEL_PX / 2);
        expect(half.offsetY).toBe(0);
        expect(holdMove(-HOLD_CANCEL_PX, 0, "x").cancel).toBe(1);
        // Past the end the mic stops a little beyond, and the amount stays at 1.
        const far = holdMove(-HOLD_CANCEL_PX * 3, 0, "x");
        expect(far.cancel).toBe(1);
        expect(far.offsetX).toBeGreaterThan(-HOLD_CANCEL_PX * 1.2);
    });

    it("locks by sliding up", () => {
        const move = holdMove(2, -HOLD_LOCK_PX, undefined);
        expect(move.axis).toBe("y");
        expect(move.lock).toBe(1);
        expect(move.cancel).toBe(0);
        expect(holdMove(0, -HOLD_LOCK_PX / 2, "y").lock).toBeCloseTo(0.5);
    });

    it("ignores the wrong way: right does not cancel, down does not lock", () => {
        expect(holdMove(80, 0, "x")).toMatchObject({ cancel: 0, offsetX: -0 });
        expect(holdMove(0, 80, "y")).toMatchObject({ lock: 0, offsetY: -0 });
    });

    it("keeps the first direction: a slide left that wanders up does not lock", () => {
        const left = holdMove(-40, 0, undefined);
        const wandering = holdMove(-60, -90, left.axis);
        expect(wandering.axis).toBe("x");
        expect(wandering.lock).toBe(0);
    });

    it("chooses again when the finger comes back to where it started", () => {
        const back = holdMove(1, 1, "x");
        expect(back.axis).toBeUndefined();
        expect(holdMove(0, -HOLD_LOCK_PX, back.axis).lock).toBe(1);
    });
});

describe("letting go", () => {
    it("cancels when slid away, whatever the length", () => {
        expect(holdRelease(true, 30)).toBe("cancel");
    });
    it("drops a note shorter than a second", () => {
        expect(holdRelease(false, 0.4)).toBe("tooShort");
        expect(holdRelease(false, 0.99)).toBe("tooShort");
    });
    it("sends a note of a second or more", () => {
        expect(holdRelease(false, 1)).toBe("send");
        expect(holdRelease(false, 12)).toBe("send");
    });
});
