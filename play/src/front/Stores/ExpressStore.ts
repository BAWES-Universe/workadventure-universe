import { writable } from "svelte/store";

/**
 * State of the Express tray (one-tap say, think and emotes).
 * "editing" is the tray in edit mode, where emotes and phrases can be swapped.
 * Per tab and in memory only.
 */
export type ExpressTrayState = "closed" | "open" | "editing";

function createExpressTrayStore() {
    const { subscribe, set } = writable<ExpressTrayState>("closed");
    return {
        subscribe,
        open: () => set("open"),
        edit: () => set("editing"),
        close: () => set("closed"),
    };
}

export const expressTrayStore = createExpressTrayStore();
