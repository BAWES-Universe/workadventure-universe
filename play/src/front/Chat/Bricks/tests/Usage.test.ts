import { describe, expect, it } from "vitest";
import {
    availableText,
    fullAgainWhen,
    moneyLeft,
    moneyUsedUp,
    parseUsage,
    renewsWhen,
    spentText,
    storageSize,
} from "../Usage";

const answer = (over: Record<string, unknown> = {}) => ({
    chat: { left: 0.6, words: "plenty", fullAgainAt: "2026-11-12T17:40:00.000Z" },
    computer: null,
    storage: null,
    extra: null,
    ...over,
});

describe("a person's usage as Orbit sends it (#1999)", () => {
    it("reads the Universe AI bar, with nothing else for someone whose Brick uses no computer", () => {
        expect(parseUsage(answer())).toEqual({
            version: null,
            chat: {
                left: 0.6,
                words: "plenty",
                fullAgainAt: "2026-11-12T17:40:00.000Z",
                replies: null,
                extra: null,
                unavailable: false,
            },
            apps: null,
            computer: null,
            speech: null,
            appUse: null,
            credit: [],
            bots: [],
            activity: [],
            storageBytes: null,
            storagePaidByUniverse: false,
            extraUntil: null,
        });
    });

    it("reads their own voice time and App use as plain words, with when they start again and whether they can ask for more", () => {
        const usage = parseUsage(
            answer({
                speech: {
                    scope: "speech",
                    left: 0,
                    words: "out",
                    startsAgainAt: "2026-12-01T00:00:00.000Z",
                    asked: false,
                    canAskForMore: true,
                    extra: null,
                },
                appUse: {
                    scope: "apps",
                    left: 0.4,
                    words: "half",
                    startsAgainAt: "2026-12-01T00:00:00.000Z",
                    asked: true,
                    canAskForMore: false,
                    extra: null,
                },
            })
        );
        expect(usage?.speech).toEqual({
            left: 0,
            words: "out",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            asked: false,
            canAskForMore: true,
        });
        expect(usage?.appUse).toEqual({
            left: 0.4,
            words: "half",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            asked: true,
            canAskForMore: false,
        });
    });

    it("shows nothing for an allowance Orbit does not send or sends without a day it starts again", () => {
        expect(parseUsage(answer({ speech: null }))?.speech).toBeNull();
        expect(parseUsage(answer({ speech: { left: 0.5, words: "half" } }))?.speech).toBeNull();
        expect(parseUsage(answer({ appUse: "no" }))?.appUse).toBeNull();
    });

    it("reads computer time, what the Bricks keep and the day extra usage ends", () => {
        const usage = parseUsage(
            answer({
                computer: {
                    left: 0,
                    words: "out",
                    startsAgainAt: "2026-12-01T00:00:00.000Z",
                    unlimited: false,
                    asked: false,
                    canAskForMore: true,
                },
                storage: { bytes: 1_400_000_000 },
                extra: { until: "2026-11-30T00:00:00.000Z" },
            })
        );
        expect(usage?.computer).toEqual({
            left: 0,
            words: "out",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            asked: false,
            canAskForMore: true,
            money: null,
        });
        expect(usage?.storageBytes).toBe(1_400_000_000);
        expect(usage?.extraUntil).toBe("2026-11-30T00:00:00.000Z");
    });

    it("keeps a bar between empty and full, and leaves out what it can't read", () => {
        expect(parseUsage(answer({ chat: { left: 3, words: "plenty", fullAgainAt: null } }))?.chat.left).toBe(1);
        expect(parseUsage(answer({ computer: { left: 0.5, words: "half" } }))?.computer).toBeNull();
        expect(parseUsage(answer({ storage: { bytes: -4 } }))?.storageBytes).toBeNull();
        expect(parseUsage(answer({ extra: { until: "soon" } }))?.extraUntil).toBeNull();
    });

    it("is nothing when the answer is not a usage", () => {
        expect(parseUsage(null)).toBeUndefined();
        expect(parseUsage({ error: "Unauthorized" })).toBeUndefined();
        expect(parseUsage(answer({ chat: { left: 0.5, words: "lots" } }))).toBeUndefined();
    });
});

const real = (over: Record<string, unknown> = {}) =>
    answer({
        version: 1731645600000,
        chat: {
            left: 0.6,
            words: "plenty",
            fullAgainAt: "2026-11-12T20:40:00.000Z",
            replies: { available: 18, total: 30, inProgress: 2, running: true, windowHours: 5 },
        },
        apps: {
            kind: "monthly",
            availableMicros: 3_200_000,
            totalMicros: 5_000_000,
            renewsAt: "2026-12-01T00:00:00.000Z",
            canAskForMore: false,
        },
        ...over,
    });

describe("real numbers (credits and grants)", () => {
    it("reads replies as Orbit counted them, and Instant Apps in dollars", () => {
        const usage = parseUsage(real());
        expect(usage?.version).toBe(1731645600000);
        expect(usage?.chat.replies).toEqual({ available: 18, total: 30, inProgress: 2, running: true, windowHours: 5 });
        expect(usage?.chat.left).toBeCloseTo(0.6);
        expect(usage?.apps).toEqual({
            kind: "monthly",
            availableMicros: 3_200_000,
            totalMicros: 5_000_000,
            inProgressMicros: 0,
            renewsAt: "2026-12-01T00:00:00.000Z",
            asked: false,
            canAskForMore: false,
            unavailable: false,
        });
    });

    it("never reads more replies available than there are", () => {
        const usage = parseUsage(
            real({ chat: { replies: { available: 50, total: 30, inProgress: 0, running: true } } })
        );
        expect(usage?.chat.replies?.available).toBe(30);
        expect(usage?.chat.left).toBe(1);
    });

    it("reads a bar from the counts alone, and a balance that could not be read", () => {
        expect(parseUsage(real({ chat: { replies: { available: 0, total: 30, running: true } } }))?.chat.words).toBe(
            "out"
        );
        const unread = parseUsage(real({ chat: { unavailable: true }, apps: { unavailable: true } }));
        expect(unread?.chat.unavailable).toBe(true);
        expect(unread?.apps?.unavailable).toBe(true);
    });

    it("reads an extra that lifts the limit, as a multiple or as no personal limit", () => {
        const twice = { multiplier: 2, until: "2026-12-31T00:00:00.000Z" };
        expect(
            parseUsage(real({ chat: { replies: { available: 48, total: 60, running: true }, extra: twice } }))?.chat
                .extra
        ).toEqual({
            multiplier: 2,
            noLimit: false,
            until: "2026-12-31T00:00:00.000Z",
        });
        const none = parseUsage(
            real({ chat: { replies: { available: 0, total: 0, running: false }, extra: { noLimit: true } } })
        );
        expect(none?.chat.extra).toEqual({ multiplier: null, noLimit: true, until: null });
        // 1x or less is no extra
        expect(
            parseUsage(real({ chat: { replies: { available: 1, total: 2, running: true }, extra: { multiplier: 1 } } }))
                ?.chat.extra
        ).toBeNull();
    });

    it("reads computer time in dollars beside the old bar, and leaves out what it can't read", () => {
        const money = {
            left: 0.4,
            words: "half",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            kind: "oneoff",
            availableMicros: 800_000,
            totalMicros: 2_000_000,
        };
        const computer = parseUsage(real({ computer: money }))?.computer;
        expect(computer?.money).toMatchObject({ kind: "oneoff", availableMicros: 800_000, totalMicros: 2_000_000 });
        expect(computer?.left).toBeCloseTo(0.4);
        expect(parseUsage(real({ apps: { kind: "oneoff", availableMicros: "lots" } }))?.apps).toBeNull();
        expect(parseUsage(real({ apps: { availableMicros: -1, totalMicros: 5 } }))?.apps).toBeNull();
    });

    it("keeps the Computers section when only its balance could not be read", () => {
        const computer = parseUsage(real({ computer: { unavailable: true } }))?.computer;
        expect(computer?.money?.unavailable).toBe(true);
        // Nothing else is sent and nothing is made up
        expect(parseUsage(real({ computer: { left: 0.5, words: "half" } }))?.computer).toBeNull();
    });

    it("reads extra credit, what each Brick spent and the tasks, leaving out only the lines it can't read", () => {
        const usage = parseUsage(
            real({
                credit: [
                    {
                        covers: ["apps", "computer"],
                        availableMicros: 3_100_000,
                        totalMicros: 5_000_000,
                        until: "2026-12-31T00:00:00.000Z",
                    },
                    { covers: ["nothing"], availableMicros: 1, totalMicros: 1 },
                ],
                bots: [
                    { id: "11", name: "Brick", spentMicros: 1_390_000, uses: ["apps", "computer", "apps", "x"] },
                    { name: "no id", spentMicros: 5 },
                ],
                activity: [
                    {
                        id: "act_1",
                        title: "Welcome video",
                        at: "2026-11-15T11:16:00.000Z",
                        state: "refunded",
                        spentMicros: null,
                        category: "apps",
                        payer: "sponsor",
                        payerName: "BAWES Universe",
                        lines: [
                            { label: "Instant video", amountMicros: 0 },
                            { label: "", note: "x" },
                        ],
                    },
                    { id: "bad id!", title: "x", at: "2026-11-15T11:16:00.000Z" },
                    { id: "act_2", title: "No time", at: "soon" },
                ],
                storage: { bytes: 1_200_000_000, payer: "universe" },
            })
        );
        expect(usage?.credit).toEqual([
            {
                covers: ["apps", "computer"],
                availableMicros: 3_100_000,
                totalMicros: 5_000_000,
                until: "2026-12-31T00:00:00.000Z",
                fromName: null,
            },
        ]);
        expect(usage?.bots).toEqual([{ id: "11", name: "Brick", spentMicros: 1_390_000, uses: ["apps", "computer"] }]);
        expect(usage?.activity).toHaveLength(1);
        expect(usage?.activity[0]).toMatchObject({
            id: "act_1",
            state: "refunded",
            payer: "sponsor",
            payerName: "BAWES Universe",
            category: "apps",
            lines: [{ label: "Instant video", amountMicros: 0, note: null }],
        });
        expect(usage?.storagePaidByUniverse).toBe(true);
    });

    it("reads at most fifty tasks", () => {
        const many = Array.from({ length: 80 }, (_, i) => ({
            id: `a${i}`,
            title: `Task ${i}`,
            at: "2026-11-15T11:16:00.000Z",
        }));
        expect(parseUsage(real({ activity: many }))?.activity).toHaveLength(50);
    });
});

describe("dollars", () => {
    it("cuts what is available down to the cent, so it never claims more than the server will admit", () => {
        expect(availableText(3_209_999, "en-US")).toBe("$3.20");
        expect(availableText(2_000_000, "en-US")).toBe("$2");
        expect(availableText(9_999, "en-US")).toBe("$0");
        expect(availableText(-5, "en-US")).toBe("$0");
    });
    it("rounds what was taken up to the cent, so it never understates", () => {
        expect(spentText(60_000, "en-US")).toBe("$0.06");
        expect(spentText(920_001, "en-US")).toBe("$0.93");
        expect(spentText(1, "en-US")).toBe("$0.01");
        expect(spentText(0, "en-US")).toBe("$0");
    });
    it("is used up below a cent, and the bar counts whole cents", () => {
        expect(moneyUsedUp({ availableMicros: 9_999 })).toBe(true);
        expect(moneyUsedUp({ availableMicros: 10_000 })).toBe(false);
        expect(moneyLeft({ availableMicros: 3_200_000, totalMicros: 5_000_000 })).toBeCloseTo(0.64);
        expect(moneyLeft({ availableMicros: 9_000_000, totalMicros: 5_000_000 })).toBe(1);
        expect(moneyLeft({ availableMicros: 5, totalMicros: 0 })).toBe(0);
    });
    it("counts both sides of a small credit in the same whole cents, so the bar agrees with the words", () => {
        const line = (available: number, total: number) =>
            `${availableText(available, "en-US")} of ${availableText(total, "en-US")}`;
        // 1.5 cents of 1.5 cents is a full bar beside "$0.01 of $0.01", not a half-full one
        expect(line(15_000, 15_000)).toBe("$0.01 of $0.01");
        expect(moneyLeft({ availableMicros: 15_000, totalMicros: 15_000 })).toBe(1);
        expect(line(14_999, 15_000)).toBe("$0.01 of $0.01");
        expect(moneyLeft({ availableMicros: 14_999, totalMicros: 15_000 })).toBe(1);
        expect(line(0, 15_000)).toBe("$0 of $0.01");
        expect(moneyLeft({ availableMicros: 0, totalMicros: 15_000 })).toBe(0);
    });
    it("says when a monthly credit renews, in the viewer's own clock", () => {
        const renews = renewsWhen("2026-12-01T03:00:00", "en-US");
        expect(renews).toEqual({ day: "1 Dec", time: "3:00 AM" });
        expect(renewsWhen(null, "en-US")).toBeUndefined();
        expect(renewsWhen("nope", "en-US")).toBeUndefined();
    });
});

describe("when a bar is full again", () => {
    const now = new Date("2026-11-12T12:00:00");
    it("is the time today, and the day with it on any other day", () => {
        expect(fullAgainWhen("2026-11-12T20:40:00", "en-US", now)).toBe("8:40 PM");
        expect(fullAgainWhen("2026-11-13T01:10:00", "en-US", now)).toBe("13 Nov, 1:10 AM");
    });
    it("is empty with no time", () => {
        expect(fullAgainWhen(null, "en-US", now)).toBe("");
        expect(fullAgainWhen("nope", "en-US", now)).toBe("");
    });
});

describe("a size", () => {
    it("is in plain units", () => {
        expect(storageSize(0)).toBe("0 B");
        expect(storageSize(512)).toBe("512 B");
        expect(storageSize(230_000_000)).toBe("230 MB");
        expect(storageSize(1_400_000_000)).toBe("1.4 GB");
        expect(storageSize(2_000_000_000)).toBe("2 GB");
    });
});
