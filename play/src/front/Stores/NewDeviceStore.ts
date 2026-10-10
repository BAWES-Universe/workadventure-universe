import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";
import { requestedCameraDeviceIdStore, requestedMicrophoneDeviceIdStore, speakerSelectedStore } from "./MediaStore";

/**
 * The devices the device list tags NEW: the ones "Choose device" opened it for. Cleared when the list closes.
 */
export const newDeviceTagsStore = writable<ReadonlySet<string>>(new Set());

/** Set to ask the action bar to open the device list (the one under the microphone). */
export const deviceListOpenRequestStore = writable(false);

/** Uses a device, and remembers it, the same way picking it from the device list does. */
export function useMediaDevice(device: Pick<MediaDeviceInfo, "deviceId" | "kind">): void {
    switch (device.kind) {
        case "videoinput":
            requestedCameraDeviceIdStore.set(device.deviceId);
            localUserStore.setPreferredVideoInputDevice(device.deviceId);
            break;
        case "audioinput":
            requestedMicrophoneDeviceIdStore.set(device.deviceId);
            localUserStore.setPreferredAudioInputDevice(device.deviceId);
            break;
        case "audiooutput":
            localUserStore.setSpeakerDeviceId(device.deviceId);
            speakerSelectedStore.set(device.deviceId);
            break;
        default:
            console.warn("Unknown device kind: ", device.kind);
    }
}

/** The popup id of the "New device detected" card: one at a time, a newer offer replaces it. */
export const NEW_DEVICE_POPUP_ID = "popupNewDevice";
