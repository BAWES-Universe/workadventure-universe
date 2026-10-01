import { describe, expect, it } from "vitest";
import {
    MAX_KNOWN_MEDIA_DEVICES,
    findNewMediaDevices,
    groupMediaDevicesByLabel,
    mediaDeviceKey,
    rememberMediaDevices,
} from "../NewMediaDevices";

function device(kind: MediaDeviceKind, label: string, deviceId = `${kind}-${label}`): MediaDeviceInfo {
    return { kind, label, deviceId, groupId: "", toJSON: () => ({}) };
}

const sonarMedia = device("audiooutput", "SteelSeries Sonar - Media");
const sonarGame = device("audiooutput", "SteelSeries Sonar - Game");
const headsetMic = device("audioinput", "USB Headset");
const headsetSpeaker = device("audiooutput", "USB Headset");

describe("findNewMediaDevices", () => {
    it("offers a device the browser has never seen", () => {
        expect(findNewMediaDevices([sonarMedia], new Set())).toEqual([sonarMedia]);
    });

    it("does not offer a device again when it comes back", () => {
        const known = new Set(rememberMediaDevices([], [sonarMedia]));
        // Sonar re-registers its devices, possibly with new ids.
        const returned = device("audiooutput", "SteelSeries Sonar - Media", "new-id");
        expect(findNewMediaDevices([returned], known)).toEqual([]);
    });

    it("ignores the default and communications aliases", () => {
        const alias = device("audiooutput", "Default - SteelSeries Sonar - Media", "default");
        const comms = device("audioinput", "Communications - USB Headset", "communications");
        expect(findNewMediaDevices([alias, comms], new Set())).toEqual([]);
    });

    it("ignores devices without a label", () => {
        expect(findNewMediaDevices([device("audioinput", "")], new Set())).toEqual([]);
    });

    it("tells a microphone and a speaker with the same label apart", () => {
        const known = new Set(rememberMediaDevices([], [headsetSpeaker]));
        expect(findNewMediaDevices([headsetMic, headsetSpeaker], known)).toEqual([headsetMic]);
    });
});

describe("rememberMediaDevices", () => {
    it("keeps the most recently seen devices when over the cap", () => {
        const old = Array.from({ length: MAX_KNOWN_MEDIA_DEVICES }, (_, i) => `audioinput:old ${i}`);
        const keys = rememberMediaDevices(old, [sonarMedia]);
        expect(keys).toHaveLength(MAX_KNOWN_MEDIA_DEVICES);
        expect(keys).not.toContain("audioinput:old 0");
        expect(keys[keys.length - 1]).toBe(mediaDeviceKey(sonarMedia));
    });

    it("moves a device seen again to the end so it is dropped last", () => {
        const keys = rememberMediaDevices([mediaDeviceKey(sonarMedia), mediaDeviceKey(sonarGame)], [sonarMedia]);
        expect(keys).toEqual([mediaDeviceKey(sonarGame), mediaDeviceKey(sonarMedia)]);
    });
});

describe("groupMediaDevicesByLabel", () => {
    it("puts a headset (microphone and speaker) before single virtual outputs", () => {
        const groups = groupMediaDevicesByLabel([sonarMedia, sonarGame, headsetMic, headsetSpeaker]);
        expect(Array.from(groups.keys())).toEqual([
            "USB Headset",
            "SteelSeries Sonar - Media",
            "SteelSeries Sonar - Game",
        ]);
        expect(groups.get("USB Headset")).toEqual([headsetMic, headsetSpeaker]);
    });
});
