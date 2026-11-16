import { beforeAll, describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import {
    BRICK_LOOKS,
    brickPictureUrl,
    isBrickLook,
    parseBrickCard,
    parseDeletedBricks,
    parseUndoDays,
    readBrickMade,
    readBrickOffer,
    shortDay,
} from "../Brick";
import { BRICK_OFFER_CARD, OFFER_MAKE, OFFER_NOT_NOW, brickHello, brickOfferCard } from "../BrickHello";
import { offerCardKey } from "../ClosedBrickCards";
import { firstFreeLook, lookColour } from "../NewBrick";

const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test";
const card = (over: Record<string, unknown> = {}) => ({
    id: "1c8d2e3f-2222-4333-8444-a55566667777",
    name: "Studio Brick",
    description: null,
    characterTextureId: "brick-violet",
    enabled: false,
    isDefault: false,
    createdAt: "2026-10-12T10:00:00.000Z",
    ...over,
});

describe("more Bricks (#1996): what Orbit and a Brick say, as the game reads it", () => {
    beforeAll(() => loadLocale("en-US"));

    it("reads a Brick's own first words, and has none for a Brick without", () => {
        expect(parseBrickCard(card({ hello: "  Send me a recipe and I'll keep it. " }))?.hello).toBe(
            "Send me a recipe and I'll keep it."
        );
        for (const hello of [undefined, null, "", "   ", 7]) expect(parseBrickCard(card({ hello }))?.hello).toBeNull();
    });

    it("says a Brick's own first words in its empty chat instead of the game's hello", () => {
        const LL = i18nObject("en-US");
        expect(brickHello("Recipe Brick", LL, "Khalid", "Send me a recipe and I'll keep it.")).toBe(
            "Send me a recipe and I'll keep it."
        );
        expect(brickHello("Recipe Brick", LL, "Khalid", "  ")).toContain("Hi Khalid, I'm Recipe Brick,");
        expect(brickHello("Recipe Brick", LL, "Khalid", null)).toContain("Hi Khalid, I'm Recipe Brick,");
    });

    it("lists the deleted Bricks with the day each is gone, the soonest first, and skips what it cannot read", () => {
        const list = parseDeletedBricks({
            deleted: [
                card({
                    id: "b",
                    name: "Later",
                    deletedAt: "2026-11-12T09:00:00.000Z",
                    goneAt: "2026-11-19T09:00:00.000Z",
                }),
                card({
                    id: "a",
                    name: "Sooner",
                    deletedAt: "2026-11-10T09:00:00.000Z",
                    goneAt: "2026-11-17T09:00:00.000Z",
                }),
                card({ id: "a", name: "Twice", goneAt: "2026-11-17T09:00:00.000Z" }),
                card({ id: "c", name: "No day" }),
                card({ id: "d", name: "Bad day", goneAt: "soon" }),
                null,
            ],
        });
        expect(list.map((brick) => brick.name)).toEqual(["Sooner", "Later"]);
        expect(list[0]).toMatchObject({ deletedAt: "2026-11-10T09:00:00.000Z", goneAt: "2026-11-17T09:00:00.000Z" });
        for (const nothing of [null, undefined, {}, { deleted: "all" }])
            expect(parseDeletedBricks(nothing)).toEqual([]);
    });

    it("reads how many days a deleted Brick waits, and names none when Orbit does not say", () => {
        expect(parseUndoDays({ undoDays: 7 })).toBe(7);
        for (const days of [undefined, null, 0, -1, "7", Number.NaN])
            expect(parseUndoDays({ undoDays: days })).toBeUndefined();
        expect(parseUndoDays(null)).toBeUndefined();
    });

    it("writes a day the short way, and nothing for a date it cannot read", () => {
        expect(shortDay("2026-11-17T09:00:00.000Z", "en-GB")).toBe("17 Nov");
        // English puts the day first whichever English it is, as the Bricks page is drawn
        expect(shortDay("2026-11-17T09:00:00.000Z", "en-US")).toBe("17 Nov");
        expect(shortDay("2026-11-17T09:00:00.000Z", "fr-FR")).toBe("17 nov.");
        expect(shortDay("soon", "en-GB")).toBe("");
    });

    it("has a picture for each of the twelve Brick looks, and the orange one for anything else", () => {
        expect(BRICK_LOOKS).toHaveLength(12);
        expect(new Set(BRICK_LOOKS).size).toBe(12);
        expect(brickPictureUrl("brick-teal")).toBe("/static/images/bricks/brick-teal.png");
        for (const look of [null, undefined, "", "woka-ada", "brick-gold", "../secret"]) {
            expect(isBrickLook(look)).toBe(false);
            expect(brickPictureUrl(look)).toBe("/static/images/bricks/brick-orange.png");
        }
    });

    it("starts New Brick on the first colour none of the person's Bricks wears", () => {
        expect(firstFreeLook([])).toBe("brick-orange");
        expect(firstFreeLook(["brick-orange", null, "woka-ada"])).toBe("brick-red");
        expect(firstFreeLook(["brick-red", "brick-orange"])).toBe("brick-amber");
        expect(firstFreeLook([...BRICK_LOOKS])).toBe("brick-orange");
    });

    it("names every Brick colour in words", () => {
        const LL = i18nObject("en-US");
        const names = BRICK_LOOKS.map((look) => lookColour(look, LL));
        expect(names).toContain("Teal");
        expect(names.every((name) => name.length > 0)).toBe(true);
        expect(new Set(names).size).toBe(12);
        expect(LL.chat.brick.lookName({ colour: lookColour("brick-teal", LL) })).toBe("Teal Brick");
    });

    it("reads the Bricks a Brick's answer made, tidy and never twice, and none from anyone else", () => {
        const content = {
            msgtype: "m.text",
            body: "Done.",
            "universe.brick_made": [
                { id: "r", name: "  Recipe   Brick ", line: "Keeps your mum's recipes", look: "brick-red", made: true },
                { id: "r", name: "Recipe Brick again" },
                { id: "t", name: "Trip Brick", made: false },
                { id: "", name: "No id" },
                { id: "n" },
                "nonsense",
            ],
        };
        expect(readBrickMade(BRICK, content)).toEqual([
            { id: "r", name: "Recipe Brick", line: "Keeps your mum's recipes", look: "brick-red", made: true },
            { id: "t", name: "Trip Brick", line: "", look: null, made: false },
        ]);
        expect(readBrickMade("@sara:chat.test", content)).toEqual([]);
        expect(readBrickMade(BRICK, { ...content, msgtype: "m.notice" })).toEqual([]);
        expect(readBrickMade(BRICK, { msgtype: "m.text", "universe.brick_made": true })).toEqual([]);
        const many = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, name: `Brick ${i}` }));
        expect(readBrickMade(BRICK, { msgtype: "m.text", "universe.brick_made": many })).toHaveLength(5);
    });

    it("reads a Brick's suggestion only when it is whole and from a bot", () => {
        const offer = {
            topic: " recipes ",
            ask: "You cook a lot. Want a Brick just for recipes?",
            name: "Recipe Brick",
            line: "It keeps your recipes in one place",
            instructions: "You keep recipes.",
        };
        const content = { msgtype: "m.text", body: offer.ask, "universe.brick_offer": offer };
        expect(readBrickOffer(BRICK, content)).toEqual({ ...offer, topic: "recipes" });
        expect(readBrickOffer("@sara:chat.test", content)).toBeUndefined();
        expect(readBrickOffer(BRICK, { ...content, msgtype: "m.notice" })).toBeUndefined();
        for (const missing of ["topic", "ask", "name"]) {
            expect(
                readBrickOffer(BRICK, { ...content, "universe.brick_offer": { ...offer, [missing]: " " } })
            ).toBeUndefined();
        }
        expect(readBrickOffer(BRICK, { ...content, "universe.brick_offer": "recipes" })).toBeUndefined();
        expect(
            readBrickOffer(BRICK, { ...content, "universe.brick_offer": { ...offer, line: 3, instructions: 4 } })
        ).toEqual({
            ...offer,
            topic: "recipes",
            line: "",
            instructions: "",
        });
    });

    it("puts the suggestion on the question card: make that Brick, or not now, and it never runs out", () => {
        const LL = i18nObject("en-US");
        const shown = brickOfferCard(
            {
                topic: "recipes",
                ask: "You cook a lot. Want a Brick just for recipes?",
                name: "Recipe Brick",
                line: "It keeps your recipes in one place",
                instructions: "You keep recipes.",
            },
            LL
        );
        expect(shown.id).toBe(BRICK_OFFER_CARD);
        expect(shown.title).toBe("You cook a lot. Want a Brick just for recipes?");
        expect(shown.question?.choices).toEqual([
            { id: OFFER_MAKE, label: "Make Recipe Brick", line: "It keeps your recipes in one place" },
            { id: OFFER_NOT_NOW, label: "Not now", line: "I'll keep helping here, and won't ask again" },
        ]);
        expect(shown.question?.multiple).toBe(false);
        expect(shown.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
        expect(offerCardKey("$event")).toBe("offer:$event");
    });
});
