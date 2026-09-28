import type { Readable } from "svelte/store";
import { derived, readable } from "svelte/store";
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
import { isKeyboardOpen, isTouchScreen } from "../Utils/ViewportGuard";
import type { QuestSuppression } from "./QuestSuppression";
import { computeQuestQuiet, computeQuestSuppression } from "./QuestSuppression";

/** Below this width the chat is drawn full width (chat.scss), whatever its sidebar width. */
const CHAT_FULL_WIDTH_BELOW_PX = 768;

/**
 * On touch screens, whether the on-screen keyboard is up (ViewportGuard's test). Always false elsewhere. Listens to
 * visualViewport resizes only while something subscribes, and only reads.
 */
export const keyboardOpenStore: Readable<boolean> = readable(false, (set) => {
    if (typeof window === "undefined" || !isTouchScreen(window) || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => set(isKeyboardOpen(window));
    update();
    viewport.addEventListener("resize", update, { passive: true });
    return () => viewport.removeEventListener("resize", update);
});

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
        keyboardOpenStore,
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
        $keyboardOpen,
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
            keyboardOpen: touchScreen && ($keyboardOpen || $typing),
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
