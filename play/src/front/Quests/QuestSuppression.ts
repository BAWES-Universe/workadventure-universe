import { AvailabilityStatus } from "@workadventure/messages";

/** Everything that can cover the dock. Each field is one existing store (see QuestUiStores.ts). */
export interface QuestCoverInputs {
    /** Phone: the chat sidebar takes the whole game area (hideActionBarStoreBecauseOfChatBar). */
    chatCoversGame: boolean;
    /** The chat is open below 768px, where it is drawn full width whatever its sidebar width. */
    chatOpenOnNarrowScreen: boolean;
    modalOpen: boolean;
    settingsMenuOpen: boolean;
    mapEditorOpen: boolean;
    videoFullScreen: boolean;
    popupOpen: boolean;
    personCardOpen: boolean;
    expressTrayOpen: boolean;
    /** Touch screens only: the on-screen keyboard is up (or a text field has focus). */
    keyboardOpen: boolean;
}

export interface QuestSuppression {
    /** Invitation, options, card, panel and celebration hide. */
    surfaces: boolean;
    /** The pill hides. It may stay under an open Express tray, which starts above the bar. */
    pill: boolean;
}

/**
 * Suppression hides quest surfaces while something else covers the game. Surfaces hide, they never move, and come
 * back as they were. A desktop chat or a one-line video strip does not suppress: the HUD makes room for them.
 */
export function computeQuestSuppression(inputs: QuestCoverInputs): QuestSuppression {
    const covered =
        inputs.chatCoversGame ||
        inputs.chatOpenOnNarrowScreen ||
        inputs.modalOpen ||
        inputs.settingsMenuOpen ||
        inputs.mapEditorOpen ||
        inputs.videoFullScreen ||
        inputs.popupOpen ||
        inputs.personCardOpen ||
        inputs.keyboardOpen;
    return { surfaces: covered || inputs.expressTrayOpen, pill: covered };
}

const QUIET_STATUSES: ReadonlySet<AvailabilityStatus> = new Set([
    AvailabilityStatus.DO_NOT_DISTURB,
    AvailabilityStatus.BUSY,
    AvailabilityStatus.BACK_IN_A_MOMENT,
    AvailabilityStatus.SILENT,
]);

export interface QuestQuietInputs {
    inCall: boolean;
    availabilityStatus: AvailabilityStatus;
    typing: boolean;
}

/**
 * Quiet defers the celebration while the person is busy; the pill and card stay openable.
 */
export function computeQuestQuiet(inputs: QuestQuietInputs): boolean {
    return inputs.inCall || inputs.typing || QUIET_STATUSES.has(inputs.availabilityStatus);
}
