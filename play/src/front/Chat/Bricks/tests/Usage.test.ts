import { describe, expect, it } from "vitest";
import { fullAgainWhen, parseUsage, storageSize } from "../Usage";

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
            chat: { left: 0.6, words: "plenty", fullAgainAt: "2026-11-12T17:40:00.000Z" },
            computer: null,
            storageBytes: null,
            extraUntil: null,
        });
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
