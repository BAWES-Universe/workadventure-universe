/**
 * The last resort after a dropped connection: if the game still isn't back after a while, reload the page.
 *
 * Reconnecting rebuilds the map from scratch. If that stalls anywhere (a connection that never settles, a map that
 * never finishes loading, the "Reconnecting" screen gone while the map is still down: a black screen), a refresh
 * always brought people back. This does that refresh for them: only while the page is on screen and the device is
 * online (offline, the screen says so and waits), only once in a while (a server that is really down must not make
 * the page reload over and over), and never over a real error screen (a ban stays shown).
 */

/** On screen and online this long after a drop, without the game back: stuck. */
export const RECONNECT_STUCK_AFTER_MS = 30_000;
/** At most one automatic reload in this long (per tab). */
export const AUTO_RELOAD_MIN_INTERVAL_MS = 5 * 60_000;
const CHECK_EVERY_MS = 1_000;
/** Time for the report to leave before the page goes. */
const RELOAD_DELAY_MS = 1_000;
const LAST_RELOAD_KEY = "universe.reconnectAutoReloadAt";

export interface ReconnectState {
    /** The map is loaded and shown. */
    sceneLoaded: boolean;
    /** The screen up, if any: the "Reconnecting" one, another (a real error), or none. */
    screen: "reconnecting" | "other" | "none";
}

export interface ReconnectWatchdogEnv {
    state(): ReconnectState;
    isVisible(): boolean;
    isOnline(): boolean;
    now(): number;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(id: unknown): void;
    setTimeout(handler: () => void, ms: number): unknown;
    lastReloadAt(): number | undefined;
    /** Whether it could be remembered: without that, no reload (it could repeat forever). */
    rememberReloadAt(at: number): boolean;
    reload(): void;
    report(properties: {
        stuckMs: number;
        screen: "reconnecting" | "none";
        sceneLoaded: boolean;
        reloaded: boolean;
    }): void;
}

export interface ReconnectWatchdog {
    /** The connection dropped: start watching (again) for the game to come back. */
    arm(): void;
}

export function createReconnectWatchdog(env: ReconnectWatchdogEnv): ReconnectWatchdog {
    let timer: unknown;
    let stuckMs = 0;
    let lastTick = 0;

    const disarm = () => {
        if (timer !== undefined) env.clearInterval(timer);
        timer = undefined;
    };

    const tick = () => {
        const now = env.now();
        const elapsed = now - lastTick;
        lastTick = now;

        const state = env.state();
        // Back in the game, or a real error (a ban, a closed room) that must stay: nothing to do.
        if ((state.sceneLoaded && state.screen !== "reconnecting") || state.screen === "other") {
            disarm();
            return;
        }
        // Only time spent looking at it, online, counts: in the background or offline, waiting is expected.
        if (!env.isVisible() || !env.isOnline()) return;
        stuckMs += Math.min(elapsed, CHECK_EVERY_MS * 5);
        if (stuckMs < RECONNECT_STUCK_AFTER_MS) return;

        disarm();
        const last = env.lastReloadAt();
        const reloaded = (last === undefined || now - last >= AUTO_RELOAD_MIN_INTERVAL_MS) && env.rememberReloadAt(now);
        env.report({ stuckMs, screen: state.screen, sceneLoaded: state.sceneLoaded, reloaded });
        if (!reloaded) return;
        env.setTimeout(() => env.reload(), RELOAD_DELAY_MS);
    };

    return {
        arm() {
            stuckMs = 0;
            lastTick = env.now();
            if (timer === undefined) timer = env.setInterval(tick, CHECK_EVERY_MS);
        },
    };
}

function readLastReload(): number | undefined {
    try {
        const value = Number(sessionStorage.getItem(LAST_RELOAD_KEY));
        return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

function writeLastReload(at: number): boolean {
    try {
        sessionStorage.setItem(LAST_RELOAD_KEY, String(at));
        return sessionStorage.getItem(LAST_RELOAD_KEY) === String(at);
    } catch {
        return false;
    }
}

export const browserWatchdogStorage = { readLastReload, writeLastReload };
