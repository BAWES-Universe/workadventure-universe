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
/** Whether that Brick's page was opened from its chat, so its Back returns there. */
let fromChat = false;
/** The Brick whose page waits for the Bricks page to open it. */
export const brickPageRequest: Readable<string | undefined> = { subscribe: requested.subscribe };

/**
 * The Bricks page calls this when it has opened the page for a request. It says whether the page was opened from the
 * Brick's chat (Back then goes back to the chat), once.
 */
export function takeBrickPageRequest(): { backToChat: boolean } {
    const backToChat = fromChat;
    fromChat = false;
    requested.set(undefined);
    return { backToChat };
}

/**
 * Opens a Brick's page. From the Brick's chat (`backToChat`) the page's Back returns to that chat: the chat is left for
 * the page, as the page lives under the Bricks page, and opened again from Back.
 */
export function openBrickPage(brickId: string, options: { backToChat?: boolean } = {}): void {
    leaveChat();
    navChat.switchToChat();
    bricksPageOpenStore.set(true);
    fromChat = options.backToChat === true;
    requested.set(brickId);
}
