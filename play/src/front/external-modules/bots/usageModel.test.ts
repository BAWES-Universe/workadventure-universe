import { describe, expect, it } from "vitest";
import {
    barPath,
    chartBars,
    chartSwitchBar,
    CHART,
    dollars,
    niceMax,
    readBotUsage,
    whenLabel,
    whereKind,
} from "./usageModel";

describe("a bot's usage as the page reads it (Orbit #491)", () => {
    it("reads Orbit's answer and treats anything missing as nothing", () => {
        const usage = readBotUsage({
            range: "30d",
            days: ["2026-10-26", "2026-10-27"],
            hasUsage: true,
            viewerIsMaker: true,
            totals: { replies: 12, people: 2, tokens: 3400 },
            people: [
                { id: "u1", name: "Sara", replies: 9, dm: 4, nearby: 5, lastAt: "2026-10-27T10:00:00Z" },
                { name: "no id" },
            ],
            ranOn: [{ kind: "own-key", name: "My DeepSeek", replies: 3, tokens: 100, costMicros: 1200 }, { kind: "?" }],
            keyProblem: { name: "My DeepSeek", downSince: "2026-10-27T09:00:00Z", meanwhile: "stopped" },
            limits: { botLimit: 40, ranOut: { universeAi: 2 } },
        });
        expect(usage.range).toBe("30d");
        expect(usage.people).toHaveLength(1);
        expect(usage.people[0]).toMatchObject({ id: "u1", name: "Sara", dm: 4, nearby: 5, notSplit: 0 });
        expect(usage.ranOn.map((line) => line.kind)).toEqual(["own-key", "universe-ai"]);
        expect(usage.ranOn[1].costMicros).toBeNull();
        expect(usage.keyProblem?.meanwhile).toBe("stopped");
        expect(usage.limits).toMatchObject({ botLimit: 40, ranOut: { universeAi: 2, botLimit: 0 }, askedMaker: 0 });
        expect(usage.guests).toEqual({ count: 0, replies: 0, dm: 0, nearby: 0, notSplit: 0 });
    });

    it("refuses an answer it does not understand", () => {
        expect(() => readBotUsage({ error: "nope" })).toThrow();
        expect(() => readBotUsage(null)).toThrow();
    });

    it("never shows less than a cent once anything was spent", () => {
        expect(dollars(0, "en-US")).toBe("$0.00");
        expect(dollars(40, "en-US")).toBe("$0.01");
        expect(dollars(1_234_567, "en-US")).toBe("$1.23");
    });

    it("says today with the time, then yesterday, then a weekday or a date", () => {
        const now = new Date(2026, 9, 27, 18, 0);
        expect(whenLabel(new Date(2026, 9, 27, 9, 5).toISOString(), "en-US", now).kind).toBe("today");
        expect(whenLabel(new Date(2026, 9, 26, 23, 0).toISOString(), "en-US", now).kind).toBe("yesterday");
        expect(whenLabel(new Date(2026, 9, 23, 12, 0).toISOString(), "en-US", now)).toEqual({
            kind: "other",
            text: "Fri",
        });
        expect(whenLabel(new Date(2026, 8, 30, 12, 0).toISOString(), "en-US", now).text).toBe("Sep 30");
        expect(whenLabel("not a date", "en-US", now)).toEqual({ kind: "other", text: "" });
    });

    it("names where someone chatted", () => {
        expect(whereKind({ dm: 1, nearby: 1, notSplit: 0 })).toBe("both");
        expect(whereKind({ dm: 1, nearby: 0, notSplit: 0 })).toBe("dm");
        expect(whereKind({ dm: 0, nearby: 2, notSplit: 0 })).toBe("nearby");
        expect(whereKind({ dm: 0, nearby: 0, notSplit: 3 })).toBe("notSplit");
    });

    it("rounds the chart's top", () => {
        expect(niceMax(0)).toBe(2);
        expect(niceMax(7)).toBe(8);
        expect(niceMax(63)).toBe(70);
        expect(niceMax(340)).toBe(400);
        // Its middle line is always a whole number of replies
        for (let value = 0; value <= 2000; value++) expect(Number.isInteger(niceMax(value) / 2)).toBe(true);
    });

    it("stacks direct messages under nearby chat, rounding only the top", () => {
        const { bars, max } = chartBars([
            { day: "2026-10-26", dm: 0, nearby: 0, notSplit: 0 },
            { day: "2026-10-27", dm: 4, nearby: 3, notSplit: 1 },
        ]);
        expect(max).toBe(8);
        expect(bars[0].parts).toEqual([]);
        expect(bars[1].parts.map((part) => [part.kind, part.top])).toEqual([
            ["dm", false],
            ["nearby", false],
            ["notSplit", true],
        ]);
        expect(bars[1].parts[0].y + bars[1].parts[0].height).toBe(CHART.bottom);
        expect(bars[1].parts[2].y).toBeCloseTo(CHART.top);
        expect(barPath(0, 10, 10, 20, false)).toBe("M0,30 V10 H10 V30 Z");
        expect(barPath(0, 10, 10, 20, true)).toContain("Q");
    });

    it("marks the day the bot moved to what it runs on now, never the range's last day", () => {
        const perDay = ["2026-10-25", "2026-10-26", "2026-10-27"].map((day) => ({
            day,
            dm: 1,
            nearby: 0,
            notSplit: 0,
        }));
        const { bars } = chartBars(perDay);
        const usage = (firstAt: string) =>
            readBotUsage({
                days: perDay.map((d) => d.day),
                totals: {},
                ranOn: [
                    { kind: "own-key", firstAt: "x" },
                    { kind: "universe-ai", firstAt },
                ],
            });
        expect(chartSwitchBar(usage(new Date(2026, 9, 26, 21, 14).toISOString()), bars)?.day).toBe("2026-10-26");
        expect(chartSwitchBar(usage(new Date(2026, 9, 27, 9, 0).toISOString()), bars)).toBeUndefined();
        expect(
            chartSwitchBar(readBotUsage({ days: [], totals: {}, ranOn: [{ kind: "universe-ai" }] }), bars)
        ).toBeUndefined();
    });
});
