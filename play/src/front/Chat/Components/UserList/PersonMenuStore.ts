import { writable } from "svelte/store";

/** The id of the person menu ("more actions") that is open, so opening one closes the others. Per tab, in memory. */
export const openPersonMenuStore = writable<string | undefined>(undefined);
