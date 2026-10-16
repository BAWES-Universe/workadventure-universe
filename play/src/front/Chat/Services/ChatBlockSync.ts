import { derived } from "svelte/store";
import type { ChatConnectionInterface, ChatUser } from "../Connection/ChatConnection";
import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
import { blackListManager } from "../../WebRtc/BlackListManager";

/** Account ids of the people in Universe right now whom you blocked in chat, with their chat ids. */
export function blockedPlayers(
    ignored: readonly string[],
    usersByRoom: ReadonlyMap<string | undefined, { users: readonly ChatUser[] }>
): Map<string, string> {
    const players = new Map<string, string>();
    if (ignored.length === 0) return players;
    const blocked = new Set(ignored);
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (user.uuid && blocked.has(user.chatId)) players.set(user.uuid, user.chatId);
        }
    }
    return players;
}

/**
 * One step of the sync: who to block in the game, who to unblock because they were unblocked in chat (maybe on another
 * device), and what this sync has blocked so far. Someone who leaves Universe stays blocked: only an unblock lifts it.
 * Each person is blocked once, when the sync first finds them, so unblocking them from the map sticks.
 */
export function chatBlockSyncStep(
    synced: ReadonlyMap<string, string>,
    ignored: readonly string[],
    usersByRoom: ReadonlyMap<string | undefined, { users: readonly ChatUser[] }>
): { synced: Map<string, string>; toBlock: string[]; toUnblock: string[] } {
    const stillIgnored = new Set(ignored);
    const next = new Map<string, string>();
    const toUnblock: string[] = [];
    for (const [uuid, chatId] of synced) {
        if (stillIgnored.has(chatId)) next.set(uuid, chatId);
        else toUnblock.push(uuid);
    }
    const toBlock: string[] = [];
    for (const [uuid, chatId] of blockedPlayers(ignored, usersByRoom)) {
        if (!next.has(uuid)) toBlock.push(uuid);
        next.set(uuid, chatId);
    }
    return { synced: next, toBlock, toUnblock };
}

/**
 * Blocks are saved in the chat account, but the game keeps its own list only until the page reloads. Whenever someone
 * you blocked in chat is in Universe, block them in the game too (voice, video, nearby messages), and lift that block
 * when they're unblocked in chat. Blocks made from the game's own menu are left alone.
 */
export function startChatBlockSync(chatConnection: ChatConnectionInterface, merger: UserProviderMerger): () => void {
    let synced = new Map<string, string>();
    return derived([chatConnection.ignoredUsers, merger.usersByRoomStore], (stores) => stores).subscribe(
        ([ignored, usersByRoom]) => {
            const step = chatBlockSyncStep(synced, ignored, usersByRoom);
            synced = step.synced;
            for (const uuid of step.toUnblock) blackListManager.cancelBlackList(uuid);
            for (const uuid of step.toBlock) blackListManager.blackList(uuid);
        }
    );
}
