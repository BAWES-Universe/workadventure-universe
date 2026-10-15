import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { errorScreenStore } from "../Stores/ErrorScreenStore";

/**
 * Getting back in after the connection dropped, without leaving the game (#958).
 *
 * A phone that comes back to the app often finds its connection closed (iOS cuts it while the app is in the
 * background) and the game has to rebuild the room, which takes 2 to 4 seconds. Instead of the full "Reconnecting"
 * screen, the room stays on screen as it was (the others faded: they may have moved), with the bar and the chat, and a
 * small pill at the top says what is going on. Only if it lasts does the full screen come up, as before.
 */

/** Under this long, a pill would only flicker: a quick return shows nothing at all. */
export const PILL_AFTER_MS = 1_000;
/** Still not back in after this long: the full "Reconnecting" screen, as before. */
export const FULL_SCREEN_AFTER_MS = 10_000;
/** How long "Back in" stays. */
export const BACK_IN_SHOWN_MS = 1_500;

/** The room as it was when the connection dropped, to show while the game rebuilds it. */
export interface RoomPicture {
    /** The map, as an image. */
    src: string;
    /** Where the map was drawn, in the game's own box. */
    left: number;
    top: number;
    width: number;
    height: number;
    /** The names over the Wokas (drawn by the page, not in the image), as they were. */
    names?: HTMLElement;
    /** The bar and the buttons around the map, as they were (a still copy: its taps wait, as the map's do). */
    ui?: HTMLElement;
}

/**
 * A still copy of part of the page for the picture: no ids or test ids (the real ones come back with the game), and
 * none of the camera tiles (the calls end with the connection and start again once back in) or embedded pages.
 */
export function stillCopy(element: HTMLElement): HTMLElement {
    const copy = element.cloneNode(true) as HTMLElement;
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("[id], [data-testid]")]) {
        el.removeAttribute("id");
        el.removeAttribute("data-testid");
    }
    for (const el of copy.querySelectorAll(".camera-box, video, audio, iframe")) {
        el.remove();
    }
    copy.setAttribute("aria-hidden", "true");
    return copy;
}

export type ReconnectPill = "reconnecting" | "offline" | "back";

export interface SoftReconnectState {
    /** Shown while the game gets back in; gone once it is. */
    picture?: RoomPicture;
    /** The pill at the top, once the wait has lasted. */
    pill?: ReconnectPill;
}

export interface SoftReconnectEnv {
    now(): number;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
    isOnline(): boolean;
    /** Calls the listener when the device goes on or offline; returns how to stop. */
    onNetworkChange(listener: () => void): () => void;
    isVisible(): boolean;
    /** Calls the listener when the page is shown or hidden; returns how to stop. */
    onVisibilityChange(listener: () => void): () => void;
}

export interface SoftReconnect extends Readable<SoftReconnectState | undefined> {
    /**
     * The connection dropped: keep the room on screen with this picture. Calls showFullScreen if getting back in
     * lasts longer than FULL_SCREEN_AFTER_MS. The waits only start once the page is on screen: a drop seen in the
     * background (or as the app comes back) gets the same pill and the same 10 seconds once the person looks.
     */
    start(picture: RoomPicture, showFullScreen: () => void): void;
    /** The room is still being rebuilt behind the picture. */
    isWaiting(): boolean;
    /**
     * When the wait on screen began (the drop, or the return to the app), until the game is back in (also once the
     * full screen took over).
     */
    droppedAt(): number | undefined;
    /** The game is back in. Returns whether the room had stayed on screen (the UI then needs a fresh start). */
    finish(): boolean;
    /**
     * A screen took over: drop the picture and the pill. The full "Reconnecting" screen keeps the time of the drop
     * (it says "offline" after the same wait as before); anything else forgets it.
     */
    cancel(keepDropTime?: boolean): void;
}

export function createSoftReconnect(env: SoftReconnectEnv): SoftReconnect {
    const { subscribe, set } = writable<SoftReconnectState | undefined>(undefined);
    let state: SoftReconnectState | undefined;
    let timers: unknown[] = [];
    let stopListening: (() => void)[] = [];
    let pillShown = false;
    let dropped: number | undefined;

    const update = (next: SoftReconnectState | undefined) => {
        state = next;
        set(next);
    };
    const stopWaiting = () => {
        for (const timer of timers) env.clearTimeout(timer);
        timers = [];
        for (const stop of stopListening) stop();
        stopListening = [];
    };
    const networkPill = (): ReconnectPill => (env.isOnline() ? "reconnecting" : "offline");

    return {
        subscribe,
        start(picture, showFullScreen) {
            stopWaiting();
            pillShown = false;
            dropped = undefined;
            update({ picture });
            const startWaits = () => {
                if (dropped !== undefined || !env.isVisible()) return;
                dropped = env.now();
                timers.push(
                    env.setTimeout(() => {
                        pillShown = true;
                        if (state?.picture) update({ ...state, pill: networkPill() });
                    }, PILL_AFTER_MS),
                    env.setTimeout(() => {
                        stopWaiting();
                        update(undefined);
                        showFullScreen();
                    }, FULL_SCREEN_AFTER_MS)
                );
            };
            stopListening.push(
                env.onNetworkChange(() => {
                    if (pillShown && state?.picture) update({ ...state, pill: networkPill() });
                }),
                env.onVisibilityChange(startWaits)
            );
            startWaits();
        },
        isWaiting() {
            return state?.picture !== undefined;
        },
        droppedAt() {
            return dropped;
        },
        finish() {
            dropped = undefined;
            if (!state?.picture) return false;
            stopWaiting();
            if (!pillShown) {
                update(undefined);
                return true;
            }
            update({ pill: "back" });
            timers.push(
                env.setTimeout(() => {
                    timers = [];
                    update(undefined);
                }, BACK_IN_SHOWN_MS)
            );
            return true;
        },
        cancel(keepDropTime = false) {
            stopWaiting();
            if (!keepDropTime) dropped = undefined;
            if (state) update(undefined);
        },
    };
}

/** The game's own (see createSoftReconnect). */
export const softReconnect = createSoftReconnect({
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    isOnline: () => navigator.onLine,
    onNetworkChange: (listener) => {
        window.addEventListener("online", listener);
        window.addEventListener("offline", listener);
        return () => {
            window.removeEventListener("online", listener);
            window.removeEventListener("offline", listener);
        };
    },
    isVisible: () => document.visibilityState === "visible",
    onVisibilityChange: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
    },
});

// A screen up (the full "Reconnecting" one, a real error, a ban): nothing of the room stays under it.
// For the page's whole life, as the game's own store.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
errorScreenStore.subscribe((screen) => {
    if (screen) softReconnect.cancel(screen.type === "reconnecting");
});

/** Changes each time the game is back in after keeping the room on screen: the UI starts fresh on the new room. */
function createGenerationStore() {
    const { subscribe, update } = writable(0);
    return { subscribe, next: () => update((n) => n + 1) };
}
export const softReconnectGeneration = createGenerationStore();
