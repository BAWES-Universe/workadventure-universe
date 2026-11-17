import { get } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getBrickItems: vi.fn<(brickId: string) => Promise<unknown>>(),
    getAllBrickItems: vi.fn<() => Promise<unknown>>(),
    tapBrickItem: vi.fn<(brickId: string, itemId: string, action: string, key?: string) => Promise<unknown>>(),
    onIdentityChange: vi.fn<(listener: () => void) => () => void>(() => () => undefined),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: orbit }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../i18n/i18n-svelte";
import {
    allGoalsList,
    brickGoalsList,
    groupGoalItems,
    parseGoalItems,
    sayBrief,
    sayDone,
    saySnoozed,
    sayStatus,
    sayTapProblem,
    sayWhen,
    type GoalItem,
} from "../BrickGoals";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
// Sunday 15 Nov 2026, noon on the clock of whoever runs this
const NOW = new Date(2026, 10, 15, 12, 0).getTime();
// Clocks print a narrow no-break space before PM on newer engines
const plain = (value: string) => value.replace(new RegExp("[\\u202f\\u00a0]", "g"), " ");

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "i1",
    brickId: BRICK,
    kind: "reminder",
    words: "Pick up the car",
    condition: null,
    outcome: null,
    cadence: { type: "once", at: new Date(2026, 10, 15, 16, 0).toISOString() },
    timeZone: "Asia/Kuwait",
    nextDueAt: new Date(2026, 10, 15, 16, 0).toISOString(),
    waitingFor: null,
    statusLine: null,
    steps: [],
    state: "on",
    setBy: "you",
    parentId: null,
    result: null,
    doneAt: null,
    heldSince: null,
    asking: null,
    group: "scheduled",
    checks: [],
    ...over,
});
const item = (over: Record<string, unknown> = {}): GoalItem => parseGoalItems({ items: [row(over)] })[0];

describe("goals and tasks on a Brick's page (#2002)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    const ll = () => get(LL);

    describe("reading Orbit's list", () => {
        it("keeps whole rows, puts each in its part, and leaves out what is not whole or is only a goal's own check", () => {
            const items = parseGoalItems({
                items: [
                    row({ id: "a", kind: "goal", words: "Visa in hand", cadence: { type: "none" }, nextDueAt: null }),
                    row({ id: "b" }),
                    row({ id: "c", state: "done", doneAt: "2026-11-10T08:00:00.000Z", result: "visa saved" }),
                    row({ id: "", words: "no key" }),
                    row({ id: "d", words: "  " }),
                    row({ id: "e", kind: "secret" }),
                    row({ id: "f", state: "deleted" }),
                    row({ id: "g", parentId: "a" }),
                    row({ id: "b", words: "twice" }),
                    null,
                ],
            });
            expect(items.map((one) => [one.id, one.group])).toEqual([
                ["a", "progress"],
                ["b", "scheduled"],
                ["c", "done"],
            ]);
            expect(items[2]).toMatchObject({ doneAt: Date.parse("2026-11-10T08:00:00.000Z"), result: "visa saved" });
            expect(parseGoalItems(undefined)).toEqual([]);
            expect(parseGoalItems({ items: "x" })).toEqual([]);
        });

        it("reads steps, who set it, and the question a goal asks, and drops what it cannot read", () => {
            const goal = item({
                kind: "goal",
                steps: [
                    { text: "Filled in the form", state: "done" },
                    { text: "Checking every morning", state: "doing" },
                    { text: "", state: "todo" },
                    { text: "Odd", state: "weird" },
                ],
                setBy: "brick",
                asking: "unsure",
                cadence: { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6, 9] },
            });
            expect(goal.steps).toEqual([
                { text: "Filled in the form", state: "done" },
                { text: "Checking every morning", state: "doing" },
            ]);
            expect(goal.setBy).toBe("brick");
            expect(goal.asking).toBe("unsure");
            expect(goal.cadence).toEqual({ type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] });
            expect(item({ cadence: { type: "daily", time: "later", days: [1] } }).cadence).toEqual({ type: "none" });
            expect(item({ asking: "other" }).asking).toBeNull();
        });

        it("lists the checks a goal set for itself under Scheduled, by the Brick, and not the ones that are over", () => {
            const check = (over: Record<string, unknown>) =>
                row({
                    kind: "schedule",
                    cadence: { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] },
                    parentId: "g",
                    ...over,
                });
            const items = parseGoalItems({
                items: [
                    row({
                        id: "g",
                        kind: "goal",
                        words: "Visa in hand",
                        checks: [
                            check({ id: "k1", words: "Check my visa status" }),
                            check({ id: "k2", state: "done" }),
                            check({ id: "k3", kind: "goal" }),
                            check({ id: "k1", words: "again" }),
                        ],
                    }),
                ],
            });
            expect(items.map((one) => [one.id, one.group, one.setBy, one.goalId])).toEqual([
                ["g", "progress", "you", null],
                ["k1", "scheduled", "brick", "g"],
            ]);
        });

        it("lists none of the checks of a goal that is done, whatever state they say", () => {
            const items = parseGoalItems({
                items: [
                    row({
                        id: "g",
                        kind: "goal",
                        state: "done",
                        doneAt: "2026-11-12T10:00:00.000Z",
                        checks: [row({ id: "k", kind: "schedule", parentId: "g", state: "on" })],
                    }),
                ],
            });
            expect(items.map((one) => one.id)).toEqual(["g"]);
        });

        it("lists Scheduled with a goal's own checks first, then the soonest, and one with nothing due last", () => {
            const at = (hour: number) => new Date(2026, 10, 16, hour, 0).toISOString();
            const parts = groupGoalItems(
                parseGoalItems({
                    items: [
                        row({ id: "late", nextDueAt: at(18) }),
                        row({ id: "none", state: "paused", nextDueAt: null }),
                        row({ id: "soon", nextDueAt: at(7) }),
                        row({ id: "g", kind: "goal", checks: [row({ id: "k", kind: "schedule", nextDueAt: at(20) })] }),
                    ],
                })
            );
            expect(parts.scheduled.map((one) => one.id)).toEqual(["k", "soon", "late", "none"]);
        });

        it("lists done ones with the latest first", () => {
            const parts = groupGoalItems(
                parseGoalItems({
                    items: [
                        row({ id: "old", state: "done", doneAt: "2026-11-01T00:00:00.000Z" }),
                        row({ id: "new", state: "done", doneAt: "2026-11-09T00:00:00.000Z" }),
                    ],
                })
            );
            expect(parts.done.map((one) => one.id)).toEqual(["new", "old"]);
        });
    });

    describe("what a row says", () => {
        it("says a snoozed run and where the schedule goes on after it, and nothing when nothing is snoozed", () => {
            const hourly = { type: "every", minutes: 60 };
            const at = (hours: number, minutes: number) => new Date(2026, 10, 15, hours, minutes).toISOString();
            const snoozed = item({
                cadence: hourly,
                nextDueAt: at(12, 10),
                snoozedUntil: at(12, 10),
                nextRegularAt: at(13, 0),
            });
            expect(snoozed.snoozedUntil).toBe(Date.parse(at(12, 10)));
            expect(snoozed.nextRegularAt).toBe(Date.parse(at(13, 0)));
            expect(plain(saySnoozed(snoozed, NOW, ll(), "en-US"))).toBe(
                "Snoozed until today, 12:10 PM · Next regular run today, 1:00 PM"
            );
            // A one-off has no schedule after it: its row already says the new time
            expect(
                plain(
                    saySnoozed(
                        item({ nextDueAt: at(12, 10), snoozedUntil: at(12, 10), nextRegularAt: at(12, 10) }),
                        NOW,
                        ll(),
                        "en-US"
                    )
                )
            ).toBe("Snoozed until today, 12:10 PM");
            // Nothing snoozed: nothing said, and a row from an Orbit that does not send it reads as before
            expect(saySnoozed(item({ cadence: hourly }), NOW, ll(), "en-US")).toBe("");
            expect(item({ cadence: hourly, nextRegularAt: undefined }).nextRegularAt).toBe(
                item({ cadence: hourly }).nextDueAt
            );
        });

        it("says when it runs", () => {
            const when = (cadence: unknown) => plain(sayWhen(item({ cadence }), NOW, ll(), "en-US", "Asia/Kuwait"));
            expect(when({ type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] })).toBe("Daily, 8:00 AM");
            expect(when({ type: "daily", time: "07:30", days: [0, 1, 2, 3, 4] })).toBe("Sun to Thu, 7:30 AM");
            expect(when({ type: "daily", time: "17:00", days: [1, 3] })).toBe("Mon, Wed, 5:00 PM");
            expect(when({ type: "every", minutes: 360 })).toBe("Every 6 hours");
            expect(when({ type: "every", minutes: 60 })).toBe("Every 1 hour");
            expect(when({ type: "every", minutes: 30 })).toBe("Every 30 minutes");
            expect(when({ type: "once", at: new Date(2026, 10, 15, 16, 0).toISOString() })).toBe("Today, 4:00 PM");
            expect(when({ type: "once", at: new Date(2026, 10, 16, 8, 0).toISOString() })).toBe("Tomorrow, 8:00 AM");
            expect(when({ type: "once", at: new Date(2026, 10, 20, 8, 0).toISOString() })).toMatch(
                /^Fri 20 Nov, 8:00 AM$/
            );
        });

        it("names the clock of a daily time when it is not the viewer's own", () => {
            const daily = item({
                cadence: { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] },
                timeZone: "Asia/Kuwait",
            });
            const say = (viewer: string) => plain(sayWhen(daily, NOW, ll(), "en-US", viewer));
            expect(say("Asia/Kuwait")).toBe("Daily, 8:00 AM");
            expect(say("Europe/London")).toBe("Daily, 8:00 AM Kuwait");
            const utc = item({ cadence: { type: "daily", time: "08:00", days: [1, 2, 3] }, timeZone: "Etc/UTC" });
            expect(plain(sayWhen(utc, NOW, ll(), "en-US", "UTC"))).toBe("Mon to Wed, 8:00 AM");
            expect(plain(sayWhen(utc, NOW, ll(), "en-US", "America/New_York"))).toBe("Mon to Wed, 8:00 AM UTC");
            const unknown = item({ cadence: { type: "daily", time: "08:00", days: [1] }, timeZone: "Mars/Base" });
            expect(plain(sayWhen(unknown, NOW, ll(), "en-US", "Asia/Kuwait"))).toBe("Mon, 8:00 AM");
        });

        it("says how a goal stands in one line", () => {
            expect(sayStatus(item({ kind: "goal" }), ll())).toBe("On track · nothing needed from you");
            expect(sayStatus(item({ kind: "goal", statusLine: "Form sent, checking daily" }), ll())).toBe(
                "Form sent, checking daily"
            );
            expect(sayStatus(item({ kind: "goal", waitingFor: "your passport" }), ll())).toBe(
                "Waiting for your passport"
            );
            expect(sayStatus(item({ kind: "goal", state: "paused", statusLine: "x" }), ll())).toBe("Paused");
            expect(sayStatus(item({ kind: "goal", heldSince: "2026-11-14T00:00:00.000Z" }), ll())).toBe(
                "Waiting until your usage for goals and tasks comes back"
            );
        });

        it("says when a done one was done, and its result", () => {
            expect(
                sayDone(
                    item({ state: "done", doneAt: new Date(2026, 10, 10, 12, 0).toISOString(), result: "visa saved" }),
                    ll(),
                    "en-US"
                )
            ).toBe("Done 10 Nov · visa saved");
            expect(sayDone(item({ state: "done" }), ll(), "en-US")).toBe("Done");
        });

        it("says what is going on under the group's title", () => {
            const brief = (rows: Record<string, unknown>[]) =>
                plain(sayBrief(parseGoalItems({ items: rows }), NOW, ll(), "en-US"));
            expect(brief([])).toBe("Optional · nothing set yet");
            // A goal's own checks are not counted as scheduled on top of it
            expect(
                brief([
                    row({ id: "g", kind: "goal", cadence: { type: "none" }, nextDueAt: null }),
                    row({ id: "k", kind: "schedule", goalId: "g" }),
                ])
            ).toBe("1 goal");
            expect(
                brief([
                    row({
                        id: "g",
                        kind: "goal",
                        cadence: { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] },
                        nextDueAt: new Date(2026, 10, 16, 8, 0).toISOString(),
                    }),
                ])
            ).toBe("1 goal · next check tomorrow, 8:00 AM");
            expect(
                brief([
                    row({ id: "a" }),
                    row({ id: "b", kind: "schedule" }),
                    row({ id: "c", kind: "goal", state: "done" }),
                ])
            ).toBe("2 scheduled · 1 goal done");
            expect(
                brief([
                    row({ id: "a" }),
                    row({ id: "c", state: "done" }),
                    row({ id: "d", kind: "goal", state: "done" }),
                ])
            ).toBe("1 scheduled · 2 done");
        });
    });

    describe("the list for one Brick", () => {
        it("reads what Orbit says, and says so when it cannot", async () => {
            orbit.getBrickItems.mockResolvedValueOnce({ items: [row()] });
            const list = brickGoalsList(BRICK);
            expect(get(list.state)).toBe("loading");
            await list.load();
            expect(orbit.getBrickItems).toHaveBeenCalledWith(BRICK);
            expect(get(list.state)).toBe("ready");
            expect(get(list.items).map((one) => one.id)).toEqual(["i1"]);

            orbit.getBrickItems.mockRejectedValueOnce(new Error("no"));
            await list.load();
            expect(get(list.state)).toBe("failed");
        });

        it("sends a tap and reads the list again, taken or refused", async () => {
            orbit.getBrickItems.mockResolvedValue({ items: [row()] });
            const list = brickGoalsList(BRICK);
            await list.load();

            orbit.tapBrickItem.mockResolvedValueOnce({ item: row({ state: "paused" }) });
            orbit.getBrickItems.mockResolvedValueOnce({ items: [row({ state: "paused" })] });
            expect(await list.tap("i1", "pause")).toBe("taken");
            expect(orbit.tapBrickItem).toHaveBeenCalledWith(BRICK, "i1", "pause");
            expect(get(list.items)[0].state).toBe("paused");

            orbit.tapBrickItem.mockRejectedValueOnce(new Error("wrong_state"));
            orbit.getBrickItems.mockResolvedValueOnce({ items: [row({ state: "done" })] });
            expect(await list.tap("i1", "pause")).toBe("refused");
            expect(get(list.items)[0].state).toBe("done");
        });

        it("reads the list across all Bricks again once a tap on one Brick has been taken", async () => {
            orbit.getBrickItems.mockResolvedValue({ items: [row()] });
            orbit.getAllBrickItems.mockClear();
            orbit.getAllBrickItems.mockResolvedValue({ items: [] });
            const list = brickGoalsList(BRICK);
            await list.load();
            orbit.tapBrickItem.mockResolvedValueOnce({});
            await list.tap("i1", "pause");
            await vi.waitFor(() => expect(orbit.getAllBrickItems).toHaveBeenCalledTimes(1));
        });

        it("sends Run now with its own key, tells the person it started, and sends no key for any other tap", async () => {
            orbit.getBrickItems.mockResolvedValue({ items: [row()] });
            const list = brickGoalsList(BRICK);
            await list.load();
            orbit.tapBrickItem.mockResolvedValue({ item: row(), run: { runId: "r1", state: "queued", replay: false } });
            expect(await list.tap("i1", "run")).toBe("started");
            expect(await list.tap("i1", "run")).toBe("started");
            const keys = orbit.tapBrickItem.mock.calls.filter((call) => call[2] === "run").map((call) => call[3]);
            expect(keys).toHaveLength(2);
            // Each tap has a key of its own, one Orbit can hold: a retry of the same tap carries the same one
            expect(keys.every((key) => typeof key === "string" && key.length >= 8 && key.length <= 64)).toBe(true);
            expect(keys[0]).not.toBe(keys[1]);
            await list.tap("i1", "pause");
            expect(orbit.tapBrickItem).toHaveBeenLastCalledWith(BRICK, "i1", "pause");
        });

        it("says why Orbit would not start a run, from what it answers, and a plain refusal for anything else", async () => {
            orbit.getBrickItems.mockResolvedValue({ items: [row()] });
            const list = brickGoalsList(BRICK);
            await list.load();
            const refuse = (code: string | undefined) =>
                orbit.tapBrickItem.mockRejectedValueOnce(Object.assign(new Error("no"), code ? { code } : {}));
            refuse("busy");
            expect(await list.tap("i1", "run")).toBe("busy");
            refuse("no_room");
            expect(await list.tap("i1", "run")).toBe("no_room");
            refuse("runs_a_day");
            expect(await list.tap("i1", "run")).toBe("runs_a_day");
            refuse("off");
            expect(await list.tap("i1", "run")).toBe("refused");
            refuse(undefined);
            expect(await list.tap("i1", "run")).toBe("refused");
            // Only Run now reads those codes: another tap with the same code is just refused
            refuse("busy");
            expect(await list.tap("i1", "pause")).toBe("refused");
            expect(sayTapProblem("busy", ll())).toBe("It's running right now.");
            expect(sayTapProblem("no_room", ll())).toMatch(/^Your usage for goals and tasks is used up/);
            expect(sayTapProblem("runs_a_day", ll())).toBe("That's the most runs for today.");
            expect(sayTapProblem("refused", ll())).toBe("Couldn't do that. Try again.");
            expect(sayTapProblem("started", ll())).toBeNull();
            expect(sayTapProblem("taken", ll())).toBeNull();
        });

        it("keeps the list it has, and says it is stale, when the read after a tap fails", async () => {
            orbit.getBrickItems.mockResolvedValueOnce({ items: [row()] });
            const list = brickGoalsList(BRICK);
            await list.load();
            orbit.tapBrickItem.mockResolvedValueOnce({});
            orbit.getBrickItems.mockRejectedValueOnce(new Error("offline"));
            expect(await list.tap("i1", "snooze")).toBe("stale");
            expect(get(list.state)).toBe("ready");
            expect(get(list.items)).toHaveLength(1);
        });
    });

    describe("the list across all Bricks", () => {
        const OTHER = "1c8d2e3f-2222-4333-8444-055566667777";

        it("names each row's Brick, and leaves out a row that does not say its Brick", async () => {
            orbit.getAllBrickItems.mockResolvedValueOnce({
                items: [
                    row({ brickName: "Brick" }),
                    row({ id: "i2", brickId: OTHER, brickName: "Recipe Brick", words: "Plan the weekend menu" }),
                    row({ id: "i3", brickId: undefined }),
                    row({
                        id: "g1",
                        kind: "goal",
                        words: "Visa in hand before 12 Dec",
                        brickName: "Brick",
                        checks: [row({ id: "c1", brickId: undefined, kind: "watch", parentId: "g1" })],
                    }),
                ],
            });
            const list = allGoalsList();
            await list.load();
            expect(orbit.getAllBrickItems).toHaveBeenCalledTimes(1);
            expect(get(list.items).map((one) => [one.id, one.brickId, one.brickName])).toEqual([
                ["i1", BRICK, "Brick"],
                ["i2", OTHER, "Recipe Brick"],
                ["g1", BRICK, "Brick"],
                // A goal's own check is its goal's Brick's
                ["c1", BRICK, "Brick"],
            ]);
        });

        it("sends a tap to the row's own Brick, and refuses one for a row it does not have", async () => {
            orbit.getAllBrickItems.mockResolvedValue({
                items: [
                    row(),
                    row({ id: "i2", brickId: OTHER, kind: "schedule", cadence: { type: "every", minutes: 60 } }),
                ],
            });
            const list = allGoalsList();
            await list.load();
            orbit.tapBrickItem.mockResolvedValueOnce({});
            expect(await list.tap("i2", "pause")).toBe("taken");
            expect(orbit.tapBrickItem).toHaveBeenLastCalledWith(OTHER, "i2", "pause");
            expect(await list.tap("gone", "pause")).toBe("refused");
            expect(orbit.tapBrickItem).toHaveBeenCalledTimes(1);
        });

        it("keeps a list it shows while it is read again", async () => {
            orbit.getAllBrickItems.mockResolvedValueOnce({ items: [row()] });
            const list = allGoalsList();
            await list.load();
            let finish: (value: unknown) => void = () => undefined;
            orbit.getAllBrickItems.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const again = list.load();
            expect(get(list.state)).toBe("ready");
            expect(get(list.items)).toHaveLength(1);
            finish({ items: [] });
            await again;
            expect(get(list.items)).toHaveLength(0);
        });
    });

    describe("when the account or Orbit changes in place", () => {
        it("forgets the list and drops a read that started before, then reads for the new account", async () => {
            let changed: () => void = () => undefined;
            orbit.onIdentityChange.mockImplementation((listener) => {
                changed = listener;
                return () => undefined;
            });
            orbit.getAllBrickItems.mockResolvedValueOnce({ items: [row({ words: "First account's" })] });
            const list = allGoalsList();
            await list.load();
            expect(get(list.items)).toHaveLength(1);

            let finishOld: (value: unknown) => void = () => undefined;
            orbit.getAllBrickItems.mockReturnValueOnce(
                new Promise((resolve) => {
                    finishOld = resolve;
                })
            );
            const old = list.load();
            orbit.getAllBrickItems.mockResolvedValueOnce({ items: [row({ id: "n1", words: "Second account's" })] });
            changed();
            // Nothing of the first account shows, not even for a moment
            expect(get(list.items)).toEqual([]);
            expect(get(list.state)).toBe("loading");
            finishOld({ items: [row({ words: "First account's, late" })] });
            await old;
            await vi.waitFor(() => expect(get(list.state)).toBe("ready"));
            expect(get(list.items).map((one) => one.words)).toEqual(["Second account's"]);
        });

        it("watches only once, however often the list is read", async () => {
            orbit.onIdentityChange.mockClear();
            orbit.getAllBrickItems.mockResolvedValue({ items: [] });
            const list = allGoalsList();
            await list.load();
            await list.load();
            expect(orbit.onIdentityChange).toHaveBeenCalledTimes(1);
        });
    });

    it("reads a row for one Brick as that Brick's when Orbit does not say", () => {
        expect(parseGoalItems({ items: [row({ brickId: undefined })] }, BRICK)[0].brickId).toBe(BRICK);
        expect(parseGoalItems({ items: [row({ brickId: undefined })] })).toEqual([]);
    });
});
