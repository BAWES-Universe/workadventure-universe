export interface WordScroll {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    /** How much the pages are zoomed (1 is their own size). */
    scale: number;
    /** Where each sheet starts, at 100%. */
    sheetTops: number[];
}

/** The page number (from 1) the reader is on: the sheet that covers the upper part of what is in view. */
export function pageInView({ scrollTop, clientHeight, scrollHeight, scale, sheetTops }: WordScroll): number {
    // At the top it is the first page, however small the pages are shown.
    if (scrollTop <= 0) return 1;
    const probe = scrollTop / scale + clientHeight / scale / 3;
    let page = 1;
    for (let index = 0; index < sheetTops.length; index++) if (sheetTops[index] <= probe) page = index + 1;
    // At the very end the last page counts, even when it is short. Pages that all fit in the panel have no end to reach.
    const scrolls = scrollHeight > clientHeight + 2;
    if (scrolls && scrollTop + clientHeight >= scrollHeight - 2) page = sheetTops.length;
    return page;
}
