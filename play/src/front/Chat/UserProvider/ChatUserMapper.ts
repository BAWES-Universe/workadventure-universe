import type { AdminUser } from "../Connection/ChatConnection";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";

export function mapExtendedSpaceUserToChatUser(user: SpaceUserExtended): AdminUser {
    return {
        uuid: user.uuid,
        chatId: user.chatID,
        pictureStore: user.pictureStore,
        availabilityStatus: user.reactiveUser.availabilityStatus,
        roomName: user.roomName,
        playUri: user.playUri,
        username: user.name,
        isAdmin: user.tags.includes("admin"),
        isMember: user.tags.includes("member"),
        isBot: isBotUser(user),
        visitCardUrl: user.visitCardUrl,
        color: user.color,
        spaceUserId: user.spaceUserId,
    };
}

/**
 * Bots (AI characters) join with the "bot" tag, and their ids start with "bot-". Either is enough, as on the server
 * (WebRTCCommunicationStrategy).
 */
export function isBotUser(user: { tags?: string[]; uuid?: string }): boolean {
    return (user.tags?.includes("bot") ?? false) || (user.uuid?.startsWith("bot-") ?? false);
}
