import { AvailabilityStatus } from "@workadventure/messages";

/**
 * Pure rules deciding which actions the People tab offers on a person.
 * Kept free of Svelte and game state so they can be unit tested.
 */

export interface SelfIdentity {
    /** This tab's own space user id (one per tab, so clones of the same account differ). */
    spaceUserId: string | undefined;
    /** Account-level ids, only used when a space user id is not available on either side. */
    chatId: string | undefined;
    uuid: string | undefined;
}

export interface PersonIdentity {
    spaceUserId?: string;
    chatId?: string;
    uuid?: string;
}

/**
 * "Yourself" means this tab's own avatar. When both sides carry a space user id, only that id is compared,
 * so another tab of the same account (a clone) is treated as another person.
 * Entries without a space user id (members known only through the chat or admin) fall back to the account ids.
 */
export function isSelf(person: PersonIdentity, me: SelfIdentity): boolean {
    if (person.spaceUserId && me.spaceUserId) {
        return person.spaceUserId === me.spaceUserId;
    }
    return matchesAccount(person, me);
}

function matchesAccount(person: PersonIdentity, me: SelfIdentity): boolean {
    return (
        (person.chatId !== undefined && person.chatId === me.chatId) ||
        (person.uuid !== undefined && person.uuid === me.uuid)
    );
}

export interface PersonActionsInput {
    isSelf: boolean;
    /** Current availability status of the person; UNCHANGED (0) or undefined means disconnected. */
    status: AvailabilityStatus | undefined;
    uuid: string | undefined;
    chatId: string | undefined;
    playUri: string | undefined;
    /** The play URI of the map this tab is on. */
    currentRoomUrl: string | undefined;
    visitCardUrl: string | undefined;
    isMatrixChatEnabled: boolean;
    roomCreationInProgress: boolean;
    iAmAdmin: boolean;
}

export type MessageAction = "hidden" | "enabled" | "disabled";

export interface PersonActions {
    /** Visible "Walk to" button (same map, known position). */
    walkTo: boolean;
    /** Visible "Go to room" button (person on another map). */
    goToRoom: boolean;
    /** Visible "Message" button. "disabled" when the person has no chat id. */
    message: MessageAction;
    /** Menu entries. Locate is listed on the same map; the menu greys it out until the person can be located. */
    locate: boolean;
    businessCard: boolean;
    ban: boolean;
    /** Whether the "more" menu has anything to show. */
    hasMenu: boolean;
}

export function isConnected(status: AvailabilityStatus | undefined): boolean {
    return status !== undefined && status !== AvailabilityStatus.UNCHANGED;
}

export function getPersonActions(input: PersonActionsInput): PersonActions {
    const connected = !input.isSelf && isConnected(input.status);
    const hasPlayUri = !!input.playUri;
    const sameMap = hasPlayUri && input.playUri === input.currentRoomUrl;
    // Walking needs the person's live position, which is asked for by uuid.
    const hasPosition = sameMap && !!input.uuid;

    const walkTo = connected && hasPosition;
    const goToRoom = connected && hasPlayUri && !sameMap;
    const locate = connected && sameMap;
    const businessCard = connected && !!input.visitCardUrl;
    const ban = connected && input.iAmAdmin;

    let message: MessageAction = "hidden";
    if (!input.isSelf && input.isMatrixChatEnabled && !input.roomCreationInProgress) {
        message = input.chatId ? "enabled" : "disabled";
    }

    return {
        walkTo,
        goToRoom,
        message,
        locate,
        businessCard,
        ban,
        hasMenu: locate || businessCard || ban,
    };
}
