import { botIdFromChatId } from "../../Bots/BotChatStatus";

/**
 * Whether the person in a direct chat is a bot. A bot's chat account is @bot_<id>:<domain>, so one is known even when it is not
 * on the map right now (a Brick that is not placed has no user, and isBot stays false).
 */
export function isBotPartner(partner: { isBot?: boolean; chatId?: string | null } | undefined): boolean {
    return partner !== undefined && (partner.isBot === true || botIdFromChatId(partner.chatId) !== undefined);
}

/** Whether the box holds back text that looks like a key: for any bot (placed or not) and for the Brick for guests. */
export function holdsKeys(
    partner: { isBot?: boolean; chatId?: string | null } | undefined,
    inGuestBrickChat: boolean
): boolean {
    return inGuestBrickChat || isBotPartner(partner);
}

/**
 * What can be sent from a box. Voice notes follow what the uploader can take and what the room allows: a room that takes notes but
 * no files (the Brick for guests) keeps its mic, while the paperclip and the GIFs stay off.
 */
export function uploadAvailability(
    textOnly: boolean,
    roomUploads: boolean,
    uploaderConfigured: boolean
): { files: boolean; voice: boolean } {
    const voice = roomUploads && uploaderConfigured;
    return { files: !textOnly && voice, voice };
}
