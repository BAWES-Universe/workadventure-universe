import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { leaveChat } from "../../ChatBack";
import { bricksPageOpenStore, navChat } from "../../Stores/ChatStore";
import { appsSearchStart } from "./AppsSearch";

/**
 * Opening the Apps page from somewhere else (game #2001): "Connect my apps" under a Brick's hello, the "Apps" link in the
 * line a Brick says after connecting an app, and "Another calendar" on its card. The page lives under the Bricks page, so
 * the chat is left for the list, the Bricks page opens, and it opens its Apps page when it sees the request.
 */

/** The link a Brick's words carry to the Apps page: "[Apps](#apps)". Followed here instead of leaving the game. */
export const APPS_LINK = "#apps";

const requested = writable(false);
/** True while a request to open the Apps page waits for the Bricks page to take it. */
export const appsPageRequest: Readable<boolean> = { subscribe: requested.subscribe };

/** The Bricks page calls this when it has opened the Apps page for a request. */
export function takeAppsPageRequest(): void {
    requested.set(false);
}

export function openAppsPage(options: { search?: string } = {}): void {
    appsSearchStart.set(options.search?.trim() || undefined);
    leaveChat();
    navChat.switchToChat();
    bricksPageOpenStore.set(true);
    requested.set(true);
}
