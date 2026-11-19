import { botIdFromChatId } from "../../Bots/BotChatStatus";

/** What is looked at in a person to tell a bot from someone: the bot server's chat addresses are known even off the map. */
export interface SearchedUser {
    username?: string | null;
    isBot?: boolean;
    chatId?: string | null;
}

/**
 * Whether someone is found by a search in People. "Bot" and "Brick" (typed whole) find every bot whatever its name, the same way
 * the chats list finds them: by isBot or by the bot chat address, since a Brick that is not on the map has isBot false.
 */
export function matchesPeopleSearch(user: SearchedUser, query: string, findsBots: boolean): boolean {
    if (query === "") return true;
    if (findsBots && (user.isBot === true || botIdFromChatId(user.chatId) !== undefined)) return true;
    return user.username ? user.username.toLocaleLowerCase().includes(query) : false;
}
