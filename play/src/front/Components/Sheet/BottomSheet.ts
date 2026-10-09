/**
 * Bottom sheets on phones (the map editor's panel, the chat): a panel that rises from the bottom of the screen and
 * rests on one of three heights. Pure helpers, kept out of Svelte so they can be unit tested.
 */
export type SheetSnap = "peek" | "half" | "full";

export interface SheetSizes {
    /** Height of the sheet at "peek", for this viewport height. */
    peek: (viewportHeight: number) => number;
    /** Height of the sheet at "half", for this viewport height. Half the screen when left out. */
    half?: (viewportHeight: number) => number;
    /** Space kept above the sheet at "full". */
    topGap: number;
}

/** A pointer that moves less than this between press and release is a tap, not a drag. */
export const SHEET_TAP_TOLERANCE = 6;

const SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"];

export function getSnapHeights(viewportHeight: number, sizes: SheetSizes): Record<SheetSnap, number> {
    const peek = sizes.peek(viewportHeight);
    const half = Math.max(peek, sizes.half?.(viewportHeight) ?? Math.round(viewportHeight / 2));
    const full = Math.max(half, viewportHeight - sizes.topGap);
    return { peek, half, full };
}

/** Keeps a drag between `min` (peek, unless the sheet can be dragged lower to close it) and full. */
export function clampHeight(height: number, viewportHeight: number, sizes: SheetSizes, min?: number): number {
    const { peek, full } = getSnapHeights(viewportHeight, sizes);
    return Math.min(Math.max(height, min ?? peek), full);
}

export function nearestSnap(height: number, viewportHeight: number, sizes: SheetSizes): SheetSnap {
    const heights = getSnapHeights(viewportHeight, sizes);
    let nearest: SheetSnap = "peek";
    for (const snap of SNAP_ORDER) {
        if (Math.abs(heights[snap] - height) < Math.abs(heights[nearest] - height)) {
            nearest = snap;
        }
    }
    return nearest;
}

/** Tapping the handle steps up through the snaps, then back down to peek. */
export function nextSnap(snap: SheetSnap): SheetSnap {
    return SNAP_ORDER[(SNAP_ORDER.indexOf(snap) + 1) % SNAP_ORDER.length];
}
