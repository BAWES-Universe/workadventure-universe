import { AvailabilityStatus } from "@workadventure/messages";
import type { OutgoingRing } from "../../Stores/RingStore";

/**
 * Pure rules for the Ring button and the line under a friend's name while you ring them. Kept free of Svelte and game
 * state so they can be unit tested. The pusher has the final word; these only keep the button honest.
 */

/** Statuses that never ring: the pusher refuses them too. */
export function isBusyStatus(status: AvailabilityStatus | undefined): boolean {
    return (
        status === AvailabilityStatus.BUSY ||
        status === AvailabilityStatus.DO_NOT_DISTURB ||
        status === AvailabilityStatus.BACK_IN_A_MOMENT
    );
}

export type RingButton =
    | { kind: "ring" }
    | { kind: "stop" }
    | { kind: "busy" }
    /** Rung lately without them coming: Ring again in a few minutes. */
    | { kind: "wait"; minutes: number }
    | { kind: "starting" };

export function ringButton(
    entry: OutgoingRing | undefined,
    status: AvailabilityStatus | undefined,
    now: number
): RingButton {
    if (entry?.state === "ringing") return { kind: "stop" };
    if (entry?.state === "starting") return { kind: "starting" };
    if (entry?.retryAt !== undefined && entry.retryAt > now) {
        return { kind: "wait", minutes: Math.max(1, Math.ceil((entry.retryAt - now) / 60_000)) };
    }
    if (isBusyStatus(status)) return { kind: "busy" };
    return { kind: "ring" };
}

export type RingLine =
    | { kind: "ringing"; seconds: number }
    | { kind: "onTheWay" }
    | { kind: "notNow" }
    | { kind: "noAnswer" }
    | undefined;

/** What their row says about your ring, for a little while after it too; undefined once there is nothing to say. */
export function ringLine(entry: OutgoingRing | undefined, now: number, ringMs: number): RingLine {
    if (!entry) return undefined;
    switch (entry.state) {
        case "starting":
        case "ringing":
            return { kind: "ringing", seconds: Math.max(0, Math.ceil((entry.startedAt + ringMs - now) / 1000)) };
        case "accepted":
            return { kind: "onTheWay" };
        case "declined":
            return { kind: "notNow" };
        case "no_answer":
        case "stopped":
            return { kind: "noAnswer" };
        default:
            return undefined;
    }
}
