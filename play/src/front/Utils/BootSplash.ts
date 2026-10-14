import type { Readable } from "svelte/store";

/**
 * The launch screen in index.html (#boot-splash, #949): Universe ink and the wordmark, painted before any script loads,
 * so the installed app (and a browser tab) never opens on a black screen. It sits above the game's canvas and under the
 * loader, in the loader's own layout, so the loader fades in over it with the wordmark holding still.
 *
 * It steps aside once a first screen is up: the loader has finished (it then fades out over the game), or a screen
 * that is not the loader shows (sign-in, woka picker, camera setup, an error). If none shows for a long time, it
 * leaves anyway, so it can never hide something it doesn't know about.
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
 * Calls `dismiss` once: when the loader has been shown and hides again, when `otherScreenShown` turns true, or after
 * BOOT_SPLASH_LONGEST_MS. Returns a function that stops watching.
 */
export function watchBootSplash(
    loaderVisible: Readable<boolean>,
    otherScreenShown: Readable<boolean>,
    dismiss: () => void,
    env: BootSplashEnv = window
): () => void {
    let done = false;
    let loaderWasVisible = false;
    const unsubscribers: (() => void)[] = [];
    const stop = () => {
        env.clearTimeout(timer);
        for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    };
    const leave = () => {
        if (done) return;
        done = true;
        dismiss();
        stop();
    };
    const timer = env.setTimeout(leave, BOOT_SPLASH_LONGEST_MS);
    unsubscribers.push(
        loaderVisible.subscribe((visible) => {
            if (visible) loaderWasVisible = true;
            else if (loaderWasVisible) leave();
        })
    );
    unsubscribers.push(
        otherScreenShown.subscribe((shown) => {
            if (shown) leave();
        })
    );
    // A store that answered at once may already have ended it, before its unsubscriber was kept.
    if (done) stop();
    return stop;
}
