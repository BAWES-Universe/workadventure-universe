import { writable } from "svelte/store";

export const currentPlayerWokaStore = writable<string | undefined>(undefined);

/**
 * The texture layers drawn in that picture (the fallback woka's when the chosen one failed to load).
 * Set just before `currentPlayerWokaStore`, so it always matches the picture there.
 */
export const currentPlayerWokaLayersStore = writable<readonly string[] | undefined>(undefined);
