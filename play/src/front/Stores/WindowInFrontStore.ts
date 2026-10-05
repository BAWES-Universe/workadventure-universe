import { writable } from "svelte/store";
import { chatVisibilityStore } from "./ChatStore";
import { modalVisibilityStore } from "./ModalStore";

/**
 * Which of the chat and the window beside it (Orbit, or any page a map opens) is in front where they overlap: the one
 * opened or clicked last, the way windows on a computer behave.
 */
export const windowInFrontStore = writable<"chat" | "window">("chat");

// Both stores live as long as the page, so these subscriptions do too.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
chatVisibilityStore.subscribe((visible) => {
    if (visible) windowInFrontStore.set("chat");
});
//eslint-disable-next-line svelte/no-ignored-unsubscribe
modalVisibilityStore.subscribe((visible) => {
    if (visible) windowInFrontStore.set("window");
});
