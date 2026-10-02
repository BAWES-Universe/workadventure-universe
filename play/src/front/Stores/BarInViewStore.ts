import { derived, writable } from "svelte/store";
import { windowSize } from "./CoWebsiteStore";

/**
 * "Keep the bar in view", the profile menu's layout switch. On (the default), the chat and side windows such as
 * Orbit open under the bar and Express and the zoom buttons sit beside Orbit. Off, windows open at full height over
 * the bar and everything else keeps its place. Kept per device, and only for desktops (1024px and wider): phones and
 * small windows keep their own layout either way.
 */
const STORAGE_KEY = "keepBarInView";

function readSetting(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) !== "false";
    } catch {
        return true;
    }
}

export const keepBarInViewStore = writable(readSetting());

// Not unsubscribing is ok, this is a singleton.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
keepBarInViewStore.subscribe((value) => {
    try {
        localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
        // Private windows can refuse storage: the switch still works until the page reloads.
    }
});

/** The width from which windows float and the layout switch applies (chat.scss and Modal.svelte use the same). */
export const DESKTOP_LAYOUT_MIN_WIDTH = 1024;

/** The switch is on and the window is wide enough for it to apply. */
export const barInViewStore = derived(
    [keepBarInViewStore, windowSize],
    ([$keepBarInView, $windowSize]) => $keepBarInView && $windowSize.width >= DESKTOP_LAYOUT_MIN_WIDTH
);

// The chat lives outside the main layout, so its place under the bar is set from a class on the page (chat.scss).
//eslint-disable-next-line svelte/no-ignored-unsubscribe
barInViewStore.subscribe((barInView) => {
    document.documentElement.classList.toggle("u-bar-in-view", barInView);
});
