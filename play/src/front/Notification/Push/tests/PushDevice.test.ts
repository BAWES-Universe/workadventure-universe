import { describe, expect, it, vi } from "vitest";
import type { InstallEnvironment } from "../../../Install/InstallPlatform";
import { describeDevice, deviceLabel, keyBytes, pushAvailability } from "../PushDevice";

const { getPushPublicKey, setPushDeviceEnabled, removePushDevice, setPushDeviceId, registerPushDevice } = vi.hoisted(
    () => ({
        getPushPublicKey: vi.fn((): Promise<string | null> => Promise.resolve(null)),
        registerPushDevice: vi.fn(() => Promise.resolve("d-new")),
        setPushDeviceEnabled: vi.fn(() => Promise.resolve(true)),
        removePushDevice: vi.fn(() => Promise.resolve(true)),
        setPushDeviceId: vi.fn(),
    })
);
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getPushPublicKey, setPushDeviceEnabled, removePushDevice, registerPushDevice },
}));
vi.mock("../../../Network/ServiceWorker", () => ({ SERVICE_WORKER_URL: "/service-worker.js" }));
vi.mock("../../../Connection/LocalUserStore", () => {
    let notification: boolean | null = null;
    return {
        localUserStore: {
            getNotification: () => notification === true,
            getNotificationChoice: () => notification,
            setNotification: (value: boolean | null) => (notification = value),
            isLogged: () => true,
            getPushDeviceId: () => null,
            setPushDeviceId,
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

describe("this device's state", () => {
    it("is blocked when the browser blocked us, on only when allowed and switched on", async () => {
        const { readThisDeviceState } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        const permission = { value: "default" as NotificationPermission };
        vi.stubGlobal("Notification", {
            get permission() {
                return permission.value;
            },
        });
        localUserStore.setNotification(true);
        expect(readThisDeviceState()).toBe("off");
        permission.value = "granted";
        expect(readThisDeviceState()).toBe("on");
        localUserStore.setNotification(false);
        expect(readThisDeviceState()).toBe("off");
        permission.value = "denied";
        expect(readThisDeviceState()).toBe("blocked");
        vi.unstubAllGlobals();
    });
});

describe("saving this device again on start", () => {
    it("leaves a device that was switched off here alone, and saves one allowed in the browser's settings", async () => {
        const { refreshThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        vi.stubGlobal("Notification", { permission: "granted" });
        vi.stubGlobal("PushManager", class {});
        vi.stubGlobal("navigator", { userAgent: UA.windowsEdge, platform: "", maxTouchPoints: 0, serviceWorker: {} });
        // Allowed in the browser's own site settings, never switched here: saved, and on here too
        (localUserStore.setNotification as (value: boolean | null) => void)(null);
        await refreshThisDevice();
        expect(getPushPublicKey).toHaveBeenCalledOnce();
        expect(localUserStore.getNotification()).toBe(true);
        localUserStore.setNotification(false);
        await refreshThisDevice();
        expect(getPushPublicKey).toHaveBeenCalledOnce();
        localUserStore.setNotification(true);
        await refreshThisDevice();
        expect(getPushPublicKey).toHaveBeenCalledTimes(2);
        vi.unstubAllGlobals();
    });
});

describe("switching this device off", () => {
    function browserWithSubscription() {
        const unsubscribe = vi.fn(() => Promise.resolve(true));
        const registration = { pushManager: { getSubscription: () => Promise.resolve({ unsubscribe }) } };
        vi.stubGlobal("navigator", { serviceWorker: { getRegistration: () => Promise.resolve(registration) } });
        vi.stubGlobal("Notification", { permission: "granted" });
        return unsubscribe;
    }

    it("tells Orbit and keeps the browser's subscription, so switching on again is quick", async () => {
        const { turnOffThisDevice } = await import("../PushDevice");
        const unsubscribe = browserWithSubscription();
        await turnOffThisDevice("d1", false);
        expect(setPushDeviceEnabled).toHaveBeenCalledWith("d1", false);
        expect(unsubscribe).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("drops the browser's subscription when Orbit can't be told, so nothing arrives anyway", async () => {
        const { turnOffThisDevice } = await import("../PushDevice");
        const unsubscribe = browserWithSubscription();
        setPushDeviceEnabled.mockResolvedValueOnce(false);
        await turnOffThisDevice("d1", false);
        expect(unsubscribe).toHaveBeenCalledOnce();
        vi.unstubAllGlobals();
    });

    it("on Remove, drops the subscription and says so when Orbit kept the device", async () => {
        const { turnOffThisDevice } = await import("../PushDevice");
        const unsubscribe = browserWithSubscription();
        removePushDevice.mockResolvedValueOnce(false);
        setPushDeviceId.mockClear();
        await expect(turnOffThisDevice("d1", true)).rejects.toThrow();
        expect(unsubscribe).toHaveBeenCalledOnce();
        // Still in Your devices, so still This device there
        expect(setPushDeviceId).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("leaves the browser alone when switched on again before Orbit answered the switch-off", async () => {
        const { subscribeThisDevice, turnOffThisDevice } = await import("../PushDevice");
        const unsubscribe = browserWithSubscription();
        let answer: (told: boolean) => void = () => undefined;
        setPushDeviceEnabled.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    answer = resolve;
                })
        );
        const switchingOff = turnOffThisDevice("d1", false);
        // On again: this test browser has no Web Push, so the save ends at once, and it has still started
        await subscribeThisDevice();
        answer(false);
        await switchingOff;
        expect(unsubscribe).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("on Remove, forgets this device's id once Orbit has removed it", async () => {
        const { turnOffThisDevice } = await import("../PushDevice");
        browserWithSubscription();
        setPushDeviceId.mockClear();
        await turnOffThisDevice("d1", true);
        expect(setPushDeviceId).toHaveBeenCalledWith(null);
        vi.unstubAllGlobals();
    });
});

describe("saving this device", () => {
    it("is only in the open window where the browser has no Web Push, without asking Orbit", async () => {
        const { subscribeThisDevice } = await import("../PushDevice");
        vi.stubGlobal("navigator", { userAgent: UA.windowsEdge, platform: "", maxTouchPoints: 0, serviceWorker: {} });
        vi.stubGlobal("Notification", { permission: "granted" });
        getPushPublicKey.mockClear();
        expect(await subscribeThisDevice()).toBe("notSetUp");
        expect(getPushPublicKey).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("stays on in the open window when the browser refuses push, as the permission is given", async () => {
        const { turnOnThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: {
                register: () =>
                    Promise.resolve({
                        pushManager: {
                            getSubscription: () => Promise.resolve(null),
                            subscribe: () => Promise.reject(new DOMException("push service error", "AbortError")),
                        },
                    }),
            },
        });
        vi.stubGlobal("Notification", { permission: "default", requestPermission: () => Promise.resolve("granted") });
        vi.stubGlobal("PushManager", class {});
        localUserStore.setNotification(false);
        getPushPublicKey.mockResolvedValueOnce("AAAA");
        registerPushDevice.mockClear();
        expect(await turnOnThisDevice()).toBe("on");
        expect(registerPushDevice).not.toHaveBeenCalled();
        expect(localUserStore.getNotificationChoice()).toBe(true);
        vi.unstubAllGlobals();
    });

    it("saves nothing when switched off while the browser was still subscribing", async () => {
        const { subscribeThisDevice, turnOffThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        const unsubscribe = vi.fn(() => Promise.resolve(true));
        const subscription = { unsubscribe, toJSON: () => ({ endpoint: "https://push.example/1" }), options: {} };
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: {
                register: () =>
                    Promise.resolve({
                        pushManager: {
                            getSubscription: () => Promise.resolve(null),
                            subscribe: () => Promise.resolve(subscription),
                        },
                    }),
            },
        });
        vi.stubGlobal("Notification", { permission: "granted" });
        vi.stubGlobal("PushManager", class {});
        localUserStore.setNotification(true);
        getPushPublicKey.mockImplementationOnce(() => {
            // The switch goes off while Orbit's key is on its way
            void turnOffThisDevice(undefined, false);
            return Promise.resolve("AAAA");
        });
        registerPushDevice.mockClear();
        expect(await subscribeThisDevice()).toBe("failed");
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(registerPushDevice).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("turns on a device that was switched off before", async () => {
        const { turnOnThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        const unsubscribe = vi.fn(() => Promise.resolve(true));
        const subscription = { unsubscribe, toJSON: () => ({ endpoint: "https://push.example/3" }), options: {} };
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: {
                register: () =>
                    Promise.resolve({
                        pushManager: {
                            getSubscription: () => Promise.resolve(null),
                            subscribe: () => Promise.resolve(subscription),
                        },
                    }),
            },
        });
        vi.stubGlobal("Notification", { permission: "default", requestPermission: () => Promise.resolve("granted") });
        vi.stubGlobal("PushManager", class {});
        localUserStore.setNotification(false);
        getPushPublicKey.mockResolvedValueOnce("AAAA");
        registerPushDevice.mockClear();
        expect(await turnOnThisDevice()).toBe("on");
        expect(unsubscribe).not.toHaveBeenCalled();
        expect(registerPushDevice).toHaveBeenCalledOnce();
        expect(localUserStore.getNotificationChoice()).toBe(true);
        vi.unstubAllGlobals();
    });

    it("records Off when it could not turn on, so the next page load does not turn it on unasked", async () => {
        const { turnOnThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        const subscription = {
            unsubscribe: () => Promise.resolve(true),
            toJSON: () => ({ endpoint: "https://push.example/4" }),
            options: {},
        };
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: {
                register: () =>
                    Promise.resolve({
                        pushManager: {
                            getSubscription: () => Promise.resolve(null),
                            subscribe: () => Promise.resolve(subscription),
                        },
                    }),
            },
        });
        vi.stubGlobal("Notification", { permission: "default", requestPermission: () => Promise.resolve("granted") });
        vi.stubGlobal("PushManager", class {});
        (localUserStore.setNotification as (value: boolean | null) => void)(null);
        getPushPublicKey.mockResolvedValueOnce("AAAA");
        // Orbit does not take the device
        registerPushDevice.mockResolvedValueOnce(null as unknown as string);
        expect(await turnOnThisDevice()).toBe("failed");
        expect(localUserStore.getNotificationChoice()).toBe(false);
        vi.unstubAllGlobals();
    });

    it("keeps Off when switched off while the browser was asking", async () => {
        const { turnOnThisDevice, turnOffThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        vi.stubGlobal("navigator", { userAgent: UA.windowsEdge, platform: "", maxTouchPoints: 0, serviceWorker: {} });
        vi.stubGlobal("Notification", {
            permission: "default",
            requestPermission: () => {
                // Off again while the browser's own box is open
                void turnOffThisDevice(undefined, false);
                return Promise.resolve("granted");
            },
        });
        vi.stubGlobal("PushManager", class {});
        registerPushDevice.mockClear();
        expect(await turnOnThisDevice()).toBe("dismissed");
        expect(localUserStore.getNotificationChoice()).toBe(false);
        expect(registerPushDevice).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("keeps Off in Orbit and on the browser when switched off while Orbit was saving it", async () => {
        const { subscribeThisDevice, turnOffThisDevice } = await import("../PushDevice");
        const { localUserStore } = await import("../../../Connection/LocalUserStore");
        const unsubscribe = vi.fn(() => Promise.resolve(true));
        const subscription = { unsubscribe, toJSON: () => ({ endpoint: "https://push.example/4" }), options: {} };
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: {
                register: () =>
                    Promise.resolve({
                        pushManager: {
                            getSubscription: () => Promise.resolve(null),
                            subscribe: () => Promise.resolve(subscription),
                        },
                    }),
                getRegistration: () => Promise.resolve(undefined),
            },
        });
        vi.stubGlobal("Notification", { permission: "granted" });
        vi.stubGlobal("PushManager", class {});
        localUserStore.setNotification(true);
        getPushPublicKey.mockResolvedValueOnce("AAAA");
        registerPushDevice.mockImplementationOnce(() => {
            void turnOffThisDevice(undefined, false);
            return Promise.resolve("d-saving");
        });
        setPushDeviceEnabled.mockClear();
        expect(await subscribeThisDevice()).toBe("failed");
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(setPushDeviceEnabled).toHaveBeenCalledWith("d-saving", false);
        vi.unstubAllGlobals();
    });

    it("forgets an id kept from before when nothing is saved in Orbit now", async () => {
        const { subscribeThisDevice, thisDeviceIdStore } = await import("../PushDevice");
        const { get } = await import("svelte/store");
        thisDeviceIdStore.set("old-device");
        setPushDeviceId.mockClear();
        // This server sends nothing while Universe is closed (no keys in Orbit)
        vi.stubGlobal("navigator", {
            userAgent: UA.windowsEdge,
            platform: "",
            maxTouchPoints: 0,
            serviceWorker: { register: vi.fn() },
        });
        vi.stubGlobal("Notification", { permission: "granted" });
        vi.stubGlobal("PushManager", class {});
        getPushPublicKey.mockResolvedValueOnce(null);
        expect(await subscribeThisDevice()).toBe("notSetUp");
        expect(get(thisDeviceIdStore)).toBeUndefined();
        expect(setPushDeviceId).toHaveBeenCalledWith(null);
        vi.unstubAllGlobals();
    });
});
