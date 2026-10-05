import type { SheetSizes } from "../Components/Sheet/BottomSheet";

/** The chat's bottom sheet on phones (ChatSheetStore.ts): its heights. Pure, so it can be unit tested. */

/** Space kept above the sheet at "full": a row of faces stays in view above it. */
export const CHAT_SHEET_TOP_GAP = 104;
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
