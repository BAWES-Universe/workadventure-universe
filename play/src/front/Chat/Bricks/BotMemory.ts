import { writable, type Readable } from "svelte/store";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { shortDay } from "./Brick";

/**
 * What a bot remembers about the signed-in person (game #2003): the list on a Brick's page and in the chat menu of
 * anyone's bot. It is the person's own: Orbit answers it only to them, and what a thing says is put into words here, in
 * the language they use, from what Orbit sends (a kind, a value, when it was said). Forgetting happens at once, with no
 * one's say, and is final: the thing goes with what was built from it.
 */

export const MEMORY_ITEM_KINDS = ["name", "birthday", "pref", "fact"] as const;
export type MemoryItemKind = (typeof MEMORY_ITEM_KINDS)[number];

export interface MemoryItem {
    /** Its key. This is what Forget names. */
    id: string;
    kind: MemoryItemKind;
    value: string;
    /** For a fact: what it is about ("favorite_color"). */
    label: string | null;
    /** When it was said, in milliseconds; null when the bot did not keep it. */
    at: number | null;
    /** Said where nobody else was: the bot knows it everywhere, and keeps it out of group chats. */
    private: boolean;
}

/** A list of things as Orbit sends it (`{ items: [...] }`); anything that is not whole is left out. */
export function parseMyMemory(value: unknown): MemoryItem[] {
    const list = (value as { items?: unknown } | null)?.items;
    if (!Array.isArray(list)) return [];
    const items: MemoryItem[] = [];
    for (const one of list) {
        const { id, kind, value: said, label, at, private: priv } = (one ?? {}) as Record<string, unknown>;
        if (typeof id !== "string" || id === "" || typeof said !== "string" || said.trim() === "") continue;
        if (!(MEMORY_ITEM_KINDS as readonly unknown[]).includes(kind)) continue;
        items.push({
            id,
            kind: kind as MemoryItemKind,
            value: said,
            label: typeof label === "string" && label !== "" ? label : null,
            at: typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null,
            private: priv === true,
        });
    }
    return items;
}

/** "favorite_color" reads "Favorite color". */
function tidyLabel(label: string | null): string {
    const words = (label ?? "").replace(/[_-]+/g, " ").trim();
    return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export interface SaidItem {
    /** What it is, in plain words: "Likes lo-fi". */
    text: string;
    /** Under it: when it was said, or that it was said privately. */
    note: string;
    private: boolean;
}

export function sayItem(item: MemoryItem, ll: TranslationFunctions, locale?: string): SaidItem {
    const m = ll.chat.brick.memory;
    const { value } = item;
    let text: string;
    switch (item.kind) {
        case "name":
            text = m.name({ value });
            break;
        case "birthday":
            text = m.birthday({ value });
            break;
        case "pref":
            text = m.likes({ value });
            break;
        default:
            text =
                item.label === "current_state"
                    ? m.feeling({ value })
                    : tidyLabel(item.label)
                    ? m.fact({ label: tidyLabel(item.label), value })
                    : value;
    }
    const day = item.at !== null ? shortDay(item.at, locale) : "";
    const note = item.private ? m.private() : day ? m.fromChat({ date: day }) : m.fromChatUndated();
    return { text, note, private: item.private };
}

export type MemoryState = "loading" | "ready" | "failed";

export interface BotMemoryList {
    items: Readable<MemoryItem[]>;
    state: Readable<MemoryState>;
    load(): Promise<void>;
    /** Forgets one thing: it goes from the list at once and comes back if Orbit refuses. True when it is forgotten. */
    forget(itemId: string): Promise<boolean>;
    /** Forgets everything this bot remembers about the person. True when it is done. */
    forgetEverything(): Promise<boolean>;
}

/** One bot's list for the person. A read that fails says so; it never shows a list it did not read. */
export function botMemoryList(botId: string): BotMemoryList {
    const items = writable<MemoryItem[]>([]);
    const state = writable<MemoryState>("loading");
    let current: MemoryItem[] = [];
    const put = (next: MemoryItem[]) => {
        current = next;
        items.set(next);
    };

    return {
        items: { subscribe: items.subscribe },
        state: { subscribe: state.subscribe },
        async load() {
            state.set("loading");
            try {
                put(parseMyMemory(await botApiService.getMyMemory(botId)));
                state.set("ready");
            } catch (error) {
                console.warn("Could not read what a bot remembers", error);
                state.set("failed");
            }
        },
        async forget(itemId) {
            const before = current;
            put(before.filter((item) => item.id !== itemId));
            try {
                await botApiService.forgetMyMemory(botId, { itemId });
                return true;
            } catch (error) {
                console.warn("Could not forget a thing", error);
                // Things said while the call was out are kept; the one that did not go comes back where it was
                put(before.filter((item) => item.id === itemId || current.some((one) => one.id === item.id)));
                return false;
            }
        },
        async forgetEverything() {
            const before = current;
            put([]);
            try {
                await botApiService.forgetMyMemory(botId, { everything: true });
                return true;
            } catch (error) {
                console.warn("Could not forget everything", error);
                put(before);
                return false;
            }
        },
    };
}
