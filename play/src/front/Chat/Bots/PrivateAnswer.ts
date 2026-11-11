import { botIdFromChatId } from "./BotChatStatus";

/**
 * An answer a bot gave one person alone while others were in nearby chat with them (#1993).
 *
 * In nearby chat it is a reply only they see, with "Continue privately". In their direct messages with the bot the
 * same answer is there once, so they can carry on from it: the bot server sends it as a notice (nothing rings twice)
 * that carries this field, and the chat says under it where it was answered.
 */
export const ANSWERED_NEARBY_KEY = "universe.answered_nearby";

/** Whether this message is that one copy: only the bot server owns bot chat IDs, and only its notice counts. */
export function readAnsweredNearby(sender: string | null | undefined, content: Record<string, unknown>): boolean {
    return (
        botIdFromChatId(sender) !== undefined && content.msgtype === "m.notice" && content[ANSWERED_NEARBY_KEY] === true
    );
}

/**
 * What "Continue privately" tells the bot: the direct chat this person just opened with it, so an answer it still
 * holds for them is put there now. It names a room and nothing else; the bot server checks that room is theirs.
 */
export function continuePrivatelyTapJson(roomId: string): string {
    return JSON.stringify({ action: "continue", room: roomId });
}
