import { derived, get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { selectedChatMessageToReply, shouldRestoreChatStateStore } from "./Stores/ChatStore";
import { selectedRoomStore } from "./Stores/SelectRoomStore";
import { openProfileRoomIdStore } from "./Stores/PartnerProfileStore";
import { openArtifactsListStore, openRoomDetailsIdStore, openSharedItemsStore } from "./Stores/ChatDetailsStore";

/**
 * Going back one level in the chat (#1553): from "Media, links and files" (or "Artifacts") to the details or profile, from there to the
 * conversation, from the conversation to all chats. The ‹ arrows, the swipe from the chat's edge and the Back button
 * all go back this way.
 */

/**
 * How many levels deep the chat is open: 0 on all chats (or with the chat closed), 1 in a conversation, 2 in its
 * details or profile, 3 in "Media, links and files" over them (2 when that page was opened straight over the chat).
 */
export function chatDepth(
    visible: boolean,
    roomId: string | undefined,
    profileRoomId: string | undefined,
    detailsRoomId: string | undefined,
    sharedRoomId: string | undefined,
    artifactsRoomId?: string
): number {
    if (!visible || roomId === undefined) return 0;
    const panel = profileRoomId === roomId || detailsRoomId === roomId;
    const page = sharedRoomId === roomId || artifactsRoomId === roomId;
    return 1 + (panel ? 1 : 0) + (page ? 1 : 0);
}

export const chatDepthStore: Readable<number> = derived(
    [
        chatVisibilityStore,
        selectedRoomStore,
        openProfileRoomIdStore,
        openRoomDetailsIdStore,
        openSharedItemsStore,
        openArtifactsListStore,
    ],
    ([$visible, $room, $profile, $details, $shared, $artifacts]) =>
        chatDepth($visible, $room?.id, $profile, $details, $shared?.roomId, $artifacts)
);

/** Leaves the conversation for all chats, closing whatever was open over it. */
export function leaveChat(): void {
    openProfileRoomIdStore.set(undefined);
    openRoomDetailsIdStore.set(undefined);
    openSharedItemsStore.set(undefined);
    openArtifactsListStore.set(undefined);
    selectedChatMessageToReply.set(null);
    selectedRoomStore.set(undefined);
    shouldRestoreChatStateStore.set(false);
}

/** Closes the top level of the chat; nothing happens on all chats. */
export function closeChatLevel(): void {
    const roomId = get(selectedRoomStore)?.id;
    if (roomId === undefined) return;
    if (get(openSharedItemsStore)?.roomId === roomId || get(openArtifactsListStore) === roomId) {
        openSharedItemsStore.set(undefined);
        openArtifactsListStore.set(undefined);
    } else if (get(openProfileRoomIdStore) === roomId || get(openRoomDetailsIdStore) === roomId) {
        openProfileRoomIdStore.set(undefined);
        openRoomDetailsIdStore.set(undefined);
    } else {
        leaveChat();
    }
}

/**
 * What a swipe back uncovers while the top level slides away: all chats (under a conversation), the conversation
 * (under its details, profile or shared page), or the details or profile (under "Media, links and files").
 */
export type ChatBackPeek = "list" | "conversation" | "panel";

/** Set while a swipe back is under way, so what it uncovers is drawn under the level that slides away. */
export const chatBackPeekStore = writable<ChatBackPeek | undefined>(undefined);
