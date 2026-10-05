import { derived, writable } from "svelte/store";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { localUserStore } from "../Connection/LocalUserStore";
import { mapEditorToolbarInUseStore } from "../Stores/MapEditorStore";
import { DESKTOP_LAYOUT_MIN_WIDTH } from "../Stores/BarInViewStore";

export const chatSidebarWidthStore = writable(localUserStore.getChatSideBarWidth());

// Not unsubscribing is ok, this is a singleton.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
chatSidebarWidthStore.subscribe((value) => {
    localUserStore.setChatSideBarWidth(value);
});

/** On a desktop (1024px and wider) the chat floats this far off the screen's edges (chat.scss). */
export const CHAT_FLOAT_INSET = 16;

/** How far the chat sits from the start edge: what sits beside it adds this to its width. */
export const chatFloatInsetStore = derived(windowSize, ($windowSize) =>
    $windowSize.width >= DESKTOP_LAYOUT_MIN_WIDTH ? CHAT_FLOAT_INSET : 0
);

/** Below this much room beside the chat, the bar and the zoom column are hidden. */
export const MIN_ROOM_FOR_ACTION_BAR = 285;

/**
 * Whether the chat or the room editor leaves too little room for the bar. On a desktop the chat floats over the game
 * under the bar and never pushes it, so however wide it is, the bar, Express and the zoom column stay where they are
 * (it may cover the column; closing or narrowing the chat shows it again). Only phones and small windows, where what is
 * beside the chat starts where it ends, count the chat's width. Editing a room on a phone or a small window hides the
 * bar until Done: the editor's panel floats over the map and would cover it. On a desktop the editor floats on the
 * right and the bar keeps its place.
 */
export function chatLeavesNoRoomForBar(
    windowWidth: number,
    chatVisible: boolean,
    chatWidth: number,
    chatFloatInset: number,
    mapEditorInUse: boolean
): boolean {
    if (!chatVisible && !mapEditorInUse) {
        return false;
    }
    if (mapEditorInUse && windowWidth < DESKTOP_LAYOUT_MIN_WIDTH) {
        return true;
    }
    const chatPushesGame = chatVisible && windowWidth < DESKTOP_LAYOUT_MIN_WIDTH;
    return windowWidth - (chatPushesGame ? chatWidth + chatFloatInset : 0) < MIN_ROOM_FOR_ACTION_BAR;
}

export const hideActionBarStoreBecauseOfChatBar = derived(
    [chatVisibilityStore, chatSidebarWidthStore, windowSize, mapEditorToolbarInUseStore, chatFloatInsetStore],
    ([$chatVisibilityStore, $chatSidebarWidthStore, $windowSize, $mapEditorToolbarInUseStore, $chatFloatInsetStore]) =>
        chatLeavesNoRoomForBar(
            $windowSize.width,
            $chatVisibilityStore,
            $chatSidebarWidthStore,
            $chatFloatInsetStore,
            $mapEditorToolbarInUseStore
        )
);

/**
 * The chat shows its own close button when the bar is hidden because the chat leaves no room for it. On desktops the
 * chat opens under the bar, so the bar's own close stays in reach.
 */
export const chatCarriesItsCloseStore = derived(hideActionBarStoreBecauseOfChatBar, ($hideActionBar) => $hideActionBar);
