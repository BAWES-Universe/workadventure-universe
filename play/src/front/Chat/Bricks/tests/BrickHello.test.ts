import { beforeAll, describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { STARTER_IDEAS } from "../Brick";
import {
    BRICK_IDEAS,
    BRICK_IDEAS_CARD,
    BRICK_STARTERS_CARD,
    brickHello,
    brickIdeaWords,
    brickIdeasCard,
    brickStartersCard,
} from "../BrickHello";

describe("the fixed words of a person's own Brick", () => {
    beforeAll(() => {
        loadLocale("en-US");
        loadLocale("fr-FR");
    });

    it("says hello to the person by name, in the Brick's own name", () => {
        const LL = i18nObject("en-US");
        expect(brickHello("Brick", LL, "Khalid")).toBe(
            "Hi Khalid, I'm Brick, your own helper in Universe. Ask me anything, or hand me a job."
        );
        expect(brickHello("Recipe Brick", LL, "  Noura ")).toContain("Hi Noura, I'm Recipe Brick,");
    });

    it("says hello without a name when the game has none", () => {
        const LL = i18nObject("en-US");
        for (const name of [undefined, null, "", "   "]) {
            expect(brickHello("Brick", LL, name)).toBe(
                "Hi, I'm Brick, your own helper in Universe. Ask me anything, or hand me a job."
            );
        }
    });

    it("offers one way to start, the only one that works today, on a question card that never runs out", () => {
        const card = brickStartersCard(i18nObject("en-US"));
        expect(card.id).toBe(BRICK_STARTERS_CARD);
        expect(card.title).toBe("Where shall we start?");
        expect(card.question).toEqual({
            multiple: false,
            choices: [{ id: STARTER_IDEAS, label: "See what I can do", line: "A few ideas to start with" }],
        });
        expect(card.options).toEqual([]);
        expect(card.lines).toEqual([]);
        expect(card.expiresAt).toBeGreaterThan(Date.now() + 100 * 365 * 24 * 3600 * 1000);
    });

    it("lists four ideas a Brick can do today, each with the words a tap sends", () => {
        const LL = i18nObject("en-US");
        const card = brickIdeasCard(LL);
        expect(card.id).toBe(BRICK_IDEAS_CARD);
        expect(card.title).toBe("What shall I take on?");
        expect(card.question?.multiple).toBe(false);
        expect(card.question?.choices.map((choice) => choice.id)).toEqual([...BRICK_IDEAS]);
        expect(card.question?.choices.map((choice) => choice.label)).toEqual([
            "Write something with you",
            "Read a web page for you",
            "Go through a file with you",
            "Think something through with you",
        ]);
        for (const choice of card.question?.choices ?? []) {
            expect(choice.line).toBeTruthy();
            expect(brickIdeaWords(choice.id, LL)).toBeTruthy();
        }
        expect(brickIdeaWords("write", LL)).toBe("Help me write something.");
        expect(brickIdeaWords("web", LL)).toBe("Read a web page for me.");
        expect(brickIdeaWords("file", LL)).toBe("Go through a file with me.");
        expect(brickIdeaWords("think", LL)).toBe("Help me think something through.");
    });

    it("sends nothing for a tap that is not one of its ideas", () => {
        const LL = i18nObject("en-US");
        expect(brickIdeaWords("", LL)).toBeUndefined();
        expect(brickIdeaWords("ideas", LL)).toBeUndefined();
        expect(brickIdeaWords("order-a-pizza", LL)).toBeUndefined();
    });

    it("falls back to the English words in a language that has none yet", () => {
        const LL = i18nObject("fr-FR");
        expect(brickHello("Brick", LL, "Khalid")).toContain("Hi Khalid, I'm Brick");
        expect(brickStartersCard(LL).title).toBe("Where shall we start?");
    });
});
