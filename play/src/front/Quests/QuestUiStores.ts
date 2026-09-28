import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import { hideActionBarStoreBecauseOfChatBar } from "../Chat/ChatSidebarWidthStore";
import { highlightFullScreen } from "../Stores/ActionsCamStore";
import { actionsMenuStore } from "../Stores/ActionsMenuStore";
import { chatInputFocusStore, chatVisibilityStore } from "../Stores/ChatStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { expressTrayStore } from "../Stores/ExpressStore";
import { requestVisitCardsStore } from "../Stores/GameStore";
import { mapEditorModeStore } from "../Stores/MapEditorStore";
import { availabilityStatusStore } from "../Stores/MediaStore";
import { menuInputFocusStore } from "../Stores/MenuInputFocusStore";
import { menuVisiblilityStore } from "../Stores/MenuStore";
import { modalVisibilityStore } from "../Stores/ModalStore";
import { popupVisibilityStore } from "../Stores/PopupStore";
import { isInRemoteConversation } from "../Stores/StreamableCollectionStore";
import { inputFormFocusStore } from "../Stores/UserInputStore";
import { wokaMenuStore } from "../Stores/WokaMenuStore";
import { isTouchScreen } from "../Utils/ViewportGuard";
import type { QuestSuppression } from "./QuestSuppression";
import { computeQuestQuiet, computeQuestSuppression } from "./QuestSuppression";

/** Below this width the chat is drawn full width (chat.scss), whatever its sidebar width. */
const CHAT_FULL_WIDTH_BELOW_PX = 768;

const typingStore = derived(
    [inputFormFocusStore, chatInputFocusStore, menuInputFocusStore],
    ([$inputFormFocus, $chatInputFocus, $menuInputFocus]) => $inputFormFocus || $chatInputFocus || $menuInputFocus
);

const touchScreen = typeof window !== "undefined" && isTouchScreen(window);

/** Both levels of suppression at once (surfaces, and the pill which may stay under the Express tray). */
export const questSuppressionStore: Readable<QuestSuppression> = derived(
    [
        hideActionBarStoreBecauseOfChatBar,
        chatVisibilityStore,
        windowSize,
        modalVisibilityStore,
        menuVisiblilityStore,
        mapEditorModeStore,
        highlightFullScreen,
        popupVisibilityStore,
        wokaMenuStore,
        actionsMenuStore,
        requestVisitCardsStore,
        expressTrayStore,
        typingStore,
    ],
    ([
        $chatCoversGame,
        $chatVisible,
        $windowSize,
        $modalOpen,
        $settingsMenuOpen,
        $mapEditorOpen,
        $videoFullScreen,
        $popupOpen,
        $wokaMenu,
        $actionsMenu,
        $requestVisitCards,
        $expressTray,
        $typing,
    ]) =>
        computeQuestSuppression({
            chatCoversGame: $chatCoversGame,
            chatOpenOnNarrowScreen: $chatVisible && $windowSize.width < CHAT_FULL_WIDTH_BELOW_PX,
            modalOpen: $modalOpen,
            settingsMenuOpen: $settingsMenuOpen,
            mapEditorOpen: $mapEditorOpen,
            videoFullScreen: $videoFullScreen,
            popupOpen: $popupOpen,
            personCardOpen: $wokaMenu !== undefined || $actionsMenu !== undefined || $requestVisitCards !== null,
            expressTrayOpen: $expressTray !== "closed",
            // On a touch screen the on-screen keyboard is up exactly while a field has focus.
            keyboardOpen: touchScreen && $typing,
        })
);

/** Invitation, options, card, log, payoff and follow-up hide (never move) while this is true. */
export const questSurfaceSuppressed: Readable<boolean> = derived(questSuppressionStore, ($s) => $s.surfaces);

/** The pill hides while this is true. */
export const questPillSuppressed: Readable<boolean> = derived(questSuppressionStore, ($s) => $s.pill);

/** Defers the payoff while in a call, busy (Do not disturb, Busy, Back in a moment, Silent) or typing. */
export const questQuiet: Readable<boolean> = derived(
    [isInRemoteConversation, availabilityStatusStore, typingStore],
    ([$inCall, $status, $typing]) =>
        computeQuestQuiet({ inCall: $inCall, availabilityStatus: $status, typing: $typing })
);
