import { derived } from "svelte/store";
import { windowSize } from "./CoWebsiteStore";

/**
 * On desktops (1024px and wider) the chat and side windows such as Orbit open under the bar, and Express and the zoom
 * buttons sit beside Orbit. This is the only desktop layout: phones and small windows keep their own layout.
 */

// The profile menu used to have a "Keep the bar in view" switch saved on the device. It is gone, so a saved "off" must
// not linger: drop it once.
try {
    localStorage.removeItem("keepBarInView");
} catch {
    // Private windows can refuse storage: nothing was saved there anyway.
}

/** The width from which windows float under the bar (chat.scss and Modal.svelte use the same). */
export const DESKTOP_LAYOUT_MIN_WIDTH = 1024;

/** The window is wide enough for the desktop layout. */
export const barInViewStore = derived([windowSize], ([$windowSize]) => $windowSize.width >= DESKTOP_LAYOUT_MIN_WIDTH);

// The chat lives outside the main layout, so its place under the bar is set from a class on the page (chat.scss).
//eslint-disable-next-line svelte/no-ignored-unsubscribe
barInViewStore.subscribe((barInView) => {
    document.documentElement.classList.toggle("u-bar-in-view", barInView);
});
