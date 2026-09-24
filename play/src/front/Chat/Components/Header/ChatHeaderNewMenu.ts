import { writable } from "svelte/store";

/** The choices behind the chat header's "+". */
export type NewChatOption = "newMessage" | "newRoom" | "newFolder";

export interface NewChatOptionsInput {
    /** Signed in to Universe (not a guest). */
    isSignedIn: boolean;
    /** The Matrix client runs as a Matrix guest, which can't create rooms or DMs. */
    isMatrixGuest: boolean;
    /** Chat connection status; saved conversations need it to be ONLINE. */
    chatStatus: string;
    /** The People tab exists on this map, so New message has somewhere to pick a person from. */
    isPeopleListEnabled: boolean;
}

/**
 * Which "+" choices to show. Saved conversations need an account, as they do today, so guests get none and
 * the "+" is hidden for them. New message needs the People tab to pick a person from.
 */
export function getNewChatOptions(input: NewChatOptionsInput): NewChatOption[] {
    if (!input.isSignedIn || input.isMatrixGuest || input.chatStatus !== "ONLINE") return [];
    const options: NewChatOption[] = [];
    if (input.isPeopleListEnabled) options.push("newMessage");
    options.push("newRoom", "newFolder");
    return options;
}

/**
 * Roving focus inside the "+" menu: arrows wrap, Home and End jump to the ends. Returns undefined for keys the
 * menu doesn't handle. Up and down are logical (not visual) so RTL behaves the same.
 */
export function nextMenuIndex(current: number, key: string, count: number): number | undefined {
    if (count <= 0) return undefined;
    switch (key) {
        case "ArrowDown":
            return current < 0 ? 0 : (current + 1) % count;
        case "ArrowUp":
            return current < 0 ? count - 1 : (current - 1 + count) % count;
        case "Home":
            return 0;
        case "End":
            return count - 1;
        default:
            return undefined;
    }
}

/**
 * Set by New message, read by the People tab's header once it mounts, so its search field takes focus.
 * Module state: per browser tab and in memory only.
 */
export const focusChatSearchRequest = writable(false);
