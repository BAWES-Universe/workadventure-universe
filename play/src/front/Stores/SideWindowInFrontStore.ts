import { writable } from "svelte/store";
import { modalVisibilityStore } from "./ModalStore";

/**
 * Orbit and the Open here window (files and links) open in the same place on the right, so when both are open one
 * is in front: the one opened or tapped last, as windows on a computer behave. Neither closes the other.
 */
export const sideWindowInFrontStore = writable<"orbit" | "openHere">("openHere");

/** Opening a file or a link brings the Open here window in front, over Orbit if it is open. */
export function bringOpenHereInFront(): void {
    sideWindowInFrontStore.set("openHere");
}

// The store lives as long as the page, so this subscription does too.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
modalVisibilityStore.subscribe((visible) => {
    if (visible) sideWindowInFrontStore.set("orbit");
});
