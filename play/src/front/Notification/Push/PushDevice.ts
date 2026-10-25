import { get, writable } from "svelte/store";
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

/** Set once signing out starts, for the rest of this page: signing in again loads a new one. */
let signingOut = false;

/** Each time this device is switched off or removed: a save on its way when it happens saves nothing. */
let switchOffs = 0;
/** Each time this browser starts being saved: a switch-off still on its way then leaves the browser as it is. */
let saves = 0;

/**
 * Subscribes this browser (the permission is already given) and saves it in Orbit. A subscription made with an
 * older key is replaced. "notSetUp" when nothing can arrive while Universe is closed: a browser without Web Push,
 * a guest, or a server that sends none (no Orbit, or no keys there). Notifications then only come while it is open.
 */
export async function subscribeThisDevice(): Promise<"saved" | "notSetUp" | "failed"> {
    const offsAtStart = switchOffs;
    saves++;
    if (pushAvailability() !== "ready" || !localUserStore.isLogged()) return notInOrbit();
    const publicKey = await botApiService.getPushPublicKey();
    if (publicKey === null) return notInOrbit();
    if (!publicKey) return "failed";
    const key = keyBytes(publicKey);
    let subscription: PushSubscription | null;
    try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
        subscription = await registration.pushManager.getSubscription();
        if (subscription && !sameKey(subscription, key)) {
            await subscription.unsubscribe();
            subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (error) {
        // The browser refuses push (Brave with it switched off, a push service that fails): it still shows them while
        // Universe is open, as the permission is given
        console.warn("Notifications: this browser could not subscribe to push", error);
        return notInOrbit();
    }
    // Switched off while this was on its way and still off, or signing out: that stands, so nothing is saved and
    // nothing can arrive
    const switchedOff = () => switchOffs !== offsAtStart && localUserStore.getNotificationChoice() === false;
    if (switchedOff() || signingOut) {
        await subscription.unsubscribe();
        return "failed";
    }
    const id = await botApiService.registerPushDevice(
        subscription.toJSON(),
        deviceLabel(describeDevice(currentInstallEnvironment()))
    );
    if (id === null) return "failed";
    // Signed out while Orbit was saving it: it leaves again rather than stay for an account no longer here
    if (signingOut) {
        await subscription.unsubscribe();
        botApiService.removePushDevice(id).catch(() => undefined);
        return "failed";
    }
    setThisDeviceId(id);
    // Switched off while Orbit was saving it: it is this device, kept as off there, and nothing reaches the browser
    if (switchedOff()) {
        await subscription.unsubscribe();
        await botApiService.setPushDeviceEnabled(id, false);
        return "failed";
    }
    // Direct messages reach it through Synapse: point this account's pusher for this device at Orbit
    import("./PushChatLink")
        .then(({ linkChatToDevice }) => linkChatToDevice(id))
        .catch((error) => console.warn("Notifications: direct messages could not be sent to this device", error));
    return "saved";
}

/** Nothing is saved in Orbit for this browser now: an id kept from an earlier sign-in no longer stands for it. */
function notInOrbit(): "notSetUp" {
    setThisDeviceId(undefined);
    return "notSetUp";
}

/**
 * On each start: where notifications are already allowed, saves this browser again, so Orbit keeps its keys and name
 * current and gets it back if it was lost. Asks nothing.
 */
export async function refreshThisDevice(): Promise<void> {
    if (pushAvailability() !== "ready" || Notification.permission !== "granted") return;
    // Switched off (or removed) here: stays off until switched on again. Allowed in the browser's own site settings,
    // with no choice made here: on, as the browser says.
    const choice = localUserStore.getNotificationChoice();
    if (choice === false) return;
    if (choice === null) {
        localUserStore.setNotification(true);
        updateThisDeviceState();
    }
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

/** This device's id in Orbit, once it has been saved there: kept, so Your devices knows it while switched off too. */
export const thisDeviceIdStore = writable<string | undefined>(localUserStore.getPushDeviceId() ?? undefined);

function setThisDeviceId(id: string | undefined): void {
    localUserStore.setPushDeviceId(id ?? null);
    thisDeviceIdStore.set(id);
}

/** What the Notifications row of the menu and This device say: on, off, or blocked by the browser. */
export type ThisDeviceState = "on" | "off" | "blocked";

export function readThisDeviceState(): ThisDeviceState {
    if (typeof Notification === "undefined") return "off";
    if (Notification.permission === "denied") return "blocked";
    return Notification.permission === "granted" && localUserStore.getNotification() ? "on" : "off";
}

export const thisDeviceStateStore = writable<ThisDeviceState>(readThisDeviceState());

/** After anything that may have changed it: the card, the switch, Remove. */
export function updateThisDeviceState(): void {
    thisDeviceStateStore.set(readThisDeviceState());
}

/**
 * This device's switch turned off, or Remove on this device: nothing arrives here any more, from Orbit or from the
 * open window, until it is switched on again. `remove` also takes it out of Your devices.
 */
export async function turnOffThisDevice(deviceId: string | undefined, remove: boolean): Promise<void> {
    switchOffs++;
    const savesAtStart = saves;
    localUserStore.setNotification(false);
    updateThisDeviceState();
    let told = false;
    if (deviceId) {
        told = remove
            ? await botApiService.removePushDevice(deviceId)
            : await botApiService.setPushDeviceEnabled(deviceId, false);
    }
    // Switched on again while Orbit was answering: that save owns the browser and its id now
    const onAgain = saves !== savesAtStart;
    // Still listed when Orbit refused: it stays This device there until Orbit forgets it
    if (remove && told && !onAgain) setThisDeviceId(undefined);
    // Removed, or Orbit could not be told: this browser drops its subscription as well, so nothing reaches it either
    // way (Orbit forgets the device at its next send there).
    if ((remove || !told) && !onAgain) await forgetThisBrowser();
    if (remove && !told) throw new Error("Orbit did not remove the device");
}

/**
 * Signing out: this browser drops its subscription first, so nothing for the account reaches it however long Orbit
 * takes, then leaves Your devices. A save still on its way saves nothing. Signing in again saves it again, for
 * whoever signs in.
 */
export async function forgetThisDeviceOnSignOut(): Promise<void> {
    signingOut = true;
    const id = get(thisDeviceIdStore);
    setThisDeviceId(undefined);
    await forgetThisBrowser();
    // The account's token is already gone: this goes on the saved Orbit session, and still goes as the page leaves
    if (id) await botApiService.removePushDevice(id, true);
}

/** This browser drops its subscription, so nothing more reaches it while Universe is closed. */
async function forgetThisBrowser(): Promise<void> {
    try {
        const registration = await navigator.serviceWorker?.getRegistration(SERVICE_WORKER_URL);
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch (error) {
        console.warn("Notifications: this browser could not be unsubscribed", error);
    }
}

export type TurnOnResult = "on" | "blocked" | "dismissed" | "failed";

/** It said it couldn't turn on: Off is the choice now, so the next page load does not turn it on unasked. */
function couldNotTurnOn(): "failed" {
    localUserStore.setNotification(false);
    return "failed";
}

/**
 * Turn on, from the tap itself: the browser's own box opens straight away (Safari and Firefox only open it from a
 * tap), then this browser is subscribed and saved.
 */
export function turnOnThisDevice(): Promise<TurnOnResult> {
    // Switched off again while the browser asked or this was saved: Off stands, and nothing went wrong
    const offsAtStart = switchOffs;
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
            if (permission !== "granted" || switchOffs !== offsAtStart) return "dismissed";
            const result = await subscribeThisDevice();
            if (switchOffs !== offsAtStart) return "dismissed";
            if (result === "failed") return couldNotTurnOn();
            localUserStore.setNotification(true);
            return "on";
        })
        .catch((error) => {
            console.error("Notifications: turning on failed", error);
            return couldNotTurnOn();
        })
        .finally(updateThisDeviceState);
}
