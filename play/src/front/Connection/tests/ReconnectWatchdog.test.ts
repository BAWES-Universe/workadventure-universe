import { describe, expect, it, vi } from "vitest";
import type { ReconnectState } from "../ReconnectWatchdog";
import { AUTO_RELOAD_MIN_INTERVAL_MS, RECONNECT_STUCK_AFTER_MS, createReconnectWatchdog } from "../ReconnectWatchdog";

function setup(options: { lastReloadAt?: number; canRemember?: boolean } = {}) {
    let time = 1_000_000;
    let interval: (() => void) | undefined;
    const timeouts: (() => void)[] = [];
    const state: ReconnectState = { sceneLoaded: false, screen: "reconnecting" };
    const env = {
        visible: true,
        online: true,
        remembered: undefined as number | undefined,
    };
    const reload = vi.fn();
    const report = vi.fn();
    const watchdog = createReconnectWatchdog({
        state: () => ({ ...state }),
        isVisible: () => env.visible,
        isOnline: () => env.online,
        now: () => time,
        setInterval: (handler) => {
            interval = handler;
            return 1;
        },
        clearInterval: () => {
            interval = undefined;
        },
        setTimeout: (handler) => {
            timeouts.push(handler);
            return 2;
        },
        lastReloadAt: () => options.lastReloadAt,
        rememberReloadAt: (at) => {
            env.remembered = at;
            return options.canRemember ?? true;
        },
        reload,
        report,
    });
    return {
        watchdog,
        state,
        env,
        reload,
        report,
        /** Seconds pass, the watchdog checking each one. */
        seconds(count: number) {
            for (let i = 0; i < count; i++) {
                time += 1_000;
                interval?.();
            }
        },
        flushTimeouts() {
            timeouts.splice(0).forEach((handler) => handler());
        },
        get armed() {
            return interval !== undefined;
        },
    };
}

const STUCK_SECONDS = RECONNECT_STUCK_AFTER_MS / 1_000;

describe("reconnect watchdog", () => {
    it("reloads the page when the game is still not back after a while on screen", () => {
        const t = setup();
        t.watchdog.arm();

        t.seconds(STUCK_SECONDS - 1);
        expect(t.report).not.toHaveBeenCalled();
        t.seconds(1);

        expect(t.report).toHaveBeenCalledWith({
            stuckMs: RECONNECT_STUCK_AFTER_MS,
            screen: "reconnecting",
            sceneLoaded: false,
            reloaded: true,
        });
        expect(t.reload).not.toHaveBeenCalled();
        t.flushTimeouts();
        expect(t.reload).toHaveBeenCalledTimes(1);
    });

    it("also catches a black screen: the Reconnecting screen gone while the map is still down", () => {
        const t = setup();
        t.watchdog.arm();
        t.state.screen = "none";

        t.seconds(STUCK_SECONDS);
        t.flushTimeouts();

        expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ screen: "none", sceneLoaded: false }));
        expect(t.reload).toHaveBeenCalledTimes(1);
    });

    it("stands down once the game is back", () => {
        const t = setup();
        t.watchdog.arm();
        t.seconds(10);
        t.state.sceneLoaded = true;
        t.state.screen = "none";
        t.seconds(1);

        expect(t.armed).toBe(false);
        t.seconds(STUCK_SECONDS);
        expect(t.reload).not.toHaveBeenCalled();
    });

    it("never reloads over a real error screen (a ban)", () => {
        const t = setup();
        t.watchdog.arm();
        t.state.screen = "other";

        t.seconds(STUCK_SECONDS * 2);
        t.flushTimeouts();

        expect(t.reload).not.toHaveBeenCalled();
        expect(t.report).not.toHaveBeenCalled();
    });

    it("only counts time on screen and online", () => {
        const t = setup();
        t.watchdog.arm();

        t.env.visible = false;
        t.seconds(STUCK_SECONDS * 2);
        t.env.visible = true;
        t.env.online = false;
        t.seconds(STUCK_SECONDS * 2);
        expect(t.report).not.toHaveBeenCalled();

        t.env.online = true;
        t.seconds(STUCK_SECONDS);
        expect(t.report).toHaveBeenCalledTimes(1);
    });

    it("reloads at most once in a while, so a server that is down doesn't make the page reload over and over", () => {
        const t = setup({ lastReloadAt: 1_000_000 - AUTO_RELOAD_MIN_INTERVAL_MS / 2 });
        t.watchdog.arm();

        t.seconds(STUCK_SECONDS);
        t.flushTimeouts();

        expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ reloaded: false }));
        expect(t.reload).not.toHaveBeenCalled();
    });

    it("doesn't reload when it can't remember having reloaded (no storage)", () => {
        const t = setup({ canRemember: false });
        t.watchdog.arm();

        t.seconds(STUCK_SECONDS);
        t.flushTimeouts();

        expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ reloaded: false }));
        expect(t.reload).not.toHaveBeenCalled();
    });

    it("starts counting again from each new drop", () => {
        const t = setup();
        t.watchdog.arm();
        t.seconds(STUCK_SECONDS - 5);
        t.watchdog.arm();
        t.seconds(10);

        expect(t.report).not.toHaveBeenCalled();
    });
});
