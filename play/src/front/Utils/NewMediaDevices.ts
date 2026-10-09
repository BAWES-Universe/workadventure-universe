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

/** The list has names for that kind of device: the site may use it. */
function hasNamesFor(devices: readonly Pick<MediaDeviceInfo, "kind" | "label">[], kind: MediaDeviceKind): boolean {
    return devices.some((device) => device.kind === kind && device.label !== "");
}

/**
 * The devices to offer as new. With the previous listing, a kind of device that had no names there (the camera,
 * before the site was allowed to use it) is being revealed, not plugged in: its devices are not new.
 */
export function findNewMediaDevices(
    devices: MediaDeviceInfo[],
    knownKeys: ReadonlySet<string>,
    previousDevices?: readonly Pick<MediaDeviceInfo, "kind" | "label">[]
): MediaDeviceInfo[] {
    return devices.filter(
        (device) =>
            isRememberable(device) &&
            !knownKeys.has(mediaDeviceKey(device)) &&
            (previousDevices === undefined || hasNamesFor(previousDevices, device.kind))
    );
}

/**
 * Browsers name devices only for the kinds the site may use. A stream that brings a kind the list has no names for
 * (the camera allowed after the microphone, for instance) means the list must be read again to show them.
 */
export function listLacksNamesFor(
    stream: { video: boolean; audio: boolean },
    devices: readonly Pick<MediaDeviceInfo, "kind" | "label">[] | undefined
): boolean {
    const list = devices ?? [];
    return (stream.video && !hasNamesFor(list, "videoinput")) || (stream.audio && !hasNamesFor(list, "audioinput"));
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
