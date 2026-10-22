import { get, writable } from "svelte/store";
import { modalIframeStore, modalVisibilityStore } from "./ModalStore";
import { windowInFrontStore } from "./WindowInFrontStore";

/**
 * Orbit and the Open here window (files and links) open in the same place on the right, so when both are open one
 * is in front: the one opened or tapped last, as windows on a computer behave. Neither closes the other.
 */
export const sideWindowInFrontStore = writable<"orbit" | "openHere">("openHere");

/**
 * A menu, Settings, Explore or a card is open over the window of files and links, which sits behind Orbit until it
 * closes. The window itself sets this (it knows what is open), so Esc and Orbit's button treat Orbit as the one in front.
 */
export const windowBehindCardStore = writable(false);

/**
 * On an upright phone the window is a sheet, and dragging it down tucks it into a slim row above the bar instead of
 * closing it: the bar and Orbit are back, and a tap on the row brings the sheet up again.
 */
export const openHereSheetTuckedStore = writable(false);

/** Opening a file or a link brings the Open here window in front, over Orbit and the chat if they are open, and up from a tuck. */
export function bringOpenHereInFront(): void {
    sideWindowInFrontStore.set("openHere");
    windowInFrontStore.set("window");
    openHereSheetTuckedStore.set(false);
}

// The store lives as long as the page, so this subscription does too.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
modalVisibilityStore.subscribe((visible) => {
    if (visible) sideWindowInFrontStore.set("orbit");
});

// A map script opening the modal again while it shows (WA.ui.modal.openModal) leaves the visibility as it was, but is
// still Orbit asking to be seen: it comes in front of the window then too.
// The store lives as long as the page, so this subscription does too.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
modalIframeStore.subscribe((iframe) => {
    if (iframe && get(modalVisibilityStore)) sideWindowInFrontStore.set("orbit");
});
