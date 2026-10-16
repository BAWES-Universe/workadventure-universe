import {
    CORRECTION_RATE,
    MAX_FONT_SIZE_ON_SCREEN,
    MAX_NAME_LENGTH,
    PLAYER_NAME_FONT_SIZE,
} from "./UsernameDisplaySizes";

/**
 * How much the pill is magnified compared to its base size, in game pixels.
 *
 * Zoomed out, one game pixel is smaller than one screen pixel and the name would shrink until it is unreadable: it
 * stops shrinking at CORRECTION_RATE of the size it has at the default zoom (upstream's rule, but counted from the
 * size actually shown, which is at most MAX_FONT_SIZE_ON_SCREEN). Zoomed in, it would grow with the map: it stops at
 * MAX_FONT_SIZE_ON_SCREEN.
 *
 * @param zoomModifier the player's zoom
 * @param ancestorScale how many screen pixels one game pixel takes, as measured on the DOM layer
 */
export function getDisplayScale(zoomModifier: number, ancestorScale: number): number {
    const upstreamScale = Math.max(zoomModifier > 0 ? CORRECTION_RATE / zoomModifier : 1, 1);
    if (!(ancestorScale > 0) || !(zoomModifier > 0)) {
        return upstreamScale;
    }
    // Size on screen if the name simply followed the map, and the size it has at the default zoom once capped.
    const followsMap = PLAYER_NAME_FONT_SIZE * ancestorScale;
    const atDefaultZoom = Math.min(followsMap / zoomModifier, MAX_FONT_SIZE_ON_SCREEN);
    const onScreen = Math.min(Math.max(followsMap, CORRECTION_RATE * atDefaultZoom), MAX_FONT_SIZE_ON_SCREEN);
    return onScreen / followsMap;
}

/** The name as written in the pill: long names are cut, unless the pill is highlighted. */
export function getShownName(name: string, highlighted: boolean): string {
    // Array.from so an emoji is never cut in the middle of its surrogate pair.
    const letters = Array.from(name);
    if (highlighted || letters.length <= MAX_NAME_LENGTH) {
        return name;
    }
    return (
        letters
            .slice(0, MAX_NAME_LENGTH - 1)
            .join("")
            .trimEnd() + "…"
    );
}
