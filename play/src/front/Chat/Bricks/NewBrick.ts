import type { TranslationFunctions } from "../../../i18n/i18n-types";
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
