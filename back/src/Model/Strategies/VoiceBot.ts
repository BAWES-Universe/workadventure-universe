import type { SpaceUser } from "@workadventure/messages";

/**
 * Tag a voice bot carries next to "bot" (its token is signed by the bot server). Keep in sync with
 * bots/voice/VoiceBotTag.ts.
 */
export const VOICE_BOT_TAG = "voice-bot";

// Bots are identified by tag, or by the uuid prefix their token gives them.
export const isBot = (user: SpaceUser): boolean => user.tags?.includes("bot") || user.uuid?.startsWith("bot-") || false;
export const isVoiceBot = (user: SpaceUser): boolean => isBot(user) && (user.tags?.includes(VOICE_BOT_TAG) ?? false);
