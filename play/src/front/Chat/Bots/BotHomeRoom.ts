import { readable, type Readable } from "svelte/store";
import { botIdFromChatId } from "./BotChatStatus";
import { parseBotRoomLink, type BotRoomLink } from "./BotRoomLink";

/**
 * The room a bot lives in, for its profile in a direct message: asked of the bot server once, while the profile is
 * open. Undefined for people, for a bot without a room, and for anyone the bot server won't tell.
 */
export function botHomeRoom(
    chatId: string | undefined,
    ask: (botId: string) => Promise<unknown>,
    gameOrigin: string
): Readable<BotRoomLink | undefined> {
    const botId = botIdFromChatId(chatId);
    if (!botId) return readable(undefined);
    return readable<BotRoomLink | undefined>(undefined, (set) => {
        let open = true;
        ask(botId)
            .then((answer) => {
                if (open) set(parseBotRoomLink(answer, gameOrigin));
            })
            .catch((error) => console.error("Failed to read the bot's room", error));
        return () => {
            open = false;
        };
    });
}
