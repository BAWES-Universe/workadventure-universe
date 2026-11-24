import { writable } from "svelte/store";

/** What "Search apps" starts with when the Apps page opens from a card ("calendar"). The page clears it once read. */
export const appsSearchStart = writable<string | undefined>(undefined);
