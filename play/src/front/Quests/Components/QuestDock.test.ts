import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";

const env = vi.hoisted(() => ({ FEATURE_FLAG_QUESTS_PROOF_SLICE: true, ENABLE_OPENID: false, WOKA_SPEED: 9 }));
vi.mock("../../Enum/EnvironmentVariable", () => env);
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
// A map is loaded (timers act only then); it has no player to measure, so the stamp just appears.
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { tryGetCurrentGameScene: () => ({}) } }));
vi.mock("../QuestDetectors", () => ({ armQuestScene: () => () => {} }));
vi.mock("../../Phaser/Game/Say/SayManager", () => ({ popupJustClosed: () => {} }));
vi.mock("../QuestMarkers", () => ({ startQuestMarkers: () => () => {} }));
vi.mock("../QuestArrival", () => ({ startQuestArrival: () => () => {} }));
vi.mock("../../Stores/MenuStore", () => ({ userIsConnected: writable(true) }));
vi.mock("../../Stores/ChatStore", () => ({ chatInputFocusStore: writable(false) }));
vi.mock("../../Stores/UserInputStore", () => ({ inputFormFocusStore: writable(false) }));
vi.mock("../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});
// What covers the game, driven by the test.
const cover = vi.hoisted(() => ({ surfaces: false, pill: false, quiet: false }));
vi.mock("../QuestUiStores", async () => {
    const { writable: w, derived: d } = await import("svelte/store");
    const suppression = w({ surfaces: cover.surfaces, pill: cover.pill });
    const quiet = w(cover.quiet);
    return {
        questSuppressionStore: suppression,
        questSurfaceSuppressed: d(suppression, ($s) => $s.surfaces),
        questPillSuppressed: d(suppression, ($s) => $s.pill),
        questQuiet: quiet,
    };
});

import { acceptQuest, completeQuest, dispatchQuest, questStateStore, resetQuests, setQuestWorld } from "../QuestStore";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";
import * as uiStores from "../QuestUiStores";
import QuestDock from "./QuestDock.svelte";

type Settable<T> = { set: (value: T) => void };
const suppression = uiStores.questSuppressionStore as unknown as Settable<{ surfaces: boolean; pill: boolean }>;
const quiet = uiStores.questQuiet as unknown as Settable<boolean>;

let dock: QuestDock | undefined;
let target: HTMLElement;

async function flush(ms = 0) {
    await vi.advanceTimersByTimeAsync(ms);
    await tick();
}

const byTestId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(async () => {
    vi.useFakeTimers({
        toFake: [
            "setTimeout",
            "clearTimeout",
            "setInterval",
            "clearInterval",
            "Date",
            "requestAnimationFrame",
            "cancelAnimationFrame",
            "performance",
        ],
    });
    resetQuests();
    suppression.set({ surfaces: false, pill: false });
    quiet.set(false);
    setQuestWorld({
        ...EMPTY_QUEST_WORLD,
        ready: true,
        roomName: "Lobby",
        exploreTarget: {
            area: { id: "a", name: "Courtyard", x: 0, y: 0, width: 64, height: 64 },
            alreadyInside: false,
        },
    });
    target = document.createElement("section");
    document.body.appendChild(target);
    dock = new QuestDock({ target });
    await flush();
});

afterEach(() => {
    dock?.$destroy();
    dock = undefined;
    document.body.innerHTML = "";
    vi.useRealTimers();
});

describe("QuestDock", () => {
    it("renders nothing but the status region while nothing is going on", () => {
        expect(byTestId("quest-status")?.getAttribute("role")).toBe("status");
        expect(byTestId("quest-dock")?.children).toHaveLength(0);
    });

    it("queues a completion while the game is covered and plays it once it has been free for a moment", async () => {
        acceptQuest("explore", "invitation");
        await flush();
        expect(byTestId("quest-pill")).not.toBeNull();

        // The phone chat covers the game: everything hides, the completion is recorded but waits.
        suppression.set({ surfaces: true, pill: true });
        // It fades out, it never moves.
        await flush(400);
        expect(byTestId("quest-pill")).toBeNull();
        completeQuest("explore");
        await flush(10_000);
        expect(get(questStateStore).quests.explore.done).toBe(true);
        expect(byTestId("quest-payoff-tick")).toBeNull();
        expect(byTestId("quest-payoff")).toBeNull();

        // Free again: after half a second the ring ticks on the pill, then the line with its stamp.
        suppression.set({ surfaces: false, pill: false });
        await flush(400);
        expect(byTestId("quest-payoff-tick")).toBeNull();
        await flush(200);
        expect(byTestId("quest-payoff-tick")).not.toBeNull();
        await flush(800);
        expect(byTestId("quest-payoff")).not.toBeNull();

        // The 6 s count only while the line can be seen and nobody is busy.
        quiet.set(true);
        await flush(20_000);
        expect(byTestId("quest-payoff")).not.toBeNull();
        quiet.set(false);
        await flush(6_500);
        expect(byTestId("quest-payoff")).toBeNull();
        expect(get(questStateStore).surface).toBe("none");
    });

    it("never lets a waiting completion take over a quest tracked since", async () => {
        acceptQuest("explore", "invitation");
        acceptQuest("build", "log");
        dispatchQuest({ type: "track", path: "explore" });
        suppression.set({ surfaces: true, pill: true });
        await flush();
        completeQuest("explore");
        // Tracking another quest before the payoff could play.
        dispatchQuest({ type: "track", path: "build" });
        suppression.set({ surfaces: false, pill: false });
        await flush(2_000);
        expect(byTestId("quest-payoff")).toBeNull();
        expect(byTestId("quest-pill")).not.toBeNull();
        expect(get(questStateStore).tracked).toBe("build");
    });

    it("tapping the line away ends it with no follow-up", async () => {
        acceptQuest("explore", "invitation");
        completeQuest("explore");
        await flush(1_500);
        expect(byTestId("quest-payoff")).not.toBeNull();
        byTestId("quest-payoff")?.click();
        await flush();
        expect(byTestId("quest-payoff")).toBeNull();
        expect(byTestId("quest-follow-up")).toBeNull();
    });

    it("opens the log over the dock with its own history entry; Back closes it and the room stays", async () => {
        const push = vi.spyOn(history, "pushState");
        acceptQuest("explore", "invitation");
        await flush();
        dispatchQuest({ type: "open-log" });
        await flush();
        expect(byTestId("quest-log")).not.toBeNull();
        expect(push).toHaveBeenCalledTimes(1);

        // Back from something opened over the log lands on the log's own entry: it stays.
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        await flush();
        expect(byTestId("quest-log")).not.toBeNull();

        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
        await flush();
        expect(byTestId("quest-log")).toBeNull();
        expect(byTestId("quest-pill")).not.toBeNull();
        push.mockRestore();
    });

    it("steps back over its history entry when the log is closed another way", async () => {
        const back = vi.spyOn(history, "back").mockImplementation(() => {});
        dispatchQuest({ type: "open-log" });
        await flush();
        byTestId("quest-log-close")?.click();
        await flush();
        expect(byTestId("quest-log")).toBeNull();
        expect(back).toHaveBeenCalledTimes(1);
        back.mockRestore();
    });

    it("hides the log (and everything else) while something covers the game, and brings it back", async () => {
        dispatchQuest({ type: "open-log" });
        await flush();
        suppression.set({ surfaces: true, pill: true });
        await flush();
        expect(byTestId("quest-log")).toBeNull();
        suppression.set({ surfaces: false, pill: false });
        await flush();
        expect(byTestId("quest-log")).not.toBeNull();
    });
});
