/**
 * How the videos are laid out on a phone held upright, in the space they get: the space above the chat sheet while
 * the chat is open, or the height set with the white bar under them while it is closed. The same space gives the
 * same layout whichever sets it. Pure, so it can be unit tested.
 *
 * - Whole rows of 16:9 videos, as big as the space allows (never narrower than 160px).
 * - When not everyone fits, the last spot becomes a "+N" tile, and the people shown are the ones the call ranks
 *   first (whoever is talking, then whoever spoke last).
 * - When big videos would show fewer than a row of faces could, the videos become round faces, in rows.
 * - Below one row of videos, one row of small videos if everyone fits in it, or of faces if not.
 * - Never more than `max` people at once (MAX_DISPLAYED_VIDEOS), the rest behind the "+N" tile.
 * - Asked for everyone ("+N" tapped), all the videos, in a list that scrolls.
 */

export const PHONE_VIDEO_GAP = 8;
export const PHONE_VIDEO_MIN_WIDTH = 160;
/** Faces are this big in rows, and up to this big alone in a short row. */
export const PHONE_FACE_SIZE = 56;
const PHONE_FACE_MIN_SIZE = 36;
/** A 16:9 video at the minimum width: one row of it needs this much height. */
const ONE_ROW_HEIGHT = Math.round((PHONE_VIDEO_MIN_WIDTH * 9) / 16) + PHONE_VIDEO_GAP;
/** A row of small videos under this height reads badly: faces instead. */
const SMALL_ROW_MIN_HEIGHT = 52;

export interface PhoneVideoLayout {
    kind: "videos" | "faces";
    /** Size of each tile in px (faces are square). */
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
    max = Infinity
): PhoneVideoLayout {
    // No people, or a space not measured yet (NaN while the page lays out).
    if (count <= 0 || !(width > 0) || !Number.isFinite(height)) {
        return { kind: "videos", width: PHONE_VIDEO_MIN_WIDTH, height: 90, shown: 0, more: 0, scrolls: false };
    }
    const facesPerRow = perRow(width, PHONE_FACE_SIZE);

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
        // Over the limit, the spots are the people shown and the "+N" tile.
        const videos = biggestVideos(Math.min(count, max + 1), width, height);
        const fits = perRow(width, videos.width) * rowsIn(height, videos.height);
        if (fits >= Math.min(count, facesPerRow)) {
            return fill("videos", videos.width, videos.height, fits, count, max);
        }
        const faces = facesPerRow * rowsIn(height, PHONE_FACE_SIZE);
        return fill("faces", PHONE_FACE_SIZE, PHONE_FACE_SIZE, faces, count, max);
    }

    // Under one row of videos: small videos if everyone fits in one row, faces if not.
    const rowHeight = Math.max(0, Math.floor(height));
    const smallWidth = Math.floor((rowHeight * 16) / 9);
    if (rowHeight >= SMALL_ROW_MIN_HEIGHT && perRow(width, smallWidth) >= count) {
        return fill("videos", smallWidth, rowHeight, count, count, max);
    }
    const face = Math.max(PHONE_FACE_MIN_SIZE, Math.min(PHONE_FACE_SIZE, rowHeight));
    return fill("faces", face, face, perRow(width, face), count, max);
}
