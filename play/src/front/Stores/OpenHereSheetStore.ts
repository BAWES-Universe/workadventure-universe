import { derived, writable } from "svelte/store";
import { getSnapHeights, clampHeight } from "../Components/Sheet/BottomSheet";
import {
    CHAT_SHEET_CLOSE_DISTANCE,
    CHAT_SHEET_SIZES,
    chatSheetRestingHeight,
    type ChatSheetRest,
} from "../Chat/ChatSheetSizes";
import { coWebsites, openHereFloatsStore } from "./CoWebsiteStore";
import { openHereTuckedStore } from "./SideWindowInFrontStore";

/**
 * On a phone held upright the Open here window is chat's own sheet (the same snaps, handle and drag): files and links
 * rise from the bottom of the screen and the game does not move. These are its stores and heights. Pure where it can
 * be, so it can be unit tested.
 */

/** Where the window's sheet rests: a snap, or the share of the screen it was dragged to. It opens at chat's height. */
export const openHereSheetRestStore = writable<ChatSheetRest>("half");

/** The window is a sheet (up or tucked): something is open and the phone is held upright. */
export const openHereSheetStore = derived(
    [coWebsites, openHereFloatsStore],
    ([$coWebsites, $openHereFloats]) => $coWebsites.length > 0 && !$openHereFloats
);

/** The sheet is up, not tucked above the bar: the bar is hidden and one chat button floats in its place. */
export const openHereSheetUpStore = derived(
    [openHereSheetStore, openHereTuckedStore],
    ([$sheet, $tucked]) => $sheet && !$tucked
);

/** The tucked sheet is a grabber (28px) and one row (64px) above the bar. */
export const OPEN_HERE_TUCKED_HEIGHT = 92;

export interface OpenHereSheetHeightInput {
    rest: ChatSheetRest;
    tucked: boolean;
    /** The chat is open over the window: the window rises to the top behind it. */
    chatOver: boolean;
    viewportHeight: number;
}

/** The sheet's height for where it rests, before a drag moves it. */
export function openHereSheetHeight({ rest, tucked, chatOver, viewportHeight }: OpenHereSheetHeightInput): number {
    if (chatOver) return getSnapHeights(viewportHeight, CHAT_SHEET_SIZES).full;
    if (tucked) return OPEN_HERE_TUCKED_HEIGHT;
    return chatSheetRestingHeight(rest, viewportHeight);
}

/**
 * What letting go of the sheet at `height` does: tuck it above the bar when it was dragged this far below its lowest
 * height (a window is not closed by a drag, as chat is: closing it can lose several items), or rest where it is, as a
 * share of the screen kept between its lowest height and "full".
 */
export function openHereSheetRelease(height: number, viewportHeight: number): "tuck" | number {
    if (height < getSnapHeights(viewportHeight, CHAT_SHEET_SIZES).peek - CHAT_SHEET_CLOSE_DISTANCE) return "tuck";
    return clampHeight(height, viewportHeight, CHAT_SHEET_SIZES) / viewportHeight;
}
