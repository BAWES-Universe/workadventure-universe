/**
 * Every file open in the window is read and drawn by a reader (PDF.js, a Word frame, a table of rows): heavy, and on a
 * phone five of them together can be more than the browser keeps. Only the item in front and the one used before it
 * keep their reader; the others are put away (bytes kept, view remembered) and read again when brought forward.
 */
export const MAX_LIVE_READERS = 2;

/** The items that keep their reader, most recently used first: the one in front, then those used before it. */
export function usedReaders<T>(recent: readonly T[], inFront: T | undefined, open: readonly T[]): T[] {
    const used = inFront === undefined ? [...recent] : [inFront, ...recent.filter((item) => item !== inFront)];
    return used.filter((item) => open.includes(item)).slice(0, MAX_LIVE_READERS);
}
