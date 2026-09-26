import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import {
    FREEZE_CHECK_EVERY_MS,
    FREEZE_RELOAD_MIN_INTERVAL_MS,
    startStoreFreezeWatchdog,
    type StoreFreezeWatchdogEnv,
} from "../StoreFreezeWatchdog";

function makeEnv(overrides: Partial<StoreFreezeWatchdogEnv> = {}) {
    let now = 1_000_000;
    let tick: (() => void) | undefined;
    const reload = vi.fn();
    const report = vi.fn();
    const env: StoreFreezeWatchdogEnv & { runChecks(n: number): void } = {
        isVisible: () => true,
        now: () => now,
        setInterval: (handler) => {
            tick = handler;
            return 1;
        },
        clearInterval: () => {
            tick = undefined;
        },
        setTimeout: (handler) => {
            handler();
            return 2;
        },
        lastReloadAt: () => undefined,
        rememberReloadAt: () => true,
        reload,
        report,
        ...overrides,
        runChecks(n: number) {
            for (let i = 0; i < n; i++) {
                now += FREEZE_CHECK_EVERY_MS;
                tick?.();
            }
        },
    };
    return { env, reload, report };
}

/** A store subscriber that throws while being notified: from then on, no Svelte store notifies anyone. */
function freezeSvelteStores() {
    const broken = writable(0);
    let armed = false;
    // Never unsubscribed: the point is a subscriber that stays broken.
    const keepBroken = broken.subscribe(() => {
        if (armed) throw new Error("Not the Game Scene");
    });
    void keepBroken;
    armed = true;
    expect(() => broken.set(1)).toThrow("Not the Game Scene");
}

describe("StoreFreezeWatchdog", () => {
    it("does nothing while the interface updates", () => {
        const { env, reload, report } = makeEnv();
        startStoreFreezeWatchdog(env);
        env.runChecks(20);
        expect(reload).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
    });

    it("doesn't check while the page is in the background", () => {
        const { env, report } = makeEnv({ isVisible: () => false });
        const watchdog = startStoreFreezeWatchdog(env);
        env.runChecks(20);
        expect(report).not.toHaveBeenCalled();
        watchdog.stop();
    });

    // Last: freezing Svelte's shared queue can't be undone in this file.
    it("reloads once when the interface has stopped updating, and never twice in a short while", () => {
        const { env, reload, report } = makeEnv();
        startStoreFreezeWatchdog(env);
        freezeSvelteStores();

        env.runChecks(1);
        expect(reload).not.toHaveBeenCalled();
        env.runChecks(1);
        expect(report).toHaveBeenCalledWith({ reloaded: true });
        expect(reload).toHaveBeenCalledTimes(1);
        // It stops watching after deciding.
        env.runChecks(10);
        expect(report).toHaveBeenCalledTimes(1);

        // A page that already reloaded for this a moment ago reports but doesn't reload again.
        const recent = makeEnv({ lastReloadAt: () => 1_000_000 - FREEZE_RELOAD_MIN_INTERVAL_MS / 2 });
        startStoreFreezeWatchdog(recent.env);
        recent.env.runChecks(2);
        expect(recent.report).toHaveBeenCalledWith({ reloaded: false });
        expect(recent.reload).not.toHaveBeenCalled();
    });
});
