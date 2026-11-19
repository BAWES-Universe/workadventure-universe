import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getAllBrickItems: vi.fn<() => Promise<unknown>>(),
    tapBrickItem: vi.fn<(brickId: string, itemId: string, action: string, key?: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getAllBrickItems: game.getAllBrickItems,
        tapBrickItem: game.tapBrickItem,
        onIdentityChange: () => () => undefined,
    },
}));
// The pictures are not what these tests are about
vi.mock(
    "../BrickPicture.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../../../Stores/MapEditorStore", async () => {
    const store = await import("svelte/store");
    return { mapEditorVisibilityStore: store.writable(false) };
});
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import GoalsPage from "../GoalsPage.svelte";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const RECIPE = "1c8d2e3f-2222-4333-8444-055566667777";
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const row = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    brickId: BRICK,
    brickName: "Brick",
    kind: "reminder",
    words: "Pick up the car",
    condition: null,
    outcome: null,
    cadence: { type: "once", at: "2099-11-15T13:00:00.000Z" },
    timeZone: zone,
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
    checks: [],
    ...over,
});
const daily = { type: "daily", time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] };

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

describe("Goals and tasks across all Bricks (#2002, mock t-7-all)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;
    const onOpen = vi.fn<(brickId: string) => void>();
    const onBack = vi.fn<() => void>();

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.tapBrickItem.mockResolvedValue({});
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
    });

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = (el: Element | null = target) =>
        (el?.textContent ?? "").replace(new RegExp("[\\u202f\\u00a0]", "g"), " ").replace(/\s+/g, " ").trim();
    async function show(items: unknown[]) {
        game.getAllBrickItems.mockResolvedValue({ items });
        page = new GoalsPage({
            target,
            props: { onBack, onOpen, looks: { [BRICK]: null, [RECIPE]: null }, names: { [RECIPE]: "Recipe Brick" } },
        });
        await settle();
    }

    it("lists every Brick's goals and tasks in three parts, each row saying its Brick", async () => {
        await show([
            row({
                id: "g1",
                kind: "goal",
                words: "Visa in hand before 12 Dec",
                cadence: daily,
                checks: [row({ id: "c1", kind: "watch", words: "Check my visa status", cadence: daily })],
            }),
            row({ id: "b", kind: "schedule", words: "Morning briefing", cadence: { ...daily, days: [0, 1, 2, 3, 4] } }),
            row(),
            row({
                id: "w",
                brickId: RECIPE,
                brickName: "",
                kind: "schedule",
                words: "Plan the weekend menu",
                cadence: daily,
            }),
            row({
                id: "d",
                kind: "goal",
                words: "This year's spending in one sheet",
                state: "done",
                doneAt: new Date(2026, 10, 3, 10, 0).toISOString(),
                result: "the sheet is in its chat",
            }),
        ]);
        expect(game.getAllBrickItems).toHaveBeenCalledTimes(1);
        expect(text(byId("goalsPage"))).toMatch(/^Goals and tasks/);
        const rows = all("goalsPageRow");
        expect(rows.map((one) => one.dataset.group)).toEqual([
            "progress",
            "scheduled",
            "scheduled",
            "scheduled",
            "scheduled",
            "done",
        ]);
        expect(text(rows[0])).toBe("Visa in hand before 12 DecBrick · On track · nothing needed from you");
        // A goal's own check first, then the soonest
        expect(text(rows[1])).toMatch(/^Check my visa statusBrick · Daily, 8:00 AM Run now Pause$/);
        expect(text(rows[4])).toMatch(/^Plan the weekend menuRecipe Brick · Daily, 8:00 AM Run now Pause$/);
        expect(text(rows[5])).toBe("This year's spending in one sheetBrick · Done 3 Nov · the sheet is in its chat");
        expect(all("goalsPageSnooze")).toHaveLength(1);
        expect(text(byId("goalsPageNote"))).toBe(
            "Tap one to open it on its Brick's page. To add one, tell any Brick in its chat."
        );
    });

    it("pauses, resumes and snoozes on the row's own Brick, without opening it", async () => {
        await show([
            row(),
            row({ id: "w", brickId: RECIPE, kind: "watch", words: "Flight under KWD 90", cadence: daily }),
            row({ id: "p", kind: "schedule", words: "Morning briefing", cadence: daily, state: "paused" }),
        ]);
        all("goalsPageSnooze")[0].click();
        await settle();
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BRICK, "i1", "snooze");
        all("goalsPagePause")[0].click();
        await settle();
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(RECIPE, "w", "pause");
        all("goalsPageResume")[0].click();
        await settle();
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(BRICK, "p", "resume");
        expect(onOpen).not.toHaveBeenCalled();
        expect(game.getAllBrickItems).toHaveBeenCalledTimes(4);
    });

    it("opens a row on its Brick's page, by a tap or by Enter", async () => {
        await show([
            row({ id: "w", brickId: RECIPE, brickName: "Recipe Brick", kind: "goal", words: "Plan the weekend menu" }),
        ]);
        const one = all("goalsPageRow")[0];
        expect(one.getAttribute("aria-label")).toBe("Open “Plan the weekend menu” on Recipe Brick's page");
        one.click();
        expect(onOpen).toHaveBeenLastCalledWith(RECIPE);
        one.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it("gives a goal's own check no button while its goal is paused", async () => {
        await show([
            row({
                id: "g1",
                kind: "goal",
                words: "Visa in hand",
                state: "paused",
                checks: [row({ id: "c1", kind: "watch", words: "Check my visa status", state: "paused" })],
            }),
        ]);
        expect(all("goalsPageRow")).toHaveLength(2);
        expect(all("goalsPageResume")).toHaveLength(0);
    });

    it("says when Orbit refused a tap", async () => {
        await show([row()]);
        game.tapBrickItem.mockRejectedValueOnce(new Error("wrong_state"));
        all("goalsPageSnooze")[0].click();
        await settle();
        expect(game.warn).toHaveBeenCalledWith("Couldn't do that. Try again.");
    });

    it("runs one now on the row's own Brick, with a key of its own, says it started, and does not open the row", async () => {
        await show([
            row(),
            row({ id: "w", brickId: RECIPE, kind: "watch", words: "Flight under KWD 90", cadence: daily }),
        ]);
        expect(all("goalsPageRun")).toHaveLength(2);
        expect(text(all("goalsPageRun")[0])).toBe("Run now");
        all("goalsPageRun")[1].click();
        await settle();
        expect(game.tapBrickItem).toHaveBeenLastCalledWith(RECIPE, "w", "run", expect.stringMatching(/^.{8,64}$/));
        expect(onOpen).not.toHaveBeenCalled();
        // The row itself does not change when it starts, so its button says so for a moment, and cannot be tapped again meanwhile
        expect(text(all("goalsPageRun")[1])).toBe("Started");
        expect(all("goalsPageRun")[1].hasAttribute("disabled")).toBe(true);
        expect(game.warn).not.toHaveBeenCalled();
    });

    it("says why a run would not start: one is running, or the usage or the runs for today are used up", async () => {
        await show([row()]);
        const refuse = async (code: string, words: string) => {
            game.tapBrickItem.mockRejectedValueOnce(Object.assign(new Error("no"), { code }));
            all("goalsPageRun")[0].click();
            await settle();
            expect(game.warn).toHaveBeenLastCalledWith(words);
        };
        await refuse("busy", "It's running right now.");
        await refuse("no_room", "Your usage for goals and tasks is used up for now. Try again when it's back.");
        await refuse("runs_a_day", "That's the most runs for today.");
        expect(text(all("goalsPageRun")[0])).toBe("Run now");
    });

    it("says a snoozed run under the row, with where the schedule goes on", async () => {
        await show([
            row({
                id: "b",
                kind: "schedule",
                words: "Headlines",
                cadence: { type: "every", minutes: 60 },
                nextDueAt: "2099-11-15T13:10:00.000Z",
                snoozedUntil: "2099-11-15T13:10:00.000Z",
                nextRegularAt: "2099-11-15T14:00:00.000Z",
            }),
        ]);
        expect(text(all("goalsPageRow")[0])).toMatch(/Every 1 hour · Snoozed until .* · Next regular run .*/);
    });

    it("says how to add one when there are none, and offers Try again when it cannot read", async () => {
        await show([]);
        expect(text(byId("goalsPageNone"))).toBe("Nothing here yet. To add one, tell any Brick in its chat.");
        page?.$destroy();
        game.getAllBrickItems.mockRejectedValue(new Error("offline"));
        page = new GoalsPage({ target, props: { onBack, onOpen } });
        await settle();
        expect(text(byId("goalsPageFailed"))).toBe("Couldn't read your goals and tasks. Try again.");
        game.getAllBrickItems.mockResolvedValue({ items: [row()] });
        byId("goalsPageRetry")?.click();
        await settle();
        expect(all("goalsPageRow")).toHaveLength(1);
    });
});
