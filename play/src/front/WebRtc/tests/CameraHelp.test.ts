import { describe, expect, it } from "vitest";
import type { InstallEnvironment } from "../../Install/InstallPlatform";
import { cameraHelpKindFor } from "../CameraHelp";

const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function env(userAgent: string, overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
    return {
        userAgent,
        platform: "",
        maxTouchPoints: 0,
        displayModeInstalled: false,
        navigatorStandalone: false,
        ...overrides,
    };
}

describe("cameraHelpKindFor", () => {
    it("gives the home screen app on an iPhone the app steps", () => {
        expect(
            cameraHelpKindFor(env(IPHONE, { platform: "iPhone", maxTouchPoints: 5, navigatorStandalone: true }))
        ).toBe("ios-app");
        expect(
            cameraHelpKindFor(env(IPHONE, { platform: "iPhone", maxTouchPoints: 5, displayModeInstalled: true }))
        ).toBe("ios-app");
    });

    it("gives Safari on an iPhone the website settings steps", () => {
        expect(cameraHelpKindFor(env(IPHONE, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios-browser");
    });

    it("knows an iPad that says it is a Mac, because a Mac has no touch screen", () => {
        expect(
            cameraHelpKindFor(env(IPAD_AS_MAC, { platform: "MacIntel", maxTouchPoints: 5, navigatorStandalone: true }))
        ).toBe("ios-app");
        expect(cameraHelpKindFor(env(IPAD_AS_MAC, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("ios-browser");
    });

    it("keeps the pictures for computers and Android", () => {
        expect(cameraHelpKindFor(env(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 0 }))).toBe("other");
        expect(cameraHelpKindFor(env(ANDROID_CHROME, { platform: "Linux armv8l", maxTouchPoints: 5 }))).toBe("other");
        expect(cameraHelpKindFor(env(WINDOWS_CHROME, { platform: "Win32", displayModeInstalled: true }))).toBe("other");
    });

    it("leaves Universe's own native app alone", () => {
        expect(cameraHelpKindFor(env(IPHONE, { platform: "iPhone", maxTouchPoints: 5, nativeShell: true }))).toBe(
            "other"
        );
    });
});
