import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { replyLimitTime } from "../Bots/BotReplyLimit";
import { BRICK_LOOKS, DEFAULT_BRICK_LOOK, type BrickLook } from "./Brick";

/** The first Brick colour none of the person's Bricks wears; when all are worn, the one everyone gets. */
export function firstFreeLook(worn: readonly (string | null | undefined)[]): BrickLook {
    return BRICK_LOOKS.find((look) => !worn.includes(look)) ?? DEFAULT_BRICK_LOOK;
}

/** A Brick colour in words ("Teal"), for the name New Brick starts with and for people who cannot see the picture. */
export function lookColour(look: BrickLook, ll: TranslationFunctions): string {
    const colours = ll.chat.brick.colours;
    switch (look) {
        case "brick-orange":
            return colours.orange();
        case "brick-red":
            return colours.red();
        case "brick-amber":
            return colours.amber();
        case "brick-lime":
            return colours.lime();
        case "brick-green":
            return colours.green();
        case "brick-teal":
            return colours.teal();
        case "brick-sky":
            return colours.sky();
        case "brick-blue":
            return colours.blue();
        case "brick-violet":
            return colours.violet();
        case "brick-pink":
            return colours.pink();
        case "brick-white":
            return colours.white();
        case "brick-charcoal":
            return colours.charcoal();
    }
}

/**
 * What a person reads when they have made too many new Bricks this hour ("New Bricks per hour"): the time they can make another,
 * on their own clock. Without a time Orbit could be read from, a few minutes.
 */
export function newBricksLimitLine(
    retryAt: string | undefined,
    locale: string,
    t: Pick<TranslationFunctions["chat"]["brick"], "limitReached" | "limitReachedLater">,
    now: Date = new Date()
): string {
    if (retryAt === undefined || Number.isNaN(Date.parse(retryAt))) return t.limitReachedLater();
    return t.limitReached({ time: replyLimitTime(retryAt, locale, now) });
}

/** What Orbit calls the refusal for a person who has made too many new Bricks this hour ("New Bricks per hour"). */
export const NEW_BRICKS_LIMIT_CODE = "new_bricks_limit";

/**
 * The refusal of a make for "New Bricks per hour" (Orbit answers 429): when they can make another, if Orbit said. Undefined for
 * any other failure, which keeps the general "couldn't make it" line.
 */
export function newBricksLimitOf(error: unknown): { retryAt: string | undefined } | undefined {
    const refusal = error as { status?: unknown; code?: unknown; retryAt?: unknown } | null | undefined;
    if (refusal?.status !== 429 || refusal.code !== NEW_BRICKS_LIMIT_CODE) return undefined;
    return { retryAt: typeof refusal.retryAt === "string" ? refusal.retryAt : undefined };
}
