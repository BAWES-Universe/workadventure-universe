import { get, writable } from "svelte/store";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { activeCoWebsiteStore, coWebsites, fullScreenCowebsite } from "./CoWebsiteStore";

/** How long "Closed N items · Undo" stays up. */
export const CLOSED_ITEMS_UNDO_MS = 6000;

interface ClosedItems {
    /** Everything that was open, in order. */
    before: Array<CoWebsite>;
    /** What the close took away. */
    closed: Array<CoWebsite>;
    /** The one that was picked. */
    active: CoWebsite | undefined;
    /** Whether the window was full screen. */
    fullScreen: boolean;
}

const { subscribe, set } = writable<ClosedItems | undefined>(undefined);

/** The last close of two or more items at once, while it can still be undone. */
export const closedItemsStore = { subscribe };

/** Set by an undo: the window picks this item once its items are back. */
export const pickedAfterUndoStore = writable<CoWebsite | undefined>(undefined);

let hideTimer: ReturnType<typeof setTimeout> | undefined;
let stopWatching: (() => void) | undefined;

export function dismissClosedItems(): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    stopWatching?.();
    stopWatching = undefined;
    set(undefined);
}

/**
 * Closes the window and everything in it, except a page its map says may not be closed. Closing two or more at once can
 * be undone for a few seconds, so there is no question to answer first.
 */
export function closeAllOpenItems(): void {
    const before = get(coWebsites);
    const closed = before.filter((coWebsite) => coWebsite.isClosable());
    // Only pages that may not be closed are open: nothing to close, and nothing else changes.
    if (closed.length === 0) return;
    const active = get(activeCoWebsiteStore);
    const fullScreen = get(fullScreenCowebsite);
    fullScreenCowebsite.set(false);
    coWebsites.keepOnly((coWebsite) => !coWebsite.isClosable());
    analyticsClient.closeCowebsite();
    dismissClosedItems();
    if (closed.length < 2) return;
    set({ before, closed, active, fullScreen });
    hideTimer = setTimeout(dismissClosedItems, CLOSED_ITEMS_UNDO_MS);
    // Something new opened (another meeting zone, a link): what was closed is not brought back over it.
    const stopWatchingOpened = coWebsites.subscribe((open) => {
        if (open.some((coWebsite) => !before.includes(coWebsite))) dismissClosedItems();
    });
    // Something asked for an item to go meanwhile (a zone left, a map script): it is not brought back either.
    let stillBefore = before;
    let stillClosed = closed;
    const stopWatchingRemoved = coWebsites.onRemoval((removes) => {
        const remaining = stillClosed.filter((coWebsite) => !removes(coWebsite));
        if (remaining.length === stillClosed.length) return;
        if (remaining.length < 2) {
            dismissClosedItems();
            return;
        }
        stillClosed = remaining;
        stillBefore = stillBefore.filter((coWebsite) => !removes(coWebsite));
        set({ before: stillBefore, closed: stillClosed, active, fullScreen });
    });
    stopWatching = () => {
        stopWatchingOpened();
        stopWatchingRemoved();
    };
}

/**
 * Closes the item in front (the picked tab). When it was the last one, the window closes with it. A page its map says may
 * not be closed stays. One item closing is not asked about and has no Undo, like the tab's own X.
 */
export function closeFrontItem(): void {
    const front = get(activeCoWebsiteStore);
    if (!front || !front.isClosable() || !get(coWebsites).includes(front)) return;
    coWebsites.remove(front);
    analyticsClient.closeCowebsite();
}

export function undoClosedItems(): void {
    const items = get(closedItemsStore);
    dismissClosedItems();
    if (!items) return;
    coWebsites.restore(items.before, items.closed);
    fullScreenCowebsite.set(items.fullScreen);
    pickedAfterUndoStore.set(items.active);
}
