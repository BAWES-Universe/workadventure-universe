import type { Readable } from "svelte/store";

/**
 * The one loading screen (#949, #981): #boot-splash in index.html, Universe ink, the logo and one bar, painted before
 * any script loads, so the app never opens on a black screen. It is the only loading screen: it stays until the game is
 * up (the room joined, not just its files loaded: between the two the canvas is still black), then the bar fills and
 * it fades into the game. It comes back when the player changes room, and steps aside for a screen that comes instead
 * of the game (sign-in, Woka picker, camera setup, an error or "reconnecting"). If its bar stops moving for a long
 * time, it leaves anyway, so it can never hide something it doesn't know about.
 */

export const BOOT_SPLASH_ID = "boot-splash";
/** As the fade in index.html. */
export const BOOT_SPLASH_FADE_MS = 300;
/** How long the bar takes to fill before the screen fades into the game: its width transition in index.html. */
export const BOOT_SPLASH_FULL_MS = 400;
/** Nothing moved for this long: the loading screen leaves anyway. */
export const BOOT_SPLASH_LONGEST_MS = 20_000;

export interface BootSplashEnv {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
}

/** What the loading screen does on the page. */
export interface BootSplashView {
    show(): void;
    hide(): void;
    /** From 0 to 1; never moves the bar back. */
    progress(fraction: number): void;
}

function fillOf(splash: HTMLElement): HTMLElement | null {
    return splash.querySelector<HTMLElement>(".boot-splash-fill");
}

/** Drives #boot-splash in `doc`. Does nothing when the page has none. */
export function bootSplashView(doc: Document = document, env: BootSplashEnv = window): BootSplashView {
    // How far the bar was last set, so it never goes back within one load.
    let shown = 0;
    let hideTimer: unknown;

    return {
        show(): void {
            const splash = doc.getElementById(BOOT_SPLASH_ID);
            if (!splash) return;
            env.clearTimeout(hideTimer);
            shown = 0;
            const fill = fillOf(splash);
            if (fill) {
                // Back to empty at once, then the page's own creep again until the app reports progress.
                fill.style.transition = "none";
                fill.style.width = "";
                fill.style.animation = "none";
                void fill.offsetWidth;
                fill.style.transition = "";
                fill.style.animation = "";
            }
            delete splash.dataset.leaving;
            splash.style.display = "";
            splash.style.pointerEvents = "";
            splash.style.opacity = "1";
        },
        hide(): void {
            const splash = doc.getElementById(BOOT_SPLASH_ID);
            if (!splash || splash.dataset.leaving === "true" || splash.style.display === "none") return;
            splash.dataset.leaving = "true";
            splash.style.pointerEvents = "none";
            splash.style.opacity = "0";
            hideTimer = env.setTimeout(() => {
                if (splash.dataset.leaving !== "true") return;
                splash.style.display = "none";
                delete splash.dataset.leaving;
            }, BOOT_SPLASH_FADE_MS);
        },
        progress(fraction: number): void {
            if (!(fraction > shown)) return;
            const splash = doc.getElementById(BOOT_SPLASH_ID);
            const fill = splash ? fillOf(splash) : null;
            if (!fill) return;
            if (fill.style.animation !== "none") {
                // The app knows better than the page's creep from here on, but never draws the bar shorter than the
                // creep got to.
                const bar = fill.parentElement?.getBoundingClientRect().width ?? 0;
                const crept = bar > 0 ? fill.getBoundingClientRect().width / bar : 0;
                fill.style.animation = "none";
                if (!(fraction > crept)) {
                    shown = crept;
                    fill.style.width = `${crept * 100}%`;
                    return;
                }
            }
            shown = Math.min(1, fraction);
            fill.style.width = `${shown * 100}%`;
        },
    };
}

export interface LoadingScreenSources {
    /** The game is up: the room is joined and shown. */
    gameLoaded: Readable<boolean>;
    /** A screen that comes instead of the game is up. */
    otherScreenShown: Readable<boolean>;
    /** How far the bar is, from 0 to 1 (loadingProgressStore). */
    progress: Readable<number>;
}

/**
 * Shows the loading screen whenever the game is not up and no other screen is, fills it as the progress moves, and
 * fades it into the game once the game is up. The page starts with it shown. Returns a function that stops watching.
 */
export function watchLoadingScreen(
    sources: LoadingScreenSources,
    view: BootSplashView,
    env: BootSplashEnv = window
): () => void {
    let gameLoaded = false;
    let otherScreenShown = false;
    // How far this load is, kept while the screen is away (behind the Woka picker, an error...) so it comes back there.
    let progress = 0;
    let visible = true;
    // It left because nothing moved for too long: it stays away until the next load.
    let gaveUp = false;
    let started = false;
    let stallTimer: unknown;
    let fullTimer: unknown;

    const armStallTimer = () => {
        env.clearTimeout(stallTimer);
        stallTimer = env.setTimeout(() => {
            if (!visible) return;
            visible = false;
            gaveUp = true;
            view.hide();
        }, BOOT_SPLASH_LONGEST_MS);
    };

    const update = () => {
        if (!started) return;
        const wanted = !gameLoaded && !otherScreenShown;
        if (!wanted) gaveUp = false;
        if (wanted && !visible && !gaveUp) {
            env.clearTimeout(fullTimer);
            visible = true;
            view.show();
            if (progress > 0) view.progress(progress);
            armStallTimer();
        } else if (!wanted && visible) {
            visible = false;
            env.clearTimeout(stallTimer);
            if (otherScreenShown) {
                view.hide();
            } else {
                // The game is up: the bar fills, then one fade into the room.
                view.progress(1);
                fullTimer = env.setTimeout(() => view.hide(), BOOT_SPLASH_FULL_MS);
            }
        }
    };

    const unsubscribers = [
        sources.gameLoaded.subscribe((loaded) => {
            gameLoaded = loaded;
            // That load is over: the next one (a room change) starts from empty, not from where this one ended.
            if (loaded) progress = 0;
            update();
        }),
        sources.otherScreenShown.subscribe((shown) => {
            otherScreenShown = shown;
            update();
        }),
        sources.progress.subscribe((value) => {
            progress = value;
            if (!visible) return;
            view.progress(value);
            if (started) armStallTimer();
        }),
    ];
    started = true;
    armStallTimer();
    update();

    return () => {
        env.clearTimeout(stallTimer);
        env.clearTimeout(fullTimer);
        for (const unsubscribe of unsubscribers) unsubscribe();
    };
}
