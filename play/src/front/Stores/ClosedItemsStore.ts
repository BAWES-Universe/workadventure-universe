import { get, writable } from "svelte/store";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { coWebsites, fullScreenCowebsite } from "./CoWebsiteStore";

/** How long "Closed N items · Undo" stays up. */
export const CLOSED_ITEMS_UNDO_MS = 6000;

interface ClosedItems {
    /** Everything that was open, in order. */
    before: Array<CoWebsite>;
    /** What the close took away. */
    closed: Array<CoWebsite>;
}

const { subscribe, set } = writable<ClosedItems | undefined>(undefined);

/** The last close of two or more items at once, while it can still be undone. */
export const closedItemsStore = { subscribe };

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function dismissClosedItems(): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    set(undefined);
}

/**
 * Closes the window and everything in it, except a page its map says may not be closed. Closing two or more at once can
 * be undone for a few seconds, so there is no question to answer first.
 */
export function closeAllOpenItems(): void {
    const before = get(coWebsites);
    const closed = before.filter((coWebsite) => coWebsite.isClosable());
    fullScreenCowebsite.set(false);
    coWebsites.keepOnly((coWebsite) => !coWebsite.isClosable());
    analyticsClient.closeCowebsite();
    dismissClosedItems();
    if (closed.length < 2) return;
    set({ before, closed });
    hideTimer = setTimeout(dismissClosedItems, CLOSED_ITEMS_UNDO_MS);
}

export function undoClosedItems(): void {
    const items = get(closedItemsStore);
    dismissClosedItems();
    if (!items) return;
    coWebsites.restore(items.before, items.closed);
}
