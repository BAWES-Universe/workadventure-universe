import { describe, expect, it, vi } from "vitest";
import { initialQuestState, reduceQuest, revealPending } from "../QuestModel";
import {
    parseInvitationSeen,
    parseStoredProgress,
    QUEST_INVITATION_DECLINED_KEY,
    QUEST_INVITATION_SEEN_KEY,
    QUEST_STATE_KEY,
    restoreQuestState,
    saveQuestState,
    serializeProgress,
} from "../QuestPersistence";

function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
    };
}

describe("parseStoredProgress", () => {
    it("rejects anything that is not our JSON", () => {
        expect(parseStoredProgress(null)).toBeNull();
        expect(parseStoredProgress("")).toBeNull();
        expect(parseStoredProgress("{nope")).toBeNull();
        expect(parseStoredProgress("[]")).toBeNull();
        expect(parseStoredProgress(JSON.stringify({ version: 2 }))).toBeNull();
    });

    it("keeps only well-formed fields", () => {
        const progress = parseStoredProgress(
            JSON.stringify({
                version: 1,
                quests: {
                    meet: { accepted: true, done: "yes", paused: "whatever", acceptedAt: "5" },
                    explore: { done: true, doneAt: 9, viaShowMe: 1 },
                    build: null,
                    extra: { accepted: true },
                },
                tracked: "meet",
                hidden: "true",
                pending: ["explore", "explore", "meet", "nope"],
                exploreArea: { id: "a", name: "Courtyard" },
                news: true,
            })
        );
        expect(progress).not.toBeNull();
        expect(progress?.quests.meet).toEqual({
            accepted: true,
            done: false,
            paused: null,
            acceptedAt: null,
            doneAt: null,
            viaShowMe: false,
            origin: null,
        });
        // Done implies accepted.
        expect(progress?.quests.explore).toMatchObject({ accepted: true, done: true, doneAt: 9, viaShowMe: false });
        expect(progress?.quests.build.accepted).toBe(false);
        expect(progress?.tracked).toBe("meet");
        expect(progress?.hidden).toBe(false);
        expect(progress?.pending).toEqual(["explore"]);
        expect(progress?.exploreArea).toEqual({ id: "a", name: "Courtyard" });
        expect(progress?.news).toBe(true);
    });

    it("drops a tracked quest that is not accepted or already done", () => {
        const progress = parseStoredProgress(
            JSON.stringify({ version: 1, quests: { build: { accepted: true, done: true } }, tracked: "build" })
        );
        expect(progress?.tracked).toBeNull();
        expect(parseStoredProgress(JSON.stringify({ version: 1, quests: {}, tracked: "meet" }))?.tracked).toBeNull();
    });

    it("drops an oversized or malformed explore area", () => {
        const long = "x".repeat(500);
        const base = { version: 1, quests: { explore: { accepted: true } } };
        expect(parseStoredProgress(JSON.stringify({ ...base, exploreArea: { id: 1, name: "A" } }))?.exploreArea).toBe(
            null
        );
        expect(
            parseStoredProgress(JSON.stringify({ ...base, exploreArea: { id: "a", name: long } }))?.exploreArea
        ).toBeNull();
    });
});

describe("parseInvitationSeen", () => {
    it("reads a small non-negative count", () => {
        expect(parseInvitationSeen(null)).toBe(0);
        expect(parseInvitationSeen("abc")).toBe(0);
        expect(parseInvitationSeen("-3")).toBe(0);
        expect(parseInvitationSeen("1")).toBe(1);
        expect(parseInvitationSeen("99")).toBe(2);
    });
});

describe("save and restore", () => {
    it("round-trips progress and brings the tracked quest back as its pill", () => {
        const storage = memoryStorage();
        let state = initialQuestState();
        state = reduceQuest(state, { type: "invitation-shown" });
        state = reduceQuest(state, {
            type: "accept",
            path: "explore",
            now: 10,
            exploreArea: { id: "a", name: "Hall" },
            origin: { room: "Lobby", giver: "Guide" },
        });
        saveQuestState(storage, state);
        expect(storage.data.get(QUEST_INVITATION_SEEN_KEY)).toBe("1");
        expect(storage.data.has(QUEST_INVITATION_DECLINED_KEY)).toBe(false);

        const restored = restoreQuestState(storage);
        expect(restored.surface).toBe("pill");
        expect(restored.tracked).toBe("explore");
        expect(restored.exploreArea).toEqual({ id: "a", name: "Hall" });
        expect(restored.quests.explore.origin).toEqual({ room: "Lobby", giver: "Guide" });
        expect(restored.invitationSeen).toBe(1);
    });

    it("a hidden tracked quest, or nothing tracked, restores to an empty dock", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "build", now: 1 });
        state = reduceQuest(state, { type: "hide" });
        const hidden = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(state) }));
        expect(hidden.tracked).toBe("build");
        expect(hidden.surface).toBe("none");

        const asideState = reduceQuest(reduceQuest(initialQuestState(), { type: "accept", path: "build", now: 1 }), {
            type: "set-aside",
        });
        const aside = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(asideState) }));
        expect(aside.surface).toBe("none");
    });

    it("remembers Not now under its own key", () => {
        const storage = memoryStorage();
        saveQuestState(storage, reduceQuest(initialQuestState(), { type: "decline" }));
        expect(storage.data.get(QUEST_INVITATION_DECLINED_KEY)).toBe("true");
        expect(restoreQuestState(storage).declined).toBe(true);
    });

    it("a payoff on screen when the page closed plays again after a reload", () => {
        let state = initialQuestState();
        state = reduceQuest(state, { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "complete", path: "meet", now: 2 });
        state = revealPending(state, false);
        expect(state.payoff).toBe("meet");
        const storage = memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(state) });
        const restored = restoreQuestState(storage);
        expect(restored.pending).toEqual(["meet"]);
        expect(restored.tracked).toBe("meet");
        expect(revealPending(restored, false).payoff).toBe("meet");
    });

    it("a payoff still waiting when another quest was tracked never takes that quest's place", () => {
        let state = initialQuestState();
        state = reduceQuest(state, { type: "accept", path: "explore", now: 1 });
        state = reduceQuest(state, { type: "complete", path: "explore", now: 2 });
        // Before the payoff could play, the player chose Meet.
        state = reduceQuest(state, { type: "accept", path: "meet", now: 3 });
        expect(state.tracked).toBe("meet");
        const saved = serializeProgress(state);
        expect(JSON.parse(saved).pending).toEqual([]);

        // An older save that still carries the stale payoff restores the player's choice too.
        const stale = JSON.stringify({ ...JSON.parse(saved), pending: ["explore"] });
        const restored = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: stale }));
        expect(restored.tracked).toBe("meet");
        expect(restored.pending).toEqual([]);
    });

    it("survives storage that throws", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const throwing = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
            removeItem: () => {
                throw new Error("blocked");
            },
        };
        expect(restoreQuestState(throwing)).toEqual(initialQuestState());
        expect(() => saveQuestState(throwing, initialQuestState())).not.toThrow();
    });
});
