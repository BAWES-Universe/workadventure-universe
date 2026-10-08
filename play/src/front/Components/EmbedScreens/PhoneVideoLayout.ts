/**
 * How the videos are laid out in the space they get: on a phone held upright, the space above the chat sheet while
 * the chat is open, or the height set with the white bar under them while it is closed; on desktops and tablets, the
 * height set with the white bar. The same space gives the same layout whichever sets it. Pure, so it can be unit
 * tested.
 *
 * - Whole rows of 16:9 videos, as big as the space allows (never narrower than 160px), never cut.
 * - When not everyone fits, the last spot becomes a "+N" tile, and the people shown are the ones the call ranks
 *   first (whoever is talking, then whoever spoke last).
 * - When big videos would show fewer than a row of small videos could, the videos become small ones, in rows.
 * - Below one row of videos, a row of small videos.
 * - Small videos are 16:9 rounded rectangles like the big ones, without the name over them. They grow with the
 *   space, from 56px high (36px in a very short row, never taller than the row) up to 96px.
 * - With a screen share among them, no small videos: a screen share that small can't be read.
 * - Never more than `max` people at once (MAX_DISPLAYED_VIDEOS), the rest behind the "+N" tile.
 * - Asked for everyone ("+N" tapped), all the videos, in a list that scrolls.
 */

export const PHONE_VIDEO_GAP = 8;
export const PHONE_VIDEO_MIN_WIDTH = 160;
/** Small videos are at least this high in rows, and grow with the space. */
export const PHONE_SMALL_HEIGHT = 56;
/** The highest a small video gets. */
export const PHONE_SMALL_MAX_HEIGHT = 96;
/** The lowest a small video gets, in a very short row. */
const PHONE_SMALL_MIN_HEIGHT = 36;
/** A 16:9 video at the minimum width: one row of it needs this much height. */
const ONE_ROW_HEIGHT = Math.round((PHONE_VIDEO_MIN_WIDTH * 9) / 16) + PHONE_VIDEO_GAP;

export interface PhoneVideoLayout {
    kind: "videos" | "small";
    /** Size of each tile in px. */
    width: number;
    height: number;
    /** Tiles shown before the "+N" tile. Everyone when nothing overflows. */
    shown: number;
    /** People behind the "+N" tile, 0 when everyone is shown. */
    more: number;
    /** Everyone is shown, in a list that scrolls. */
    scrolls: boolean;
}

function perRow(width: number, tile: number): number {
    return Math.max(1, Math.floor((width + PHONE_VIDEO_GAP) / (tile + PHONE_VIDEO_GAP)));
}

function rowsIn(height: number, tile: number): number {
    return Math.max(1, Math.floor((height + PHONE_VIDEO_GAP) / (tile + PHONE_VIDEO_GAP)));
}

/** The width of a 16:9 video this high. */
function widthOf(height: number): number {
    return Math.round((height * 16) / 9);
}

/**
 * The highest small videos, at most `highest`, that fit `count` people in whole rows; PHONE_SMALL_HEIGHT if none do.
 */
function biggestSmall(count: number, width: number, height: number, highest: number): number {
    for (let size = Math.min(PHONE_SMALL_MAX_HEIGHT, highest); size > PHONE_SMALL_HEIGHT; size -= 2) {
        if (perRow(width, widthOf(size)) * rowsIn(height, size) >= count) return size;
    }
    return Math.min(PHONE_SMALL_HEIGHT, highest);
}

function fillSmall(size: number, width: number, height: number, count: number, max: number) {
    return fill("small", widthOf(size), size, perRow(width, widthOf(size)) * rowsIn(height, size), count, max);
}

/** The largest 16:9 videos that fit `count` people in the space, in whole rows; at least the minimum width. */
function biggestVideos(count: number, width: number, height: number): { width: number; height: number } {
    let best = PHONE_VIDEO_MIN_WIDTH;
    for (let columns = 1; columns <= count; columns++) {
        const byWidth = (width - PHONE_VIDEO_GAP * (columns - 1)) / columns;
        if (byWidth < PHONE_VIDEO_MIN_WIDTH) break;
        const rows = Math.ceil(count / columns);
        const byHeight = (((height - PHONE_VIDEO_GAP * (rows - 1)) / rows) * 16) / 9;
        best = Math.max(best, Math.min(byWidth, byHeight));
    }
    const tileWidth = Math.floor(Math.min(best, width));
    return { width: tileWidth, height: Math.floor((tileWidth * 9) / 16) };
}

function fill(kind: PhoneVideoLayout["kind"], width: number, height: number, fits: number, count: number, max: number) {
    if (fits >= count && count <= max) return { kind, width, height, shown: count, more: 0, scrolls: false };
    // The last spot holds the "+N" tile.
    const shown = Math.max(0, Math.min(fits - 1, max));
    return { kind, width, height, shown, more: count - shown, scrolls: false };
}

export function phoneVideoLayout(
    count: number,
    width: number,
    height: number,
    everyone = false,
    max = Infinity,
    small = true
): PhoneVideoLayout {
    // No people, or a space not measured yet (NaN while the page lays out).
    if (count <= 0 || !(width > 0) || !Number.isFinite(height)) {
        return { kind: "videos", width: PHONE_VIDEO_MIN_WIDTH, height: 90, shown: 0, more: 0, scrolls: false };
    }
    // Over the limit, the spots are the people shown and the "+N" tile.
    const spots = Math.min(count, max + 1);

    if (everyone) {
        const columns = Math.min(count, Math.max(1, perRow(width, PHONE_VIDEO_MIN_WIDTH)));
        const tileWidth = Math.floor((width - PHONE_VIDEO_GAP * (columns - 1)) / columns);
        return {
            kind: "videos",
            width: tileWidth,
            height: Math.floor((tileWidth * 9) / 16),
            shown: count,
            more: 0,
            scrolls: true,
        };
    }

    if (height >= ONE_ROW_HEIGHT) {
        const videos = biggestVideos(spots, width, height);
        const fits = perRow(width, videos.width) * rowsIn(height, videos.height);
        if (!small || fits >= Math.min(count, perRow(width, widthOf(PHONE_SMALL_HEIGHT)))) {
            return fill("videos", videos.width, videos.height, fits, count, max);
        }
        return fillSmall(biggestSmall(spots, width, height, PHONE_SMALL_MAX_HEIGHT), width, height, count, max);
    }

    // Under one row of videos: one row of small videos, as big as the row allows.
    const rowHeight = Math.max(0, Math.floor(height));
    if (!small) {
        // A screen share among them: one row of small whole videos instead.
        const videoHeight = Math.max(1, rowHeight);
        const videoWidth = Math.floor((videoHeight * 16) / 9);
        return fill("videos", videoWidth, videoHeight, perRow(width, videoWidth), count, max);
    }
    // At least 36px when the row has room for it, and never taller than the row, which would cut it.
    const size = Math.max(
        1,
        Math.min(
            rowHeight,
            Math.max(PHONE_SMALL_MIN_HEIGHT, biggestSmall(spots, width, rowHeight, rowHeight - PHONE_VIDEO_GAP))
        )
    );
    return fillSmall(size, width, rowHeight, count, max);
}
