import { writable } from "svelte/store";

/**
 * State of the Express tray (one-tap say, think and emotes).
 * Per tab and in memory only.
 */
export type ExpressTrayState = "closed" | "open";

function createExpressTrayStore() {
    const { subscribe, set } = writable<ExpressTrayState>("closed");
    return {
        subscribe,
        open: () => set("open"),
        close: () => set("closed"),
    };
}

export const expressTrayStore = createExpressTrayStore();
