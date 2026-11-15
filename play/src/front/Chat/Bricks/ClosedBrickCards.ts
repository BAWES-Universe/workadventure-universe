import { derived, writable } from "svelte/store";
import type { Readable } from "svelte/store";

/**
 * The cards of a Brick the person closed with X (game #1995): the ways to start under its hello, once per chat, and the
 * ideas under one "what I can do" answer, and (#1996) one suggestion of a Brick. Kept on this device, so a closed card stays closed after a reload. Only the
 * newest few are kept: an old card is long out of sight.
 */
const STORAGE_KEY = "universe.brick.closedCards";
const KEPT = 40;

function read(): string[] {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string").slice(-KEPT) : [];
    } catch {
        // No storage, or something else wrote there: nothing was closed
        return [];
    }
}

const closed = writable<string[]>(read());

export const closedBrickCards: Readable<ReadonlySet<string>> = derived(closed, ($closed) => new Set($closed));

export function closeBrickCard(key: string): void {
    closed.update((keys) => {
        if (keys.includes(key)) return keys;
        const next = [...keys, key].slice(-KEPT);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // No storage: the card stays closed until the page reloads
        }
        return next;
    });
}

export const startersCardKey = (roomId: string): string => `starters:${roomId}`;
export const ideasCardKey = (messageId: string): string => `ideas:${messageId}`;
/** A Brick's suggestion (#1996): closed with X, "Not now" or "Make it", it never comes back for that message. */
export const offerCardKey = (messageId: string): string => `offer:${messageId}`;
/** A Brick's offer to connect an App (#2001): closed with X, "Not now" or once it is connected, it never comes back for that message. */
export const appCardKey = (messageId: string): string => `app:${messageId}`;
/** "Keep Brick?" after an answer of the Brick for guests that says something needs an account (#1997): closed, it does not come back for that answer. */
export const keepCardKey = (messageId: string): string => `keep:${messageId}`;
