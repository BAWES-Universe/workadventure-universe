import { afterEach, describe, expect, it, vi } from "vitest";
import { isScreenSharingSupported } from "../Stores/ScreenSharingStore";
import { getNativeAppPlatform, isNativeMobileApp } from "./DeviceUtils";

type TestCapacitor = {
    getPlatform?: () => "android" | "ios" | "web";
    isNativePlatform?: () => boolean;
};

const originalCapacitor = (window as typeof window & { Capacitor?: TestCapacitor }).Capacitor;
const originalMediaDevices = navigator.mediaDevices;

function setCapacitor(capacitor?: TestCapacitor) {
    Object.defineProperty(window, "Capacitor", {
        configurable: true,
        value: capacitor,
    });
}

function setMediaDevices(mediaDevices: MediaDevices | undefined) {
    Object.defineProperty(window.navigator, "mediaDevices", {
        configurable: true,
        value: mediaDevices,
    });
}

afterEach(() => {
    setCapacitor(originalCapacitor);
    setMediaDevices(originalMediaDevices);
    vi.restoreAllMocks();
});

describe("DeviceUtils", () => {
    it("detects Capacitor native mobile platforms", () => {
        setCapacitor({
            getPlatform: () => "android",
            isNativePlatform: () => true,
        });

        expect(getNativeAppPlatform()).toBe("android");
        expect(isNativeMobileApp()).toBe(true);
    });

    it("treats web or missing Capacitor bridge as non-native", () => {
        setCapacitor({
            getPlatform: () => "web",
            isNativePlatform: () => false,
        });

        expect(getNativeAppPlatform()).toBeUndefined();
        expect(isNativeMobileApp()).toBe(false);

        setCapacitor(undefined);

        expect(getNativeAppPlatform()).toBeUndefined();
        expect(isNativeMobileApp()).toBe(false);
    });
});

describe("isScreenSharingSupported", () => {
    it("hides screen sharing inside native Capacitor apps", () => {
        setCapacitor({
            getPlatform: () => "ios",
            isNativePlatform: () => true,
        });
        setMediaDevices({
            getDisplayMedia: vi.fn(),
        } as unknown as MediaDevices);

        expect(isScreenSharingSupported()).toBe(false);
    });

    it("keeps screen sharing available in regular browsers with getDisplayMedia", () => {
        setCapacitor(undefined);
        setMediaDevices({
            getDisplayMedia: vi.fn(),
        } as unknown as MediaDevices);

        expect(isScreenSharingSupported()).toBe(true);
    });
});
