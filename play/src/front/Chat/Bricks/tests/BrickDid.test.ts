import { get } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getBrickDid: vi.fn<(brickId: string, before?: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: orbit }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../i18n/i18n-svelte";
import { brickDidList, parseDidPage, sayRun } from "../BrickDid";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const NOW = new Date(2026, 10, 16, 12, 0).getTime();
const plain = (value: string) => value.replace(new RegExp("[\\u202f\\u00a0]", "g"), " ");

const run = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    runId: "r1",
    itemId: "i1",
    brickId: BRICK,
    words: "Morning briefing",
    kind: "schedule",
    dueAt: new Date(2026, 10, 16, 7, 30).toISOString(),
    finishedAt: new Date(2026, 10, 16, 7, 31).toISOString(),
    state: "done",
    outcome: "spoke",
    result: null,
    error: null,
    late: false,
    fresh: false,
    ...over,
});

describe("Everything Brick did (#2002)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    describe("reading a page", () => {
        it("reads the runs and the cursor, and drops what it cannot read", () => {
            const page = parseDidPage({
                runs: [
                    run(),
                    run({ runId: "r2", state: "failed", error: "The site did not answer" }),
                    { nope: 1 },
                    run({ runId: "", state: "done" }),
                    run({ runId: "r3", state: "weird" }),
                ],
                next: "2026-11-15T07:31:00.000Z|r2",
            });
            expect(page.runs.map((one) => one.runId)).toEqual(["r1", "r2"]);
            expect(page.runs[1]).toMatchObject({ state: "failed", result: "The site did not answer" });
            expect(page.next).toBe("2026-11-15T07:31:00.000Z|r2");
            expect(parseDidPage(null)).toEqual({ runs: [], next: null });
            expect(parseDidPage({ runs: "x" })).toEqual({ runs: [], next: null });
        });

        it("dates a run that has not ended by when it was due", () => {
            const page = parseDidPage({ runs: [run({ finishedAt: null, state: "claimed", outcome: null })] });
            expect(page.runs[0].at).toBe(new Date(2026, 10, 16, 7, 30).getTime());
        });
    });

    describe("what a run says", () => {
        const say = (over: Record<string, unknown>) => {
            const one = parseDidPage({ runs: [run(over)] }).runs[0];
            return plain(sayRun(one, NOW, get(LL), "en-US"));
        };

        it("says when it ran, then what came of it", () => {
            expect(say({ result: "Sent you the briefing" })).toBe("Today, 7:31 AM · Sent you the briefing");
            expect(say({ outcome: "spoke" })).toBe("Today, 7:31 AM · Told you");
            expect(say({ outcome: "quiet" })).toBe("Today, 7:31 AM · Nothing to report");
            expect(say({ outcome: "waiting" })).toBe("Today, 7:31 AM · Needed something from you");
            expect(say({ outcome: null })).toBe("Today, 7:31 AM · Nothing to report");
        });

        it("says a failed run first, with why when Orbit says", () => {
            expect(say({ state: "failed", error: "The site did not answer" })).toBe(
                "Today, 7:31 AM · Didn't work: The site did not answer"
            );
            expect(say({ state: "failed", error: null })).toBe("Today, 7:31 AM · Didn't work");
        });

        it("says a run that is going or was skipped", () => {
            expect(say({ state: "claimed", finishedAt: null, outcome: null })).toBe("Today, 7:30 AM · Running now");
            expect(say({ state: "dropped", outcome: null })).toBe("Today, 7:31 AM · Skipped");
            expect(say({ state: "dropped", outcome: null, result: "Paused before it ran" })).toBe(
                "Today, 7:31 AM · Paused before it ran"
            );
        });
    });

    describe("the list for one Brick", () => {
        it("reads the newest page, and says so when it cannot", async () => {
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run()], next: null });
            const list = brickDidList(BRICK);
            expect(get(list.state)).toBe("loading");
            await list.load();
            expect(orbit.getBrickDid).toHaveBeenCalledWith(BRICK);
            expect(get(list.state)).toBe("ready");
            expect(get(list.runs)).toHaveLength(1);
            expect(get(list.more)).toBe(false);

            const failing = brickDidList(BRICK);
            orbit.getBrickDid.mockRejectedValueOnce(new Error("offline"));
            await failing.load();
            expect(get(failing.state)).toBe("failed");
            expect(get(failing.runs)).toEqual([]);
        });

        it("adds the next page after the last one, without a run twice", async () => {
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run({ runId: "r1" })], next: "cursor-1" });
            const list = brickDidList(BRICK);
            await list.load();
            expect(get(list.more)).toBe(true);
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run({ runId: "r1" }), run({ runId: "r0" })], next: null });
            expect(await list.loadMore()).toBe(true);
            expect(orbit.getBrickDid).toHaveBeenLastCalledWith(BRICK, "cursor-1");
            expect(get(list.runs).map((one) => one.runId)).toEqual(["r1", "r0"]);
            expect(get(list.more)).toBe(false);
            // Nothing more to ask for: no read
            orbit.getBrickDid.mockClear();
            expect(await list.loadMore()).toBe(true);
            expect(orbit.getBrickDid).not.toHaveBeenCalled();
        });

        it("keeps what shows, and says so, when the next page cannot be read", async () => {
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run()], next: "cursor-1" });
            const list = brickDidList(BRICK);
            await list.load();
            orbit.getBrickDid.mockRejectedValueOnce(new Error("offline"));
            expect(await list.loadMore()).toBe(false);
            expect(get(list.runs)).toHaveLength(1);
            expect(get(list.more)).toBe(true);
            expect(get(list.loadingMore)).toBe(false);
        });

        it("keeps a list it shows while it is read again, and a late next page never covers the new first page", async () => {
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run({ runId: "r1" })], next: "cursor-1" });
            const list = brickDidList(BRICK);
            await list.load();
            let finishOld: (value: unknown) => void = () => undefined;
            orbit.getBrickDid.mockReturnValueOnce(
                new Promise((resolve) => {
                    finishOld = resolve;
                })
            );
            const old = list.loadMore();
            orbit.getBrickDid.mockResolvedValueOnce({ runs: [run({ runId: "n1" })], next: null });
            await list.load();
            expect(get(list.state)).toBe("ready");
            expect(get(list.runs).map((one) => one.runId)).toEqual(["n1"]);
            finishOld({ runs: [run({ runId: "old" })], next: null });
            await old;
            expect(get(list.runs).map((one) => one.runId)).toEqual(["n1"]);
        });
    });
});
