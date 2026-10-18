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
    if (scroll.scrollTop < lastScrollTop) return false;
    return pinned;
}

/** Taller than this (CSS px) since the last size is the list growing, not rounding. */
const GROWTH_TOLERANCE = 1;

/** Whether the list itself got taller (the keyboard closed and gave the sheet its height back). */
export function listGrewTaller(previousHeight: number, height: number): boolean {
    return previousHeight > 0 && height > previousHeight + GROWTH_TOLERANCE;
}

/** Taller than this (CSS px) at once is the on-screen keyboard closing, not a rounding or a bar showing. */
const KEYBOARD_MIN_HEIGHT = 100;

/** Whether the window got its height back from the on-screen keyboard (an iPhone gives it back when it closes). */
export function keyboardClosed(previousHeight: number, height: number): boolean {
    return height - previousHeight >= KEYBOARD_MIN_HEIGHT;
}
