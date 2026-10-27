import { derived } from "svelte/store";
import type { ChatConnectionInterface, ChatRoom } from "../Chat/Connection/ChatConnection";
import { waitForStoreValue } from "../Stores/Utils/waitForStoreValue";

/**
 * The chat a notification is about, once the account's chats are loaded: on a slow connection that can be later
 * than the chat connection itself. Undefined for a chat this account is not in (left since, or another account's).
 */
export async function findChatRoom(
    chatConnection: ChatConnectionInterface,
    chatRoomId: string
): Promise<ChatRoom | undefined> {
    await waitForStoreValue(
        derived(chatConnection.connectionStatus, (status) => (status === "CONNECTING" ? undefined : status))
    );
    try {
        return chatConnection.getRoomByID(chatRoomId);
    } catch {
        return undefined;
    }
}
