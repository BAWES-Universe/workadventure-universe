import { readable, type Readable } from "svelte/store";
import { profileMemory } from "../Stores/ProfileMemory";
import { botIdFromChatId } from "./BotChatStatus";
import { parseBotRoomLink, type BotRoomLink } from "./BotRoomLink";

const lastRooms = profileMemory<BotRoomLink | undefined>();

/**
 * The room a bot lives in, for its profile in a direct message: asked of the bot server each time the profile opens.
 * Undefined for people, for a bot without a room, and for anyone the bot server won't tell. The room it said last shows
 * at once while it is asked again, and stays when the bot server doesn't answer (#1585).
 */
export function botHomeRoom(
    chatId: string | undefined,
    ask: (botId: string) => Promise<unknown>,
    gameOrigin: string
): Readable<BotRoomLink | undefined> {
    const botId = botIdFromChatId(chatId);
    if (!botId) return readable(undefined);
    return readable<BotRoomLink | undefined>(lastRooms.get(botId), (set) => {
        let open = true;
        ask(botId)
            .then((answer) => {
                if (answer === undefined) return;
                const room = parseBotRoomLink(answer, gameOrigin);
                lastRooms.set(botId, room);
                if (open) set(room);
            })
            .catch((error) => console.error("Failed to read the bot's room", error));
        return () => {
            open = false;
        };
    });
}
