import { writable } from "svelte/store";
import HelpCameraSettingsPopup from "../Components/HelpSettings/HelpCameraSettingsPopup.svelte";
import { popupStore } from "./PopupStore";
import { resetCameraRetry } from "./CameraRetryStore";

/** hint: the one-time first-visit tip. Nothing was refused, so the card has no Try again and no "blocked" wording. */
export function showHelpCameraSettings(hint = false) {
    popupStore.addPopup(HelpCameraSettingsPopup, { hint }, "cameraAccessDenied");
}

export function hideHelpCameraSettings() {
    popupStore.removePopup("cameraAccessDenied");
    resetCameraRetry();
}

export const helpWebRtcSettingsVisibleStore = writable<"pending" | "error" | "hidden">("hidden");
export const helpNotificationSettingsVisibleStore = writable(false);
