import { describe, expect, it } from "vitest";
import { formatPeakHour } from "../peakHour";

describe("formatPeakHour", () => {
    it("shows a UTC hour on the viewer's clock", () => {
        const now = new Date("2026-09-29T12:00:00Z");
        const expected = new Date("2026-09-29T14:00:00Z").getHours();
        const label = formatPeakHour(14, now);
        expect(label).toBe(`${expected % 12 || 12} ${expected < 12 ? "AM" : "PM"}`);
    });

    it("writes midnight and noon as 12", () => {
        // Find the UTC hours that land on local midnight and noon today, whatever the test machine's zone.
        const now = new Date("2026-09-29T12:00:00Z");
        const utcHourFor = (localHour: number) =>
            Array.from({ length: 24 }, (_, h) => h).find((h) => {
                const at = new Date(now.getTime());
                at.setUTCHours(h, 0, 0, 0);
                return at.getHours() === localHour;
            });
        const midnight = utcHourFor(0);
        const noon = utcHourFor(12);
        if (midnight !== undefined) expect(formatPeakHour(midnight, now)).toBe("12 AM");
        if (noon !== undefined) expect(formatPeakHour(noon, now)).toBe("12 PM");
    });
});
