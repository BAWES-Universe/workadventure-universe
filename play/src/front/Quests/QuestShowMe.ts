import type { Readable } from "svelte/store";
import { get, writable } from "svelte/store";
import type { QuestPath } from "./QuestModel";

/** After the card closes, the marker and the edge arrow stay this long so the person can look for them. */
export const SHOW_ME_LINGER_MS = 4_000;

const active = writable<QuestPath | null>(null);
let lingerTimer: ReturnType<typeof setTimeout> | undefined;

function clearLinger(): void {
    if (lingerTimer) clearTimeout(lingerTimer);
    lingerTimer = undefined;
}

/** The quest whose target is marked on the map right now (Show me), if any. The camera never moves for it. */
export const questShowMeStore: Readable<QuestPath | null> = { subscribe: active.subscribe };

export function startShowMe(path: QuestPath): void {
    clearLinger();
    active.set(path);
}

/** The card closed: keep the marker a little longer, then remove it. */
export function lingerShowMe(): void {
    if (get(active) === null || lingerTimer) return;
    lingerTimer = setTimeout(() => {
        lingerTimer = undefined;
        active.set(null);
    }, SHOW_ME_LINGER_MS);
}

export function stopShowMe(): void {
    clearLinger();
    active.set(null);
}
