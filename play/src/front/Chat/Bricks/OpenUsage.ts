import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { leaveChat } from "../ChatBack";
import { bricksPageOpenStore, navChat } from "../Stores/ChatStore";
import type { UsageRequest } from "./UsageLink";

/**
 * Opening the Usage page from a chat (the links are in UsageLink.ts). As with the Apps page, the page lives under the
 * Bricks page, so the chat is left for the list, the Bricks page opens, and it opens Usage when it sees the request.
 */

const requested = writable<UsageRequest | undefined>(undefined);
/** Set while a request to open the Usage page waits for the Bricks page to take it. */
export const usagePageRequest: Readable<UsageRequest | undefined> = { subscribe: requested.subscribe };

/** The Bricks page calls this when it has opened the Usage page for a request. */
export function takeUsagePageRequest(): void {
    requested.set(undefined);
}

export function openUsagePage(request: UsageRequest = { receiptId: undefined }): void {
    leaveChat();
    navChat.switchToChat();
    bricksPageOpenStore.set(true);
    requested.set(request);
}
