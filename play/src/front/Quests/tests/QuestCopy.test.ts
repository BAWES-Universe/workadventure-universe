import { describe, expect, it } from "vitest";
import { loadLocale } from "../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../i18n/i18n-util";
import {
    logEntries,
    offerEyebrow,
    questBody,
    questDescription,
    questEyebrow,
    questEyebrowFor,
    questObjective,
    questPayoffLine,
    whereDescription,
} from "../QuestCopy";
import { initialQuestState, reduceQuest } from "../QuestModel";
import type { QuestWorld } from "../QuestWorld";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";

loadLocale("en-US");
const t = i18nObject("en-US");

const world: QuestWorld = {
    ...EMPTY_QUEST_WORLD,
    ready: true,
    roomName: "Lobby",
    host: { kind: "bot", userId: 3, uuid: "bot-3", name: "Guide" },
    present: [{ userId: 3, uuid: "bot-3", name: "Guide", isBot: true }],
    exploreTarget: { area: { id: "a", name: "Courtyard", x: 0, y: 0, width: 64, height: 64 }, alreadyInside: false },
    canBuild: true,
};
const fromGuide = { room: "Lobby", giver: { kind: "bot" as const, name: "Guide", uuid: "bot-3" } };
/** Another room, another host: where the player may be when the quest ends. */
const garden: QuestWorld = { ...world, roomName: "Garden", host: { kind: "area", areaId: "g", name: "Greenhouse" } };

describe("quest copy", () => {
    it("lets the host speak through the eyebrow, never a 'Name:' prefix", () => {
        const state = initialQuestState();
        expect(questEyebrow(t, world)).toBe("Guide");
        expect(questEyebrow(t, { ...world, host: { kind: "none" } })).toBe("Lobby");
        expect(questEyebrow(t, { ...world, host: { kind: "none" }, roomName: undefined })).toBe("Welcome");
        expect(questPayoffLine(t, "meet", state, world)).toBe("Good to meet you.");
        expect(questPayoffLine(t, "meet", state, { ...world, host: { kind: "none" } })).toBe(
            "You said hi. Welcome in."
        );
        expect(questPayoffLine(t, "explore", state, world)).toBe("You found the Courtyard.");
    });

    it("lets the offer on screen keep its giver's name once the bot is out of range", () => {
        const offering = reduceQuest(initialQuestState(), { type: "invitation-shown", origin: fromGuide });
        expect(offerEyebrow(t, offering, { ...world, host: { kind: "none" }, present: [] })).toBe("Guide");
        const byRoom = reduceQuest(initialQuestState(), {
            type: "invitation-shown",
            origin: { room: "Lobby", giver: null },
        });
        expect(offerEyebrow(t, byRoom, world)).toBe("Lobby");
        expect(offerEyebrow(t, initialQuestState(), world)).toBe("Guide");
    });

    it("never says 'Find the ' while Explore has no area to name", () => {
        const state = initialQuestState();
        const noArea: QuestWorld = { ...world, exploreTarget: undefined };
        expect(questObjective(t, "explore", state, world)).toBe("Find the Courtyard");
        expect(questObjective(t, "explore", state, noArea)).toBe("Explore this place");
        expect(questDescription(t, "explore", state, noArea)).toBe("Explore this place");
        expect(questBody(t, "explore", state, noArea, "idle")).toBe("Explore this place");
    });

    it("lists Meet as available while nobody is here, saying it will wait", () => {
        const alone: QuestWorld = { ...world, host: { kind: "none" }, present: [] };
        const [meet] = logEntries(t, initialQuestState(), alone, ["meet"]);
        expect(meet).toMatchObject({ path: "meet", status: "available", note: "Nobody's here right now" });
        expect(logEntries(t, initialQuestState(), world, ["meet"])[0].note).toBeUndefined();
    });

    it("keeps the giver frozen at acceptance on the card, the payoff and the log, wherever the player is now", () => {
        const state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1, origin: fromGuide });
        expect(questEyebrowFor(t, "meet", state, garden)).toBe("Guide");
        expect(questPayoffLine(t, "meet", state, garden)).toBe("Good to meet you.");
        expect(logEntries(t, state, garden, [])[0].origin).toBe("Guide · Lobby");
        // Accepted from the room itself: neutral, wherever the player goes.
        const byRoom = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "meet",
            now: 1,
            origin: { room: "Lobby", giver: null },
        });
        expect(questEyebrowFor(t, "meet", byRoom, world)).toBe("Lobby");
        expect(questPayoffLine(t, "meet", byRoom, world)).toBe("You said hi. Welcome in.");
        expect(logEntries(t, byRoom, garden, [])[0].origin).toBe("Lobby");
    });

    it("tells Meet's progress in the card: waiting after the hello, nobody here while paused", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1, origin: fromGuide });
        expect(questBody(t, "meet", state, world, "idle")).toBe("Walk up to someone. When the bubble opens, say hi.");
        expect(questBody(t, "meet", state, world, "sent")).toBe("Hello sent. Waiting for a reply.");
        state = reduceQuest(state, { type: "pause", path: "meet", reason: "no-eligible-target" });
        expect(questBody(t, "meet", state, world, "sent")).toBe("Nobody's here right now");
        // Done while its payoff waits (a call, typing): the card tells how it ended, not the first step again.
        state = reduceQuest(state, { type: "complete", path: "meet", now: 2 });
        expect(questBody(t, "meet", state, world, "exchanged")).toBe("Good to meet you.");
    });

    it("tells Build to open the editor", () => {
        const state = reduceQuest(initialQuestState(), { type: "accept", path: "build", now: 1 });
        expect(questBody(t, "build", state, world, "idle")).toBe("Open the map editor and place one thing.");
    });

    it("counts steps in Arabic with the right plural form", () => {
        loadLocale("ar-SA");
        const ar = i18nObject("ar-SA");
        const say = (steps: number) => ar.quest.card.direction({ target: "الساحة", direction: "الشمال", steps });
        expect(say(1)).toContain("1 خطوة ");
        expect(say(2)).toContain("2 خطوتين");
        expect(say(5)).toContain("5 خطوات");
        expect(say(14)).toContain("14 خطوة ");
    });

    it("lists on-map, accepted, available and done entries with their giver, reward and requirement", () => {
        let state = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "explore",
            now: 1,
            exploreArea: { id: "a", name: "Courtyard" },
        });
        state = reduceQuest(state, { type: "accept", path: "meet", now: 2, origin: fromGuide });
        state = reduceQuest(state, { type: "complete", path: "explore", now: 3 });
        const entries = logEntries(t, state, world, ["build"]);
        expect(entries.map((entry) => [entry.path, entry.status])).toEqual([
            ["meet", "tracked"],
            ["explore", "done"],
            ["build", "available"],
        ]);
        expect(entries[0]).toMatchObject({
            origin: "Guide · Lobby",
            reward: "First Hello badge",
            line: "Say hi to someone",
        });
        expect(entries[0].giver).toMatchObject({ kind: "bot", name: "Guide" });
        expect(entries[1].line).toBe("You found the Courtyard.");
        expect(entries[2].requirement).toBe("Needs: edit rights in this room");
    });

    it("says where the target is in words, and nothing when there is nothing positional to say", () => {
        const courtyard = { name: "Courtyard", position: { x: 320, y: -320 } };
        expect(whereDescription(t, courtyard, { x: 0, y: 0 }, "explore")).toBe(
            "Courtyard is north-east of you, about 14 steps"
        );
        // Build's body already names the menus; Meet without anyone, or any path without the map, adds nothing.
        expect(whereDescription(t, courtyard, { x: 0, y: 0 }, "build")).toBeUndefined();
        expect(whereDescription(t, undefined, { x: 0, y: 0 }, "meet")).toBeUndefined();
        expect(whereDescription(t, courtyard, undefined, "explore")).toBeUndefined();
        expect(whereDescription(t, undefined, { x: 0, y: 0 }, "explore")).toBeUndefined();
        // Explore's area fixed on another map: said in words.
        expect(whereDescription(t, undefined, { x: 0, y: 0 }, "explore", "Courtyard")).toBe(
            "The Courtyard is in another room."
        );
    });
});
