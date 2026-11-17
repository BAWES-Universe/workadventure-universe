/**
 * Recording a voice note by holding the mic, the way phones do it: hold to record, release to send, slide left to
 * cancel, slide up to lock the recording open. This is the movement maths only; the recorder draws it and acts on it.
 */

/** A press must last this long before it is a recording: a quick tap only shows how to record. */
export const HOLD_START_MS = 200;
/** A finger that has moved this far has chosen its direction. */
export const HOLD_DIRECTION_PX = 10;
/** Slid this far to the left, a release cancels the note. */
export const HOLD_CANCEL_PX = 96;
/** Slid this far up, the recording locks open and the finger can lift. */
export const HOLD_LOCK_PX = 72;
/** A held note shorter than this is dropped on release: it was a slip, not a message. */
export const HOLD_MIN_SECONDS = 1;

export type HoldAxis = "x" | "y" | undefined;

export interface HoldMove {
    /** Left (cancel) or up (lock), once the finger has chosen; the other direction is then ignored. */
    axis: HoldAxis;
    /** How far the mic follows the finger (never past the end of its track, never the wrong way). */
    offsetX: number;
    offsetY: number;
    /** 0 to 1: how close a release is to cancelling, and how close the recording is to locking. */
    cancel: number;
    lock: number;
}

/**
 * Where the finger is, `dx` and `dy` from where it first touched. The first slide the right way (left, or up) past a few
 * pixels is kept: a slide to the left that wanders up does not lock, and the other way round. Drifting down or toward the
 * mic first chooses nothing.
 */
export function holdMove(dx: number, dy: number, previous: HoldAxis): HoldMove {
    // Back where it started: the direction is chosen again.
    let axis = Math.hypot(dx, dy) < HOLD_DIRECTION_PX / 2 ? undefined : previous;
    // Only a slide the right way chooses: a thumb that settles down or away from the mic first has chosen nothing yet.
    const toCancel = Math.max(0, -dx);
    const toLock = Math.max(0, -dy);
    if (axis === undefined && Math.max(toCancel, toLock) > HOLD_DIRECTION_PX) axis = toCancel > toLock ? "x" : "y";
    if (axis === "x") {
        const left = Math.max(0, -dx);
        return {
            axis,
            offsetX: -Math.min(left, HOLD_CANCEL_PX * 1.15),
            offsetY: 0,
            cancel: Math.min(1, left / HOLD_CANCEL_PX),
            lock: 0,
        };
    }
    if (axis === "y") {
        const up = Math.max(0, -dy);
        return {
            axis,
            offsetX: 0,
            offsetY: -Math.min(up, HOLD_LOCK_PX * 1.15),
            cancel: 0,
            lock: Math.min(1, up / HOLD_LOCK_PX),
        };
    }
    return { axis, offsetX: 0, offsetY: 0, cancel: 0, lock: 0 };
}

export type HoldRelease = "cancel" | "tooShort" | "send";

/** What letting go does: the note was slid away, was too short to mean anything, or goes. */
export function holdRelease(cancelled: boolean, heldSeconds: number): HoldRelease {
    if (cancelled) return "cancel";
    return heldSeconds < HOLD_MIN_SECONDS ? "tooShort" : "send";
}
