import { derived, get, writable } from "svelte/store";
import { mobileLayoutStore } from "../Stores/MobileLayoutStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { parseChatSheetRest, type ChatSheetRest } from "./ChatSheetSizes";

/**
 * On a phone held upright the chat is a sheet that rises from the bottom of the screen, with the videos above it.
 * Phones on their side, tablets and desktops keep the chat beside the game. Upright is the same rule as the window's
 * (a square screen counts as upright), so the two sheets are never split between a sheet and a side panel.
 */
export const chatSheetLayoutStore = derived(
    [mobileLayoutStore, windowSize],
    ([$mobileLayout, $windowSize]) => $mobileLayout && $windowSize.portrait
);

/** Where the sheet was left is kept on this device, so it opens there after a reload too. */
const CHAT_SHEET_REST_KEY = "chatSheetRest";

/**
 * Where the sheet rests: a snap, or the share of the screen a person dragged it to. Kept while the chat is closed, so
 * it opens where it was left.
 */
export const chatSheetSnapStore = writable<ChatSheetRest>(readKeptRest() ?? "half");

function readKeptRest(): ChatSheetRest | undefined {
    try {
        return parseChatSheetRest(localStorage.getItem(CHAT_SHEET_REST_KEY));
    } catch {
        return undefined;
    }
}

/** A person put the sheet somewhere (drag or tap on its handle): it rests there, and opens there after a reload. */
export function keepChatSheetRest(rest: ChatSheetRest): void {
    chatSheetSnapStore.set(rest);
    try {
        localStorage.setItem(CHAT_SHEET_REST_KEY, String(rest));
    } catch {
        // Storage blocked (private mode): it is still kept until the page reloads.
    }
}

/** The chat's own sheet height on screen right now (it follows a drag), 0 while there is no chat sheet. */
export const chatOwnSheetHeightStore = writable(0);

/** The same for the Open here window's sheet (files and links on a phone), which is built the same way. */
export const openHereSheetHeightStore = writable(0);

/** The height of the tallest sheet on screen, the chat's or the window's: the videos fit above it. */
export const chatSheetHeightStore = derived(
    [chatOwnSheetHeightStore, openHereSheetHeightStore],
    ([$chatHeight, $windowHeight]) => Math.max($chatHeight, $windowHeight)
);

/** A sheet is open: the videos share the space above it, with no room to show one of them big. */
export const chatSheetOpenStore = derived(chatSheetHeightStore, ($height) => $height > 0);

/**
 * A file tapped in the chat shows above it: the chat sheet drops to its lowest height, so the window has the room. Only
 * for a chat that is open as the sheet; a closed chat keeps the height it was left at.
 */
export function lowerChatSheet(): void {
    if (get(chatVisibilityStore) && get(chatSheetLayoutStore)) chatSheetSnapStore.set("peek");
}
