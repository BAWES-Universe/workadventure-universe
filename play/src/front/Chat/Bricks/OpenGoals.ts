import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { leaveChat } from "../ChatBack";
import { bricksPageOpenStore, navChat } from "../Stores/ChatStore";

/**
 * Opening the Goals and tasks page from a chat (game #2002, mock t-1-goal): a Brick that set a goal ends with "Change,
 * pause or end it any time in [Goals and tasks](#goals)". As with the Apps page, the page lives under the Bricks page, so
 * the chat is left for the list, the Bricks page opens, and it opens Goals and tasks when it sees the request.
 */

/** The link a Brick's words carry to the Goals and tasks page. Followed here instead of leaving the game. */
export const GOALS_LINK = "#goals";

const requested = writable(false);
/** True while a request to open the Goals and tasks page waits for the Bricks page to take it. */
export const goalsPageRequest: Readable<boolean> = { subscribe: requested.subscribe };

/** The Bricks page calls this when it has opened the Goals and tasks page for a request. */
export function takeGoalsPageRequest(): void {
    requested.set(false);
}

export function openGoalsPage(): void {
    leaveChat();
    navChat.switchToChat();
    bricksPageOpenStore.set(true);
    requested.set(true);
}
