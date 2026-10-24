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

/**
 * The first of the list's messages still showing at its top (its bottom below the list's top), from the messages'
 * bottoms in list order. Undefined when there are none.
 */
export function firstShowingIndex(
    count: number,
    bottomAt: (index: number) => number,
    listTop: number
): number | undefined {
    let low = 0;
    let high = count;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (bottomAt(middle) > listTop) high = middle;
        else low = middle + 1;
    }
    return low < count ? low : undefined;
}

/**
 * Where the list scrolls to so the message being read stays put after it `moved` (CSS px) in the list's content. When
 * the list got shorter under a reader near its end, the browser has already pulled the place up to the new end: the
 * move then counts from where the reader was, not from there.
 */
export function placeAfterMove(
    scrollTop: number,
    rememberedScrollTop: number,
    maxScrollTop: number,
    moved: number
): number {
    const pulledToEnd = scrollTop >= maxScrollTop - 1 && rememberedScrollTop > scrollTop;
    return (pulledToEnd ? rememberedScrollTop : scrollTop) + moved;
}
