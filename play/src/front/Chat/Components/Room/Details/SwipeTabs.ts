/** A flick faster than this (px per ms) picks the tab it was flicked toward, wherever the pill was let go. */
const FLICK_SPEED = 0.4;
/** A page swiped further than this (px) moves to the next or previous tab, as the woka picker's categories do. */
const PAGE_SWIPE_DISTANCE = 50;

/**
 * The tab the pill lands on when it is let go after a drag, as in the Chats and People tabs: the one it was flicked
 * toward, else the one it is nearer. `position` is where the pill was dropped (0 is the first tab, `step` apart).
 */
export function tabAfterPillDrag(drag: {
    from: number;
    position: number;
    step: number;
    count: number;
    velocity: number;
}): number {
    const last = drag.count - 1;
    if (Math.abs(drag.velocity) > FLICK_SPEED) {
        return Math.min(last, Math.max(0, drag.from + (drag.velocity > 0 ? 1 : -1)));
    }
    if (drag.step <= 0) return drag.from;
    return Math.min(last, Math.max(0, Math.round(drag.position / drag.step)));
}

/**
 * The tab a sideways swipe on the page moves to: the next one when swiped toward the start (as a page is pushed
 * away), the previous one when swiped toward the end, or the same one for a short swipe or past either end.
 * `dx` is in reading direction (already flipped for right-to-left).
 */
export function tabAfterPageSwipe(current: number, dx: number, count: number): number {
    if (Math.abs(dx) <= PAGE_SWIPE_DISTANCE) return current;
    const next = current + (dx < 0 ? 1 : -1);
    return next < 0 || next >= count ? current : next;
}

/** How far the page follows the finger: all the way, or a quarter past either end, so it feels the edge. */
export function pageDragOffset(current: number, dx: number, count: number): number {
    const pastEnd = (current === 0 && dx > 0) || (current >= count - 1 && dx < 0);
    return pastEnd ? dx / 4 : dx;
}
