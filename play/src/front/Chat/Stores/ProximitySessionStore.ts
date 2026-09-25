import { writable } from "svelte/store";
import type { ChatMessage } from "../Connection/ChatConnection";

/**
 * Which stay of the proximity chat the thread shows: a session id, ROOM_MESSAGES_SESSION_ID for the messages
 * written outside any stay, or undefined for the whole timeline (the behaviour before sessions had rows).
 * Per tab and in memory, like the proximity chat itself.
 */
export const selectedProximitySessionStore = writable<string | undefined>(undefined);

/**
 * What a proximity chat hands to the one of the next map, so walking through a door keeps the chats you had.
 * Held only between the old scene's cleanup and the new scene's start; a reload clears it, as before.
 */
export interface ProximityHistoryStash {
    messages: ChatMessage[];
    unreadBySession: Map<string, number>;
    unsentDrafts: Map<string, string>;
}

let stash: ProximityHistoryStash | undefined;

export function stashProximityHistory(history: ProximityHistoryStash): void {
    stash = history.messages.length > 0 ? history : undefined;
}

export function takeProximityHistory(): ProximityHistoryStash | undefined {
    const taken = stash;
    stash = undefined;
    return taken;
}
