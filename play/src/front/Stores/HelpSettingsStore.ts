import { writable } from "svelte/store";
import HelpCameraSettingsPopup from "../Components/HelpSettings/HelpCameraSettingsPopup.svelte";
import { popupStore } from "./PopupStore";
import { resetCameraRetry } from "./CameraRetryStore";

export function showHelpCameraSettings() {
    popupStore.addPopup(HelpCameraSettingsPopup, {}, "cameraAccessDenied");
}

export function hideHelpCameraSettings() {
    popupStore.removePopup("cameraAccessDenied");
    resetCameraRetry();
}

export const helpWebRtcSettingsVisibleStore = writable<"pending" | "error" | "hidden">("hidden");
export const helpNotificationSettingsVisibleStore = writable(false);
