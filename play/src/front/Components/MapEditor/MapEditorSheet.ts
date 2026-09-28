/**
 * Bottom sheet used by the map editor on mobile (below Tailwind's `md`).
 * Pure helpers, kept out of Svelte so they can be unit tested.
 */
export type MapEditorSheetSnap = "peek" | "half" | "full";

/** Height of the sheet at "peek": the drag handle and the tool name. */
export const MAP_EDITOR_SHEET_PEEK_HEIGHT = 64;
/** Space kept above the sheet at "full" so the toolbar and a strip of map stay visible. */
export const MAP_EDITOR_SHEET_TOP_GAP = 96;
/** A pointer that moves less than this between press and release is a tap, not a drag. */
export const MAP_EDITOR_SHEET_TAP_TOLERANCE = 6;

const SNAP_ORDER: MapEditorSheetSnap[] = ["peek", "half", "full"];

export function getSheetSnapHeights(viewportHeight: number): Record<MapEditorSheetSnap, number> {
    const peek = MAP_EDITOR_SHEET_PEEK_HEIGHT;
    const half = Math.max(peek, Math.round(viewportHeight / 2));
    const full = Math.max(half, viewportHeight - MAP_EDITOR_SHEET_TOP_GAP);
    return { peek, half, full };
}

export function clampSheetHeight(height: number, viewportHeight: number): number {
    const { peek, full } = getSheetSnapHeights(viewportHeight);
    return Math.min(Math.max(height, peek), full);
}

export function nearestSheetSnap(height: number, viewportHeight: number): MapEditorSheetSnap {
    const heights = getSheetSnapHeights(viewportHeight);
    let nearest: MapEditorSheetSnap = "peek";
    for (const snap of SNAP_ORDER) {
        if (Math.abs(heights[snap] - height) < Math.abs(heights[nearest] - height)) {
            nearest = snap;
        }
    }
    return nearest;
}

/** Tapping the handle or the active tool steps up through the snaps, then back down to peek. */
export function nextSheetSnap(snap: MapEditorSheetSnap): MapEditorSheetSnap {
    return SNAP_ORDER[(SNAP_ORDER.indexOf(snap) + 1) % SNAP_ORDER.length];
}
