import { describe, expect, it } from "vitest";
import { loadLocale } from "../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../i18n/i18n-util";
import { logEntries, questBody, questEyebrow, questPayoffLine, showMeDescription } from "../QuestCopy";
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

    it("tells Meet's progress in the card: waiting after the hello, nobody here while paused", () => {
        let state = reduceQuest(initialQuestState(), { type: "accept", path: "meet", now: 1 });
        expect(questBody(t, "meet", state, world, "idle")).toBe("Walk up to someone. When the bubble opens, say hi.");
        expect(questBody(t, "meet", state, world, "sent")).toBe("Hello sent. Waiting for a reply.");
        state = reduceQuest(state, { type: "pause", path: "meet", reason: "no-eligible-target" });
        expect(questBody(t, "meet", state, world, "sent")).toBe("Nobody's here right now");
        // Done while its payoff waits (a call, typing): the card tells how it ended, not the first step again.
        state = reduceQuest(state, { type: "complete", path: "meet", now: 2 });
        expect(questBody(t, "meet", state, world, "exchanged")).toBe("Good to meet you.");
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

    it("lists tracked, accepted, available and done entries with their reward and requirement", () => {
        let state = reduceQuest(initialQuestState(), {
            type: "accept",
            path: "explore",
            now: 1,
            exploreArea: { id: "a", name: "Courtyard" },
        });
        state = reduceQuest(state, { type: "accept", path: "meet", now: 2 });
        state = reduceQuest(state, { type: "complete", path: "explore", now: 3 });
        const entries = logEntries(t, state, world, ["build"]);
        expect(entries.map((entry) => [entry.path, entry.status])).toEqual([
            ["meet", "tracked"],
            ["explore", "done"],
            ["build", "available"],
        ]);
        expect(entries[0]).toMatchObject({ origin: "From Guide · Lobby", reward: "First Hello badge" });
        expect(entries[1].lastTime).toBe("You found the Courtyard last time.");
        expect(entries[2].requirement).toBe("Needs: edit rights in this room");
    });

    it("says where the target is in words, or what to open when there is no place", () => {
        expect(
            showMeDescription(t, { name: "Courtyard", position: { x: 320, y: -320 } }, { x: 0, y: 0 }, "explore")
        ).toBe("Courtyard is north-east of you, about 14 steps");
        expect(showMeDescription(t, undefined, { x: 0, y: 0 }, "build")).toBe("Open Tools, then Map editor.");
        expect(showMeDescription(t, undefined, { x: 0, y: 0 }, "explore", "Courtyard")).toBe(
            "The Courtyard is in another room."
        );
        expect(showMeDescription(t, undefined, { x: 0, y: 0 }, "meet")).toBe("Nobody's here right now");
    });
});
