// Bound the input before matching. Even family and subdivision flag emojis fit in 32 UTF-16 code units.
export const MAX_EMOTE_LENGTH = 32;

// Accept emoji bases with optional presentation/skin-tone modifiers and ZWJ sequences,
// country flags, keycaps and subdivision flags. Components alone (e.g. digits or ZWJ) are not emotes.
const EMOJI_BASE = String.raw`\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?`;
const EMOJI_ONLY_REGEXP = new RegExp(
    String.raw`^(?:${EMOJI_BASE}(?:\u200D${EMOJI_BASE})*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F})+$`,
    "u"
);

/** Only emoji sequences may be broadcast to players in the sender's zone. */
export function isValidEmote(emote: string): boolean {
    return emote.length > 0 && emote.length <= MAX_EMOTE_LENGTH && EMOJI_ONLY_REGEXP.test(emote);
}
