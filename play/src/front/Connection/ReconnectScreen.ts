import { get } from "svelte/store";
import { ErrorScreenMessage } from "@workadventure/messages";
import LL from "../../i18n/i18n-svelte";
import { errorScreenStore } from "../Stores/ErrorScreenStore";

/** The code of the screen shown while the game gets back into the room after the connection dropped. */
export const RECONNECTING_CODE = "CONNECTION_LOST";

/** Coming back to the app with the connection closed: how long to wait for the network before the first attempt. */
export const RESUME_NETWORK_WAIT_MS = 3_000;

/** How long the reconnecting screen stays as it is before saying the device is offline (when it is). */
export const OFFLINE_NOTICE_AFTER_MS = 15_000;

/**
 * Shows the calm "Reconnecting" screen right away, instead of an error: nothing failed, the game is getting back in.
 * A screen already up (a real error, a ban) is kept.
 */
export function showReconnectingScreen(logo: string | undefined): void {
    if (get(errorScreenStore)) return;
    errorScreenStore.setError(
        ErrorScreenMessage.fromPartial({
            type: "reconnecting",
            code: RECONNECTING_CODE,
            title: get(LL).warning.reconnectingTitle(),
            details: get(LL).warning.reconnectingDetails(),
            image: logo,
        })
    );
}

interface NetworkWindow {
    navigator: { onLine: boolean };
    addEventListener(type: "online", listener: () => void): void;
    removeEventListener(type: "online", listener: () => void): void;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
}

/**
 * Resolves when the browser is online, at the latest after maxMs: a phone coming back to the app may not have its
 * network yet, and an attempt then only fails. Resolves at once when already online. Never waits longer than maxMs,
 * since `navigator.onLine` can be wrong.
 */
export function waitForNetwork(maxMs: number, win: NetworkWindow = window as unknown as NetworkWindow): Promise<void> {
    return waitOrOnline(win.navigator.onLine ? 0 : maxMs, win);
}

/** Waits ms, or less if the browser comes back online in the meantime. */
export function waitOrOnline(ms: number, win: NetworkWindow = window as unknown as NetworkWindow): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            win.removeEventListener("online", done);
            win.clearTimeout(timer);
            resolve();
        };
        const timer = win.setTimeout(done, ms);
        win.addEventListener("online", done);
    });
}

/** What the reconnecting screen says: offline only once it has lasted a while and the device reports no network. */
export function reconnectingCopy(elapsedMs: number, online: boolean): "reconnecting" | "offline" {
    return !online && elapsedMs >= OFFLINE_NOTICE_AFTER_MS ? "offline" : "reconnecting";
}
