import { describe, expect, it, vi } from "vitest";
import { canOfferInvitation, initialQuestState, reduceQuest, revealPending } from "../QuestModel";
import {
    parseInvitationSeen,
    parseStoredProgress,
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
                    explore: { done: true, doneAt: 9 },
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
            origin: null,
        });
        // Done implies accepted.
        expect(progress?.quests.explore).toMatchObject({ accepted: true, done: true, doneAt: 9 });
        expect(progress?.quests.build.accepted).toBe(false);
        expect(progress?.tracked).toBe("meet");
        expect(progress?.pending).toEqual(["explore"]);
        expect(progress?.exploreArea).toEqual({ id: "a", name: "Courtyard" });
        expect(progress?.news).toBe(true);
    });

    it("reads the giver frozen at acceptance, and a save from before givers had a kind", () => {
        const stored = (origin: unknown) =>
            parseStoredProgress(JSON.stringify({ version: 1, quests: { meet: { accepted: true, origin } } }))?.quests
                .meet.origin;
        expect(stored({ room: "Lobby", giver: { kind: "bot", name: "Guide", uuid: "bot-1" } })).toEqual({
            room: "Lobby",
            giver: { kind: "bot", name: "Guide", uuid: "bot-1" },
        });
        expect(stored({ room: "Lobby", giver: { kind: "area", name: "Hall" } })).toEqual({
            room: "Lobby",
            giver: { kind: "area", name: "Hall" },
        });
        expect(stored({ room: "Lobby", giver: "Guide" })).toEqual({
            room: "Lobby",
            giver: { kind: "bot", name: "Guide" },
        });
        expect(stored({ room: "Lobby", giver: null })).toEqual({ room: "Lobby", giver: null });
        expect(stored({ room: "Lobby", giver: { kind: "ghost", name: "X" } })).toEqual({ room: "Lobby", giver: null });
        expect(stored({ room: 5 })).toBeNull();
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
            origin: { room: "Lobby", giver: { kind: "bot", name: "Guide", uuid: "bot-1" } },
        });
        saveQuestState(storage, state);
        expect(storage.data.get(QUEST_INVITATION_SEEN_KEY)).toBe("1");
        expect(storage.data.has("quests.invitationDeclined")).toBe(false);

        const restored = restoreQuestState(storage);
        expect(restored.surface).toBe("pill");
        expect(restored.tracked).toBe("explore");
        expect(restored.exploreArea).toEqual({ id: "a", name: "Hall" });
        expect(restored.quests.explore.origin).toEqual({
            room: "Lobby",
            giver: { kind: "bot", name: "Guide", uuid: "bot-1" },
        });
        expect(restored.invitationSeen).toBe(1);
    });

    it("nothing tracked restores to an empty dock", () => {
        const fresh = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(initialQuestState()) }));
        expect(fresh.tracked).toBeNull();
        expect(fresh.surface).toBe("none");
    });

    it("keeps the giver's face with the quest, and drops one that is not a small image", () => {
        const stored = (portrait: unknown) =>
            parseStoredProgress(
                JSON.stringify({
                    version: 1,
                    quests: {
                        meet: {
                            accepted: true,
                            origin: { room: "Lobby", giver: { kind: "bot", name: "Guide", portrait } },
                        },
                    },
                })
            )?.quests.meet.origin?.giver;
        expect(stored("data:image/png;base64,AAAA")).toEqual({
            kind: "bot",
            name: "Guide",
            portrait: "data:image/png;base64,AAAA",
        });
        expect(stored("https://elsewhere/x.png")).toEqual({ kind: "bot", name: "Guide" });
        expect(stored("data:image/png;base64," + "A".repeat(70_000))).toEqual({ kind: "bot", name: "Guide" });
    });

    it("never stores Not now: a fresh load offers again, and the declined show does not count as a fade", () => {
        const storage = memoryStorage();
        let state = reduceQuest(initialQuestState(), { type: "invitation-shown" });
        state = reduceQuest(state, { type: "decline" });
        saveQuestState(storage, state);
        expect([...storage.data.keys()]).toEqual([QUEST_STATE_KEY, QUEST_INVITATION_SEEN_KEY]);
        expect(storage.data.get(QUEST_INVITATION_SEEN_KEY)).toBe("0");
        expect(storage.data.get(QUEST_STATE_KEY)).not.toContain("declined");

        const restored = restoreQuestState(storage);
        expect(restored.declined).toBe(false);
        expect(canOfferInvitation(restored)).toBe(true);

        // Ignored twice, on the other hand, stays remembered.
        let faded = reduceQuest(initialQuestState(), { type: "invitation-shown" });
        faded = reduceQuest(faded, { type: "invitation-faded" });
        faded = reduceQuest(faded, { type: "invitation-shown" });
        faded = reduceQuest(faded, { type: "invitation-faded" });
        saveQuestState(storage, faded);
        expect(canOfferInvitation(restoreQuestState(storage))).toBe(false);
    });

    it("a celebration on screen when the page closed plays again after a reload", () => {
        let state = initialQuestState();
        state = reduceQuest(state, { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "complete", path: "meet", now: 2 });
        state = revealPending(state, false);
        expect(state.celebrating).toBe("meet");
        const storage = memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(state) });
        const restored = restoreQuestState(storage);
        expect(restored.pending).toEqual(["meet"]);
        expect(restored.tracked).toBeNull();
        expect(revealPending(restored, false).celebrating).toBe("meet");
    });

    it("a celebration still waiting survives a reload, and the quest on the map stays there", () => {
        let state = initialQuestState();
        state = reduceQuest(state, { type: "accept", path: "explore", now: 1 });
        state = reduceQuest(state, { type: "complete", path: "explore", now: 2 });
        // Before the celebration could play, the player chose Meet.
        state = reduceQuest(state, { type: "accept", path: "meet", now: 3 });
        const saved = serializeProgress(state);
        expect(JSON.parse(saved).pending).toEqual(["explore"]);
        const restored = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: saved }));
        expect(restored.tracked).toBe("meet");
        expect(restored.pending).toEqual(["explore"]);
        expect(revealPending(restored, false).celebrating).toBe("explore");
    });

    it("quests finished together: the one playing and the ones still waiting all come back after a reload", () => {
        let state = initialQuestState();
        state = reduceQuest(state, { type: "accept", path: "meet", now: 1 });
        state = reduceQuest(state, { type: "accept", path: "build", now: 2 });
        state = reduceQuest(state, { type: "complete", path: "build", now: 3 });
        state = reduceQuest(state, { type: "complete", path: "meet", now: 4 });
        // The first celebration plays and releases the map; the second still waits.
        state = revealPending(state, false);
        expect(state.celebrating).toBe("build");
        expect(state.tracked).toBeNull();
        const saved = serializeProgress(state);
        expect(JSON.parse(saved).pending).toEqual(["build", "meet"]);
        const restored = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: saved }));
        expect(restored.pending).toEqual(["build", "meet"]);
    });

    it("the chapter's celebration, cut short by a reload, plays after it, and only once", () => {
        let state = initialQuestState();
        for (const [index, path] of (["meet", "explore", "build"] as const).entries()) {
            state = reduceQuest(state, { type: "accept", path, now: index * 2 + 1 });
            state = reduceQuest(state, { type: "complete", path, now: index * 2 + 2 });
        }
        for (let i = 0; i < 3; i++) state = reduceQuest(revealPending(state, false), { type: "celebration-settled" });
        // The chapter's celebration is on screen when the page closes.
        expect(state.surface).toBe("celebration");
        expect(state.celebrating).toBeNull();
        const restored = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(state) }));
        expect(restored.pending).toEqual([]);
        expect(revealPending(restored, true)).toBe(restored);
        const replayed = revealPending(restored, false);
        expect(replayed.surface).toBe("celebration");
        expect(replayed.celebrating).toBeNull();
        const settled = reduceQuest(replayed, { type: "celebration-settled" });
        expect(settled.chapterCelebrated).toBe(true);
        // Played to its end, it stays played across the next reload.
        const again = restoreQuestState(memoryStorage({ [QUEST_STATE_KEY]: serializeProgress(settled) }));
        expect(revealPending(again, false)).toBe(again);
    });

    it("keeps the room's address with a quest, from this game only", () => {
        const origin = (url: unknown) =>
            parseStoredProgress(
                JSON.stringify({
                    version: 1,
                    quests: { meet: { accepted: true, origin: { room: "test", giver: null, url } } },
                })
            )?.quests.meet.origin?.url;
        const here = `${window.location.origin}/@/bawes/hq/test`;
        expect(origin(here)).toBe(here);
        expect(origin("https://elsewhere.example/@/a/b/c")).toBeUndefined();
        expect(origin("javascript:alert(1)")).toBeUndefined();
        expect(origin(`${window.location.origin}/${"x".repeat(600)}`)).toBeUndefined();
        expect(origin(42)).toBeUndefined();
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
