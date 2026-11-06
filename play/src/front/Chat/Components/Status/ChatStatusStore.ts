import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import type { ChatRoomMembershipManagement } from "../../Connection/ChatConnection";
import { botIdFromChatId } from "../../Bots/BotChatStatus";
import type { BotAvailability } from "../../Bots/BotChatStatus";
import { botStatusCache } from "../../Bots/BotStatusStore";
import { friendsStore } from "../../Stores/FriendsStore";
import { directPartnerStore } from "../Room/DirectChat/DirectPartnerStore";
import type { ChatStatusFacts } from "./ChatStatus";

/**
 * The status of the other side of a direct chat, from the same sources the chat header always used: where the person
 * is (their avatar and chat presence), the bot server's state for a bot, and for a friend who shares their room, when
 * they were last in Universe. One store per chat row, and the same one inside the open chat.
 */
export function chatStatusStore(room: ChatRoomMembershipManagement): Readable<ChatStatusFacts> {
    const partner = directPartnerStore(room);
    const botId = derived(partner, ($partner) => botIdFromChatId($partner.chatId));
    const botState = derived<Readable<string | undefined>, BotAvailability | undefined>(
        botId,
        (id, set) => (id ? botStatusCache.store(id).subscribe(set) : set(undefined)),
        undefined
    );
    // Only a friend has a last seen, and only when they share their room with someone (Orbit leaves it out otherwise).
    const lastSeenAt = derived([partner, friendsStore], ([$partner, friends]) =>
        $partner.chatId && friends.status !== "signedOut"
            ? friends.list?.friends.find((friend) => friend.chatId === $partner.chatId)?.lastSeenAt || undefined
            : undefined
    );
    return derived([partner, botId, botState, lastSeenAt], ([$partner, id, state, seen]): ChatStatusFacts => {
        if (id) return { kind: "bot", state };
        return { kind: "person", place: $partner.place, lastSeenAt: seen };
    });
}
