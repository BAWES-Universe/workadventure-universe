import { writable } from "svelte/store";

/**
 * State of the Express tray (one-tap say, think and emotes).
 * "editing" is the tray in edit mode, where emotes and phrases can be swapped.
 * Per tab and in memory only.
 */
export type ExpressTrayState = "closed" | "open" | "editing";

export interface ExpressTrayOpenOptions {
    /** Start in Think mode (Ctrl+Enter). */
    think?: boolean;
    /** Focus the text field even on touch screens (opened from a keyboard). */
    focusInput?: boolean;
}

/** How the tray was last opened; read by the tray when it mounts. */
export const expressTrayOpenOptions = writable<ExpressTrayOpenOptions>({});

function createExpressTrayStore() {
    const { subscribe, set } = writable<ExpressTrayState>("closed");
    return {
        subscribe,
        open: (options: ExpressTrayOpenOptions = {}) => {
            expressTrayOpenOptions.set(options);
            set("open");
        },
        edit: () => set("editing"),
        close: () => set("closed"),
    };
}

export const expressTrayStore = createExpressTrayStore();
