/**
 * How the chat panel lays out the list and the open thread.
 * At 670px and wider (twice the initial panel width), list and thread sit side by side.
 * Below that, an open thread takes the whole panel: the list, and the Chat / People tabs in its header, hide.
 */
import { INITIAL_SIDEBAR_WIDTH } from "../../Stores/ChatStore";

/** Twice the initial panel width: from there the list and the open thread sit side by side. */
export const CHAT_LAYOUT_LIMIT = INITIAL_SIDEBAR_WIDTH * 2;

export interface ChatLayout {
    twoColumns: boolean;
    showList: boolean;
}

export function resolveChatLayout(sideBarWidth: number, twoColumnLimit: number, hasOpenThread: boolean): ChatLayout {
    const twoColumns = sideBarWidth >= twoColumnLimit;
    return { twoColumns, showList: twoColumns || !hasOpenThread };
}
