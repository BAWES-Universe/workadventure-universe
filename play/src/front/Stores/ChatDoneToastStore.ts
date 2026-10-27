import { writable } from "svelte/store";

/** How long the note after deleting a chat or leaving a group stays. */
export const CHAT_DONE_TOAST_MS = 4000;

/** The words on screen. Each note is a new value, so the same words again stay for a full while again. */
export const chatDoneToastStore = writable<{ text: string } | undefined>(undefined);

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows "Deleted your chat with …" or "Left …" and takes it away by itself. */
export function showChatDoneToast(text: string): void {
    clearTimeout(timer);
    chatDoneToastStore.set({ text });
    timer = setTimeout(() => chatDoneToastStore.set(undefined), CHAT_DONE_TOAST_MS);
}
