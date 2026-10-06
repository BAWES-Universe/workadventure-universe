import { writable } from "svelte/store";

/** Counts the copies made from the chat: each new value shows the "Copied" pill above the message box again. */
export const copiedPillStore = writable(0);

export function showCopiedPill(): void {
    copiedPillStore.update((copies) => copies + 1);
}
