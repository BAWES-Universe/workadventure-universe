import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { BotAsk } from "../Bots/BotAsk";
import { STARTER_IDEAS, type BrickOffer } from "./Brick";

/**
 * The fixed words of a person's own Brick (game #1995): its hello, the ways to start under it, and the ideas under its
 * "what I can do" answer. The game shows them itself, so they cost nothing and nothing is sent until the person taps
 * or writes. They list only what a Brick can do today; more arrive with the issues that build them.
 */

/**
 * The hello, shown as the Brick's first words while its chat is empty, and as the line under its name in Chats. A Brick
 * that was made with its own first words (#1996) says those.
 */
export function brickHello(
    brickName: string,
    ll: TranslationFunctions,
    personName?: string | null,
    ownHello?: string | null
): string {
    if (ownHello?.trim()) return ownHello.trim();
    const name = personName?.trim();
    return name ? ll.chat.brick.hello({ name, brick: brickName }) : ll.chat.brick.helloNoName({ brick: brickName });
}

/** A card the game makes itself never runs out and is never edited by the bot server. */
function ownCard(id: string, title: string, choices: { id: string; label: string; line: string }[]): BotAsk {
    return {
        id,
        revision: 0,
        title,
        lines: [],
        options: [],
        question: { choices, multiple: false },
        expiresAt: Number.MAX_SAFE_INTEGER,
        waitMinutes: 0,
    };
}

export const BRICK_STARTERS_CARD = "brick.starters";
/** The starter that asks the Brick for another Brick (#1996): sent as the person's own words. */
export const STARTER_MAKE = "make";
export const BRICK_IDEAS_CARD = "brick.ideas";

/** The ways to start under the hello, on the question card. Only starters that work today. */
export function brickStartersCard(ll: TranslationFunctions): BotAsk {
    return ownCard(BRICK_STARTERS_CARD, ll.chat.brick.startTitle(), [
        { id: STARTER_IDEAS, label: ll.chat.brick.seeWhatICanDo(), line: ll.chat.brick.seeWhatICanDoLine() },
        { id: STARTER_MAKE, label: ll.chat.brick.makeAnother(), line: ll.chat.brick.makeAnotherLine() },
    ]);
}

export const BRICK_OFFER_CARD = "brick.offer";
export const OFFER_MAKE = "make";
export const OFFER_NOT_NOW = "not_now";

/** A Brick's suggestion on the question card (#1996): make the Brick it describes, or not now. */
export function brickOfferCard(offer: BrickOffer, ll: TranslationFunctions): BotAsk {
    return ownCard(BRICK_OFFER_CARD, offer.ask, [
        { id: OFFER_MAKE, label: ll.chat.brick.offerMake({ name: offer.name }), line: offer.line },
        { id: OFFER_NOT_NOW, label: ll.chat.brick.offerNotNow(), line: ll.chat.brick.offerNotNowLine() },
    ]);
}

export const BRICK_IDEAS = ["write", "web", "file", "think"] as const;
export type BrickIdea = (typeof BRICK_IDEAS)[number];

/** The ideas under the Brick's "what I can do" answer, in its own voice. */
export function brickIdeasCard(ll: TranslationFunctions): BotAsk {
    const ideas = ll.chat.brick.ideas;
    return ownCard(BRICK_IDEAS_CARD, ll.chat.brick.ideasTitle(), [
        { id: "write", label: ideas.write(), line: ideas.writeLine() },
        { id: "web", label: ideas.web(), line: ideas.webLine() },
        { id: "file", label: ideas.file(), line: ideas.fileLine() },
        { id: "think", label: ideas.think(), line: ideas.thinkLine() },
    ]);
}

/** What a tap on an idea sends, in the person's words; undefined for anything that is not an idea. */
export function brickIdeaWords(idea: string, ll: TranslationFunctions): string | undefined {
    const ideas = ll.chat.brick.ideas;
    switch (idea) {
        case "write":
            return ideas.writeAsk();
        case "web":
            return ideas.webAsk();
        case "file":
            return ideas.fileAsk();
        case "think":
            return ideas.thinkAsk();
        default:
            return undefined;
    }
}
