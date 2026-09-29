import { writable } from "svelte/store";

/**
 * True while keyboard focus is inside the quest options, card or log: the game stops reading movement keys so arrows
 * and letters act on the panel, as they do for the settings menu (menuInputFocusStore).
 */
export const questInputFocusStore = writable(false);
