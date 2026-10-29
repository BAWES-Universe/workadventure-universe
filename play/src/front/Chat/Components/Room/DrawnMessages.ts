/**
 * A long chat opens on its newest messages (#1591). Drawing every message a chat holds before the first frame took most
 * of a second in a long chat with pictures: the chat now draws what fills the screen, and the older messages it holds
 * as the reader scrolls up to them.
 */

/** About the height of a one-line message: the screen's height over this is how many messages are drawn at a time. */
export const SHORT_MESSAGE_PX = 40;

/** How many messages to draw at a time, for a screen this tall: enough to fill it with short ones. */
export function screenfulCount(screenHeight: number): number {
    return Math.max(1, Math.ceil(screenHeight / SHORT_MESSAGE_PX));
}

/**
 * The oldest message drawn once `count` more are drawn above the oldest drawn now (`fromId`, or the end of the chat
 * when nothing is drawn yet). Undefined once that reaches the oldest message the chat holds: all of them are drawn.
 */
export function drawnFrom(ids: readonly string[], fromId: string | undefined, count: number): string | undefined {
    const index = fromId === undefined ? ids.length : ids.indexOf(fromId);
    if (index < 0) return undefined;
    const next = index - count;
    return next <= 0 ? undefined : ids[next];
}

/** Where drawing starts: at `fromId`, or at the oldest message when everything is drawn (or it is gone). */
export function drawnStart(ids: readonly string[], fromId: string | undefined): number {
    if (fromId === undefined) return 0;
    return Math.max(0, ids.indexOf(fromId));
}

const drawEverything = new Set<() => Promise<void>>();

/** A chat on screen says how to draw all the messages it holds at once; the returned function takes that back. */
export function onDrawEveryMessage(draw: () => Promise<void>): () => void {
    drawEverything.add(draw);
    return () => drawEverything.delete(draw);
}

/** Before looking for a message on screen (a quote or a pin to jump to): every message held is drawn first. */
export async function drawEveryHeldMessage(): Promise<void> {
    await Promise.all(Array.from(drawEverything, (draw) => draw()));
}
