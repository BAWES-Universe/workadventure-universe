import { describe, expect, it } from "vitest";
import { newBricksLimitLine } from "../NewBrick";

const t = {
    limitReached: ({ time }: { time: string }) => `You've made a lot of Bricks this hour. Try again at ${time}.`,
    limitReachedLater: () => "You've made a lot of Bricks this hour. Try again in a few minutes.",
} as unknown as Parameters<typeof newBricksLimitLine>[2];

describe("the line for a person who made too many new Bricks this hour", () => {
    it("names the time they can make another, on their own clock", () => {
        const now = new Date("2026-11-21T12:00:00.000Z");
        const line = newBricksLimitLine("2026-11-21T12:40:00.000Z", "en-US", t, now);
        expect(line).toMatch(/^You've made a lot of Bricks this hour\. Try again at \d{1,2}:40.*\.$/);
    });

    it("names the next whole minute when the time has seconds, so a try inside the minute is not refused again", () => {
        const now = new Date("2026-11-21T12:00:00.000Z");
        // 12:40:59 is shown as :41, never as :40
        expect(newBricksLimitLine("2026-11-21T12:40:59.000Z", "en-US", t, now)).toMatch(/Try again at \d{1,2}:41.*\.$/);
    });

    it("says a few minutes when Orbit gave no time it can be read from", () => {
        for (const retryAt of [undefined, "", "soon"]) {
            expect(newBricksLimitLine(retryAt, "en-US", t)).toBe(
                "You've made a lot of Bricks this hour. Try again in a few minutes."
            );
        }
    });
});
