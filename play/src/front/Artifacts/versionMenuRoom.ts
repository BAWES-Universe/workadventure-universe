/** Space kept between the bottom of the list of versions and what it would run into. */
export const VERSION_MENU_MARGIN = 12;
/** Less room than this shows no whole version (the title, one row and the padding): the window is asked for more. */
export const VERSION_MENU_MIN_ROOM = 120;

export interface VersionMenuRoomInput {
    /** Where the list starts on screen. */
    menuTop: number;
    /** Where the window ends on screen. */
    windowBottom: number;
    viewportHeight: number;
    /** The chat's own sheet on a phone, 0 without one. The window is behind it, so it hides the bottom of the window. */
    chatHeight: number;
}

/** How tall the list of versions may be: down to the window's end, or to the chat's top where the chat covers it. */
export function versionMenuRoom({ menuTop, windowBottom, viewportHeight, chatHeight }: VersionMenuRoomInput): number {
    const visibleBottom = Math.min(windowBottom, viewportHeight - chatHeight);
    return Math.max(0, Math.floor(visibleBottom - menuTop - VERSION_MENU_MARGIN));
}
