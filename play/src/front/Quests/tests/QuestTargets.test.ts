import { describe, expect, it } from "vitest";
import { initialQuestState, reduceQuest } from "../QuestModel";
import { questTarget } from "../QuestTargets";
import type { QuestWorld } from "../QuestWorld";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";

const world: QuestWorld = {
    ...EMPTY_QUEST_WORLD,
    ready: true,
    host: { kind: "bot", userId: 3, uuid: "bot-3", name: "Guide" },
    present: [
        { userId: 7, uuid: "u-7", name: "Ada", isBot: false },
        { userId: 3, uuid: "bot-3", name: "Guide", isBot: true },
    ],
    exploreTarget: {
        area: { id: "a", name: "Courtyard", x: 100, y: 200, width: 64, height: 32 },
        alreadyInside: false,
    },
};

describe("questTarget", () => {
    it("marks Explore's area at its centre, with a ring sized to it", () => {
        expect(questTarget("explore", initialQuestState(), world)).toEqual({
            kind: "place",
            x: 132,
            y: 216,
            radius: 16,
            name: "Courtyard",
        });
    });

    it("never points Explore at another area than the one fixed at acceptance", () => {
        const state = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "explore",
            now: 1,
            exploreArea: { id: "b", name: "Garden" },
        });
        expect(questTarget("explore", state, world)).toBeUndefined();
    });

    it("points Meet at the host bot when it is here, else at the nearest person", () => {
        expect(questTarget("meet", initialQuestState(), world)).toMatchObject({ kind: "player", userId: 3 });
        const noHost: QuestWorld = { ...world, host: { kind: "none" } };
        const positions: Record<number, { x: number; y: number }> = { 7: { x: 500, y: 500 }, 3: { x: 10, y: 10 } };
        expect(
            questTarget("meet", initialQuestState(), noHost, { x: 0, y: 0 }, (userId) => positions[userId])
        ).toMatchObject({ userId: 3 });
    });

    it("has no place for Build (it happens in the map editor)", () => {
        expect(questTarget("build", initialQuestState(), world)).toBeUndefined();
    });
});
