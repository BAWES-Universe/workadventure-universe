/**
 * How the chat panel lays out the list and the open thread.
 * At 670px and wider (twice the initial panel width), list and thread sit side by side.
 * Below that, an open thread takes the whole panel: the list, and the Chat / People tabs in its header, hide.
 */
export interface ChatLayout {
    twoColumns: boolean;
    showList: boolean;
}

export function resolveChatLayout(sideBarWidth: number, twoColumnLimit: number, hasOpenThread: boolean): ChatLayout {
    const twoColumns = sideBarWidth >= twoColumnLimit;
    return { twoColumns, showList: twoColumns || !hasOpenThread };
}
