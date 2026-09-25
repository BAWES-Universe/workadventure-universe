import { AvailabilityStatus, SayMessageType } from "@workadventure/messages";
import type { ExpressionSource } from "../../../Administration/AnalyticsClient";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { gameManager } from "../GameManager";

export type SayType = "say" | "think";

/** How long a Say bubble stays above the avatar. Think bubbles stay until the player moves. */
export const SAY_DURATION_MS = 5000;

/** Maximum length of a say or think bubble. */
export const SAY_MAX_LENGTH = 100;

/**
 * Some statuses force the bubble type: in a meeting you can only speak out loud,
 * and when you're away, busy or silent you can only think.
 * Returns undefined when the player is free to choose.
 */
export function sayTypeForcedByStatus(status: AvailabilityStatus): SayType | undefined {
    switch (status) {
        case AvailabilityStatus.JITSI:
        case AvailabilityStatus.BBB:
        case AvailabilityStatus.LIVEKIT:
        case AvailabilityStatus.DENY_PROXIMITY_MEETING:
        case AvailabilityStatus.SPEAKER:
            return "say";
        case AvailabilityStatus.SILENT:
        case AvailabilityStatus.AWAY:
        case AvailabilityStatus.DO_NOT_DISTURB:
        case AvailabilityStatus.BACK_IN_A_MOMENT:
        case AvailabilityStatus.BUSY:
            return "think";
        default:
            return undefined;
    }
}

/**
 * Shows a say or think bubble above the current player, sends it to the other players
 * and records the send. Shared by the say popup and the Express tray.
 */
export function sendSayBubble(text: string, type: SayType, source: ExpressionSource): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return;
    }
    gameManager
        .getCurrentGameScene()
        .sayManager.say(
            trimmed.slice(0, SAY_MAX_LENGTH),
            type === "say" ? SayMessageType.SpeechBubble : SayMessageType.ThinkingCloud,
            type === "say" ? SAY_DURATION_MS : undefined
        );
    analyticsClient.saySent(type, source);
}
