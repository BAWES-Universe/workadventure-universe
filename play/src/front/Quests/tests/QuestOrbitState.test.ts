import { describe, expect, it, vi } from "vitest";

vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));

import { loadLocale } from "../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../i18n/i18n-util";
import { isOrbitQuestStateMessage } from "../../external-modules/admin-api/orbitBridge";
import { initialQuestState, reduceQuest } from "../QuestModel";
import { orbitQuestEntries } from "../QuestOrbitState";
import { acceptanceOrigin, EMPTY_QUEST_WORLD } from "../QuestWorld";

loadLocale("en-US");
const t = i18nObject("en-US");

describe("the quest log sent to Orbit", () => {
    it("lists tracked, accepted and done in the game's order and words, with the stamp once done", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "build", now: 1 });
        state = reduceQuest(state, { type: "accept", path: "explore", now: 2, exploreArea: { id: "a", name: "Hall" } });
        state = reduceQuest(state, { type: "accept", path: "meet", now: 3 });
        state = reduceQuest(state, { type: "complete", path: "build", now: 4 });
        const world = { ...EMPTY_QUEST_WORLD, roomName: "Lobby", host: { kind: "none" as const } };

        const entries = orbitQuestEntries(t, state, world);
        expect(entries).toEqual([
            { id: "welcome.meet", title: "Meet someone", status: "tracked", room: "Lobby" },
            { id: "welcome.explore", title: "Explore this place", status: "accepted", room: "Lobby" },
            { id: "welcome.build", title: "Try building", status: "done", stamp: "builder", room: "Lobby" },
        ]);
        expect(
            isOrbitQuestStateMessage({
                type: "orbit-quest-state",
                version: 1,
                roomRevision: "rev-aaaaaaaaaaaaaaaa",
                entries,
            })
        ).toBe(true);
    });

    it("names the host as the giver, and sends an empty log when nothing was accepted", () => {
        const world = {
            ...EMPTY_QUEST_WORLD,
            roomName: "Lobby",
            host: { kind: "bot" as const, userId: 1, uuid: "bot-1", name: "Guide" },
        };
        expect(orbitQuestEntries(t, initialQuestState(), world)).toEqual([]);
        const state = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "meet",
            now: 1,
            origin: acceptanceOrigin(null, world),
        });
        expect(orbitQuestEntries(t, state, world)[0].giver).toBe("Guide");
    });

    it("names no giver for an accepted quest saved without an origin, even where someone hosts now", () => {
        const world = {
            ...EMPTY_QUEST_WORLD,
            roomName: "Lobby",
            host: { kind: "bot" as const, userId: 1, uuid: "bot-1", name: "Guide" },
        };
        const state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        const [entry] = orbitQuestEntries(t, state, world);
        expect(entry.giver).toBeUndefined();
        expect(entry.room).toBe("Lobby");
    });

    it("keeps the giver and the room frozen at acceptance, wherever the player is now", () => {
        const state = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "meet",
            now: 1,
            origin: { room: "Lobby", giver: { kind: "bot", name: "Guide", uuid: "bot-1" } },
        });
        // After a teleport: another room, an area hosting there.
        const garden = {
            ...EMPTY_QUEST_WORLD,
            roomName: "Garden",
            host: { kind: "area" as const, areaId: "g", name: "Greenhouse" },
        };
        expect(orbitQuestEntries(t, state, garden)[0]).toMatchObject({ giver: "Guide", room: "Lobby" });
    });
});
