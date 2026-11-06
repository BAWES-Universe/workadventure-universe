import { describe, expect, it } from "vitest";
import { RUN_GAP_MS, dayLabel, messageRuns, runSenderKey } from "../MessageRuns";
import type { RunItem } from "../MessageRuns";

const at = (hours: number, minutes: number, day = 17) => new Date(2026, 9, day, hours, minutes);
const msg = (
    id: string,
    senderKey: string | undefined,
    date: Date | null,
    isReply = false,
    spoken = false
): RunItem => ({
    id,
    senderKey,
    date,
    isReply,
    spoken,
});

describe("messageRuns", () => {
    it("starts a new run for a line said out loud, so its mic mark beside the time is always there", () => {
        const runs = messageRuns([
            msg("a", "me", at(19, 26)),
            msg("b", "me", at(19, 27), false, true),
            msg("c", "me", at(19, 28)),
        ]);
        expect([...runs.values()].map((place) => place.runStart)).toEqual([true, true, false]);
    });

    it("keeps one person's messages a few minutes apart in one run", () => {
        const runs = messageRuns([msg("a", "me", at(19, 26)), msg("b", "me", at(19, 26)), msg("c", "me", at(19, 32))]);
        expect([...runs.values()].map((place) => place.runStart)).toEqual([true, false, false]);
    });

    it("starts a new run when someone else writes", () => {
        const runs = messageRuns([
            msg("a", "linear", at(19, 25)),
            msg("b", "me", at(19, 26)),
            msg("c", "linear", at(19, 26)),
        ]);
        expect([...runs.values()].map((place) => place.runStart)).toEqual([true, true, true]);
    });

    it("starts a new run after the gap, even from the same person", () => {
        const start = at(19, 26);
        const runs = messageRuns([
            msg("a", "me", start),
            msg("b", "me", new Date(start.getTime() + RUN_GAP_MS - 1)),
            msg("c", "me", new Date(start.getTime() + 2 * RUN_GAP_MS)),
        ]);
        expect(runs.get("b")?.runStart).toBe(false);
        expect(runs.get("c")?.runStart).toBe(true);
    });

    it("starts a new run on a reply and after a notice", () => {
        const runs = messageRuns([
            msg("a", "me", at(19, 40)),
            msg("b", "me", at(19, 41), true),
            msg("joined", undefined, at(19, 41)),
            msg("c", "me", at(19, 41)),
        ]);
        expect(runs.get("b")?.runStart).toBe(true);
        expect(runs.get("c")?.runStart).toBe(true);
    });

    it("marks the first item of each day, and a new day starts a run", () => {
        const runs = messageRuns([
            msg("a", "me", at(23, 58, 16)),
            msg("b", "me", at(23, 59, 16)),
            msg("c", "me", at(0, 1, 17)),
        ]);
        expect([...runs.values()].map((place) => place.dayStart)).toEqual([true, false, true]);
        expect(runs.get("c")?.runStart).toBe(true);
    });
});

describe("runSenderKey", () => {
    it("tells apart two scripted authors that share the placeholder chat id", () => {
        expect(runSenderKey({ chatId: "0", username: "Test machine" })).not.toBe(
            runSenderKey({ chatId: "0", username: "Eve" })
        );
        expect(runSenderKey({ chatId: "@sara:chat", username: "Sara" })).toBe(
            runSenderKey({ chatId: "@sara:chat", username: "Sara" })
        );
    });

    it("never merges messages whose writer isn't loaded yet", () => {
        expect(runSenderKey(undefined)).toBeUndefined();
        const runs = messageRuns([
            msg("a", runSenderKey(undefined), at(10, 0)),
            msg("b", runSenderKey(undefined), at(10, 1)),
        ]);
        expect(runs.get("b")?.runStart).toBe(true);
    });
});

describe("dayLabel", () => {
    const now = at(20, 0);
    it("says Today and Yesterday", () => {
        expect(dayLabel(at(9, 0), "en-US", now)).toBe("Today");
        expect(dayLabel(at(22, 5, 16), "en-US", now)).toBe("Yesterday");
    });

    it("shows the date before that, with the year only when it is another year", () => {
        expect(dayLabel(at(10, 0, 10), "en-US", now)).toBe("Sat, Oct 10");
        expect(dayLabel(new Date(2025, 11, 31), "en-US", now)).toBe("Wed, Dec 31, 2025");
    });
});
