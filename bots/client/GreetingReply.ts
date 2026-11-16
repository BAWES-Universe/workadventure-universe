/**
 * Free greetings (approved by Khalid 10 Nov 2026). When someone walks up, a bot greets them on its own, each time they come. That
 * greeting:
 *   - costs the person nothing: it is paid for by whoever's key the bot runs on, never counted in their Universe AI window, a bot's own
 *     limit per person or the guests' pool (the usage is sent marked as a greeting, see AIService.generateGreetingStream);
 *   - is text only, never a voice reply: its reply id is marked, and BotClient keeps it out of the voice, so it is never spoken and
 *     never counts as a spoken reply.
 */

/** The marker in a greeting's reply id. It sits before "-player-", so the person it is for is read from the id as for any reply. */
const GREETING_MARK = '-greeting';

/** A new id for a greeting reply to this person: "bot-<bot>-greeting-player-<id>-<uuid>". */
export function greetingReplyId(botId: string, playerId: number): string {
    return `bot-${botId}${GREETING_MARK}-player-${playerId}-${crypto.randomUUID()}`;
}

/** Whether a reply id is a greeting's. */
export function isGreetingReply(responseId: string): boolean {
    return responseId.startsWith('bot-') && responseId.includes(`${GREETING_MARK}-player-`);
}
