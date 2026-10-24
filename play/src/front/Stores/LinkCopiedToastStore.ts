import { writable } from "svelte/store";

/** How long the "link copied" note stays. */
export const LINK_COPIED_TOAST_MS = 3000;

/** Set while the note is on screen. Each copy is a new value, so copying again shows it for a full while again. */
export const linkCopiedToastStore = writable<object | undefined>(undefined);

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows the "link copied" note and takes it away by itself. */
export function showLinkCopiedToast(): void {
    clearTimeout(timer);
    linkCopiedToastStore.set({});
    timer = setTimeout(() => linkCopiedToastStore.set(undefined), LINK_COPIED_TOAST_MS);
}
