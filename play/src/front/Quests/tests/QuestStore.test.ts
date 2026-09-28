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

const guide = { userId: 3, uuid: "bot-3", name: "Guide", isBot: true };

const readyWorld: QuestWorld = {
    ...EMPTY_QUEST_WORLD,
    ready: true,
    roomName: "Lobby",
    host: { kind: "bot", userId: 3, uuid: "bot-3", name: "Guide" },
    present: [guide],
    exploreTarget: { area: { id: "a", name: "Courtyard", x: 0, y: 0, width: 10, height: 10 }, alreadyInside: false },
    canBuild: false,
};

/** The player walked out of the bot's range: the game re-resolves the host to nobody (the room). */
const awayFromGuide: QuestWorld = { ...readyWorld, host: { kind: "none" }, present: [] };

async function loadStore() {
    return import("../QuestStore");
}

describe("QuestStore", () => {
    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        sessionStorage.clear();
        for (const fn of Object.values(analytics)) fn.mockClear();
    });

    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it("restores progress and saves every change", async () => {
        localStorage.setItem(
            "quests.state",
            JSON.stringify({ version: 1, quests: { meet: { accepted: true } }, tracked: "meet" })
        );
        const store = await loadStore();
        expect(get(store.questStateStore).tracked).toBe("meet");
        store.setQuestsHidden(true);
        expect(JSON.parse(localStorage.getItem("quests.state") ?? "{}").hidden).toBe(true);
        expect(analytics.questStopped).toHaveBeenCalledWith({ questId: "welcome.meet", reason: "hidden" });
        expect(analytics.questTracker).toHaveBeenCalledWith(expect.objectContaining({ action: "hidden" }));
        // Still followed underneath: showing the bar again reports it followed, pairing with the stop.
        expect(analytics.questTracked).not.toHaveBeenCalled();
        store.setQuestsHidden(false);
        expect(get(store.questStateStore).tracked).toBe("meet");
        expect(analytics.questTracked).toHaveBeenCalledWith({ questId: "welcome.meet", from: "log" });
        expect(analytics.questTracker).toHaveBeenCalledWith(expect.objectContaining({ action: "restored" }));
    });

    it("questReset=1 forgets everything once, from localStorage on load", async () => {
        localStorage.setItem(
            "quests.state",
            JSON.stringify({ version: 1, quests: { meet: { accepted: true } }, tracked: "meet", hidden: true })
        );
        localStorage.setItem("quests.invitationSeen", "2");
        localStorage.setItem("questReset", "1");
        const store = await loadStore();
        const state = get(store.questStateStore);
        expect(state.tracked).toBeNull();
        expect(state.hidden).toBe(false);
        expect(state.invitationSeen).toBe(0);
        expect(state.declined).toBe(false);
        expect(localStorage.getItem("questReset")).toBeNull();
        expect(localStorage.getItem("quests.state")).not.toContain('"tracked":"meet"');
    });

    it("reads the dev host simulation, bot by default", async () => {
        expect((await loadStore()).questSim).toBe("bot");
        vi.resetModules();
        localStorage.setItem("questSim", "area");
        expect((await loadStore()).questSim).toBe("area");
    });

    it("offers once and records the offer; Not now lasts this page and is never stored", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        expect(store.showQuestInvitation()).toBe(true);
        expect(analytics.questOffered).toHaveBeenCalledWith(expect.objectContaining({ giverKind: "bot" }));
        expect(store.showQuestInvitation()).toBe(false);
        // Walked away before answering: the declined offer is still credited to the bot that made it.
        store.setQuestWorld(awayFromGuide);
        store.declineQuestInvitation();
        expect(analytics.questDeclined).toHaveBeenCalledWith(expect.objectContaining({ giverKind: "bot" }));
        expect(get(store.questStateStore).declined).toBe(true);
        expect(sessionStorage.length).toBe(0);
        expect(localStorage.getItem("quests.invitationDeclined")).toBeNull();
        // An answered offer never counts against the fade limit.
        expect(localStorage.getItem("quests.invitationSeen")).toBe("0");

        // The log still offers everything (Meet too, alone in the room), and Start works from it.
        expect(get(store.questAvailablePathsStore)).toEqual(["meet", "explore"]);
        store.acceptQuest("explore", "log", 1);
        expect(get(store.questStateStore).tracked).toBe("explore");
        expect(get(store.questStateStore).surface).toBe("card");
    });

    it("a refresh after Not now offers again, and the bot that offers is the one frozen for a Start from the log", async () => {
        let store = await loadStore();
        store.setQuestWorld(readyWorld);
        store.showQuestInvitation();
        store.declineQuestInvitation();

        // The page reloads: nothing about Not now survives, the invitation may show again.
        vi.resetModules();
        store = await loadStore();
        expect(get(store.questStateStore).declined).toBe(false);
        // Arriving away from the bot: the room offers.
        store.setQuestWorld(awayFromGuide);
        expect(store.showQuestInvitation()).toBe(true);
        expect(get(store.questStateStore).offeredBy).toEqual({ room: "Lobby", giver: null });
        store.declineQuestInvitation();

        // Arriving next to the bot again: it offers, and a Start from the log keeps it as the giver even once the
        // player has walked out of its range.
        vi.resetModules();
        store = await loadStore();
        store.setQuestWorld(readyWorld);
        expect(store.showQuestInvitation()).toBe(true);
        store.declineQuestInvitation();
        store.setQuestWorld(awayFromGuide);
        store.acceptQuest("meet", "log", 1);
        expect(get(store.questStateStore).quests.meet.origin).toEqual({
            room: "Lobby",
            giver: { kind: "bot", name: "Guide", uuid: "bot-3" },
        });
    });

    it("an invitation that faded twice is not shown again after a reload", async () => {
        localStorage.setItem("quests.invitationSeen", "2");
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        expect(store.showQuestInvitation()).toBe(false);
    });

    it("Meet started while nobody is here waits, paused, until someone comes", async () => {
        const store = await loadStore();
        store.setQuestWorld(awayFromGuide);
        expect(get(store.questAvailablePathsStore)).toContain("meet");
        store.acceptQuest("meet", "log", 1);
        const state = get(store.questStateStore);
        expect(state.tracked).toBe("meet");
        expect(state.quests.meet.paused).toBe("no-eligible-target");
        expect(analytics.questPaused).toHaveBeenCalledWith({ questId: "welcome.meet", reason: "no-eligible-target" });
    });

    it("freezes the giver when the invitation is shown, whoever hosts when the quest is accepted or finished", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        store.showQuestInvitation();
        // The player walked away from the bot before choosing: the room is hosting now.
        store.setQuestWorld(awayFromGuide);
        store.acceptQuest("explore", "invitation", 1);
        expect(get(store.questStateStore).quests.explore.origin).toEqual({
            room: "Lobby",
            giver: { kind: "bot", name: "Guide", uuid: "bot-3" },
        });
        // Finished after a teleport to another room: the origin does not move.
        store.setQuestWorld({ ...awayFromGuide, roomName: "Garden" });
        store.completeQuest("explore", "detected", 2);
        expect(get(store.questStateStore).quests.explore.origin).toMatchObject({ room: "Lobby" });
    });

    it("a quest started in another room than the offer takes that room's host", async () => {
        const store = await loadStore();
        store.setQuestWorld(readyWorld);
        store.showQuestInvitation();
        store.declineQuestInvitation();
        store.setQuestWorld({ ...awayFromGuide, roomName: "Garden" });
        store.acceptQuest("explore", "log", 1);
        expect(get(store.questStateStore).quests.explore.origin).toEqual({ room: "Garden", giver: null });
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
        expect(analytics.questDone).toHaveBeenCalledWith({ questId: "welcome.meet", secondsSinceAccepted: 30 });
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
        store.questAnnouncementStore.push("Following: Say hi to someone");
        store.questAnnouncementStore.push("Following: Say hi to someone");
        expect(store.questAnnouncementStore.take()).toBe("Following: Say hi to someone");
        expect(store.questAnnouncementStore.take()).toBeUndefined();
    });
});
