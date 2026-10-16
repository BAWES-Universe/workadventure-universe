import { get } from "svelte/store";
import { openedMenuStore } from "../../Stores/MenuStore";
import { modalIframeStore, modalVisibilityStore, roomListVisibilityStore } from "../../Stores/ModalStore";
import { broadcastPanelOpenStore } from "../../Stores/BroadcastStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { analyticsClient } from "../../Administration/AnalyticsClient";

/** Opens or closes "Explore {Universe}", the list of every room in this universe (the bar's pill, the phone's tile). */
export function toggleExploreList(): void {
    if (get(roomListVisibilityStore)) {
        roomListVisibilityStore.set(false);
        return;
    }
    analyticsClient.openedRoomList();
    // The list sits over the game: close the chat and any modal it would be hidden under.
    chatVisibilityStore.set(false);
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    broadcastPanelOpenStore.set(false);
    roomListVisibilityStore.set(true);
    openedMenuStore.closeAll();
}
