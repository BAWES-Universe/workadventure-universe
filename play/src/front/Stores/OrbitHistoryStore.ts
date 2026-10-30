import { writable } from "svelte/store";

/**
 * True while Orbit has the top of the tab's history: while it is open, and after it closes until its steps have been
 * walked back. Other steps (the chat's levels) wait until then: one added on top of Orbit's would be walked back with
 * them, and its level would close at once.
 */
export const orbitHoldsHistoryStore = writable(false);
