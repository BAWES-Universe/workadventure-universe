import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickItems: vi.fn<(brickId: string) => Promise<unknown>>(),
    tapBrickItem: vi.fn<(brickId: string, itemId: string, action: string) => Promise<unknown>>(),
    openBrickChat: vi.fn<(brickId: string) => Promise<{ sendMessage: (text: string) => void } | undefined>>(),
    sendMessage: vi.fn<(text: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the group reads on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getBrickItems: game.getBrickItems, tapBrickItem: game.tapBrickItem },
}));
vi.mock("../BrickChat", () => ({ openBrickChat: game.openBrickChat }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BrickGoalsGroup from "../BrickGoalsGroup.svelte";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const daily = { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] };
const row = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    brickId: BOT,
    kind: "reminder",
    words: "Pick up the car",
    condition: null,
    outcome: null,
    cadence: { type: "once", at: "2099-11-15T13:00:00.000Z" },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    nextDueAt: "2099-11-15T13:00:00.000Z",
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
    ...over,
});
const goal = (over: Record<string, unknown> = {}) =>
    row({
        id: "g1",
        kind: "goal",
        words: "Visa in hand before 12 Dec",
        cadence: daily,
        nextDueAt: "2099-11-16T05:00:00.000Z",
        steps: [
            { text: "Filled in the form", state: "done" },
            { text: "Checking the status every morning", state: "doing" },
            { text: "Tell you the moment it's approved", state: "todo" },
        ],
        ...over,
    });

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("Goals and tasks group on a Brick's page (#2002)", () => {
    let target: HTMLElement;
    let part: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.getBrickItems.mockResolvedValue({ items: [] });
        game.tapBrickItem.mockResolvedValue({});
        game.openBrickChat.mockResolvedValue({ sendMessage: game.sendMessage });
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        part?.$destroy();
        part = undefined;
        target.remove();
    });

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = (el: Element | null = target) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    async function show(items: unknown[], props: Record<string, unknown> = {}) {
        game.getBrickItems.mockResolvedValue({ items });
        part = new BrickGoalsGroup({
            target,
            props: { botId: BOT, name: "Brick", open: true, onToggle: () => undefined, ...props },
        });
        await settle();
    }
    async function press(id: string, nth = 0) {
        all(id)[nth].click();
        await settle();
    }

    it("starts with Optional when nothing is set, and Give Brick a goal opens its chat", async () => {
        await show([]);
        expect(game.getBrickItems).toHaveBeenCalledWith(BOT);
        expect(text(byId("bot-page-group-goals"))).toContain("Goals and tasks");
        expect(text(byId("bot-page-group-goals"))).toContain("Optional · nothing set yet");
        expect(text(byId("goalsEmpty"))).toMatch(/^Optional\. Give Brick something to keep working on\./);
        for (const word of ["A goal", "Keep watch", "On a schedule", "A reminder"]) expect(text()).toContain(word);
        await press("goalsGive");
        expect(game.openBrickChat).toHaveBeenCalledWith(BOT);
        expect(game.sendMessage).not.toHaveBeenCalled();
    });

    it("shows a goal with its steps and one status line, and keeps the three parts in the mock's order", async () => {
        await show([
            row({
                id: "c",
                state: "done",
                doneAt: new Date(2026, 10, 10, 12, 0).toISOString(),
                result: "visa saved",
                kind: "goal",
            }),
            row({ id: "r", words: "Pick up the car" }),
            goal(),
            row({
                id: "b",
                kind: "schedule",
                words: "Morning briefing",
                cadence: { ...daily, time: "07:30", days: [0, 1, 2, 3, 4] },
            }),
        ]);
        const html = text();
        expect(html.indexOf("In progress")).toBeLessThan(html.indexOf("Scheduled"));
        expect(html.indexOf("Scheduled")).toBeLessThan(html.indexOf("Done"));
        expect(text(byId("goalWords"))).toBe("Visa in hand before 12 Dec");
        expect(text(byId("goalStatus"))).toBe("On track · nothing needed from you");
        expect(all("goalStep").map((step) => text(step))).toEqual([
            "✓Filled in the form",
            "Checking the status every morning",
            "Tell you the moment it's approved",
        ]);
        expect(all("goalStep").map((step) => step.classList[0])).toEqual(["done", "now", "todo"]);
        expect(all("goalScheduled").map((one) => text(one))).toEqual([
            expect.stringMatching(/^Pick up the car.*· by you Snooze$/),
            expect.stringMatching(/^Morning briefingSun to Thu, 7:30.AM · by you Pause$/),
        ]);
        expect(text(byId("goalDoneRow"))).toBe("Pick up the carDone 10 Nov · visa saved Reopen");
    });

    it("names the Brick on what the Brick set for itself", async () => {
        await show([row({ setBy: "brick", kind: "schedule", cadence: daily, words: "Check my visa status" })]);
        expect(text(byId("goalScheduled"))).toMatch(/Daily, 8:00.AM · by Brick Pause$/);
    });

    it("pauses a goal and then resumes it, marks it done, and reads the list again each time", async () => {
        await show([goal()]);
        game.getBrickItems.mockResolvedValue({ items: [goal({ state: "paused" })] });
        await press("goalPause");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "g1", "pause");
        expect(text(byId("goalStatus"))).toBe("Paused");
        expect(byId("goalPause")).toBeNull();
        game.getBrickItems.mockResolvedValue({ items: [goal()] });
        await press("goalResume");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "g1", "resume");
        game.getBrickItems.mockResolvedValue({
            items: [goal({ state: "done", doneAt: new Date(2026, 10, 12, 10, 0).toISOString() })],
        });
        await press("goalDone");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "g1", "done");
        expect(byId("goalCard")).toBeNull();
        expect(text(byId("goalDoneRow"))).toContain("Visa in hand before 12 Dec");
    });

    it("reopens a done one", async () => {
        await show([
            goal({ state: "done", doneAt: new Date(2026, 10, 12, 10, 0).toISOString(), result: "visa saved" }),
        ]);
        expect(text(byId("goalDoneRow"))).toBe("Visa in hand before 12 DecDone 12 Nov · visa saved Reopen");
        game.getBrickItems.mockResolvedValue({ items: [goal()] });
        await press("goalReopen");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "g1", "reopen");
        expect(byId("goalCard")).not.toBeNull();
    });

    it("pauses and resumes a briefing, snoozes a one-off reminder, and reads a paused one as Paused with Resume", async () => {
        await show([
            row({ id: "r" }),
            row({ id: "b", kind: "schedule", cadence: daily, words: "Morning briefing" }),
            row({
                id: "w",
                kind: "watch",
                cadence: { type: "every", minutes: 360 },
                words: "Flight under KWD 90",
                state: "paused",
            }),
        ]);
        expect(all("goalScheduled").map((one) => text(one))).toEqual([
            expect.stringMatching(/Snooze$/),
            expect.stringMatching(/Daily, 8:00.AM · by you Pause$/),
            "Flight under KWD 90Paused · Every 6 hours · by you Resume",
        ]);
        await press("goalSnooze");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "r", "snooze");
        await press("goalPause");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "b", "pause");
        await press("goalResume");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "w", "resume");
    });

    it("gives a goal's own check no Resume while its goal is paused (the goal's Resume brings it back), but keeps one for a check the person paused alone", async () => {
        const check = (over: Record<string, unknown> = {}) =>
            row({ id: "k1", kind: "schedule", cadence: daily, words: "Check my visa status", parentId: "g1", ...over });
        await show([goal({ state: "paused", checks: [check({ state: "paused" })] })]);
        expect(all("goalScheduled")).toHaveLength(1);
        expect(text(byId("goalScheduled"))).toContain("Check my visa status");
        expect(text(byId("goalScheduled"))).toContain("Paused");
        expect(byId("goalScheduled")?.querySelector("button")).toBeNull();
        expect(all("goalResume")).toHaveLength(1);
        expect(byId("goalCard")?.querySelector('[data-testid="goalResume"]')).not.toBeNull();

        part?.$destroy();
        target.innerHTML = "";
        await show([goal({ checks: [check({ state: "paused" })] })]);
        expect(byId("goalScheduled")?.querySelector('[data-testid="goalResume"]')).not.toBeNull();
    });

    it("tells the person when Orbit refuses a tap, and shows the list as it really stands", async () => {
        await show([goal()]);
        game.tapBrickItem.mockRejectedValueOnce(new Error("wrong_state"));
        game.getBrickItems.mockResolvedValue({
            items: [goal({ state: "done", doneAt: new Date(2026, 10, 12, 10, 0).toISOString() })],
        });
        await press("goalPause");
        expect(game.warn).toHaveBeenCalledWith("Couldn't do that. Try again.");
        expect(byId("goalCard")).toBeNull();
        expect(byId("goalDoneRow")).not.toBeNull();
    });

    it("tells the person when Orbit took a tap but the list could not be read again", async () => {
        await show([goal()]);
        game.tapBrickItem.mockResolvedValueOnce({});
        game.getBrickItems.mockRejectedValue(new Error("offline"));
        await press("goalPause");
        expect(game.warn).toHaveBeenCalledWith(
            "Done, but the list could not be refreshed. Close this page and open it again."
        );
        expect(game.warn).not.toHaveBeenCalledWith("Couldn't do that. Try again.");
        expect(byId("goalCard")).not.toBeNull();
    });

    it("does not send a second tap for a row while its tap is still on its way", async () => {
        await show([goal()]);
        let finish: (value: unknown) => void = () => undefined;
        game.tapBrickItem.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        byId("goalPause")?.click();
        await settle();
        byId<HTMLButtonElement>("goalDone")?.click();
        byId<HTMLButtonElement>("goalPause")?.click();
        await settle();
        expect(game.tapBrickItem).toHaveBeenCalledTimes(1);
        finish({});
        await settle();
    });

    it("asks the question a goal has open, and Keep going answers it", async () => {
        await show([goal({ asking: "unsure" })]);
        expect(text(byId("goalAsk"))).toBe("Brick isn't sure it got there. Is this done?");
        game.getBrickItems.mockResolvedValue({ items: [goal()] });
        await press("goalKeep");
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BOT, "g1", "keep");
        expect(byId("goalAsk")).toBeNull();
        await show([goal({ asking: "date_passed" })]);
        expect(text(all("goalAsk")[0])).toBe("The date this was for has passed. Close it, or keep going?");
    });

    it("opens the chat with the goal named when the person taps Change, with no form", async () => {
        await show([goal()]);
        await press("goalChange");
        expect(game.openBrickChat).toHaveBeenCalledWith(BOT);
        expect(game.sendMessage).toHaveBeenCalledWith("I'd like to change this one: “Visa in hand before 12 Dec”");
        expect(target.querySelector("input, textarea, form")).toBeNull();
    });

    it("keeps long Done lists short until See all", async () => {
        const done = (n: number) =>
            row({
                id: `d${n}`,
                kind: "goal",
                words: `Goal ${n}`,
                state: "done",
                doneAt: new Date(2026, 10, n, 10, 0).toISOString(),
            });
        await show([1, 2, 3, 4, 5, 6, 7].map(done));
        expect(all("goalDoneRow")).toHaveLength(5);
        expect(text(all("goalDoneRow")[0])).toContain("Goal 7");
        expect(text(byId("goalsSeeAll"))).toBe("See all 7");
        await press("goalsSeeAll");
        expect(all("goalDoneRow")).toHaveLength(7);
        expect(byId("goalsSeeAll")).toBeNull();
    });

    it("ends with Give Brick a goal or a task, which opens its chat", async () => {
        await show([goal()]);
        expect(text(target)).toContain("Give Brick a goal or a task");
        expect(text(target)).toContain("Opens its chat. Say it in your own words.");
        await press("goalsNew");
        expect(game.openBrickChat).toHaveBeenCalledWith(BOT);
    });

    it("ends Done with Everything Brick did, which opens its page, and shows it only when there is something", async () => {
        const open = vi.fn<() => void>();
        await show([goal({ state: "done", doneAt: new Date(2026, 10, 12).toISOString(), result: "visa saved" })], {
            onOpenDid: open,
        });
        expect(text(byId("goalsDidRow"))).toBe("Everything Brick didEach run, with its result");
        await press("goalsDidRow");
        expect(open).toHaveBeenCalledTimes(1);
        part?.$destroy();
        target.innerHTML = "";
        // With nothing set there are no runs to show; and without a way to open it the row is not drawn
        await show([], { onOpenDid: open });
        expect(byId("goalsDidRow")).toBeNull();
        part?.$destroy();
        target.innerHTML = "";
        await show([goal()]);
        expect(byId("goalsDidRow")).toBeNull();
    });

    it("says so, with Try again, when it cannot read the list", async () => {
        game.getBrickItems.mockRejectedValueOnce(new Error("offline"));
        part = new BrickGoalsGroup({
            target,
            props: { botId: BOT, name: "Brick", open: true, onToggle: () => undefined },
        });
        await settle();
        expect(text(target)).toContain("Couldn't read what Brick keeps for you. Try again.");
        expect(byId("goalsEmpty")).toBeNull();
        game.getBrickItems.mockResolvedValue({ items: [goal()] });
        await press("goalsRetry");
        expect(byId("goalCard")).not.toBeNull();
    });
});
