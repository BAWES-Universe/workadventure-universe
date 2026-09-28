import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestWorld } from "../QuestWorld";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";

const analytics = vi.hoisted(() => ({
    questOffered: vi.fn(),
    questDeclined: vi.fn(),
    questAccepted: vi.fn(),
    questTracked: vi.fn(),
    questObjectiveDone: vi.fn(),
    questDone: vi.fn(),
    questStopped: vi.fn(),
    questTracker: vi.fn(),
    questGiverUnavailable: vi.fn(),
    questPaused: vi.fn(),
    questSkipped: vi.fn(),
}));

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: analytics }));

const readyWorld: QuestWorld = {
    ...EMPTY_QUEST_WORLD,
    ready: true,
    host: { kind: "bot", userId: 3, uuid: "bot-3", name: "Guide" },
    present: [{ userId: 3, uuid: "bot-3", name: "Guide", isBot: true }],
    exploreTarget: { area: { id: "a", name: "Courtyard", x: 0, y: 0, width: 10, height: 10 }, alreadyInside: false },
    canBuild: false,
};

async function loadStore() {
    return import("../QuestStore");
}

describe("QuestStore", () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        for (const fn of Object.values(analytics)) fn.mockClear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("restores progress and saves every change", async () => {
        localStorage.setItem(
            "quests.state",
            JSON.stringify({ version: 1, quests: { meet: { accepted: true } }, tracked: "meet" })
        );
        const store = await loadStore();
        expect(get(store.questStateStore).tracked).toBe("meet");
        store.setAsideQuest();
        expect(JSON.parse(localStorage.getItem("quests.state") ?? "{}").tracked).toBeNull();
        expect(analytics.questStopped).toHaveBeenCalledWith({ questId: "welcome.meet", reason: "set-aside" });
    });

    it("questReset=1 forgets everything once", async () => {
        localStorage.setItem("quests.invitationDeclined", "true");
        localStorage.setItem("questReset", "1");
        const store = await loadStore();
        expect(get(store.questStateStore).declined).toBe(false);
        expect(localStorage.getItem("questReset")).toBeNull();
    });

    it("reads the dev host simulation, bot by default", async () => {
        expect((await loadStore()).questSim).toBe("bot");
        vi.resetModules();
        localStorage.setItem("questSim", "area");
        expect((await loadStore()).questSim).toBe("area");
    });

    it("offers once, records the offer, and records Not now", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        expect(store.showQuestInvitation()).toBe(true);
        expect(analytics.questOffered).toHaveBeenCalledWith(expect.objectContaining({ giverKind: "bot" }));
        expect(store.showQuestInvitation()).toBe(false);
        store.declineQuestInvitation();
        expect(localStorage.getItem("quests.invitationDeclined")).toBe("true");
        expect(analytics.questDeclined).toHaveBeenCalledTimes(1);
    });

    it("fixes the Explore area on acceptance and credits it at once when already inside", async () => {
        const store = await loadStore();
        store.setQuestWorld({
            ...readyWorld,
            exploreTarget: { ...readyWorld.exploreTarget!, alreadyInside: true },
        });
        store.acceptQuest("explore", "invitation", 1_000);
        const state = get(store.questStateStore);
        expect(state.exploreArea).toEqual({ id: "a", name: "Courtyard" });
        expect(state.quests.explore.done).toBe(true);
        expect(state.pending).toEqual(["explore"]);
        expect(analytics.questObjectiveDone).toHaveBeenCalledWith(
            expect.objectContaining({ questId: "welcome.explore", source: "already-valid" })
        );
    });

    it("an untracked completion is quiet: no payoff, a dot on the Quests row", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        store.acceptQuest("meet", "invitation", 0);
        store.acceptQuest("explore", "log", 0);
        store.completeQuest("meet", "detected", 30_000);
        const state = get(store.questStateStore);
        expect(state.quests.meet.done).toBe(true);
        expect(state.pending).toEqual([]);
        expect(get(store.questNewsStore)).toBe(true);
        expect(analytics.questDone).toHaveBeenCalledWith({
            questId: "welcome.meet",
            secondsSinceAccepted: 30,
            viaShowMe: false,
        });
    });

    it("credits Meet at once when accepted mid-exchange", async () => {
        const store = await loadStore();
        store.setMeetAlreadyExchanged(() => true);
        store.acceptQuest("meet", "invitation");
        expect(get(store.questStateStore).quests.meet.done).toBe(true);
    });

    it("pauses Meet once and records it", async () => {
        const store = await loadStore();
        store.acceptQuest("meet", "invitation");
        store.pauseQuest("meet");
        store.pauseQuest("meet");
        expect(get(store.questStateStore).quests.meet.paused).toBe("no-eligible-target");
        expect(analytics.questPaused).toHaveBeenCalledTimes(1);
    });

    it("offers paths from the simulated world", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        expect(get(store.questAvailablePathsStore)).toEqual(["meet", "explore"]);
    });

    it("coalesces duplicate announcements", async () => {
        const store = await loadStore();
        store.questAnnouncementStore.push("Tracking: Say hi to someone");
        store.questAnnouncementStore.push("Tracking: Say hi to someone");
        expect(store.questAnnouncementStore.take()).toBe("Tracking: Say hi to someone");
        expect(store.questAnnouncementStore.take()).toBeUndefined();
    });
});
