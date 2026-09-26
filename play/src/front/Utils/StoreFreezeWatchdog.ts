import { writable } from "svelte/store";

/**
 * Notices when the interface has stopped updating, and refreshes the page.
 *
 * Svelte stores share one notification queue across the whole app. If a store subscriber throws while it is being
 * told about a change, that queue is never emptied, and from then on no store tells anyone about anything: values
 * still change, but nothing on screen follows. The map keeps running (it isn't Svelte), so the game looks alive while
 * every button seems dead, or a "Reconnecting" screen never goes away. Only a refresh brings it back.
 *
 * This keeps a tiny probe store of its own and changes it now and then: when its own subscriber isn't told, the
 * queue is stuck. It checks only while the page is on screen, needs two stuck checks in a row, and reloads at most
 * once in a while (shared with the reconnect watchdog), so it can never make the page reload over and over.
 */

/** How often the probe is changed while the page is on screen. */
export const FREEZE_CHECK_EVERY_MS = 5_000;
/** Stuck checks in a row before the interface is called frozen. */
export const FREEZE_CHECKS_BEFORE_RELOAD = 2;
/** At most one automatic reload in this long (per tab), shared with the reconnect watchdog. */
export const FREEZE_RELOAD_MIN_INTERVAL_MS = 5 * 60_000;
/** Time for the report to leave before the page goes. */
const RELOAD_DELAY_MS = 1_000;

export interface StoreFreezeWatchdogEnv {
    isVisible(): boolean;
    now(): number;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(id: unknown): void;
    setTimeout(handler: () => void, ms: number): unknown;
    lastReloadAt(): number | undefined;
    /** Whether it could be remembered: without that, no reload (it could repeat forever). */
    rememberReloadAt(at: number): boolean;
    reload(): void;
    report(properties: { reloaded: boolean }): void;
}

export interface StoreFreezeWatchdog {
    stop(): void;
}

export function startStoreFreezeWatchdog(env: StoreFreezeWatchdogEnv): StoreFreezeWatchdog {
    const probe = writable(0);
    let sent = 0;
    let seen = 0;
    const unsubscribe = probe.subscribe((value) => {
        seen = value;
    });
    let stuckChecks = 0;

    const stop = () => {
        env.clearInterval(timer);
        unsubscribe();
    };

    const check = () => {
        if (!env.isVisible()) return;
        sent += 1;
        probe.set(sent);
        if (seen === sent) {
            stuckChecks = 0;
            return;
        }
        stuckChecks += 1;
        if (stuckChecks < FREEZE_CHECKS_BEFORE_RELOAD) return;

        stop();
        const now = env.now();
        const last = env.lastReloadAt();
        const reloaded =
            (last === undefined || now - last >= FREEZE_RELOAD_MIN_INTERVAL_MS) && env.rememberReloadAt(now);
        env.report({ reloaded });
        if (reloaded) env.setTimeout(() => env.reload(), RELOAD_DELAY_MS);
    };

    const timer = env.setInterval(check, FREEZE_CHECK_EVERY_MS);
    return { stop };
}
