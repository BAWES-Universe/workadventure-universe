/**
 * Whether the player's main input is a finger: no mouse that can hover. It follows the device, not the window width,
 * so an iPad is a touch device and a narrow desktop window is not.
 */
export function isTouchDevice(): boolean {
    return window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
}
