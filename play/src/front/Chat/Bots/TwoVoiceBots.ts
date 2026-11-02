/**
 * Two voice bots in one bubble (#1670). They would talk over each other, so both answer in text and the chat says so once.
 * This is the pure part: how many voice bots are in a space, told as the game tells them (the tag their token carries).
 */

/** The tag a voice bot's token carries next to "bot" (bots/voice/VoiceBotTag.ts). */
const VOICE_BOT_TAG = "voice-bot";

type VoiceBotUser = { spaceUserId: string; tags?: string[]; uuid?: string };

export function isVoiceBotUser(user: Partial<VoiceBotUser>): boolean {
    const isBot = (user.tags?.includes("bot") ?? false) || (user.uuid?.startsWith("bot-") ?? false);
    return isBot && (user.tags?.includes(VOICE_BOT_TAG) ?? false);
}

/** The voice bots in a space, not counting the person who asks (a bot may also be the one looking). */
export function voiceBotCount(users: Iterable<VoiceBotUser>, mySpaceUserId: string, exceptSpaceUserId?: string): number {
    let count = 0;
    for (const user of users) {
        if (user.spaceUserId === mySpaceUserId || user.spaceUserId === exceptSpaceUserId) continue;
        if (isVoiceBotUser(user)) count++;
    }
    return count;
}

