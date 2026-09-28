import { describe, expect, it } from "vitest";
import { initialQuestState, reduceQuest } from "../QuestModel";
import type { QuestArea, QuestPresent, QuestWorld } from "../QuestWorld";
import {
    acceptanceOrigin,
    availablePaths,
    EMPTY_QUEST_WORLD,
    giverAsHost,
    isPathCompletable,
    namedOpenAreas,
    offerHost,
    pickExploreTarget,
    questGiverUserId,
    questOrigin,
    resolveQuestHost,
    simulatedWorld,
} from "../QuestWorld";

const area = (id: string, name: string, x: number, y = 0, size = 10): QuestArea => ({
    id,
    name,
    x,
    y,
    width: size,
    height: size,
});
const lobby = area("1", "Lobby", 0);
const garden = area("2", "Garden", 100);
const roof = area("3", "Roof", 300);

const person = (userId: number, name: string, isBot = false): QuestPresent => ({
    userId,
    uuid: isBot ? `bot-${userId}` : `u-${userId}`,
    name,
    isBot,
});

describe("namedOpenAreas", () => {
    it("keeps named areas the player may enter", () => {
        const areas = [lobby, area("4", "  ", 50), area("5", "Vault", 60), area("6", "Flat", 70, 0, 0)];
        expect(namedOpenAreas(areas, new Set(["5"])).map((a) => a.id)).toEqual(["1"]);
    });
});

describe("pickExploreTarget", () => {
    it("picks the nearest area the player is not in", () => {
        expect(pickExploreTarget([roof, lobby, garden], { x: 5, y: 5 })).toEqual({
            area: garden,
            alreadyInside: false,
        });
    });

    it("marks the objective as met when the only candidate contains the player", () => {
        expect(pickExploreTarget([lobby], { x: 5, y: 5 })).toEqual({ area: lobby, alreadyInside: true });
    });

    it("prefers the area the owner published", () => {
        expect(pickExploreTarget([lobby, garden, roof], { x: 5, y: 5 }, "roof")?.area).toBe(roof);
        expect(pickExploreTarget([lobby, garden], { x: 5, y: 5 }, "Nowhere")?.area).toBe(garden);
    });

    it("offers nothing without areas", () => {
        expect(pickExploreTarget([], { x: 0, y: 0 })).toBeUndefined();
    });
});

describe("resolveQuestHost", () => {
    const present = [person(1, "Alice"), person(2, "Guide", true), person(3, "Helper", true)];
    const nobot = [person(1, "Alice")];

    it("takes the first bot on the map, whatever its name", () => {
        expect(resolveQuestHost("bot", present, [lobby])).toMatchObject({ kind: "bot", name: "Guide" });
        expect(resolveQuestHost("bot", [present[2], present[1]], [lobby])).toMatchObject({
            kind: "bot",
            name: "Helper",
        });
        expect(resolveQuestHost("area", present, [lobby])).toMatchObject({ kind: "bot", name: "Guide" });
        expect(resolveQuestHost("none", present, [lobby])).toMatchObject({ kind: "bot", name: "Guide" });
        expect(resolveQuestHost("bot", nobot, [lobby])).toEqual({ kind: "none" });
    });

    it("falls back to the first named area with the area simulation only, else nobody", () => {
        expect(resolveQuestHost("area", nobot, [lobby, garden])).toEqual({
            kind: "area",
            areaId: "1",
            name: "Lobby",
        });
        expect(resolveQuestHost("area", nobot, [])).toEqual({ kind: "none" });
        expect(resolveQuestHost("none", nobot, [lobby])).toEqual({ kind: "none" });
        expect(resolveQuestHost("empty", present, [lobby])).toEqual({ kind: "none" });
    });

    it("honours the owner's host when it is here, else falls back", () => {
        expect(resolveQuestHost("bot", present, [lobby], { kind: "bot", uuid: "bot-3" })).toMatchObject({
            name: "Helper",
        });
        expect(resolveQuestHost("bot", present, [lobby, garden], { kind: "area", name: "garden" })).toMatchObject({
            kind: "area",
            name: "Garden",
        });
        expect(resolveQuestHost("bot", present, [lobby], { kind: "none" })).toEqual({ kind: "none" });
        expect(resolveQuestHost("bot", present, [lobby], { kind: "bot", uuid: "bot-99" })).toMatchObject({
            name: "Guide",
        });
    });
});

describe("availablePaths", () => {
    const world: QuestWorld = {
        ...EMPTY_QUEST_WORLD,
        ready: true,
        present: [person(1, "Alice")],
        exploreTarget: { area: garden, alreadyInside: false },
        canBuild: true,
    };

    it("offers what can be done here, and Meet always: people come and go", () => {
        expect(availablePaths(initialQuestState(), world, "bot")).toEqual(["meet", "explore", "build"]);
        const alone = { ...world, present: [], canBuild: false };
        expect(availablePaths(initialQuestState(), alone, "bot")).toEqual(["meet", "explore"]);
        expect(isPathCompletable(alone, "meet")).toBe(false);
        expect(availablePaths(initialQuestState(), { ...alone, exploreTarget: undefined }, "bot")).toEqual(["meet"]);
    });

    it("leaves out accepted and done paths", () => {
        const state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        expect(availablePaths(state, world, "bot")).toEqual(["explore", "build"]);
    });

    it("offers nothing before the map is ready or in the empty simulation", () => {
        expect(availablePaths(initialQuestState(), { ...world, ready: false }, "bot")).toEqual([]);
        expect(availablePaths(initialQuestState(), world, "empty")).toEqual([]);
        expect(simulatedWorld(world, "empty")).toMatchObject({
            present: [],
            exploreTarget: undefined,
            canBuild: false,
        });
    });
});

describe("the quest giver", () => {
    const guideHost = { kind: "bot" as const, userId: 2, uuid: "bot-2", name: "Guide" };
    const lobbyWithGuide: QuestWorld = {
        ...EMPTY_QUEST_WORLD,
        ready: true,
        roomName: "Lobby",
        host: guideHost,
        present: [person(2, "Guide", true)],
    };
    const lobbyAlone: QuestWorld = { ...lobbyWithGuide, host: { kind: "none" }, present: [] };

    it("freezes who offered the quest while the player is still in that room", () => {
        const offered = questOrigin(lobbyWithGuide);
        expect(offered).toEqual({ room: "Lobby", giver: { kind: "bot", name: "Guide", uuid: "bot-2" } });
        // Walked out of the bot's range: the offer still counts.
        expect(acceptanceOrigin(offered, lobbyAlone)).toBe(offered);
        // Another room: whoever hosts there (nobody: the room itself).
        expect(acceptanceOrigin(offered, { ...lobbyAlone, roomName: "Garden" })).toEqual({
            room: "Garden",
            giver: null,
        });
        expect(acceptanceOrigin(null, lobbyWithGuide)).toEqual(offered);
        expect(questOrigin({ ...lobbyAlone, host: { kind: "area", areaId: "1", name: "Hall" } })).toEqual({
            room: "Lobby",
            giver: { kind: "area", name: "Hall" },
        });
    });

    it("shows the frozen giver's live face while that bot is near, and the face frozen with it otherwise", () => {
        const giver = { kind: "bot" as const, name: "Guide", uuid: "bot-2", portrait: "data:image/png;base64,AAAA" };
        expect(giverAsHost(giver, lobbyWithGuide)).toEqual({ ...guideHost, portrait: "data:image/png;base64,AAAA" });
        expect(giverAsHost(giver, lobbyAlone)).toEqual({
            kind: "bot",
            userId: null,
            uuid: "bot-2",
            name: "Guide",
            portrait: "data:image/png;base64,AAAA",
        });
        expect(giverAsHost({ kind: "bot", name: "Guide" }, lobbyAlone)).toEqual({
            kind: "bot",
            userId: null,
            uuid: "",
            name: "Guide",
        });
        expect(giverAsHost({ kind: "area", name: "Hall" }, lobbyAlone)).toMatchObject({ kind: "area", name: "Hall" });
        expect(giverAsHost(null, lobbyWithGuide)).toEqual({ kind: "none" });
    });

    it("marks the host bot while it still has a quest to give, whatever is on screen", () => {
        const fresh = initialQuestState();
        expect(questGiverUserId(fresh, lobbyWithGuide, ["meet", "explore"])).toBe(2);
        expect(questGiverUserId(fresh, lobbyAlone, ["meet"])).toBeUndefined();
        // Everything taken: the mark goes, like a quest giver with nothing left.
        expect(questGiverUserId(fresh, lobbyWithGuide, [])).toBeUndefined();
        const offering = reduceQuest(fresh, { type: "invitation-shown", origin: questOrigin(lobbyWithGuide) });
        expect(questGiverUserId(reduceQuest(offering, { type: "decline" }), lobbyWithGuide, ["meet"])).toBe(2);
        expect(
            questGiverUserId(reduceQuest(offering, { type: "accept", path: "meet", now: 1 }), lobbyWithGuide, [
                "explore",
            ])
        ).toBe(2);
    });

    it("keeps the offer on screen with the bot that made it, never whichever bot is first now", () => {
        const offering = reduceQuest(initialQuestState(), {
            type: "invitation-shown",
            origin: questOrigin(lobbyWithGuide),
        });
        // Walked out of the bot's range: its name and frozen face stay, no live bot to mark; the room's host, if
        // any, takes the mark instead.
        expect(offerHost(offering, lobbyAlone)).toMatchObject({ kind: "bot", userId: null, name: "Guide" });
        expect(questGiverUserId(offering, lobbyAlone, ["meet"])).toBeUndefined();
        // Another bot hosts here now: the "!" and the ring stay on the one that offered.
        const helperFirst: QuestWorld = {
            ...lobbyWithGuide,
            host: { kind: "bot", userId: 5, uuid: "bot-5", name: "Helper" },
            present: [person(5, "Helper", true), person(2, "Guide", true)],
        };
        expect(offerHost(offering, helperFirst)).toEqual(guideHost);
        expect(questGiverUserId(offering, helperFirst, ["meet"])).toBe(2);
        expect(offerHost(reduceQuest(offering, { type: "open-options" }), helperFirst)).toEqual(guideHost);
        // No offer made yet: whoever hosts now.
        expect(offerHost(initialQuestState(), helperFirst)).toMatchObject({ name: "Helper" });
    });
});
