import { writable } from "svelte/store";

/**
 * The "Try again" button of the camera access card.
 *
 * The card lives in a component that MediaStore reaches through HelpSettingsStore, so it cannot import MediaStore
 * itself: MediaStore registers what "try again" does, and the card only calls it. This file imports nothing but
 * svelte/store, so every side can use it.
 */

/** The player tapped Try again since the card opened (the card then says what to do if nothing was asked). */
export const cameraRetriedStore = writable(false);

let retryHandler: (() => void) | undefined;
// The browser refused a request that included the camera, so the camera was switched off because of it, not by the player
let cameraRefused = false;

export function markCameraRefused(): void {
    cameraRefused = true;
}

/** The camera works again, or the player chose to go on without it: a later microphone refusal is not the camera's. */
export function clearCameraRefused(): void {
    cameraRefused = false;
}

export function cameraWasRefused(): boolean {
    return cameraRefused;
}

export function setCameraRetryHandler(handler: () => void): void {
    retryHandler = handler;
}

/** Asks for the camera again. Call it straight from the tap: iPhone only asks again for a request made in a tap. */
export function retryCameraAccess(): void {
    cameraRetriedStore.set(true);
    retryHandler?.();
}

/** The card closed: Try again has not been tapped since it opened. */
export function resetCameraRetry(): void {
    cameraRetriedStore.set(false);
}
