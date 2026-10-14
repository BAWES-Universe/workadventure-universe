/** How close to the bottom (CSS px) still counts as at the newest message. */
export const PINNED_DISTANCE = 24;

export interface TimelineScroll {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

/**
 * Whether the chat stays on its newest message after a scroll. Reaching the bottom pins it. Only scrolling up unpins
 * it: everything the chat does on its own scrolls down or keeps the place, so going up is always the reader.
 */
export function stillPinnedToBottom(pinned: boolean, lastScrollTop: number, scroll: TimelineScroll): boolean {
    const distanceFromBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    if (distanceFromBottom <= PINNED_DISTANCE) return true;
    if (scroll.scrollTop < lastScrollTop - 1) return false;
    return pinned;
}
