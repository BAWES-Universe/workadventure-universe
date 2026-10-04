import { derived } from "svelte/store";
import type { ChatConnectionInterface, ChatUser } from "../Connection/ChatConnection";
import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
import { blackListManager } from "../../WebRtc/BlackListManager";

/** Account ids of the people in Universe right now whom you blocked in chat. */
export function blockedPlayerUuids(
    ignored: readonly string[],
    usersByRoom: ReadonlyMap<string | undefined, { users: readonly ChatUser[] }>
): string[] {
    if (ignored.length === 0) return [];
    const blocked = new Set(ignored);
    const uuids: string[] = [];
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (user.uuid && blocked.has(user.chatId)) uuids.push(user.uuid);
        }
    }
    return uuids;
}

/**
 * Blocks are saved in the chat account, but the game keeps its own list only until the page reloads. Whenever someone
 * you blocked in chat is in Universe, block them in the game too (voice, video, nearby messages).
 */
export function startChatBlockSync(chatConnection: ChatConnectionInterface, merger: UserProviderMerger): () => void {
    return derived([chatConnection.ignoredUsers, merger.usersByRoomStore], ([ignored, usersByRoom]) =>
        blockedPlayerUuids(ignored, usersByRoom)
    ).subscribe((uuids) => {
        for (const uuid of uuids) blackListManager.blackList(uuid);
    });
}
