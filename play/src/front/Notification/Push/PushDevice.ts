import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { localUserStore } from "../../Connection/LocalUserStore";
import { SERVICE_WORKER_URL } from "../../Network/ServiceWorker";
import type { InstallEnvironment } from "../../Install/InstallPlatform";
import { currentInstallEnvironment, isInstalledApp } from "../../Install/InstallPlatform";

/**
 * This browser as a device for notifications Orbit sends while Universe is closed (#863): whether it can get them,
 * what to call it in Your devices, and turning them on. Each browser and each installed app says yes once for itself.
 */

/** "ready": it can ask. "iphone-tab": an iPhone or iPad tab, where only Universe on the Home Screen gets them. */
export type PushAvailability = "ready" | "iphone-tab" | "unsupported";

export type PushBrowser = "chrome" | "edge" | "firefox" | "safari" | "samsung" | "other";

export interface PushDeviceInfo {
    /** The word the card uses: "this phone", "this computer". */
    kind: "phone" | "tablet" | "computer";
    browser: PushBrowser;
    os: "android" | "iphone" | "ipad" | "mac" | "windows" | "linux" | "other";
    installed: boolean;
}

export function describeDevice(env: InstallEnvironment): PushDeviceInfo {
    const ua = env.userAgent;
    const isIpad = /iPad/.test(ua) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
    const os: PushDeviceInfo["os"] = isIpad
        ? "ipad"
        : /iPhone|iPod/.test(ua)
        ? "iphone"
        : /Android/.test(ua)
        ? "android"
        : /Macintosh/.test(ua)
        ? "mac"
        : /Windows/.test(ua)
        ? "windows"
        : /Linux/.test(ua)
        ? "linux"
        : "other";
    let browser: PushBrowser;
    if (/EdgA\/|Edg\/|EdgiOS\//.test(ua)) browser = "edge";
    else if (/SamsungBrowser\//.test(ua)) browser = "samsung";
    else if (/Firefox\/|FxiOS\//.test(ua)) browser = "firefox";
    else if (/Chrome\/|CriOS\//.test(ua)) browser = "chrome";
    else if (/Safari\//.test(ua)) browser = "safari";
    else browser = "other";
    const kind =
        os === "ipad" || (os === "android" && !/Mobile/.test(ua))
            ? "tablet"
            : os === "iphone" || os === "android"
            ? "phone"
            : "computer";
    return { kind, browser, os, installed: isInstalledApp(env) };
}

export const BROWSER_NAMES: Record<PushBrowser, string> = {
    chrome: "Chrome",
    edge: "Edge",
    firefox: "Firefox",
    safari: "Safari",
    samsung: "Samsung Internet",
    other: "Browser",
};
const OS_NAMES: Record<PushDeviceInfo["os"], string> = {
    android: "Android",
    iphone: "iPhone",
    ipad: "iPad",
    mac: "Mac",
    windows: "Windows",
    linux: "Linux",
    other: "this device",
};

/** The name in Your devices: "Chrome on Android", "Universe app on iPhone". */
export function deviceLabel(device: PushDeviceInfo): string {
    if (device.installed) return `Universe app on ${OS_NAMES[device.os]}`;
    return `${BROWSER_NAMES[device.browser]} on ${OS_NAMES[device.os]}`;
}

export function pushAvailability(env: InstallEnvironment = currentInstallEnvironment()): PushAvailability {
    const device = describeDevice(env);
    const supported =
        typeof window !== "undefined" &&
        "Notification" in window &&
        "serviceWorker" in navigator &&
        "PushManager" in window;
    // An iPhone or iPad tab has no push at all: only Universe on the Home Screen (iOS 16.4 and later) gets it.
    if ((device.os === "iphone" || device.os === "ipad") && !device.installed) return "iphone-tab";
    return supported ? "ready" : "unsupported";
}

/** The subscribe key as the push manager wants it. */
export function keyBytes(base64Url: string): Uint8Array {
    const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
    const current = subscription.options?.applicationServerKey;
    if (!current) return true;
    const bytes = new Uint8Array(current);
    return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/**
 * Subscribes this browser (the permission is already given) and saves it in Orbit. A subscription made with an
 * older key is replaced. True when Orbit has it.
 */
export async function subscribeThisDevice(): Promise<boolean> {
    const publicKey = await botApiService.getPushPublicKey();
    if (!publicKey) return false;
    const key = keyBytes(publicKey);
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, key)) {
        await subscription.unsubscribe();
        subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const id = await botApiService.registerPushDevice(
        subscription.toJSON(),
        deviceLabel(describeDevice(currentInstallEnvironment()))
    );
    return id !== null;
}

/**
 * On each start: where notifications are already allowed, saves this browser again, so Orbit keeps its keys and name
 * current and gets it back if it was lost. Asks nothing.
 */
export async function refreshThisDevice(): Promise<void> {
    if (pushAvailability() !== "ready" || Notification.permission !== "granted") return;
    // Switched off here: stays off until switched on again.
    if (!localUserStore.getNotification()) return;
    try {
        await subscribeThisDevice();
    } catch (error) {
        console.warn("Notifications: this device could not be saved again", error);
    }
}

let refreshed = false;

/** refreshThisDevice, once per page: Orbit is reached once a signed-in player has a room. */
export function refreshThisDeviceOnce(): void {
    if (refreshed) return;
    refreshed = true;
    refreshThisDevice().catch(() => undefined);
}

/**
 * Switched off in the settings: this browser drops its subscription, so nothing more reaches it while Universe is
 * closed. Orbit forgets the device the next time it tries to send there (the push service answers that it is gone).
 */
export async function forgetThisBrowser(): Promise<void> {
    try {
        const registration = await navigator.serviceWorker?.getRegistration(SERVICE_WORKER_URL);
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch (error) {
        console.warn("Notifications: this browser could not be unsubscribed", error);
    }
}

export type TurnOnResult = "on" | "blocked" | "dismissed" | "failed";

/**
 * Turn on, from the tap itself: the browser's own box opens straight away (Safari and Firefox only open it from a
 * tap), then this browser is subscribed and saved.
 */
export function turnOnThisDevice(): Promise<TurnOnResult> {
    let asking: Promise<NotificationPermission>;
    try {
        asking = Notification.requestPermission();
    } catch (error) {
        console.error("Notifications: the browser could not ask", error);
        return Promise.resolve("failed");
    }
    return asking
        .then(async (permission) => {
            if (permission === "denied") return "blocked";
            if (permission !== "granted") return "dismissed";
            if (!(await subscribeThisDevice())) return "failed";
            localUserStore.setNotification(true);
            return "on";
        })
        .catch((error) => {
            console.error("Notifications: turning on failed", error);
            return "failed" as const;
        });
}
