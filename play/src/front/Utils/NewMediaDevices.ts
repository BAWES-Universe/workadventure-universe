/**
 * Decides which media devices deserve a "New device detected" prompt.
 *
 * A device counts as new only the first time this browser ever sees it, not every time it
 * reappears. Virtual audio devices (SteelSeries Sonar, Voicemeeter...) drop out and come back
 * when their app restarts or the computer wakes up, and each return used to trigger a prompt.
 */

// Chrome lists the system default and "communications" devices a second time under these ids.
const ALIAS_DEVICE_IDS = ["default", "communications"];

// Keep the remembered list bounded; the oldest entries are dropped first.
export const MAX_KNOWN_MEDIA_DEVICES = 100;

export function isAliasMediaDevice(device: Pick<MediaDeviceInfo, "deviceId">): boolean {
    return ALIAS_DEVICE_IDS.includes(device.deviceId);
}

/**
 * The key a device is remembered by. Labels are stable across reconnections, and device ids can
 * change when the browser's device-id salt is reset.
 */
export function mediaDeviceKey(device: Pick<MediaDeviceInfo, "kind" | "label">): string {
    return `${device.kind}:${device.label}`;
}

function isRememberable(device: MediaDeviceInfo): boolean {
    // Labels are empty until the user grants media permissions, and then nothing can be told apart.
    return device.label !== "" && !isAliasMediaDevice(device);
}

export function findNewMediaDevices(devices: MediaDeviceInfo[], knownKeys: ReadonlySet<string>): MediaDeviceInfo[] {
    return devices.filter((device) => isRememberable(device) && !knownKeys.has(mediaDeviceKey(device)));
}

/**
 * Returns the remembered keys with the given devices added, most recent last, capped to
 * MAX_KNOWN_MEDIA_DEVICES.
 */
export function rememberMediaDevices(knownKeys: readonly string[], devices: MediaDeviceInfo[]): string[] {
    const keys = new Set(knownKeys);
    for (const device of devices) {
        if (!isRememberable(device)) continue;
        const key = mediaDeviceKey(device);
        // Re-insert so that devices still in use stay at the end and are dropped last.
        keys.delete(key);
        keys.add(key);
    }
    return Array.from(keys).slice(-MAX_KNOWN_MEDIA_DEVICES);
}

/**
 * Groups new devices by label (a headset shows up once as a microphone and once as a speaker)
 * and puts the labels covering the most device kinds first, so a headset is offered before
 * a single virtual output.
 */
export function groupMediaDevicesByLabel(devices: MediaDeviceInfo[]): Map<string, MediaDeviceInfo[]> {
    const groups = new Map<string, MediaDeviceInfo[]>();
    for (const device of devices) {
        const group = groups.get(device.label);
        if (group) {
            group.push(device);
        } else {
            groups.set(device.label, [device]);
        }
    }
    const kindCount = (group: MediaDeviceInfo[]) => new Set(group.map((device) => device.kind)).size;
    return new Map(Array.from(groups.entries()).sort((a, b) => kindCount(b[1]) - kindCount(a[1])));
}
