import { writable } from "svelte/store";

export const currentPlayerGroupLockStateStore = writable<boolean | undefined>(undefined);

/**
 * The others in the current player's bubble (their user ids), in the order the server lists them. Empty outside a
 * bubble. "Ask to follow" asks them.
 */
export const bubbleMatesStore = writable<number[]>([]);
