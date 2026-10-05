import type { SheetSizes } from "../Components/Sheet/BottomSheet";

/** The chat's bottom sheet on phones (ChatSheetStore.ts): its heights. Pure, so it can be unit tested. */

/** Space kept above the sheet at "full": a row of faces stays in view above it. */
export const CHAT_SHEET_TOP_GAP = 104;
/** Below its lowest height, a sheet let go this much further down closes the chat. */
export const CHAT_SHEET_CLOSE_DISTANCE = 80;

export const CHAT_SHEET_SIZES: SheetSizes = {
    // Lowest: the field to type in and the last two or three messages.
    peek: (viewportHeight) =>
        Math.min(Math.round(viewportHeight / 2), Math.max(240, Math.round(viewportHeight * 0.34))),
    topGap: CHAT_SHEET_TOP_GAP,
};
