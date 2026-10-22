import { derived } from "svelte/store";
import { incomingRingStore } from "../Chat/Stores/RingStore";
import { broadcastPanelOpenStore } from "./BroadcastStore";
import { requestVisitCardsStore } from "./GameStore";
import { menuVisiblilityStore, openedMenuStore } from "./MenuStore";
import { roomListVisibilityStore } from "./ModalStore";
import { cardOverWindow } from "./OpenHereCards";
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
                $popups.length > 0 ||
                $incomingRing !== undefined,
        })
);
