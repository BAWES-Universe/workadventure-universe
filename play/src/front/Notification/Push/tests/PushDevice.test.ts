import { describe, expect, it, vi } from "vitest";
import type { InstallEnvironment } from "../../../Install/InstallPlatform";
import { describeDevice, deviceLabel, keyBytes, pushAvailability } from "../PushDevice";

const { getPushPublicKey } = vi.hoisted(() => ({ getPushPublicKey: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: { getPushPublicKey } }));
vi.mock("../../../Network/ServiceWorker", () => ({ SERVICE_WORKER_URL: "/service-worker.js" }));
vi.mock("../../../Connection/LocalUserStore", () => {
    let notification = false;
    return {
        localUserStore: {
            getNotification: () => notification,
            setNotification: (value: boolean) => (notification = value),
        },
    };
});

const UA = {
    androidChrome:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    androidTablet:
        "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    samsung:
        "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    windowsEdge:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

const env = (userAgent: string, overrides: Partial<InstallEnvironment> = {}): InstallEnvironment => ({
    userAgent,
    platform: "",
    maxTouchPoints: 0,
    displayModeInstalled: false,
    navigatorStandalone: false,
    ...overrides,
});

describe("this browser as a device", () => {
    it.each([
        [env(UA.androidChrome), { kind: "phone", browser: "chrome", os: "android" }, "Chrome on Android"],
        [env(UA.androidTablet), { kind: "tablet", browser: "chrome", os: "android" }, "Chrome on Android"],
        [env(UA.samsung), { kind: "phone", browser: "samsung", os: "android" }, "Samsung Internet on Android"],
        [env(UA.iphone), { kind: "phone", browser: "safari", os: "iphone" }, "Safari on iPhone"],
        [env(UA.mac), { kind: "computer", browser: "safari", os: "mac" }, "Safari on Mac"],
        [env(UA.windowsEdge), { kind: "computer", browser: "edge", os: "windows" }, "Edge on Windows"],
        [env(UA.linuxFirefox), { kind: "computer", browser: "firefox", os: "linux" }, "Firefox on Linux"],
    ])("names it in Your devices (%#)", (environment, expected, label) => {
        const device = describeDevice(environment);
        expect(device).toMatchObject(expected);
        expect(deviceLabel(device)).toBe(label);
    });

    it("sees an iPad that says it is a Mac", () => {
        expect(describeDevice(env(UA.mac, { platform: "MacIntel", maxTouchPoints: 5 }))).toMatchObject({
            os: "ipad",
            kind: "tablet",
        });
    });

    it("calls an installed app the Universe app", () => {
        expect(deviceLabel(describeDevice(env(UA.iphone, { navigatorStandalone: true })))).toBe(
            "Universe app on iPhone"
        );
    });
});

describe("whether this browser can get notifications", () => {
    it("sends an iPhone or iPad tab to the Home Screen, but not the app on it", () => {
        expect(pushAvailability(env(UA.iphone))).toBe("iphone-tab");
        expect(pushAvailability(env(UA.mac, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("iphone-tab");
        expect(pushAvailability(env(UA.iphone, { navigatorStandalone: true }))).not.toBe("iphone-tab");
    });
});

describe("the subscribe key", () => {
    it("turns the base64url key into its bytes, with or without padding", () => {
        expect(Array.from(keyBytes("AQID"))).toEqual([1, 2, 3]);
        expect(Array.from(keyBytes("-_8"))).toEqual([251, 255]);
    });
});

describe("saving this device again on start", () => {
    it("leaves a device that was switched off here alone", async () => {
        const { refreshThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        vi.stubGlobal("Notification", { permission: "granted" });
        vi.stubGlobal("PushManager", class {});
        vi.stubGlobal("navigator", { userAgent: UA.windowsEdge, platform: "", maxTouchPoints: 0, serviceWorker: {} });
        localUserStore.setNotification(false);
        await refreshThisDevice();
        expect(getPushPublicKey).not.toHaveBeenCalled();
        localUserStore.setNotification(true);
        await refreshThisDevice();
        expect(getPushPublicKey).toHaveBeenCalledOnce();
        vi.unstubAllGlobals();
    });
});
