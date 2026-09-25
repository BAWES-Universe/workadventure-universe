import type { ChatOpenSource } from "../Administration/AnalyticsClient";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { chatVisibilityStore } from "../Stores/ChatStore";

let pendingChatOpenSource: ChatOpenSource | undefined;

/**
 * Opens the chat panel and records what opened it. Use this instead of `chatVisibilityStore.set(true)`
 * at known entry points; direct calls to the store keep working and are counted as "unknown".
 */
export function openChat(source: ChatOpenSource): void {
    pendingChatOpenSource = source;
    try {
        chatVisibilityStore.set(true);
    } finally {
        pendingChatOpenSource = undefined;
    }
}

let previousChatVisibility = false;
// This is a singleton, so we don't need to unsubscribe.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
chatVisibilityStore.subscribe((visible) => {
    if (visible && !previousChatVisibility) {
        analyticsClient.chatPanelOpened(pendingChatOpenSource ?? "unknown");
    }
    previousChatVisibility = visible;
});
