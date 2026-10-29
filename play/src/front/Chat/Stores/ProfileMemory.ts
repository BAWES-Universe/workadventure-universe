import type { Readable } from "svelte/store";
import { relationshipsStore, type Relationship } from "./FriendsStore";

/**
 * What a person's profile showed last (their card, where they are), kept while the player is in the game so opening
 * it again shows it at once and only refreshes it quietly, as WhatsApp and Discord do (#1585). In memory only: a
 * reload forgets it, and nothing is saved on the device. Someone whose standing with you changes (unfriended, blocked,
 * a friend at last) is forgotten at once, so nothing they show only to friends stays on screen.
 */
export interface ProfileMemory<T> {
    has(key: string): boolean;
    get(key: string): T | undefined;
    set(key: string, value: T): void;
}

const memories = new Set<Map<string, unknown>>();

export function profileMemory<T>(): ProfileMemory<T> {
    const kept = new Map<string, T>();
    memories.add(kept as Map<string, unknown>);
    // Watched from the first use, not on import: the friends list belongs to a running game.
    const used = () => watchRelationships(relationshipsStore);
    return {
        has: (key) => (used(), kept.has(key)),
        get: (key) => (used(), kept.get(key)),
        set: (key, value) => {
            used();
            kept.set(key, value);
        },
    };
}

/** Forgets everything kept about one person (by their uuid, or a bot's id). */
export function forgetPerson(key: string): void {
    for (const kept of memories) kept.delete(key);
}

let watching = false;
let known = new Map<string, Relationship>();

/** Exported for tests: forgets whoever's standing changed since the last list. */
export function watchRelationships(relationships: Readable<Map<string, Relationship>>): void {
    if (watching) return;
    watching = true;
    // Watched for as long as the game runs, like the friends list itself.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    relationships.subscribe((next) => {
        for (const uuid of new Set([...known.keys(), ...next.keys()])) {
            if (known.get(uuid) !== next.get(uuid)) forgetPerson(uuid);
        }
        known = new Map(next);
    });
}
