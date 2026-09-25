import { writable } from "svelte/store";
import type { ChatMessage, ChatRoom } from "../Connection/ChatConnection";

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
    /** The proximity chat was the one open: the next map's opens in its place (a reconnect keeps you in it). */
    wasSelected?: boolean;
    /** What leaving the bubble puts back (the chat open before it), when the old map still had to put it back. */
    chatStateToRestore?: { room: ChatRoom | undefined; visible: boolean };
}

let stash: ProximityHistoryStash | undefined;

export function stashProximityHistory(history: ProximityHistoryStash): void {
    stash =
        history.messages.length > 0 || history.wasSelected || history.chatStateToRestore !== undefined
            ? history
            : undefined;
}

/**
 * Leaving the game without a new map right away (back to the login screen, changing your woka or camera): keep the
 * chats you had, but not what was open, so the proximity chat never opens by itself when you come back.
 */
export function keepOnlyProximityHistory(): void {
    if (!stash) return;
    stash = { ...stash, wasSelected: false, chatStateToRestore: undefined };
    if (stash.messages.length === 0) stash = undefined;
}

export function takeProximityHistory(): ProximityHistoryStash | undefined {
    const taken = stash;
    stash = undefined;
    return taken;
}
