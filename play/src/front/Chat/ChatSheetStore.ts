import { derived, writable } from "svelte/store";
import { mobileLayoutStore } from "../Stores/MobileLayoutStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import type { SheetSnap } from "../Components/Sheet/BottomSheet";

/**
 * On a phone held upright the chat is a sheet that rises from the bottom of the screen, with the videos above it.
 * Phones on their side, tablets and desktops keep the chat beside the game.
 */
export const chatSheetLayoutStore = derived(
    [mobileLayoutStore, windowSize],
    ([$mobileLayout, $windowSize]) => $mobileLayout && $windowSize.height > $windowSize.width
);

/** The height the sheet rests on. Kept while the chat is closed, so it opens where it was left. */
export const chatSheetSnapStore = writable<SheetSnap>("half");

/** The sheet's height on screen right now (it follows a drag), 0 while there is no sheet. The videos fit above it. */
export const chatSheetHeightStore = writable(0);
