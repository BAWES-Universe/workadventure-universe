import type { Readable } from "svelte/store";

/**
 * The launch screen in index.html (#boot-splash, #949): Universe ink and the wordmark, painted before any script loads,
 * so the installed app (and a browser tab) never opens on a black screen. It sits above the game's canvas and under the
 * loader, in the loader's own layout, so the loader fades in over it with the wordmark holding still.
 *
 * It steps aside once a first screen is up: the game itself (the room is joined, not just its files loaded: between the
 * two the canvas is still black), or a screen that comes instead (sign-in, woka picker, camera setup, an error or
 * "reconnecting"). If none shows for a long time, it leaves anyway, so it can never hide something it doesn't know
 * about.
 */

export const BOOT_SPLASH_ID = "boot-splash";
/** As the fade in index.html. */
export const BOOT_SPLASH_FADE_MS = 300;
/** Counted from when the app starts: nothing on screen by then, the launch screen leaves anyway. */
export const BOOT_SPLASH_LONGEST_MS = 20_000;

export interface BootSplashEnv {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
}

/** Fades the launch screen out and removes it. Does nothing when it is already gone or going. */
export function dismissBootSplash(doc: Document = document, env: BootSplashEnv = window): void {
    const splash = doc.getElementById(BOOT_SPLASH_ID);
    if (!splash || splash.dataset.leaving === "true") return;
    splash.dataset.leaving = "true";
    splash.style.pointerEvents = "none";
    splash.style.opacity = "0";
    env.setTimeout(() => splash.remove(), BOOT_SPLASH_FADE_MS);
}

/**
 * Calls `dismiss` once: when `firstScreenShown` turns true, or after BOOT_SPLASH_LONGEST_MS. Returns a function that
 * stops watching.
 */
export function watchBootSplash(
    firstScreenShown: Readable<boolean>,
    dismiss: () => void,
    env: BootSplashEnv = window
): () => void {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    const stop = () => {
        env.clearTimeout(timer);
        unsubscribe?.();
        unsubscribe = undefined;
    };
    const leave = () => {
        if (done) return;
        done = true;
        dismiss();
        stop();
    };
    const timer = env.setTimeout(leave, BOOT_SPLASH_LONGEST_MS);
    unsubscribe = firstScreenShown.subscribe((shown) => {
        if (shown) leave();
    });
    // A store that answered at once has already ended it, before its unsubscriber was kept.
    if (done) stop();
    return stop;
}
