import { AvailabilityStatus } from "@workadventure/messages";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../../i18n/i18n-util";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { lastSeenDay } from "../UserList/Friends";
import { partnerStatus } from "../Room/DirectChat/PartnerStatus";
import { OFFLINE_GREY, profileStatusLine, statusDotColour, statusWords } from "./ChatStatus";

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

    describe("the Profile's status line", () => {
        it("says Online for a Brick the header calls Online (it has no avatar and no chat presence)", () => {
            // What the Profile read before: a Brick is nowhere in the world and publishes no presence, so it was "offline".
            expect(partnerStatus({ kind: "offline" }, LL()).label).toBe("Offline");
            const facts = { kind: "bot", state: "online" } as const;
            const line = profileStatusLine(facts, LL());
            expect(line.label).toBe("Online");
            expect(line.label).toBe(statusWords(facts, LL(), "en-US", NOW));
            expect(line.color).toBe(statusDotColour(facts, LL()));
        });

        it("matches the header for every state a bot can be in", () => {
            for (const state of ["online", "resting", "unready", "gone"] as const) {
                const facts = { kind: "bot", state } as const;
                expect(profileStatusLine(facts, LL())).toEqual({
                    label: statusWords(facts, LL(), "en-US", NOW),
                    color: statusDotColour(facts, LL()),
                });
            }
        });

        it("shows no line, and no dot, until the bot server has answered", () => {
            expect(profileStatusLine({ kind: "bot", state: undefined }, LL())).toEqual({
                label: undefined,
                color: undefined,
            });
        });

        it("stays quiet in words where the header does, with the dot as the header has it", () => {
            // Someone with no access to the bot: the header shows no words, but keeps the bot server's dot.
            expect(profileStatusLine({ kind: "bot", state: "online" }, LL(), { words: undefined })).toEqual({
                label: undefined,
                color: "#68e97a",
            });
        });

        it("leaves a person's line as it was", () => {
            const place = { kind: "here", roomName: "Cafe" } as const;
            expect(profileStatusLine({ kind: "person", place }, LL())).toEqual(partnerStatus(place, LL()));
            expect(profileStatusLine({ kind: "person", place: { kind: "offline" } }, LL()).label).toBe("Offline");
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
