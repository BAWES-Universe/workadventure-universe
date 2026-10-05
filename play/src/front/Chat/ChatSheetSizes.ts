import type { SheetSizes, SheetSnap } from "../Components/Sheet/BottomSheet";
import { getSnapHeights } from "../Components/Sheet/BottomSheet";

/** The chat's bottom sheet on phones (ChatSheetStore.ts): its heights. Pure, so it can be unit tested. */

/** Space kept above the sheet at "full": none, so it can be dragged up to cover the whole screen. */
export const CHAT_SHEET_TOP_GAP = 0;
/** Share of the screen the sheet takes when the chat is opened on purpose ("half"). */
export const CHAT_SHEET_OPEN_SHARE = 0.6;
/** Below its lowest height, a sheet let go this much further down closes the chat. */
export const CHAT_SHEET_CLOSE_DISTANCE = 80;

export const CHAT_SHEET_SIZES: SheetSizes = {
    // Lowest: the field to type in and the last two or three messages.
    peek: (viewportHeight) =>
        Math.min(Math.round(viewportHeight / 2), Math.max(240, Math.round(viewportHeight * 0.34))),
    // Where it opens: tall enough to read the list or the conversation without dragging it up first.
    half: (viewportHeight) => Math.round(viewportHeight * CHAT_SHEET_OPEN_SHARE),
    topGap: CHAT_SHEET_TOP_GAP,
};

/**
 * Where the chat sheet rests: one of the snaps, or the share of the screen a person dragged it to (0 to 1). A drag
 * stays where it is let go; tapping the handle and a few automatic moves use the snaps.
 */
export type ChatSheetRest = SheetSnap | number;

/** The sheet's height for where it rests, kept between its lowest height and "full". */
export function chatSheetRestingHeight(rest: ChatSheetRest, viewportHeight: number): number {
    const heights = getSnapHeights(viewportHeight, CHAT_SHEET_SIZES);
    if (typeof rest !== "number") return heights[rest];
    return Math.min(Math.max(Math.round(rest * viewportHeight), heights.peek), heights.full);
}

/** Space left under the latest message when the sheet grows to show it. */
export const CHAT_SHEET_FIT_MARGIN = 8;

/**
 * A chat opened by a message in a bubble: the height that shows that latest message whole above the field to type
 * in. It only grows the sheet (from `current`), never past "full".
 */
export function chatSheetFitHeight(
    current: number,
    listHeight: number,
    lastMessageHeight: number,
    viewportHeight: number
): number {
    const missing = lastMessageHeight + CHAT_SHEET_FIT_MARGIN - listHeight;
    const { full } = getSnapHeights(viewportHeight, CHAT_SHEET_SIZES);
    return Math.min(Math.max(current, current + missing), Math.max(current, full));
}

/**
 * Reads where the sheet was left on this device (kept in the browser), or undefined when nothing usable is kept.
 * "peek" is never kept: only the video layout lowers the sheet that far, and the chat should open readable.
 */
export function parseChatSheetRest(stored: string | null): ChatSheetRest | undefined {
    if (stored === "half" || stored === "full") return stored;
    const share = Number(stored);
    return stored !== null && stored !== "" && Number.isFinite(share) && share > 0 && share <= 1 ? share : undefined;
}
