import { describe, expect, it } from "vitest";
import {
    engineActionFor,
    mergeEngineProgress,
    parseEngineQuests,
    questPathOfEngineId,
    unsyncedActions,
    type QuestEngineQuest,
} from "../QuestEngine";
import { initialQuestState, reduceQuest } from "../QuestModel";

function remote(id: QuestEngineQuest["id"], status: QuestEngineQuest["status"], tracked = false): QuestEngineQuest {
    return { id, status, tracked, acceptedAt: 1_000, doneAt: status === "done" ? 2_000 : null };
}

describe("quest engine ids", () => {
    it("reads only the Welcome chapter's keys", () => {
        expect(questPathOfEngineId("welcome.meet")).toBe("meet");
        expect(questPathOfEngineId("welcome.fly")).toBeNull();
        expect(questPathOfEngineId(42)).toBeNull();
    });
});

describe("engineActionFor", () => {
    it("reports what the player did and what finished a quest", () => {
        expect(engineActionFor({ type: "accept", path: "meet", now: 1 })).toEqual({
            action: "accept",
            questId: "welcome.meet",
        });
        expect(engineActionFor({ type: "track", path: "build" })).toEqual({
            action: "track",
            questId: "welcome.build",
        });
        expect(engineActionFor({ type: "abandon", path: "explore" })).toEqual({
            action: "stop",
            questId: "welcome.explore",
        });
        expect(engineActionFor({ type: "complete", path: "meet", now: 5 })).toEqual({
            action: "observe",
            questId: "welcome.meet",
            observedAt: 5,
        });
    });

    it("keeps the dock's own business to itself", () => {
        expect(engineActionFor({ type: "open-log" })).toBeNull();
        expect(engineActionFor({ type: "news" })).toBeNull();
        expect(engineActionFor({ type: "reset" })).toBeNull();
    });
});

describe("parseEngineQuests", () => {
    it("accepts a bare list or a { quests } body and drops what it does not know", () => {
        const body = {
            quests: [
                { id: "welcome.meet", status: "done", tracked: true, acceptedAt: 1, doneAt: 2 },
                { id: "welcome.explore", status: "in-progress", tracked: true, acceptedAt: "x" },
                { id: "other.quest", status: "done" },
                { id: "welcome.build", status: "sideways" },
                null,
            ],
        };
        expect(parseEngineQuests(body)).toEqual([
            { id: "welcome.meet", status: "done", tracked: false, acceptedAt: 1, doneAt: 2 },
            { id: "welcome.explore", status: "in-progress", tracked: true, acceptedAt: null, doneAt: null },
        ]);
        expect(parseEngineQuests(body.quests.slice(0, 1))).toHaveLength(1);
        expect(parseEngineQuests({ nope: true })).toBeNull();
    });
});

describe("mergeEngineProgress", () => {
    it("returns the same state when the engine agrees", () => {
        const state = initialQuestState();
        expect(mergeEngineProgress(state, [])).toBe(state);
        expect(mergeEngineProgress(state, [remote("welcome.meet", "not-started")])).toBe(state);
    });

    it("takes quests accepted and finished elsewhere, quietly", () => {
        const merged = mergeEngineProgress(initialQuestState(), [
            remote("welcome.meet", "done"),
            remote("welcome.explore", "in-progress", true),
        ]);
        expect(merged.quests.meet).toMatchObject({ accepted: true, done: true, doneAt: 2_000 });
        expect(merged.quests.explore).toMatchObject({ accepted: true, done: false, acceptedAt: 1_000 });
        expect(merged.tracked).toBe("explore");
        expect(merged.pending).toEqual([]);
    });

    it("never undoes what this browser finished, and keeps its own tracked quest", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "build", now: 1 });
        state = reduceQuest(state, { type: "track", path: "build" });
        const merged = mergeEngineProgress(state, [
            remote("welcome.build", "not-started"),
            remote("welcome.meet", "in-progress", true),
        ]);
        expect(merged.quests.build.accepted).toBe(true);
        expect(merged.tracked).toBe("build");
    });

    it("drops a tracked quest the engine says is finished", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "track", path: "meet" });
        const merged = mergeEngineProgress(state, [remote("welcome.meet", "done")]);
        expect(merged.quests.meet.done).toBe(true);
        expect(merged.tracked).toBeNull();
    });
});

describe("unsyncedActions", () => {
    it("reports no track for a quest finished elsewhere, once merged", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "track", path: "meet" });
        const engine = [remote("welcome.meet", "done")];
        expect(unsyncedActions(mergeEngineProgress(state, engine), engine)).toEqual([]);
    });

    it("reports what only this browser knew", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "complete", path: "meet", now: 3 });
        state = reduceQuest(state, { type: "accept", path: "explore", now: 4 });
        state = reduceQuest(state, { type: "track", path: "explore" });
        expect(unsyncedActions(state, [remote("welcome.meet", "in-progress")])).toEqual([
            { action: "observe", questId: "welcome.meet", observedAt: 3 },
            { action: "accept", questId: "welcome.explore" },
            { action: "track", questId: "welcome.explore" },
        ]);
    });

    it("has nothing to say when the engine is caught up", () => {
        const state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        const tracked = state.tracked === "meet";
        expect(unsyncedActions(state, [remote("welcome.meet", "in-progress", tracked)])).toEqual([]);
    });
});
