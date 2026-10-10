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

/**
 * What the "New device detected" card offers:
 * - "one": a single device, maybe with several kinds (a headset is a microphone and a speaker): Switch, with a tick
 *   per kind when there is more than one.
 * - "several": many devices at once (SteelSeries Sonar registers five): Choose device opens the device list.
 */
export type NewDeviceOffer =
    | { type: "one"; label: string; devices: MediaDeviceInfo[] }
    | {
          type: "several";
          /** What the devices share, like "SteelSeries Sonar", or undefined when they share nothing. */
          name: string | undefined;
          /** What tells each device apart: "Chat", "Game"... or the whole names when they share nothing. */
          parts: string[];
          devices: MediaDeviceInfo[];
          audioOnly: boolean;
      };

// Chrome adds a USB id, "HD Pro Webcam (4df7:4eda)", and Windows a driver name in brackets after the device name.
function cleanDeviceName(label: string): string {
    return label
        .replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
}

const NAME_SEPARATORS = /[\s\-–—:|,]+$/;

/**
 * The words a set of device names starts with, like "SteelSeries Sonar" for "SteelSeries Sonar - Chat" and
 * "SteelSeries Sonar - Game", and what is left of each name. Undefined when they share no whole word or when one
 * name would have nothing left.
 */
export function splitSharedDeviceName(labels: string[]): { name: string; parts: string[] } | undefined {
    const names = labels.map(cleanDeviceName);
    if (names.length < 2) return undefined;
    const words = names.map((name) => name.split(/\s+/));
    let shared = 0;
    while (words.every((list) => shared < list.length && list[shared] === words[0][shared])) {
        shared++;
    }
    const name = words[0].slice(0, shared).join(" ").replace(NAME_SEPARATORS, "").trim();
    if (name.length < 2) return undefined;
    const parts = words.map((list) =>
        list
            .slice(shared)
            .join(" ")
            .replace(/^[\s\-–—:|,]+/, "")
            .trim()
    );
    if (parts.some((part) => part === "")) return undefined;
    return { name, parts };
}

export function buildNewDeviceOffer(devices: MediaDeviceInfo[]): NewDeviceOffer | undefined {
    const groups = groupMediaDevicesByLabel(devices);
    const entries = Array.from(groups.entries());
    if (entries.length === 0) return undefined;
    if (entries.length === 1) {
        const [label, group] = entries[0];
        return { type: "one", label: cleanDeviceName(label), devices: group };
    }
    const labels = entries.map(([label]) => label);
    const shared = splitSharedDeviceName(labels);
    const all = entries.flatMap(([, group]) => group);
    return {
        type: "several",
        name: shared?.name,
        parts: shared?.parts ?? labels.map(cleanDeviceName),
        devices: all,
        audioOnly: all.every((device) => device.kind !== "videoinput"),
    };
}

// A remembered name ending with this covers every device whose name starts with it ("SteelSeries Sonar *").
const IGNORE_PREFIX_MARK = " *";

/**
 * What "Don't ask" remembers for an offer: the device's own name, what the devices share (so a device the same app
 * adds later is not offered either), or each name when they share nothing.
 */
export function ignoreKeysForOffer(offer: NewDeviceOffer): string[] {
    if (offer.type === "one") return [offer.label];
    if (offer.name !== undefined) return [`${offer.name}${IGNORE_PREFIX_MARK}`];
    return Array.from(new Set(offer.devices.map((device) => cleanDeviceName(device.label))));
}

export function isIgnoredMediaDevice(device: Pick<MediaDeviceInfo, "label">, ignoredKeys: readonly string[]): boolean {
    const name = cleanDeviceName(device.label);
    return ignoredKeys.some((key) =>
        key.endsWith(IGNORE_PREFIX_MARK)
            ? name.startsWith(`${key.slice(0, -IGNORE_PREFIX_MARK.length)} `)
            : name === key
    );
}
