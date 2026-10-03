import { derived, writable } from "svelte/store";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { localUserStore } from "../Connection/LocalUserStore";
import { mapEditorSideBarWidthStore } from "../Components/MapEditor/MapEditorSideBarWidthStore";
import { mapEditorToolbarInUseStore } from "../Stores/MapEditorStore";
import { barInViewStore, DESKTOP_LAYOUT_MIN_WIDTH } from "../Stores/BarInViewStore";

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
        mapEditorToolbarInUseStore,
        chatFloatInsetStore,
    ],
    ([
        $chatVisibilityStore,
        $chatSidebarWidthStore,
        $windowSize,
        $mapEditorWidthStore,
        $mapEditorToolbarInUseStore,
        $chatFloatInsetStore,
    ]) => {
        if (!$chatVisibilityStore && !$mapEditorToolbarInUseStore) {
            return false;
        }
        return (
            $windowSize.width -
                ($chatVisibilityStore ? $chatSidebarWidthStore + $chatFloatInsetStore : 0) -
                ($mapEditorToolbarInUseStore ? $mapEditorWidthStore : 0) <
            285
        );
    }
);

/**
 * The chat shows its own close button: when the bar is hidden because the chat leaves no room for it, and on a
 * desktop where the chat opens over the bar (the "Keep the bar in view" switch is off), covering the bar's close.
 */
export const chatCarriesItsCloseStore = derived(
    [hideActionBarStoreBecauseOfChatBar, chatVisibilityStore, windowSize, barInViewStore],
    ([$hideActionBar, $chatVisibilityStore, $windowSize, $barInView]) =>
        $hideActionBar || ($chatVisibilityStore && $windowSize.width >= DESKTOP_LAYOUT_MIN_WIDTH && !$barInView)
);
