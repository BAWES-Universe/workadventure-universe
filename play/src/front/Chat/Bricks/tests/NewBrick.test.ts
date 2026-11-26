import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newBricksLimitLine } from "../NewBrick";

const t = {
    limitReached: ({ time }: { time: string }) => `You've made a lot of Bricks this hour. Try again at ${time}.`,
    limitReachedLater: () => "You've made a lot of Bricks this hour. Try again in a few minutes.",
} as unknown as Parameters<typeof newBricksLimitLine>[2];

/** The minutes a clock in `zone` shows at `iso`: what the line must say on a device set to that zone. */
function minutesIn(iso: string, zone: string): string {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, minute: "2-digit" }).format(new Date(iso));
}

const now = new Date("2026-11-21T12:00:00.000Z");
// Zones that are not a whole hour from UTC: the minutes on their clocks are not the minutes in UTC
const ZONES = ["UTC", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Adelaide"];

describe("the line for a person who made too many new Bricks this hour", () => {
    const before = process.env.TZ;
    beforeEach(() => {
        // The line is said on the device clock; a test pins it, so the result does not depend on the machine it runs on
        process.env.TZ = "UTC";
    });
    afterEach(() => {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
    });

    it.each(ZONES)("names the time they can make another, on their own clock (device in %s)", (zone) => {
        process.env.TZ = zone;
        const line = newBricksLimitLine("2026-11-21T12:40:00.000Z", "en-US", t, now);
        expect(line).toContain(`:${minutesIn("2026-11-21T12:40:00.000Z", zone)} `);
        expect(line).toMatch(/^You've made a lot of Bricks this hour\. Try again at \d{1,2}:\d{2}.*\.$/);
    });

    it.each(ZONES)(
        "names the next whole minute when the time has seconds, so a try inside the minute is not refused again (device in %s)",
        (zone) => {
            process.env.TZ = zone;
            // 12:40:59 is shown as the minute after 12:40, never as 12:40 itself
            const line = newBricksLimitLine("2026-11-21T12:40:59.000Z", "en-US", t, now);
            expect(line).toContain(`:${minutesIn("2026-11-21T12:41:00.000Z", zone)} `);
            expect(line).not.toContain(`:${minutesIn("2026-11-21T12:40:00.000Z", zone)} `);
        }
    );

    it("says a few minutes when Orbit gave no time it can be read from", () => {
        for (const retryAt of [undefined, "", "soon"]) {
            expect(newBricksLimitLine(retryAt, "en-US", t)).toBe(
                "You've made a lot of Bricks this hour. Try again in a few minutes."
            );
        }
    });
});
