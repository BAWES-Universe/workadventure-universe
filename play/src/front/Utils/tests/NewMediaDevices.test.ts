import { describe, expect, it } from "vitest";
import {
    MAX_KNOWN_MEDIA_DEVICES,
    findNewMediaDevices,
    groupMediaDevicesByLabel,
    listLacksNamesFor,
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

    it("does not offer cameras whose names were only hidden until the site was allowed to use the camera", () => {
        const brio = device("videoinput", "MX Brio");
        const before = [device("videoinput", "", ""), headsetMic];
        expect(findNewMediaDevices([brio, headsetMic], new Set(rememberMediaDevices([], before)), before)).toEqual([]);
    });

    it("still offers a camera plugged in once the camera's names were showing", () => {
        const brio = device("videoinput", "MX Brio");
        const obs = device("videoinput", "OBS Virtual Camera");
        const known = new Set(rememberMediaDevices([], [brio]));
        expect(findNewMediaDevices([brio, obs], known, [brio])).toEqual([obs]);
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

describe("listLacksNamesFor", () => {
    const blankCamera = device("videoinput", "", "");
    const brio = device("videoinput", "MX Brio");

    it("asks for a new reading when the camera starts and the list has no camera names", () => {
        expect(listLacksNamesFor({ video: true, audio: true }, [blankCamera, headsetMic])).toBe(true);
    });

    it("asks for none when the list already names what the stream uses", () => {
        expect(listLacksNamesFor({ video: true, audio: true }, [brio, headsetMic])).toBe(false);
        // A microphone-only stream does not need the camera's names.
        expect(listLacksNamesFor({ video: false, audio: true }, [blankCamera, headsetMic])).toBe(false);
    });

    it("asks for one when there is no list yet", () => {
        expect(listLacksNamesFor({ video: false, audio: true }, undefined)).toBe(true);
    });
});
