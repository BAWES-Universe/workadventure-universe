import { writable } from "svelte/store";

/**
 * Dev-only switches for the proof slice, read from this browser's localStorage (the flag gates everything that
 * reads them):
 * - `questSim`: which host variant to simulate: `bot` (default; the bot named Receptionist, else the first bot),
 *   `area`, `none` or `empty` (nothing here, no invitation).
 * - `questReset=1`: forget all quest progress on the next load (then cleared).
 * - `questDockWidth`: `narrow` (default; cards leave the Express column visible) or `full` on phones.
 */
export type QuestSim = "bot" | "area" | "none" | "empty";
export type QuestDockWidth = "narrow" | "full";

export const QUEST_SIM_KEY = "questSim";
export const QUEST_RESET_KEY = "questReset";
export const QUEST_DOCK_WIDTH_KEY = "questDockWidth";

/** The bot a `bot` simulation prefers as host when it is on the map. */
export const PREFERRED_HOST_BOT_NAME = "Receptionist";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseQuestSim(raw: string | null): QuestSim {
    return raw === "area" || raw === "none" || raw === "empty" ? raw : "bot";
}

export function parseQuestDockWidth(raw: string | null): QuestDockWidth {
    return raw === "full" ? "full" : "narrow";
}

export function readQuestSim(storage: StorageLike | undefined): QuestSim {
    try {
        return parseQuestSim(storage?.getItem(QUEST_SIM_KEY) ?? null);
    } catch {
        return "bot";
    }
}

/** True once when `questReset=1` is set; the key is removed so the reset happens a single time. */
export function consumeQuestReset(storage: StorageLike | undefined): boolean {
    try {
        if (storage?.getItem(QUEST_RESET_KEY) !== "1") return false;
        storage.removeItem(QUEST_RESET_KEY);
        return true;
    } catch {
        return false;
    }
}

function createQuestDockWidthStore(storage: StorageLike | undefined) {
    let initial: QuestDockWidth = "narrow";
    try {
        initial = parseQuestDockWidth(storage?.getItem(QUEST_DOCK_WIDTH_KEY) ?? null);
    } catch {
        // Storage blocked: the default applies.
    }
    const { subscribe, set } = writable<QuestDockWidth>(initial);
    return {
        subscribe,
        set(value: QuestDockWidth) {
            set(value);
            try {
                storage?.setItem(QUEST_DOCK_WIDTH_KEY, value);
            } catch {
                // Kept for this page only.
            }
        },
    };
}

function browserStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export const questDockWidthStore = createQuestDockWidthStore(browserStorage());

export { browserStorage as questBrowserStorage };
