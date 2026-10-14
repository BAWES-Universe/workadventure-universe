import { writable } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";
import {
    BOOT_SPLASH_FADE_MS,
    BOOT_SPLASH_FULL_MS,
    BOOT_SPLASH_ID,
    BOOT_SPLASH_LONGEST_MS,
    bootSplashView,
    watchLoadingScreen,
    type BootSplashEnv,
    type BootSplashView,
} from "../BootSplash";

/** Timers on a clock moved by hand. */
function makeEnv() {
    const timers = new Map<number, { handler: () => void; at: number }>();
    let next = 1;
    let now = 0;
    const env: BootSplashEnv & { advance(ms: number): void; pending(): number } = {
        setTimeout: (handler, ms) => {
            timers.set(next, { handler, at: now + ms });
            return next++;
        },
        clearTimeout: (id) => {
            timers.delete(id as number);
        },
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
                if (timer.at <= now && timers.has(id)) {
                    timers.delete(id);
                    timer.handler();
                }
            }
        },
        pending: () => timers.size,
    };
    return env;
}

function addSplash() {
    document.body.innerHTML = `<div id="${BOOT_SPLASH_ID}"><div class="boot-splash-bar"><div class="boot-splash-fill"></div></div></div>`;
    const splash = document.getElementById(BOOT_SPLASH_ID) as HTMLElement;
    const fill = splash.querySelector(".boot-splash-fill") as HTMLElement;
    return { splash, fill };
}

/** Records what the controller asked the screen to do. */
function recordingView() {
    const calls: string[] = [];
    const view: BootSplashView = {
        show: () => calls.push("show"),
        hide: () => calls.push("hide"),
        progress: (fraction) => calls.push(`progress ${fraction}`),
    };
    return { view, calls };
}

describe("bootSplashView", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("moves the bar forward, never back, and takes over from the page's creep", () => {
        const { fill } = addSplash();
        const view = bootSplashView(document, makeEnv());
        view.progress(0.12);
        expect(fill.style.width).toBe("12%");
        expect(fill.style.animation).toBe("none");
        view.progress(0.5);
        view.progress(0.3);
        expect(fill.style.width).toBe("50%");
        view.progress(2);
        expect(fill.style.width).toBe("100%");
    });

    it("never draws the bar shorter than the page's creep got to", () => {
        const { fill } = addSplash();
        const bar = fill.parentElement as HTMLElement;
        bar.getBoundingClientRect = () => ({ width: 160 } as DOMRect);
        fill.getBoundingClientRect = () => ({ width: 32 } as DOMRect);
        const view = bootSplashView(document, makeEnv());
        view.progress(0.12);
        expect(fill.style.width).toBe("20%");
        view.progress(0.15);
        expect(fill.style.width).toBe("20%");
        view.progress(0.3);
        expect(fill.style.width).toBe("30%");
    });

    it("ignores no progress at all, so the page's creep keeps going", () => {
        const { fill } = addSplash();
        bootSplashView(document, makeEnv()).progress(0);
        expect(fill.style.width).toBe("");
        expect(fill.style.animation).toBe("");
    });

    it("fades out, then stays in the page hidden", () => {
        const { splash } = addSplash();
        const env = makeEnv();
        bootSplashView(document, env).hide();
        expect(splash.style.opacity).toBe("0");
        expect(splash.style.pointerEvents).toBe("none");
        env.advance(BOOT_SPLASH_FADE_MS);
        expect(splash.style.display).toBe("none");
        expect(document.getElementById(BOOT_SPLASH_ID)).toBe(splash);
    });

    it("comes back with an empty bar for the next load", () => {
        const { splash, fill } = addSplash();
        const env = makeEnv();
        const view = bootSplashView(document, env);
        view.progress(0.9);
        view.hide();
        env.advance(BOOT_SPLASH_FADE_MS);
        view.show();
        expect(splash.style.display).toBe("");
        expect(splash.style.opacity).toBe("1");
        expect(splash.style.pointerEvents).toBe("");
        expect(fill.style.width).toBe("");
        view.progress(0.12);
        expect(fill.style.width).toBe("12%");
    });

    it("stays when shown again while it was fading out", () => {
        const { splash } = addSplash();
        const env = makeEnv();
        const view = bootSplashView(document, env);
        view.hide();
        view.show();
        env.advance(BOOT_SPLASH_FADE_MS);
        expect(splash.style.display).toBe("");
        expect(splash.style.opacity).toBe("1");
    });

    it("does nothing when the page has no loading screen", () => {
        const view = bootSplashView(document, makeEnv());
        expect(() => {
            view.show();
            view.progress(0.5);
            view.hide();
        }).not.toThrow();
    });
});

describe("watchLoadingScreen", () => {
    function setup() {
        const gameLoaded = writable(false);
        const otherScreenShown = writable(false);
        const progress = writable(0);
        const env = makeEnv();
        const { view, calls } = recordingView();
        const stop = watchLoadingScreen({ gameLoaded, otherScreenShown, progress }, view, env);
        return { gameLoaded, otherScreenShown, progress, env, calls, stop };
    }

    it("fills the bar as the load moves, then fades into the game once it is up", () => {
        const { gameLoaded, progress, env, calls } = setup();
        progress.set(0.12);
        progress.set(0.75);
        gameLoaded.set(true);
        expect(calls).toEqual(["progress 0", "progress 0.12", "progress 0.75", "progress 1"]);
        env.advance(BOOT_SPLASH_FULL_MS);
        expect(calls.at(-1)).toBe("hide");
    });

    it("steps aside at once for a screen that comes instead of the game", () => {
        const { otherScreenShown, calls } = setup();
        otherScreenShown.set(true);
        expect(calls.at(-1)).toBe("hide");
    });

    it("comes back for the next load: a room change, or after the Woka picker", () => {
        const { gameLoaded, otherScreenShown, env, calls } = setup();
        otherScreenShown.set(true);
        otherScreenShown.set(false);
        expect(calls.at(-1)).toBe("show");
        gameLoaded.set(true);
        env.advance(BOOT_SPLASH_FULL_MS);
        gameLoaded.set(false);
        expect(calls.at(-1)).toBe("show");
    });

    it("does not fade out the screen that came back right after the game was up", () => {
        const { gameLoaded, env, calls } = setup();
        gameLoaded.set(true);
        gameLoaded.set(false);
        env.advance(BOOT_SPLASH_FULL_MS);
        expect(calls.filter((call) => call === "hide")).toEqual([]);
        expect(calls.at(-1)).toBe("show");
    });

    it("leaves when nothing moves for a long time, until the next load", () => {
        const { gameLoaded, otherScreenShown, progress, env, calls } = setup();
        env.advance(BOOT_SPLASH_LONGEST_MS - 1);
        progress.set(0.2);
        env.advance(BOOT_SPLASH_LONGEST_MS - 1);
        expect(calls).not.toContain("hide");
        env.advance(1);
        expect(calls.at(-1)).toBe("hide");
        // Still not loaded, nothing else on screen: it stays away.
        progress.set(0.3);
        otherScreenShown.set(false);
        expect(calls.at(-1)).toBe("hide");
        // The game comes up, then a new room starts loading: it shows again.
        gameLoaded.set(true);
        gameLoaded.set(false);
        expect(calls.at(-1)).toBe("show");
    });

    it("stops watching when asked", () => {
        const { gameLoaded, env, calls, stop } = setup();
        stop();
        gameLoaded.set(true);
        env.advance(BOOT_SPLASH_LONGEST_MS);
        expect(calls).toEqual(["progress 0"]);
        expect(env.pending()).toBe(0);
    });
});
