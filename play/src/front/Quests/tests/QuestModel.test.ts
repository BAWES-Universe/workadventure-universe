import { describe, expect, it } from "vitest";
import type { QuestEvent, QuestState } from "../QuestModel";
import {
    acceptedUntrackedCount,
    canOfferInvitation,
    initialQuestState,
    questStatus,
    reduceQuest,
    revealPending,
    visibleSurface,
} from "../QuestModel";

function run(...events: QuestEvent[]): QuestState {
    return events.reduce(reduceQuest, initialQuestState());
}

const free = { surfaces: false, pill: false };

describe("reduceQuest", () => {
    it("goes invitation → options → pill on accepting a path", () => {
        const state = run(
            { type: "invitation-shown" },
            { type: "open-options" },
            { type: "accept", path: "meet", now: 5 }
        );
        expect(state.surface).toBe("pill");
        expect(state.tracked).toBe("meet");
        expect(state.quests.meet).toMatchObject({ accepted: true, done: false, acceptedAt: 5 });
        expect(state.invitationSeen).toBe(1);
    });

    it("closing the options goes back to the invitation: a close is not a decline", () => {
        const state = run({ type: "invitation-shown" }, { type: "open-options" }, { type: "close" });
        expect(state.surface).toBe("invitation");
        expect(state.declined).toBe(false);
    });

    it("Not now is remembered and the invitation is never offered again", () => {
        const state = run({ type: "invitation-shown" }, { type: "decline" });
        expect(state.declined).toBe(true);
        expect(state.surface).toBe("none");
        expect(canOfferInvitation(state)).toBe(false);
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
        const state = run({ type: "accept", path: "explore", now: 1 }, { type: "set-aside" });
        expect(state.surface).toBe("none");
        expect(canOfferInvitation(state)).toBe(false);
    });

    it("tracking another quest keeps the previous one accepted", () => {
        const state = run(
            { type: "accept", path: "meet", now: 1 },
            { type: "accept", path: "explore", now: 2 },
            { type: "track", path: "meet" }
        );
        expect(state.tracked).toBe("meet");
        expect(questStatus(state, "explore")).toBe("accepted");
        expect(acceptedUntrackedCount(state)).toBe(1);
    });

    it("set aside untracks and keeps the quest accepted", () => {
        const state = run({ type: "accept", path: "build", now: 1 }, { type: "open-card" }, { type: "set-aside" });
        expect(state.tracked).toBeNull();
        expect(state.surface).toBe("none");
        expect(questStatus(state, "build")).toBe("accepted");
    });

    it("remove forgets an accepted quest but never an earned one", () => {
        let state = run({ type: "accept", path: "explore", now: 1, exploreArea: { id: "a", name: "Courtyard" } });
        expect(state.exploreArea).toEqual({ id: "a", name: "Courtyard" });
        state = reduceQuest(state, { type: "remove", path: "explore" });
        expect(questStatus(state, "explore")).toBe("available");
        expect(state.exploreArea).toBeNull();

        const done = run({ type: "accept", path: "meet", now: 1 }, { type: "complete", path: "meet", now: 2 });
        expect(reduceQuest(done, { type: "remove", path: "meet" })).toBe(done);
    });

    it("the tracked completion waits for its payoff; an untracked one finishes quietly with a dot", () => {
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

    it("closing the log puts back what it covered", () => {
        const state = run({ type: "invitation-shown" }, { type: "open-log" }, { type: "close" });
        expect(state.surface).toBe("invitation");
        const tracked = run({ type: "accept", path: "meet", now: 1 }, { type: "open-log" }, { type: "close" });
        expect(tracked.surface).toBe("pill");
    });

    it("hiding quests hides everything except the open log; showing brings the pill back", () => {
        let state = run({ type: "accept", path: "meet", now: 1 }, { type: "open-log" }, { type: "hide" });
        expect(state.surface).toBe("log");
        expect(visibleSurface(state, free)).toBe("log");
        state = reduceQuest(state, { type: "close" });
        expect(state.surface).toBe("none");
        state = reduceQuest(state, { type: "show-quests" });
        state = reduceQuest(state, { type: "track", path: "meet" });
        expect(state.surface).toBe("pill");
    });

    it("accepting from the log while hidden un-hides", () => {
        const state = run({ type: "hide" }, { type: "accept", path: "build", now: 1 });
        expect(state.hidden).toBe(false);
    });

    it("the follow-up follows the payoff and closes to the resting dock", () => {
        let state = run({ type: "accept", path: "meet", now: 1 }, { type: "complete", path: "meet", now: 2 });
        state = revealPending(state, false);
        state = reduceQuest(state, { type: "payoff-settled", followUp: "sign-in" });
        expect(state.surface).toBe("follow-up");
        state = reduceQuest(state, { type: "sign-in-later", continuation: true });
        expect(state.signInOfferSkipped).toBe(true);
        expect(state.followUp).toBe("continuation");
        state = reduceQuest(state, { type: "follow-up-closed" });
        expect(state.surface).toBe("none");
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
        expect(shown.surface).toBe("payoff");
        expect(shown.payoff).toBe("explore");
        expect(shown.pending).toEqual([]);
        expect(shown.tracked).toBeNull();
    });

    it("never hijacks a quest tracked after the completion", () => {
        let state = completed();
        state = reduceQuest(state, { type: "accept", path: "meet", now: 3 });
        const next = revealPending(state, false);
        expect(next.pending).toEqual([]);
        expect(next.payoff).toBeNull();
        expect(next.surface).toBe("pill");
        expect(next.tracked).toBe("meet");
        expect(next.quests.explore.done).toBe(true);
    });

    it("opening the log over a payoff ends it", () => {
        const shown = revealPending(completed(), false);
        const log = reduceQuest(shown, { type: "open-log" });
        expect(log.payoff).toBeNull();
        expect(reduceQuest(log, { type: "close" }).surface).toBe("none");
    });

    it("does not interrupt the log", () => {
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
        const card = reduceQuest(pill, { type: "open-card" });
        expect(visibleSurface(card, { surfaces: true, pill: false })).toBe("none");
        expect(card.surface).toBe("card");
    });
});
