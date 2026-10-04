import { derived, writable } from "svelte/store";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { localUserStore } from "../Connection/LocalUserStore";
import { mapEditorSideBarWidthStore } from "../Components/MapEditor/MapEditorSideBarWidthStore";
import { mapEditorModeStore } from "../Stores/MapEditorStore";
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

export const hideActionBarStoreBecauseOfChatBar = derived(
    [
        chatVisibilityStore,
        chatSidebarWidthStore,
        windowSize,
        mapEditorSideBarWidthStore,
        mapEditorModeStore,
        chatFloatInsetStore,
    ],
    ([
        $chatVisibilityStore,
        $chatSidebarWidthStore,
        $windowSize,
        $mapEditorWidthStore,
        $mapEditorModeStore,
        $chatFloatInsetStore,
    ]) => {
        if (!$chatVisibilityStore && !$mapEditorModeStore) {
            return false;
        }
        return (
            $windowSize.width -
                ($chatVisibilityStore ? $chatSidebarWidthStore + $chatFloatInsetStore : 0) -
                ($mapEditorModeStore ? $mapEditorWidthStore : 0) <
            285
        );
    }
);

/**
 * The chat shows its own close button when the bar is hidden because the chat leaves no room for it. On desktops the
 * chat opens under the bar, so the bar's own close stays in reach.
 */
export const chatCarriesItsCloseStore = derived(hideActionBarStoreBecauseOfChatBar, ($hideActionBar) => $hideActionBar);
