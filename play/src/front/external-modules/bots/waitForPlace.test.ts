import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForPlace, PLACE_FIRST_LOOK_MS, PLACE_LOOK_EVERY_MS, PLACE_LOOK_TRIES } from "./waitForPlace";

describe("waiting for the person's place before a Brick is put beside them", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("syncs once with the place when the player is there, and not before", () => {
        const where: { place?: { x: number; y: number } } = {};
        const done = vi.fn();
        waitForPlace(() => where.place, done);
        vi.advanceTimersByTime(PLACE_FIRST_LOOK_MS + PLACE_LOOK_EVERY_MS * 3);
        expect(done).not.toHaveBeenCalled();
        where.place = { x: 320, y: 480 };
        vi.advanceTimersByTime(PLACE_LOOK_EVERY_MS);
        expect(done).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledWith({ x: 320, y: 480 });
        vi.advanceTimersByTime(60000);
        expect(done).toHaveBeenCalledTimes(1);
    });

    it("never syncs without a place: when the tries run out nothing is said, and it looks no more", () => {
        const getPlace = vi.fn(() => undefined);
        const done = vi.fn();
        waitForPlace(getPlace, done);
        vi.advanceTimersByTime(PLACE_FIRST_LOOK_MS + PLACE_LOOK_EVERY_MS * (PLACE_LOOK_TRIES + 5));
        expect(done).not.toHaveBeenCalled();
        expect(getPlace).toHaveBeenCalledTimes(PLACE_LOOK_TRIES);
    });

    it("says nothing once stopped (a room entered again replaces the wait)", () => {
        const done = vi.fn();
        const stop = waitForPlace(() => ({ x: 1, y: 2 }), done);
        stop();
        vi.advanceTimersByTime(60000);
        expect(done).not.toHaveBeenCalled();
    });
});
