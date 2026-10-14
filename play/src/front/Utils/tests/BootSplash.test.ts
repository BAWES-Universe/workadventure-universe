import { writable } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    BOOT_SPLASH_FADE_MS,
    BOOT_SPLASH_ID,
    BOOT_SPLASH_LONGEST_MS,
    dismissBootSplash,
    watchBootSplash,
    type BootSplashEnv,
} from "../BootSplash";

function makeEnv() {
    const timers = new Map<number, { handler: () => void; ms: number }>();
    let next = 1;
    const env: BootSplashEnv & { run(ms: number): void; pending(): number } = {
        setTimeout: (handler, ms) => {
            timers.set(next, { handler, ms });
            return next++;
        },
        clearTimeout: (id) => {
            timers.delete(id as number);
        },
        run(ms) {
            for (const [id, timer] of [...timers]) {
                if (timer.ms <= ms) {
                    timers.delete(id);
                    timer.handler();
                }
            }
        },
        pending: () => timers.size,
    };
    return env;
}

describe("dismissBootSplash", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("fades the launch screen out, then removes it", () => {
        document.body.innerHTML = `<div id="${BOOT_SPLASH_ID}"></div>`;
        const env = makeEnv();
        dismissBootSplash(document, env);
        const splash = document.getElementById(BOOT_SPLASH_ID);
        expect(splash?.style.opacity).toBe("0");
        expect(splash?.style.pointerEvents).toBe("none");
        env.run(BOOT_SPLASH_FADE_MS);
        expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
    });

    it("does nothing a second time, or when there is no launch screen", () => {
        document.body.innerHTML = `<div id="${BOOT_SPLASH_ID}"></div>`;
        const env = makeEnv();
        dismissBootSplash(document, env);
        dismissBootSplash(document, env);
        expect(env.pending()).toBe(1);
        env.run(BOOT_SPLASH_FADE_MS);
        expect(() => dismissBootSplash(document, env)).not.toThrow();
        expect(env.pending()).toBe(0);
    });
});

describe("watchBootSplash", () => {
    it("leaves as soon as a first screen shows, and only once", () => {
        const shown = writable(false);
        const dismiss = vi.fn();
        const env = makeEnv();
        watchBootSplash(shown, dismiss, env);
        expect(dismiss).not.toHaveBeenCalled();
        shown.set(true);
        shown.set(false);
        shown.set(true);
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(env.pending()).toBe(0);
    });

    it("leaves at once when a first screen is already up", () => {
        const dismiss = vi.fn();
        const env = makeEnv();
        watchBootSplash(writable(true), dismiss, env);
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(env.pending()).toBe(0);
    });

    it("leaves anyway when nothing shows for a long time, and only once", () => {
        const shown = writable(false);
        const dismiss = vi.fn();
        const env = makeEnv();
        watchBootSplash(shown, dismiss, env);
        env.run(BOOT_SPLASH_LONGEST_MS);
        expect(dismiss).toHaveBeenCalledTimes(1);
        shown.set(true);
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it("stops watching when asked", () => {
        const shown = writable(false);
        const dismiss = vi.fn();
        const env = makeEnv();
        const stop = watchBootSplash(shown, dismiss, env);
        stop();
        shown.set(true);
        expect(dismiss).not.toHaveBeenCalled();
        expect(env.pending()).toBe(0);
    });
});
