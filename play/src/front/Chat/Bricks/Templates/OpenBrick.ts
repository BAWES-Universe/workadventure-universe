import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { leaveChat } from "../../ChatBack";
import { bricksPageOpenStore, navChat } from "../../Stores/ChatStore";

/**
 * Opening a Brick's own page from somewhere else (game #2008): a Brick just made from a template opens on its page, where
 * "Setup required" and "Made from" are. The page lives under the Bricks page, so the chat is left for the list, the Bricks
 * page opens, and it opens that Brick's page when it sees the request (the same way the Apps page is asked for).
 */
const requested = writable<string | undefined>(undefined);
/** The Brick whose page waits for the Bricks page to open it. */
export const brickPageRequest: Readable<string | undefined> = { subscribe: requested.subscribe };

/** The Bricks page calls this when it has opened the page for a request. */
export function takeBrickPageRequest(): void {
    requested.set(undefined);
}

export function openBrickPage(brickId: string): void {
    leaveChat();
    navChat.switchToChat();
    bricksPageOpenStore.set(true);
    requested.set(brickId);
}
