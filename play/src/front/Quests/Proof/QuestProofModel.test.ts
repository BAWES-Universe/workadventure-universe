import { describe, expect, it } from "vitest";
import {
    availablePaths,
    effectiveSurface,
    initialProofState,
    reduceProof,
    restoreProof,
    revealPending,
} from "./QuestProofModel";
import { createQuestProofController, PROOF_STORAGE_KEY } from "./QuestProofController";
import type { ProofEvent, QuestProofState } from "./QuestProofModel";
const run = (events: ProofEvent[], state = initialProofState()) => events.reduce(reduceProof, state);
const acceptMeet: ProofEvent = { type: "accept", path: "meet" };
const sent: ProofEvent = { type: "message", direction: "sent", session: 1 };
const received: ProofEvent = { type: "message", direction: "received", session: 1 };

describe("quest proof safety contracts", () => {
    it("declining leaves no pill and stays declined after returning", () => {
        const state = run([{ type: "decline" }]);
        expect(state.tracked).toBeNull();
        expect(state.surface).toBe("hidden");
        expect(restoreProof(JSON.stringify(state))?.surface).toBe("hidden");
    });
    it("a sent message alone does not earn the stamp", () => {
        const state = run([acceptMeet, sent, sent]);
        expect(state.quests.meet.done).toBe(false);
        expect(state.pending).toEqual([]);
    });
    it("requires both directions in one session and grants only once", () => {
        const state = run([acceptMeet, received, sent, received, sent]);
        expect(state.quests.meet.done).toBe(true);
        expect(state.pending).toEqual(["meet"]);
    });
    it("does not join an old outgoing message to a new participant's reply", () => {
        const state = run([
            acceptMeet,
            sent,
            { type: "participant-left" },
            { type: "participant-returned" },
            { type: "message", direction: "received", session: 2 },
        ]);
        expect(state.quests.meet.done).toBe(false);
        expect(reduceProof(state, { type: "message", direction: "sent", session: 2 }).quests.meet.done).toBe(true);
    });
    it("ignores stale replies after reconnect and keeps acceptance", () => {
        const state = run([acceptMeet, sent, { type: "reconnect" }, received]);
        expect(state.quests.meet).toEqual({ accepted: true, done: false });
        expect(state.exchange).toEqual({ session: 2, sent: false, received: false });
        expect(state.tracked).toBe("meet");
    });
    it("credits an accepted untracked quest quietly without replacing the tracked quest", () => {
        const state = run([acceptMeet, { type: "accept", path: "explore" }, sent, received]);
        expect(state.quests.meet.done).toBe(true);
        expect(state.pending).toEqual([]);
        const revealed = revealPending(state, false);
        expect(revealed.tracked).toBe("explore");
        expect(revealed.surface).toBe("pill");
    });
    it("untracking keeps progress and does not make later completion intrusive", () => {
        const state = run([acceptMeet, sent, { type: "untrack" }, received]);
        expect(state.quests.meet.done).toBe(true);
        expect(state.surface).toBe("hidden");
        expect(revealPending(state, false).surface).toBe("hidden");
    });
    it("quietly consumes a deferred payoff after the player follows another quest", () => {
        const completed = run([acceptMeet, sent, received]);
        expect(revealPending(completed, true)).toBe(completed);
        const switched = run([{ type: "log" }, { type: "accept", path: "explore" }], completed);
        const revealed = revealPending(switched, false);
        expect(revealed.quests.meet.done).toBe(true);
        expect(revealed.pending).toEqual([]);
        expect(revealed.tracked).toBe("explore");
        expect(revealed.surface).toBe("pill");
    });
    it("does not count actions before explicit acceptance", () => {
        const state = run([sent, received, { type: "area-entered" }, { type: "safe-build-placed" }]);
        expect(Object.values(state.quests).every((quest) => !quest.done)).toBe(true);
    });
    it("defers a tracked payoff during a busy surface", () => {
        const done = run([acceptMeet, sent, received]);
        expect(effectiveSurface(done, true)).toBe("hidden");
        expect(revealPending(done, true)).toBe(done);
        expect(revealPending(done, false).surface).toBe("payoff");
    });
    it("does not auto-open a stamp over an explicitly opened log", () => {
        const state = run([acceptMeet, { type: "log" }, sent, received]);
        expect(effectiveSurface(state, true)).toBe("log");
        expect(revealPending(state, false)).toBe(state);
    });
    it("does not reopen a hidden tracker for a reward", () => {
        const state = run([acceptMeet, { type: "hide" }, sent, received]);
        expect(revealPending(state, false).surface).toBe("hidden");
        expect(state.quests.meet.done).toBe(true);
    });
    it("settling a payoff restores a different unfinished tracked quest", () => {
        const state: QuestProofState = {
            ...run([{ type: "accept", path: "explore" }]),
            surface: "payoff",
            payoff: "meet",
        };
        expect(reduceProof(state, { type: "settle" }).surface).toBe("pill");
    });
    it("does not infer a build permission or target in the no-host fixture", () => {
        const state = initialProofState("none");
        expect(availablePaths(state)).toEqual(["meet", "explore"]);
        expect(reduceProof(state, { type: "accept", path: "build" }).quests.build.accepted).toBe(false);
    });
    it("empty room offers nothing but retains an accessible log", () => {
        const state = run([{ type: "log" }], initialProofState("empty"));
        expect(availablePaths(state)).toEqual([]);
        expect(effectiveSurface(state, false)).toBe("log");
    });
    it("missing targets cannot complete but never erase accepted progress", () => {
        const state = run([{ type: "accept", path: "explore" }, { type: "target-removed" }, { type: "area-entered" }]);
        expect(availablePaths(state)).not.toContain("explore");
        expect(state.quests.explore).toEqual({ accepted: true, done: false });
        expect(state.tracked).toBe("explore");
    });
    it("appointment arrival suppresses the invitation without permanently declining", () => {
        const state = run([{ type: "appointment", value: true }]);
        expect(effectiveSurface(state, false)).toBe("hidden");
        expect(state.declined).toBe(false);
        expect(effectiveSurface(reduceProof(state, { type: "appointment", value: false }), false)).toBe("invitation");
    });
    it("restores completed stamps and acceptance but not a stale message session", () => {
        const original = run([acceptMeet, sent]);
        const state = restoreProof(JSON.stringify(original));
        expect(state?.quests.meet.accepted).toBe(true);
        expect(state?.exchange.sent).toBe(false);
        expect(state?.surface).toBe("pill");
    });
    it("rejects malformed storage and isolates persistence from account preferences", () => {
        expect(restoreProof("not JSON")).toBeNull();
        const writes: string[] = [];
        const controller = createQuestProofController({
            getItem: () => null,
            setItem: (key) => {
                writes.push(key);
            },
        });
        controller.send({ type: "decline" });
        controller.openLog();
        expect(writes).toEqual([PROOF_STORAGE_KEY, PROOF_STORAGE_KEY]);
    });
    it("works when storage is blocked", () => {
        const controller = createQuestProofController({
            getItem: () => {
                throw Error("blocked");
            },
            setItem: () => {
                throw Error("blocked");
            },
        });
        expect(() => controller.send(acceptMeet)).not.toThrow();
    });
    it("resets every earned fixture stamp on explicit proof reset", () => {
        const state = run([acceptMeet, sent, received, { type: "reset", scenario: "area" }]);
        expect(state).toEqual(initialProofState("area"));
    });
});
