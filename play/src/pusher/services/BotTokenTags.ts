/** The tags a bot's own token may add to what Orbit answers: that it is a bot, and that it talks (bots/voice/VoiceBotTag.ts). */
const BOT_TOKEN_TAGS = ["bot", "voice-bot"];

/** Who a bot token names: "bot-" and the bot's id (the same shape the chat ID check reads). */
const BOT_IDENTIFIER = /^bot-[a-z0-9._=\-/]+$/;

/**
 * The tags a connection gets. Orbit answers a bot with none (it only knows the tags of an account), so a bot would lose the
 * "voice-bot" tag its token carries and the game would not know it talks until the bot sent a status. A token that names a bot,
 * has no sign-in and is signed with our secret keeps those two tags next to what Orbit says. Nothing else in a token is
 * trusted: no other tag (they decide who may do what), and no tag for a person.
 */
export function memberTagsFor(
    identifier: string | undefined,
    isLogged: boolean,
    tokenTags: string[] | undefined,
    answeredTags: string[]
): string[] {
    if (isLogged || !identifier || !BOT_IDENTIFIER.test(identifier)) return answeredTags;
    const fromToken = (tokenTags ?? []).filter((tag) => BOT_TOKEN_TAGS.includes(tag) && !answeredTags.includes(tag));
    return fromToken.length > 0 ? [...answeredTags, ...fromToken] : answeredTags;
}
