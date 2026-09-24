import { writable } from "svelte/store";

/**
 * The one room menu open in this tab, if any. Opening a room menu closes the
 * other one, even though its toggle stops the click from reaching the document. Per tab and in memory only.
 */
export const openChatMenuStore = writable<object | undefined>(undefined);
