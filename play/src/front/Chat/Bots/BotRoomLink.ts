import { botIdFromChatId } from "./BotChatStatus";

/** The room a bot lives in, carried by a direct-message reply that names it (its `universe.room_link` field). */
export interface BotRoomLink {
    url: string;
    room: string;
    world: string;
    /** Empty when the bot server didn't send it (an older one) */
    universe: string;
}

const NAME_MAX = 120;

/**
 * The room link a bot's reply carries, or undefined when it has none, is not from a bot, or points away from this game.
 * Only the bot server owns bot chat IDs, and the link must open on this game's own address.
 */
export function readBotRoomLink(
    sender: string | null | undefined,
    content: Record<string, unknown>,
    gameOrigin: string
): BotRoomLink | undefined {
    if (!botIdFromChatId(sender) || content.msgtype !== "m.text") return undefined;
    return parseBotRoomLink(content["universe.room_link"], gameOrigin);
}

/** A bot's room link as the bot server sends it (in a reply, or for its profile), or undefined when it isn't one. */
export function parseBotRoomLink(value: unknown, gameOrigin: string): BotRoomLink | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { url, room, world, universe } = value as Partial<BotRoomLink>;
    if (typeof url !== "string" || typeof room !== "string" || !room.trim()) return undefined;
    try {
        const parsed = new URL(url);
        if (parsed.origin !== gameOrigin || !parsed.pathname.startsWith("/@/")) return undefined;
    } catch {
        return undefined;
    }
    return {
        url,
        room: room.trim().slice(0, NAME_MAX),
        world: typeof world === "string" ? world.trim().slice(0, NAME_MAX) : "",
        universe: typeof universe === "string" ? universe.trim().slice(0, NAME_MAX) : "",
    };
}
