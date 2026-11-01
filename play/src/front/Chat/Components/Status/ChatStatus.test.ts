import { AvailabilityStatus } from "@workadventure/messages";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../../i18n/i18n-util";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { lastSeenDay } from "../UserList/Friends";
import { OFFLINE_GREY, statusDotColour, statusWords } from "./ChatStatus";

// 1 Nov 2026, 15:00 in whatever zone the tests run in.
const NOW = new Date(2026, 10, 1, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 3) => new Date(2026, 10, 1 - daysAgo, hour, 0, 0).toISOString();

describe("status of a direct chat (#1731)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    const LL = () => i18nObject("en-US");

    describe("lastSeenDay", () => {
        it("counts calendar days, not hours", () => {
            expect(lastSeenDay(at(0, 1), NOW, "en-US")).toBe("today");
            // 14 hours ago, but yesterday.
            expect(lastSeenDay(new Date(2026, 9, 31, 23, 59).toISOString(), NOW, "en-US")).toBe("yesterday");
            expect(lastSeenDay(at(3), NOW, "en-US")).toBe("3 days ago");
        });

        it("rolls over to months and years, and never says tomorrow", () => {
            expect(lastSeenDay(at(60), NOW, "en-US")).toBe("2 months ago");
            expect(lastSeenDay(at(800), NOW, "en-US")).toBe("2 years ago");
            expect(lastSeenDay(new Date(NOW + 3 * 3_600_000 * 24).toISOString(), NOW, "en-US")).toBe("today");
        });

        it("says nothing for a missing or unreadable date", () => {
            expect(lastSeenDay(undefined, NOW, "en-US")).toBe("");
            expect(lastSeenDay("not a date", NOW, "en-US")).toBe("");
        });
    });

    describe("the dot", () => {
        it("gives every person exactly one colour, grey when offline", () => {
            expect(statusDotColour({ kind: "person", place: { kind: "offline" } }, LL())).toBe(OFFLINE_GREY);
            expect(statusDotColour({ kind: "person", place: { kind: "here" } }, LL())).toBe("#68e97a");
            expect(statusDotColour({ kind: "person", place: { kind: "chatOnly" } }, LL())).toBe("#68e97a");
            expect(statusDotColour({ kind: "person", place: { kind: "talking" } }, LL())).toBe("#4156f6");
        });

        it("colours away and busy people as People does", () => {
            const away = { kind: "away", status: AvailabilityStatus.AWAY, sameMap: true } as const;
            const dnd = { kind: "busy", status: AvailabilityStatus.DO_NOT_DISTURB, sameMap: true } as const;
            expect(statusDotColour({ kind: "person", place: away }, LL())).toBe("#e9c84e");
            expect(statusDotColour({ kind: "person", place: dnd }, LL())).toBe("#e96e53");
        });

        it("colours a resting bot like an away person, and shows none until the bot server has answered", () => {
            expect(statusDotColour({ kind: "bot", state: "resting" }, LL())).toBe("#e9c84e");
            expect(statusDotColour({ kind: "bot", state: "online" }, LL())).toBe("#68e97a");
            expect(statusDotColour({ kind: "bot", state: "unready" }, LL())).toBe("#ffffff");
            expect(statusDotColour({ kind: "bot", state: undefined }, LL())).toBeUndefined();
        });
    });

    describe("the words", () => {
        it("says when an offline friend who shares their room was last seen", () => {
            const place = { kind: "offline" } as const;
            expect(statusWords({ kind: "person", place, lastSeenAt: at(0, 1) }, LL(), "en-US", NOW)).toBe(
                "Last seen today"
            );
            expect(statusWords({ kind: "person", place, lastSeenAt: at(3) }, LL(), "en-US", NOW)).toBe(
                "Last seen 3 days ago"
            );
        });

        it("says Offline without a last seen (not a friend, or a friend who shares their room with no one)", () => {
            expect(statusWords({ kind: "person", place: { kind: "offline" } }, LL(), "en-US", NOW)).toBe("Offline");
        });

        it("ignores last seen for someone online", () => {
            expect(
                statusWords(
                    { kind: "person", place: { kind: "elsewhere", roomName: "Cafe" }, lastSeenAt: at(3) },
                    LL(),
                    "en-US",
                    NOW
                )
            ).toBe("Online · Cafe");
        });

        it("says a bot's state in plain words", () => {
            expect(statusWords({ kind: "bot", state: "resting" }, LL(), "en-US", NOW)).toBe("Resting");
            expect(statusWords({ kind: "bot", state: undefined }, LL(), "en-US", NOW)).toBeUndefined();
        });
    });
});
