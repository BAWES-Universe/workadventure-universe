/** Longest press that still counts as a tap, as the map's tap-to-walk uses. */
export const QUICK_TAP_MS = 250;
/** How far a finger may drift and still be a tap, not the start of a joystick drag. */
export const QUICK_TAP_SLOP_PX = 10;

export interface TapPointer {
    downX: number;
    downY: number;
    upX: number;
    upY: number;
    getDuration(): number;
}

/** A short press released close to where it began: a tap or a click, never a hold or a drag. */
export function isQuickTap(pointer: TapPointer): boolean {
    return (
        pointer.getDuration() <= QUICK_TAP_MS &&
        Math.hypot(pointer.upX - pointer.downX, pointer.upY - pointer.downY) < QUICK_TAP_SLOP_PX
    );
}
