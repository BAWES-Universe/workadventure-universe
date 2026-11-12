import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForPlace } from "./waitForPlace";

describe("waiting for the person's place before a Brick is put beside them", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("goes ahead with the place once the player is there, not before", () => {
        let place: { x: number; y: number } | undefined;
        const done = vi.fn();
        waitForPlace(() => place, done);
        vi.advanceTimersByTime(1500);
        expect(done).not.toHaveBeenCalled();
        vi.advanceTimersByTime(900);
        expect(done).not.toHaveBeenCalled();
        place = { x: 320, y: 480 };
        vi.advanceTimersByTime(300);
        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith({ x: 320, y: 480 });
        vi.advanceTimersByTime(60000);
        expect(done).toHaveBeenCalledTimes(1);
    });

    it("goes ahead with no place when the player never appears, once", () => {
        const done = vi.fn();
        waitForPlace(() => undefined, done, { maxMs: 5000 });
        vi.advanceTimersByTime(20000);
        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith(undefined);
    });

    it("says nothing once stopped (a room entered again replaces the wait)", () => {
        const done = vi.fn();
        const stop = waitForPlace(() => ({ x: 1, y: 2 }), done);
        stop();
        vi.advanceTimersByTime(60000);
        expect(done).not.toHaveBeenCalled();
    });
});
