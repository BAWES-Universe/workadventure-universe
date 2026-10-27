import { describe, expect, it } from "vitest";
import { lastNotifiedLabel, QUIET_HOURS_CHOICES, quietHoursLabel, quietHoursValue } from "../PushSettings";

describe("quiet hours", () => {
    it("names a choice by its times, or off", () => {
        expect(quietHoursValue(null)).toBe("off");
        expect(quietHoursValue({ start: "22:00", end: "07:00", timeZone: "Asia/Kuwait" })).toBe("22:00-07:00");
    });

    it("shows the times in the player's language", () => {
        expect(quietHoursLabel("22:00", "07:00", "en-US")).toBe("10:00 PM – 7:00 AM");
        expect(quietHoursLabel("00:00", "08:00", "fr-FR")).toBe("00:00 – 08:00");
    });

    it("offers nights that end in the morning", () => {
        for (const choice of QUIET_HOURS_CHOICES) {
            expect(choice.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
            expect(choice.end).toMatch(/^0[6-9]:00$/);
        }
    });
});

describe("when a device last got a notification", () => {
    const now = Date.parse("2026-10-25T20:00:00Z");
    const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

    it.each([
        [10, "now"],
        [5 * 60, "5 minutes ago"],
        [2 * 3600, "2 hours ago"],
        [26 * 3600, "yesterday"],
        [3 * 86400, "3 days ago"],
    ])("%i seconds ago reads %s", (seconds, label) => {
        expect(lastNotifiedLabel(ago(seconds), now, "en-US")).toBe(label);
    });
});
