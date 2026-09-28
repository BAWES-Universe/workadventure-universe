import { describe, expect, it } from "vitest";
import type { QuestEvent, QuestState } from "../QuestModel";
import {
    acceptedUntrackedCount,
    canOfferInvitation,
    initialQuestState,
    markedQuestPath,
    questsOnOffer,
    questStatus,
    reduceQuest,
    revealPending,
    visibleSurface,
} from "../QuestModel";

function run(...events: QuestEvent[]): QuestState {
    return events.reduce(reduceQuest, initialQuestState());
}

const free = { surfaces: false, pill: false };
const guide = { room: "Lobby", giver: { kind: "bot" as const, name: "Guide", uuid: "bot-1" } };

describe("reduceQuest", () => {
    it("goes invitation → log → pill on accepting a path, and remembers who offered it", () => {
        const state = run(
            { type: "invitation-shown", origin: guide },
            { type: "open-log" },
            { type: "accept", path: "meet", now: 5, origin: guide }
        );
        // Accept closes the log, as a quest giver's window does: the quest is on the map, its objective on the pill.
        expect(state.surface).toBe("pill");
        expect(state.tracked).toBe("meet");
        expect(state.offeredBy).toEqual(guide);
        expect(state.quests.meet).toMatchObject({ accepted: true, done: false, acceptedAt: 5, origin: guide });
        expect(state.invitationSeen).toBe(1);
    });

    it("closing the log opened from the invitation is not a decline, and rests on the pill", () => {
        const state = run({ type: "invitation-shown" }, { type: "open-log" }, { type: "close" });
        expect(state.surface).toBe("none");
        expect(state.declined).toBe(false);
        expect(visibleSurface(state, free)).toBe("pill");
    });

    it("Not now dismisses the invitation for this page; the quests stay startable", () => {
        const state = run({ type: "invitation-shown" }, { type: "decline" });
        expect(state.declined).toBe(true);
        expect(state.surface).toBe("none");
        expect(canOfferInvitation(state)).toBe(false);
        // An answered offer is not a faded one: the next page load (declined is never stored) may offer again.
        expect(state.invitationSeen).toBe(0);
        expect(canOfferInvitation({ ...state, declined: false })).toBe(true);
        // The bar never goes empty: the Quests pill opens the panel.
        expect(visibleSurface(state, free)).toBe("pill");
        const started = reduceQuest(state, { type: "accept", path: "explore", now: 1 });
        expect(started.tracked).toBe("explore");
        expect(started.surface).toBe("pill");
    });

    it("a faded invitation leaves a dot and may come back once, then never", () => {
        let state = run({ type: "invitation-shown" }, { type: "invitation-faded" });
        expect(state.news).toBe(true);
        expect(state.declined).toBe(false);
        expect(canOfferInvitation(state)).toBe(true);
        state = reduceQuest(state, { type: "invitation-shown" });
        state = reduceQuest(state, { type: "invitation-faded" });
        expect(canOfferInvitation(state)).toBe(false);
        expect(reduceQuest(state, { type: "invitation-shown" })).toBe(state);
    });

    it("never offers the invitation once something is accepted", () => {
        const state = run({ type: "accept", path: "explore", now: 1 });
        expect(state.surface).toBe("pill");
        expect(canOfferInvitation(state)).toBe(false);
    });

    it("several quests can be in progress, one on the map; Show on map keeps the log open", () => {
        const state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "accept", path: "explore", now: 2 },
            { type: "open-log" },
            { type: "track", path: "meet" }
        );
        expect(state.tracked).toBe("meet");
        expect(questStatus(state, "explore")).toBe("accepted");
        expect(acceptedUntrackedCount(state)).toBe(1);
        expect(state.surface).toBe("log");
        // Already on the map: nothing changes.
        expect(reduceQuest(state, { type: "track", path: "meet" })).toBe(state);
    });

    it("abandon returns a quest to Available and moves the map to what is still in progress", () => {
        let state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "accept", path: "explore", now: 2, exploreArea: { id: "a", name: "Hall" } },
            { type: "open-log" }
        );
        state = reduceQuest(state, { type: "abandon", path: "explore" });
        expect(state.quests.explore).toMatchObject({ accepted: false, origin: null });
        expect(state.exploreArea).toBeNull();
        expect(state.tracked).toBe("meet");
        expect(state.surface).toBe("log");
        state = reduceQuest(state, { type: "abandon", path: "meet" });
        expect(state.tracked).toBeNull();
        expect(canOfferInvitation({ ...state, surface: "none" })).toBe(true);
        // Never a quest that is done, or one never taken.
        const done = run({ type: "accept", path: "build", now: 1 }, { type: "complete", path: "build", now: 2 });
        expect(reduceQuest(done, { type: "abandon", path: "build" })).toBe(done);
        expect(reduceQuest(initialQuestState(), { type: "abandon", path: "meet" })).toEqual(initialQuestState());
    });

    it("the pill toggles the panel", () => {
        const opened = run({ type: "accept", path: "build", now: 1 }, { type: "close" }, { type: "toggle-log" });
        expect(opened.surface).toBe("log");
        expect(reduceQuest(opened, { type: "toggle-log" }).surface).toBe("pill");
        const fresh = reduceQuest(initialQuestState(), { type: "toggle-log" });
        expect(fresh.surface).toBe("log");
        expect(reduceQuest(fresh, { type: "toggle-log" }).surface).toBe("none");
    });

    it("the tracked completion waits for its celebration; an untracked one finishes quietly with a dot", () => {
        let state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "accept", path: "explore", now: 2 },
            { type: "complete", path: "meet", now: 3 }
        );
        expect(state.quests.meet.done).toBe(true);
        expect(state.pending).toEqual([]);
        expect(state.news).toBe(true);

        state = reduceQuest(state, { type: "complete", path: "explore", now: 4 });
        expect(state.pending).toEqual(["explore"]);
        expect(state.tracked).toBe("explore");
    });

    it("ignores completions of quests that were never accepted", () => {
        const state = initialQuestState();
        expect(reduceQuest(state, { type: "complete", path: "build", now: 1 })).toBe(state);
    });

    it("pauses Meet while nobody is here and resumes silently", () => {
        let state = run({ type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "pause", path: "meet", reason: "no-eligible-target" });
        expect(state.quests.meet.paused).toBe("no-eligible-target");
        expect(state.tracked).toBe("meet");
        state = reduceQuest(state, { type: "resume", path: "meet" });
        expect(state.quests.meet.paused).toBeNull();
    });

    it("closing the log rests on the pill", () => {
        const tracked = run({ type: "accept", path: "meet", now: 1 }, { type: "open-log" }, { type: "close" });
        expect(tracked.surface).toBe("pill");
        // Only the log closes this way.
        const invitation = run({ type: "invitation-shown" });
        expect(reduceQuest(invitation, { type: "close" })).toBe(invitation);
    });

    it("a celebration settles into the panel, with the quest done and nothing on the map", () => {
        let state = run({ type: "accept", path: "meet", now: 1 }, { type: "complete", path: "meet", now: 2 });
        state = revealPending(state, false);
        expect(state.surface).toBe("celebration");
        expect(state.celebrating).toBe("meet");
        // Tapping it, or the panel opening over it, ends it either way.
        expect(reduceQuest(state, { type: "close" })).toBe(state);
        state = reduceQuest(state, { type: "celebration-settled" });
        expect(state.surface).toBe("log");
        expect(state.celebrating).toBeNull();
        expect(state.tracked).toBeNull();
        expect(state.chapterCelebrated).toBe(false);
        expect(reduceQuest(state, { type: "close" }).surface).toBe("none");
        expect(visibleSurface(reduceQuest(state, { type: "close" }), free)).toBe("pill");
    });

    it("the last quest's celebration is followed by the chapter's own, once", () => {
        let state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "complete", path: "meet", now: 2 },
            { type: "accept", path: "explore", now: 3 },
            { type: "complete", path: "explore", now: 4 },
            { type: "accept", path: "build", now: 5 },
            { type: "complete", path: "build", now: 6 }
        );
        state = revealPending(state, false);
        expect(state.celebrating).toBe("build");
        state = reduceQuest(state, { type: "celebration-settled" });
        expect(state.surface).toBe("celebration");
        expect(state.celebrating).toBeNull();
        state = reduceQuest(state, { type: "celebration-settled" });
        expect(state.surface).toBe("log");
        expect(state.chapterCelebrated).toBe(true);
        // Never again: a later reset-and-redo would, but not this browser.
        expect(reduceQuest(state, { type: "celebration-settled" })).toBe(state);
    });

    it("opening the panel over the chapter's celebration counts it as played too", () => {
        let state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "complete", path: "meet", now: 2 },
            { type: "accept", path: "explore", now: 3 },
            { type: "complete", path: "explore", now: 4 },
            { type: "accept", path: "build", now: 5 },
            { type: "complete", path: "build", now: 6 }
        );
        state = reduceQuest(revealPending(state, false), { type: "celebration-settled" });
        expect(state.celebrating).toBeNull();
        state = reduceQuest(state, { type: "open-log" });
        expect(state.surface).toBe("log");
        expect(state.chapterCelebrated).toBe(true);
    });

    it("reset starts over", () => {
        const state = run({ type: "accept", path: "meet", now: 1 }, { type: "decline" }, { type: "reset" });
        expect(state).toEqual(initialQuestState());
    });
});

describe("revealPending", () => {
    const completed = () =>
        run({ type: "accept", path: "explore", now: 1 }, { type: "complete", path: "explore", now: 2 });

    it("waits while blocked, then plays and releases the tracked slot", () => {
        const state = completed();
        expect(revealPending(state, true)).toBe(state);
        const shown = revealPending(state, false);
        expect(shown.surface).toBe("celebration");
        expect(shown.celebrating).toBe("explore");
        expect(shown.pending).toEqual([]);
        expect(shown.tracked).toBeNull();
    });

    it("never hijacks a quest tracked after the completion", () => {
        let state = completed();
        state = reduceQuest(state, { type: "accept", path: "meet", now: 3 });
        const next = revealPending(state, false);
        expect(next.pending).toEqual([]);
        expect(next.celebrating).toBeNull();
        expect(next.surface).toBe("pill");
        expect(next.tracked).toBe("meet");
        expect(next.quests.explore.done).toBe(true);
    });

    it("opening the panel over a celebration ends it", () => {
        const shown = revealPending(completed(), false);
        const log = reduceQuest(shown, { type: "open-log" });
        expect(log.celebrating).toBeNull();
        expect(reduceQuest(log, { type: "close" }).surface).toBe("none");
    });

    it("does not interrupt the panel", () => {
        const state = reduceQuest(completed(), { type: "open-log" });
        expect(revealPending(state, false).surface).toBe("log");
    });

    it("returns the same object when nothing changes", () => {
        const state = initialQuestState();
        expect(revealPending(state, false)).toBe(state);
    });
});

describe("visibleSurface", () => {
    it("hides surfaces but lets the pill stay under the Express tray", () => {
        const pill = run({ type: "accept", path: "meet", now: 1 });
        expect(visibleSurface(pill, { surfaces: true, pill: false })).toBe("pill");
        expect(visibleSurface(pill, { surfaces: true, pill: true })).toBe("none");
        const log = reduceQuest(pill, { type: "open-log" });
        expect(visibleSurface(log, { surfaces: true, pill: false })).toBe("none");
        expect(log.surface).toBe("log");
    });

    it("rests on the Quests pill whenever nothing is on the map, unless covered or nothing is on offer", () => {
        const fresh = initialQuestState();
        expect(visibleSurface(fresh, free)).toBe("pill");
        expect(visibleSurface(fresh, { surfaces: false, pill: true })).toBe("none");
        // Nothing on offer here (or the map not there yet): no pill; the menu row stays the way in.
        expect(visibleSurface(fresh, free, false)).toBe("none");
        const followed = run({ type: "accept", path: "meet", now: 1 });
        expect(visibleSurface(followed, free, false)).toBe("pill");
        const done = revealPending(
            run({ type: "accept", path: "build", now: 1 }, { type: "complete", path: "build", now: 2 }),
            false
        );
        expect(visibleSurface(done, free)).toBe("celebration");
        expect(visibleSurface(reduceQuest(done, { type: "celebration-settled" }), free)).toBe("log");
    });
});

describe("questsOnOffer", () => {
    it("is true once the map is ready with something to start, accepted or done", () => {
        const fresh = initialQuestState();
        expect(questsOnOffer(fresh, [], true)).toBe(false);
        expect(questsOnOffer(fresh, ["meet"], false)).toBe(false);
        expect(questsOnOffer(fresh, ["meet"], true)).toBe(true);
        const accepted = run({ type: "accept", path: "meet", now: 1 }, { type: "accept", path: "build", now: 2 });
        expect(questsOnOffer(accepted, [], true)).toBe(true);
        const done = run({ type: "accept", path: "meet", now: 1 }, { type: "complete", path: "meet", now: 2 });
        expect(questsOnOffer(revealPending(done, false), [], true)).toBe(true);
    });
});

describe("markedQuestPath", () => {
    it("marks the quest on the map always, except already done", () => {
        const state = run({ type: "accept", path: "explore", now: 1 });
        expect(markedQuestPath(state)).toBe("explore");
        expect(markedQuestPath(reduceQuest(state, { type: "open-log" }))).toBe("explore");
        expect(markedQuestPath(reduceQuest(state, { type: "complete", path: "explore", now: 2 }))).toBeNull();
        expect(markedQuestPath(initialQuestState())).toBeNull();
    });
});
