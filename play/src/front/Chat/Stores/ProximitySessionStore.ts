import { writable } from "svelte/store";
import type { ChatMessage, ChatRoom } from "../Connection/ChatConnection";
import type { UnsentVoiceNote } from "../VoiceNote/VoiceNote";

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
    unsentVoiceNotes: Map<string, UnsentVoiceNote>;
    /** The proximity chat was the one open: the next map's opens in its place (a reconnect keeps you in it). */
    wasSelected?: boolean;
    /** What leaving the bubble puts back (the chat open before it), when the old map still had to put it back. */
    chatStateToRestore?: {
        room: ChatRoom | undefined;
        visible: boolean;
        /** The chat to put back was the proximity chat itself: the next map's proximity chat stands in for it. */
        proximityChat?: boolean;
    };
    /**
     * The next map's proximity chat, once it took this. What the old chat still gets after the hand-over (a reconnect
     * keeps it open while the game gets back in) goes to it: the composer's text and voice note when it closes, and
     * messages sent meanwhile, marked as not sent.
     */
    takenBy?: {
        keepUnsentDraft(sessionId: string | undefined, text: string): void;
        keepUnsentVoiceNote(sessionId: string | undefined, note: UnsentVoiceNote): void;
        carryNotSentMessage(message: ChatMessage, stayEnd: ChatMessage | undefined): void;
    };
}

let stash: ProximityHistoryStash | undefined;

export function stashProximityHistory(history: ProximityHistoryStash): void {
    stash =
        history.messages.length > 0 || history.wasSelected || history.chatStateToRestore !== undefined
            ? history
            : undefined;
}

/** Set when the game was left without a new map right away; the next proximity chat reads it once. */
let leftWithoutMap = false;

/**
 * Leaving the game without a new map right away (back to the login screen, changing your woka or camera): keep the
 * chats you had, but not what was open, so the proximity chat never opens by itself when you come back.
 */
export function keepOnlyProximityHistory(): void {
    leftWithoutMap = true;
    if (!stash) return;
    // Changed in place: the old chat holds this same object, and what the next one does to it (takenBy) must reach it.
    stash.wasSelected = false;
    stash.chatStateToRestore = undefined;
    if (stash.messages.length === 0) stash = undefined;
}

/** Whether the game was left without a new map since the last call: the previous proximity chat is gone for good. */
export function takeLeftWithoutMap(): boolean {
    const left = leftWithoutMap;
    leftWithoutMap = false;
    return left;
}

export function takeProximityHistory(): ProximityHistoryStash | undefined {
    const taken = stash;
    stash = undefined;
    return taken;
}
