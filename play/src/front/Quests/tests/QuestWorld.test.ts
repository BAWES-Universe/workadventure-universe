import { describe, expect, it } from "vitest";
import { initialQuestState, reduceQuest } from "../QuestModel";
import type { QuestArea, QuestPresent, QuestWorld } from "../QuestWorld";
import {
    acceptanceOrigin,
    availablePaths,
    EMPTY_QUEST_WORLD,
    giverAsHost,
    namedOpenAreas,
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

    it("offers only what can be done here", () => {
        expect(availablePaths(initialQuestState(), world, "bot")).toEqual(["meet", "explore", "build"]);
        expect(availablePaths(initialQuestState(), { ...world, present: [], canBuild: false }, "bot")).toEqual([
            "explore",
        ]);
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

    it("shows the frozen giver's face only while that bot is near", () => {
        const giver = { kind: "bot" as const, name: "Guide", uuid: "bot-2" };
        expect(giverAsHost(giver, lobbyWithGuide)).toEqual(guideHost);
        expect(giverAsHost(giver, lobbyAlone)).toEqual({ kind: "none" });
        expect(giverAsHost({ kind: "area", name: "Hall" }, lobbyAlone)).toMatchObject({ kind: "area", name: "Hall" });
        expect(giverAsHost(null, lobbyWithGuide)).toEqual({ kind: "none" });
    });

    it("marks the host bot only while its offer is on screen and nothing is accepted", () => {
        const offering = reduceQuest(initialQuestState(), { type: "invitation-shown" });
        expect(questGiverUserId(offering, lobbyWithGuide)).toBe(2);
        expect(questGiverUserId(reduceQuest(offering, { type: "open-options" }), lobbyWithGuide)).toBe(2);
        expect(questGiverUserId(offering, lobbyAlone)).toBeUndefined();
        expect(questGiverUserId(reduceQuest(offering, { type: "decline" }), lobbyWithGuide)).toBeUndefined();
        expect(
            questGiverUserId(reduceQuest(offering, { type: "accept", path: "meet", now: 1 }), lobbyWithGuide)
        ).toBeUndefined();
    });
});
