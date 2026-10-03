import { beforeEach, describe, expect, it, vi } from "vitest";
import { localUserStore } from "./LocalUserStore";

vi.mock("../Enum/EnvironmentVariable.ts", () => {
    return {
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
        MAX_USERNAME_LENGTH: 10,
    };
});

const device = vi.hoisted(() => ({ ios: false, android: false }));
vi.mock("../WebRtc/DeviceUtils", () => ({
    isIOS: () => device.ios,
    isAndroid: () => device.android,
}));

describe("Keep microphone active in away mode", () => {
    beforeEach(() => {
        localStorage.clear();
        device.ios = false;
        device.android = false;
    });

    it("stays on by default on a computer", () => {
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(true);
    });

    it("is off by default on an iPhone and on Android", () => {
        device.ios = true;
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(false);
        localStorage.clear();
        device.ios = false;
        device.android = true;
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(false);
    });

    it("ignores the value a phone saved automatically before", () => {
        device.ios = true;
        localStorage.setItem("microphonePrivacySettings", "true");
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(false);
    });

    it("keeps a phone's own choice", () => {
        device.android = true;
        localUserStore.setMicrophonePrivacySettings(true);
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(true);
    });

    it("keeps a computer's choice apart from a phone's", () => {
        localUserStore.setMicrophonePrivacySettings(false);
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(false);
        device.ios = true;
        localUserStore.setMicrophonePrivacySettings(true);
        device.ios = false;
        expect(localUserStore.getMicrophonePrivacySettings()).toBe(false);
    });
});
