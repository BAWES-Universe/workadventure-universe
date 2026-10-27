import { derived } from "svelte/store";
import { incomingRingStore } from "../Chat/Stores/RingStore";
import { broadcastPanelOpenStore } from "./BroadcastStore";
import { followStateStore } from "./FollowStore";
import { requestVisitCardsStore } from "./GameStore";
import { menuVisiblilityStore, openedMenuStore } from "./MenuStore";
import { roomListVisibilityStore } from "./ModalStore";
import { cardOverWindow } from "./OpenHereCards";
import { NEW_DEVICE_POPUP_ID } from "./NewDeviceStore";
import { popupStore } from "./PopupStore";
import { showReportScreenStore, userReportEmpty } from "./ShowReportScreenStore";
import { actionsMenuStore } from "./ActionsMenuStore";
import { wokaMenuStore } from "./WokaMenuStore";

/** A menu, panel or card is open over the game: the window of files and links sits under it until it closes. */
export const cardOverWindowStore = derived(
    [
        openedMenuStore,
        menuVisiblilityStore,
        roomListVisibilityStore,
        broadcastPanelOpenStore,
        requestVisitCardsStore,
        wokaMenuStore,
        actionsMenuStore,
        showReportScreenStore,
        popupStore,
        followStateStore,
        incomingRingStore,
    ],
    ([
        $openedMenu,
        $menuVisible,
        $roomList,
        $broadcastPanel,
        $requestVisitCards,
        $wokaMenu,
        $actionsMenu,
        $showReportScreen,
        $popups,
        $followState,
        $incomingRing,
    ]) =>
        cardOverWindow({
            barMenu: $openedMenu !== undefined,
            panel: $menuVisible || $roomList || $broadcastPanel,
            card:
                $requestVisitCards !== null ||
                $wokaMenu !== undefined ||
                $actionsMenu !== undefined ||
                $showReportScreen !== userReportEmpty ||
                // The follow popup is a card only while it asks (a request); the pill of a follow going on and the note
                // after one are not.
                ($followState === "requesting" && $popups.some((popup) => popup.uuid === "popupFollow")) ||
                $popups.some((popup) => popup.uuid === NEW_DEVICE_POPUP_ID) ||
                $incomingRing !== undefined,
        })
);
