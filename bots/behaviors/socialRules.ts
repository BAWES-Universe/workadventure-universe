/**
 * Pure decision rules for SocialBehavior, kept free of BotClient so they can be unit tested.
 */

/**
 * Availability statuses, mirroring the AvailabilityStatus enum in messages/protos/messages.proto.
 */
export const AvailabilityStatus = {
    UNCHANGED: 0,
    ONLINE: 1,
    SILENT: 2,
    AWAY: 3,
    JITSI: 4,
    BBB: 5,
    DENY_PROXIMITY_MEETING: 6,
    SPEAKER: 7,
    BUSY: 8,
    DO_NOT_DISTURB: 9,
    BACK_IN_A_MOMENT: 10,
    LIVEKIT: 11,
    LISTENER: 12,
} as const;

/** How long a social bot keeps trying to reach a player before giving up. */
export const APPROACH_TIMEOUT_MS = 20000;

/**
 * Whether a social bot may walk up to a player with this availability status.
 * Only players who are plainly online (or whose status we don't know yet) are approached.
 * Away, busy, do-not-disturb, "no proximity meetings", silent zones and players already
 * in a meeting or on stage are left alone.
 */
export function isAvailableForApproach(status: number | undefined): boolean {
    return (
        status === undefined ||
        status === AvailabilityStatus.UNCHANGED ||
        status === AvailabilityStatus.ONLINE
    );
}

/**
 * Whether a player is already in a conversation bubble that the bot is not part of.
 * A bot that hasn't joined the room yet (no user id) can't be in any bubble.
 */
export function isInOtherBubble(bubbleUserIds: number[] | undefined, playerId: number, botUserId: number | null): boolean {
    if (!bubbleUserIds || !bubbleUserIds.includes(playerId)) return false;
    return botUserId === null || !bubbleUserIds.includes(botUserId);
}

/**
 * Whether a bot should stop approaching its target: it has tried for too long, or the target
 * has moved too far from the bot's area (the bot would otherwise chase them across the map).
 */
export function shouldAbandonApproach(params: {
    now: number;
    approachStartedAt: number;
    timeoutMs?: number;
    targetPosition: { x: number; y: number };
    area?: { center: { x: number; y: number }; radius: number };
    leashMargin: number;
}): boolean {
    const { now, approachStartedAt, timeoutMs = APPROACH_TIMEOUT_MS, targetPosition, area, leashMargin } = params;
    if (now - approachStartedAt > timeoutMs) return true;
    if (!area) return false;
    const dx = targetPosition.x - area.center.x;
    const dy = targetPosition.y - area.center.y;
    return Math.sqrt(dx * dx + dy * dy) > area.radius + leashMargin;
}

/**
 * The prompt for a greeting the bot starts itself, after walking over to someone.
 * Unlike a player-initiated greeting, the bot is the one who came over, so it opens
 * with a reason to talk that fits its character (its chat instructions).
 */
export function buildBotInitiatedGreetingPrompt(playerName: string | undefined, hasHistory: boolean): string {
    const who = playerName || 'someone';
    const history = hasHistory
        ? ` You have met ${playerName ? 'them' : 'this person'} before, so greet them like someone familiar, based on your shared history.`
        : '';
    return `You noticed ${who} nearby and walked over to start a conversation.${history} Open with a friendly reason for coming over that fits your character, and give them something easy to reply to. Keep it short and natural.`;
}
