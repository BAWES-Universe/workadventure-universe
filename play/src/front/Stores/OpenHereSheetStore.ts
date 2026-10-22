import { derived, get, writable } from "svelte/store";
import { chatSheetSnapStore } from "../Chat/ChatSheetStore";
import type { ChatSheetRest } from "../Chat/ChatSheetSizes";
import { getLastChatOpenSource } from "../Chat/openChat";
import { chatVisibilityStore } from "./ChatStore";
import { coWebsites, openHereFloatsStore } from "./CoWebsiteStore";
import { openHereSheetTuckedStore } from "./SideWindowInFrontStore";

/**
 * On a phone held upright the Open here window is chat's own sheet: it rises from the bottom, rests on the same
 * heights and is dragged by the same handle. These are its stores, next to the chat's (ChatSheetStore.ts).
 */

/** The files and links are showing as a sheet. */
export const openHereSheetLayoutStore = derived(openHereFloatsStore, ($floats) => !$floats);

/** The sheet is up: it covers the bottom of the screen, so the bar is hidden (as it is while the chat is up). */
export const openHereSheetUpStore = derived(
    [coWebsites, openHereSheetLayoutStore, openHereSheetTuckedStore],
    ([$coWebsites, $sheetLayout, $tucked]) => $coWebsites.length > 0 && $sheetLayout && !$tucked
);

/** The sheet is tucked into its slim row above the bar. */
export const openHereSheetTuckedRowStore = derived(
    [coWebsites, openHereSheetLayoutStore, openHereSheetTuckedStore],
    ([$coWebsites, $sheetLayout, $tucked]) => $coWebsites.length > 0 && $sheetLayout && $tucked
);

/** Where the sheet rests: a snap, or the share of the screen a person dragged it to. It opens at the chat's height. */
export const openHereSheetRestStore = writable<ChatSheetRest>("half");

/** The sheet's height on screen right now (it follows a drag), 0 while it is not up or the chat is in front of it. */
export const openHereSheetHeightStore = writable(0);

/** The "N open" list is showing: a menu in the desktop window, a sheet on a phone. */
export const openHereListOpenStore = writable(false);

/** Where the chat rested before a file took the screen above it, so it goes back there when they part. */
let chatRestBeforeFile: ChatSheetRest | undefined;

/**
 * A file and the chat are up together on a phone: the chat is in front at its lowest height (the field and the last
 * messages) and the file shows above it. A chat a message in a bubble opened keeps the height it opened at, unless a
 * file was tapped in it (`force`).
 */
export function lowerChatForFile(force = false): void {
    if (!get(openHereSheetLayoutStore) || !get(chatVisibilityStore)) return;
    if (!force && getLastChatOpenSource() === "bubble") return;
    if (chatRestBeforeFile === undefined) chatRestBeforeFile = get(chatSheetSnapStore);
    // After the chat's own opening pass, which lifts a chat left at its lowest height back up.
    setTimeout(() => chatSheetSnapStore.set("peek"), 0);
}

/** The chat and the file part (one closed): the chat goes back where it was, unless a person moved it since. */
export function restoreChatAfterFile(): void {
    if (chatRestBeforeFile === undefined) return;
    const rest = chatRestBeforeFile;
    chatRestBeforeFile = undefined;
    setTimeout(() => {
        if (get(chatSheetSnapStore) === "peek") chatSheetSnapStore.set(rest);
    }, 0);
}

/**
 * A file tapped in chat always shows: a tucked sheet comes back up, and the chat, wherever it had been dragged to,
 * drops to its lowest height with the file above it.
 */
export function showFileOnPhone(): void {
    if (!get(openHereSheetLayoutStore)) return;
    openHereSheetTuckedStore.set(false);
    lowerChatForFile(true);
}
