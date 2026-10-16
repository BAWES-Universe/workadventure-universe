import type { GifCategory } from "./KlipyClient";

/** The index of the column to put the next picture in: the shortest one, the left one when they are level. */
export function shortestColumn(heights: number[]): number {
    let shortest = 0;
    for (let index = 1; index < heights.length; index++) {
        if (heights[index] < heights[shortest]) shortest = index;
    }
    return shortest;
}

const FALLBACK_TERMS = ["hello", "lol", "thanks", "yes", "no", "wow", "love", "sad", "bye", "hug"];

/** The first screen's tiles until Klipy sends its own (or when it can't). */
export function fallbackCategories(): GifCategory[] {
    return FALLBACK_TERMS.map((term) => ({ name: term, query: term }));
}

/** The picker is never narrower than this, whatever the chat panel. */
export const MIN_PICKER_WIDTH = 280;
/** ... nor wider than this. */
export const MAX_PICKER_WIDTH = 640;
/** The gap between the picker and each side of the chat panel. */
export const PICKER_SIDE_GAP = 8;

/** The picker takes the width of the chat panel it sits on, minus a gap on each side. */
export function pickerWidthFor(panelWidth: number): number {
    return Math.min(MAX_PICKER_WIDTH, Math.max(MIN_PICKER_WIDTH, Math.round(panelWidth) - 2 * PICKER_SIDE_GAP));
}

/** Columns of category tiles: 2 up to 439px, 3 from there. */
export function tileColumnsFor(pickerWidth: number): number {
    return pickerWidth < 440 ? 2 : 3;
}

/** Columns of GIFs: 2 up to 439px, 3 up to 559px, 4 from there. */
export function gifColumnsFor(pickerWidth: number): number {
    if (pickerWidth < 440) return 2;
    return pickerWidth < 560 ? 3 : 4;
}

// Heights that look like GIFs (width / height), so the grey boxes of a loading list are not all the same.
const SKELETON_RATIOS = [1.35, 1.1, 0.9, 1.5, 0.8, 1.6, 1.05, 0.95, 1.7, 1.3, 0.85, 1.2];
const SKELETON_PER_COLUMN = 4;

/** The grey boxes of a list that is loading: each box is its width / height, placed like the GIFs will be. */
export function skeletonColumns(columnCount: number): number[][] {
    const columns: number[][] = Array.from({ length: columnCount }, () => []);
    const heights: number[] = new Array<number>(columnCount).fill(0);
    for (let index = 0; index < columnCount * SKELETON_PER_COLUMN; index++) {
        const ratio = SKELETON_RATIOS[index % SKELETON_RATIOS.length];
        const column = shortestColumn(heights);
        columns[column].push(ratio);
        heights[column] += 1 / ratio;
    }
    return columns;
}

/** The boxes under a list that loads its next page: one per column. */
export function skeletonMoreRow(columnCount: number): number[] {
    return Array.from({ length: columnCount }, (_, index) => SKELETON_RATIOS[(index * 5 + 1) % SKELETON_RATIOS.length]);
}

export type GridMove = "left" | "right" | "up" | "down";

/** Where an arrow key goes from a tile: another tile's index, "search" above the first row, or nowhere. */
export function tileNeighbour(
    index: number,
    count: number,
    columns: number,
    move: GridMove
): number | "search" | undefined {
    const column = index % columns;
    switch (move) {
        case "left":
            return column > 0 ? index - 1 : undefined;
        case "right":
            return column < columns - 1 && index + 1 < count ? index + 1 : undefined;
        case "up":
            return index - columns >= 0 ? index - columns : "search";
        case "down": {
            const nextRowStart = (Math.floor(index / columns) + 1) * columns;
            // A last row with fewer tiles: go to its last one.
            return nextRowStart < count ? Math.min(index + columns, count - 1) : undefined;
        }
    }
}

export interface GifPosition {
    column: number;
    row: number;
}

/**
 * Where an arrow key goes from a GIF. `heights[column][row]` is each GIF's height as a share of the column's width.
 * Up and down stay in the column; left and right go to the GIF next door that is level with this one.
 */
export function gifNeighbour(
    heights: number[][],
    from: GifPosition,
    move: GridMove
): GifPosition | "search" | undefined {
    const { column, row } = from;
    switch (move) {
        case "up":
            return row > 0 ? { column, row: row - 1 } : "search";
        case "down":
            return row + 1 < heights[column].length ? { column, row: row + 1 } : undefined;
        case "left":
        case "right": {
            const target = move === "left" ? column - 1 : column + 1;
            if (target < 0 || target >= heights.length || heights[target].length === 0) return undefined;
            const middleOf = (list: number[], index: number) =>
                list.slice(0, index).reduce((sum, height) => sum + height, 0) + list[index] / 2;
            const middle = middleOf(heights[column], row);
            let best = 0;
            let bestDistance = Infinity;
            for (let index = 0; index < heights[target].length; index++) {
                const distance = Math.abs(middleOf(heights[target], index) - middle);
                if (distance < bestDistance) {
                    best = index;
                    bestDistance = distance;
                }
            }
            return { column: target, row: best };
        }
    }
}
