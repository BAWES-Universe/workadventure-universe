/**
 * The "Say hi in person" card is the Chats tab's empty state: it teaches how a proximity chat starts to a player who
 * has no chats yet, and gets out of the way for good once they have had one.
 */

/** Kept on this device: proximity history lives in memory only, so it can't say a chat happened on an earlier visit. */
const HAD_PROXIMITY_CHAT_KEY = "chatHadProximityChat";

export function readHadProximityChat(): boolean {
    try {
        return localStorage.getItem(HAD_PROXIMITY_CHAT_KEY) === "1";
    } catch {
        return false;
    }
}

/** The player had a proximity chat: the card never shows again on this device. */
export function rememberProximityChat(): void {
    try {
        localStorage.setItem(HAD_PROXIMITY_CHAT_KEY, "1");
    } catch {
        // Storage blocked (private mode): the card still stays away until the page reloads.
    }
}

export interface SayHiCardState {
    /** A live proximity card is on the list (a bubble, a meeting or a zone). */
    liveCardVisible: boolean;
    /** Some proximity chat the player had is in the list now. */
    hasProximityHistory: boolean;
    /** A proximity chat was had before on this device. */
    hadProximityChatBefore: boolean;
    /**
     * The saved conversations (DMs, groups, invitations, folders) are known to be none; false when there are some;
     * undefined while they are not known (the chat is connecting, offline or in error).
     */
    savedChatsEmpty: boolean | undefined;
}

/** The card shows only while the Chats list has nothing in it, and the player never had a proximity chat. */
export function shouldShowSayHiCard(state: SayHiCardState): boolean {
    return (
        !state.liveCardVisible &&
        !state.hasProximityHistory &&
        !state.hadProximityChatBefore &&
        state.savedChatsEmpty === true
    );
}
