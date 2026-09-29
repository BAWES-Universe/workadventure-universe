/**
 * Dev-only switches for quests, read from this browser's localStorage:
 * - `questSim`: which host variant to simulate. The owner's choice (from the hash) and then the first bot on the map
 *   always come first; `area` then falls back to the first named area, `bot` (default) and `none` to no host, and
 *   `empty` simulates an empty room (no host, nothing here, no invitation).
 * - `questReset=1`: forget all quest progress on the next load (then cleared).
 */
export type QuestSim = "bot" | "area" | "none" | "empty";

export const QUEST_SIM_KEY = "questSim";
export const QUEST_RESET_KEY = "questReset";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseQuestSim(raw: string | null): QuestSim {
    return raw === "area" || raw === "none" || raw === "empty" ? raw : "bot";
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

function browserStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export { browserStorage as questBrowserStorage };
