import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";

const env = vi.hoisted(() => ({ ENABLE_OPENID: false, WOKA_SPEED: 9 }));
vi.mock("../../Enum/EnvironmentVariable", () => env);
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
// A map is loaded (timers act only then); its player can be moved by the test. No camera: the marks stay hidden.
type TestScene = { CurrentPlayer: { x: number; y: number }; moveTo?: () => Promise<void> };
const scene = vi.hoisted(() => ({ current: { CurrentPlayer: { x: 0, y: 0 } } as unknown }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { tryGetCurrentGameScene: () => scene.current } }));
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

import { questDockWidthStore } from "../QuestDevSettings";
import { openQuestLog } from "../QuestDockFocus";
import {
    acceptQuest,
    completeQuest,
    declineQuestInvitation,
    dispatchQuest,
    questStateStore,
    resetQuests,
    setQuestsHidden,
    setQuestWorld,
    trackQuest,
} from "../QuestStore";
import { walkToQuestTarget } from "../QuestWalk";
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
const player = () => (scene.current as TestScene).CurrentPlayer;
const keyboardClick = (element: HTMLElement | null) => {
    element?.focus();
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
};

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
    questDockWidthStore.set("narrow");
    scene.current = { CurrentPlayer: { x: 0, y: 0 } };
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
    it("never goes empty: the Quests pill rests bottom-left while nothing is followed, and opens the log", async () => {
        expect(byTestId("quest-status")?.getAttribute("role")).toBe("status");
        const pill = byTestId("quests-pill");
        expect(pill).not.toBeNull();
        // Two quests to pick up: Meet (alone for now, it waits) and Explore.
        expect(pill?.querySelector(".u-count")?.textContent).toBe("2");
        pill?.click();
        await flush();
        expect(byTestId("quest-log")).not.toBeNull();
        expect(byTestId("quests-pill")).toBeNull();
        byTestId("quest-log-close")?.click();
        await flush();
        expect(byTestId("quests-pill")).not.toBeNull();
    });

    it("keeps the pill after Not now, after a payoff, and only Hide the quest bar removes it", async () => {
        dispatchQuest({ type: "invitation-shown" });
        await flush();
        expect(byTestId("quest-invitation")).not.toBeNull();
        expect(byTestId("quests-pill")).toBeNull();
        declineQuestInvitation();
        await flush(400);
        expect(byTestId("quest-invitation")).toBeNull();
        expect(byTestId("quests-pill")).not.toBeNull();
        // Available is still there: Start from the log works after Not now.
        byTestId("quests-pill")?.click();
        await flush();
        byTestId("quest-log-explore")?.querySelector("button")?.click();
        await flush();
        byTestId("quest-log-start-explore")?.click();
        await flush();
        expect(get(questStateStore).tracked).toBe("explore");
        expect(byTestId("quest-card")).not.toBeNull();

        completeQuest("explore");
        await flush(1_500);
        expect(byTestId("quest-payoff")).not.toBeNull();
        byTestId("quest-payoff")?.click();
        await flush(400);
        expect(byTestId("quests-pill")).not.toBeNull();

        setQuestsHidden(true);
        await flush(400);
        expect(byTestId("quests-pill")).toBeNull();
        expect(byTestId("quest-dock")?.children).toHaveLength(0);
    });

    it("shows no resting pill before the map is ready or where nothing is on offer", async () => {
        setQuestWorld(EMPTY_QUEST_WORLD);
        await flush();
        expect(byTestId("quests-pill")).toBeNull();
        expect(byTestId("quest-dock")?.children).toHaveLength(0);
        setQuestWorld({ ...EMPTY_QUEST_WORLD, ready: true, roomName: "Lobby" });
        await flush();
        expect(byTestId("quests-pill")).not.toBeNull();
    });

    it("opens the card expanded on Start, with the objective and its buttons, then folds it after 10 s", async () => {
        acceptQuest("explore", "invitation");
        await flush();
        const card = byTestId("quest-card");
        expect(card).not.toBeNull();
        expect(byTestId("quest-card-body")?.textContent).not.toBe("");
        expect(byTestId("quest-walk")).not.toBeNull();
        expect(byTestId("quest-choose-another")).not.toBeNull();
        await flush(9_000);
        expect(byTestId("quest-card")).not.toBeNull();
        await flush(1_100);
        expect(byTestId("quest-card")).toBeNull();
        const pill = byTestId("quest-pill");
        expect(pill).not.toBeNull();
        expect(byTestId("quest-pill-label")?.textContent).not.toBe("");
        expect(get(questStateStore).tracked).toBe("explore");
    });

    it("folds the card on the player's first movement after 3 s, but not before", async () => {
        acceptQuest("build", "invitation");
        await flush();
        expect(byTestId("quest-card")).not.toBeNull();
        player().x = 10;
        await flush(1_000);
        expect(byTestId("quest-card")).not.toBeNull();
        await flush(2_500);
        player().x = 20;
        await flush(600);
        expect(byTestId("quest-card")).toBeNull();
        expect(byTestId("quest-pill")).not.toBeNull();
    });

    it("counts the 10 s only while the card can be seen", async () => {
        acceptQuest("explore", "invitation");
        await flush();
        // The phone chat covers the game right after Start: the card was never seen.
        suppression.set({ surfaces: true, pill: true });
        await flush(15_000);
        suppression.set({ surfaces: false, pill: false });
        await flush(500);
        expect(byTestId("quest-card")).not.toBeNull();
        await flush(8_000);
        expect(byTestId("quest-card")).not.toBeNull();
        await flush(2_000);
        expect(byTestId("quest-card")).toBeNull();
        expect(byTestId("quest-pill")).not.toBeNull();
    });

    it("never folds while keyboard focus is inside the card, or once the pointer is over it", async () => {
        acceptQuest("explore", "invitation");
        await flush();
        byTestId("quest-walk")?.focus();
        expect(byTestId("quest-card")?.contains(document.activeElement)).toBe(true);
        await flush(12_000);
        expect(byTestId("quest-card")).not.toBeNull();
        // Focus leaves, the player walks off: the card still stays (only the X, Escape or moving close it now).
        byTestId("quest-walk")?.blur();
        player().x = 40;
        await flush(1_000);
        expect(byTestId("quest-card")).not.toBeNull();

        dispatchQuest({ type: "close" });
        await flush();
        trackQuest("explore", "log");
        await flush();
        byTestId("quest-card")?.dispatchEvent(new Event("pointerenter"));
        await flush(12_000);
        expect(byTestId("quest-card")).not.toBeNull();
    });

    it("a walk from the card that just ended is not the player leaving", async () => {
        let arrive: () => void = () => {};
        (scene.current as TestScene).moveTo = () =>
            new Promise<void>((resolve) => {
                arrive = resolve;
            });
        acceptQuest("explore", "invitation");
        await flush(3_500);
        void walkToQuestTarget({ kind: "place", x: 100, y: 100, radius: 16, name: "Courtyard" });
        await flush();
        expect(byTestId("quest-stop-walking")).not.toBeNull();
        player().x = 50;
        await flush(1_000);
        expect(byTestId("quest-card")).not.toBeNull();
        // Arrived (after the last sample), the walk ends: the resting place is the new starting point.
        player().x = 60;
        arrive();
        await flush(1_000);
        expect(byTestId("quest-card")).not.toBeNull();
        // Walking away from there folds it.
        player().x = 70;
        await flush(500);
        expect(byTestId("quest-card")).toBeNull();
    });

    it("folds on the X and stays followed; the pill reopens the card, which then stays open", async () => {
        acceptQuest("build", "invitation");
        await flush();
        byTestId("quest-card-close")?.click();
        await flush();
        expect(byTestId("quest-card")).toBeNull();
        expect(get(questStateStore).tracked).toBe("build");
        byTestId("quest-pill")?.click();
        await flush();
        expect(byTestId("quest-card")).not.toBeNull();
        await flush(20_000);
        expect(byTestId("quest-card")).not.toBeNull();
    });

    it("Follow from the log closes the log and opens that quest's card", async () => {
        acceptQuest("explore", "invitation");
        acceptQuest("build", "log");
        await flush();
        dispatchQuest({ type: "open-log" });
        await flush();
        trackQuest("explore", "log");
        await flush();
        expect(byTestId("quest-log")).toBeNull();
        expect(byTestId("quest-card")).not.toBeNull();
        expect(get(questStateStore).tracked).toBe("explore");
    });

    it("Start from a log opened by the menu row focuses the new card, not the menu", async () => {
        const opener = document.createElement("button");
        document.body.appendChild(opener);
        openQuestLog(opener, true);
        await flush();
        expect(byTestId("quest-log")?.contains(document.activeElement)).toBe(true);
        byTestId("quest-log-explore")?.querySelector("button")?.click();
        await flush();
        keyboardClick(byTestId("quest-log-start-explore"));
        await flush();
        expect(byTestId("quest-log")).toBeNull();
        expect(byTestId("quest-card")).not.toBeNull();
        expect(byTestId("quest-card")?.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(opener);
        // Used from the keyboard: it stays until closed.
        await flush(12_000);
        expect(byTestId("quest-card")).not.toBeNull();
    });

    it("Enter on an option focuses the card it opens", async () => {
        dispatchQuest({ type: "invitation-shown" });
        await flush();
        keyboardClick(byTestId("quest-show-options"));
        await flush();
        expect(byTestId("quest-options")?.contains(document.activeElement)).toBe(true);
        keyboardClick(byTestId("quest-option-explore"));
        await flush();
        expect(byTestId("quest-card")).not.toBeNull();
        expect(byTestId("quest-card")?.contains(document.activeElement)).toBe(true);
    });

    it("widens the surfaces with the card width switch, on phones and on desktop", async () => {
        const dockElement = byTestId("quest-dock");
        expect(dockElement?.classList.contains("md:max-w-[22rem]")).toBe(true);
        expect(dockElement?.classList.contains("w-[calc(100%-5.5rem)]")).toBe(true);
        questDockWidthStore.set("full");
        await flush();
        expect(dockElement?.classList.contains("w-[calc(100%-1rem)]")).toBe(true);
        expect(dockElement?.classList.contains("md:max-w-[22rem]")).toBe(false);
        expect(dockElement?.classList.contains("w-[calc(100%-5.5rem)]")).toBe(false);
        dispatchQuest({ type: "open-log" });
        await flush();
        expect(byTestId("quest-log")?.classList.contains("quest-log-full")).toBe(true);
        byTestId("quest-width-narrow")?.click();
        await flush();
        expect(get(questDockWidthStore)).toBe("narrow");
        expect(byTestId("quest-log")?.classList.contains("quest-log-full")).toBe(false);
        expect(dockElement?.classList.contains("md:max-w-[22rem]")).toBe(true);
    });

    it("queues a completion while the game is covered and plays it once it has been free for a moment", async () => {
        acceptQuest("explore", "invitation");
        await flush();
        dispatchQuest({ type: "close" });
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
        // Meet is still there to try: one follow-up, then the resting pill.
        expect(get(questStateStore).surface).toBe("follow-up");
        byTestId("quest-back-to-exploring")?.click();
        await flush(400);
        expect(get(questStateStore).surface).toBe("none");
        expect(byTestId("quests-pill")).not.toBeNull();
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
        expect(byTestId("quest-card")).not.toBeNull();
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
        dispatchQuest({ type: "close" });
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
