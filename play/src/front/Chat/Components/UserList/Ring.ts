import { AvailabilityStatus } from "@workadventure/messages";
import type { PictureStore } from "../../../Stores/PictureStore";
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
    /** They said they are coming. */
    | { kind: "onTheWay" }
    | { kind: "starting" };

export function ringButton(
    entry: OutgoingRing | undefined,
    status: AvailabilityStatus | undefined,
    now: number
): RingButton {
    if (entry?.state === "ringing") return { kind: "stop" };
    if (entry?.state === "starting") return { kind: "starting" };
    if (entry?.state === "accepted") return { kind: "onTheWay" };
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
            return { kind: "noAnswer" };
        default:
            return undefined;
    }
}

/** Someone's woka as People knows it: anyone in this world. A caller from elsewhere gets the default woka. */
export function lookOfCaller(
    usersByRoom: ReadonlyMap<
        string | undefined,
        { users: { uuid?: string; pictureStore?: PictureStore; color?: string | null }[] }
    >,
    uuid: string
): { picture?: PictureStore; color?: string } {
    for (const { users } of usersByRoom.values()) {
        const user = users.find((candidate) => candidate.uuid === uuid);
        if (user) return { picture: user.pictureStore, color: user.color ?? undefined };
    }
    return {};
}
