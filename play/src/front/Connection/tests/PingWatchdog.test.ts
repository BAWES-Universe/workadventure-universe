import { describe, expect, it, vi } from "vitest";
import type { VisibilitySource, WatchdogClock } from "../PingWatchdog";
import { LATE_TIMER_TOLERANCE_MS, PingWatchdog } from "../PingWatchdog";

const DELAY = 100_000;

/** A clock whose timers only fire when the test says so, like a page a phone froze in the background. */
function fakeClock() {
    let now = 0;
    let timer: { handler: () => void; at: number } | undefined;
    const clock: WatchdogClock = {
        now: () => now,
        setTimeout: (handler, timeout) => {
            timer = { handler, at: now + timeout };
            return timer;
        },
        clearTimeout: (handle) => {
            if (handle === timer) timer = undefined;
        },
    };
    return {
        clock,
        /** Time passes with the page awake: the timer fires on time. */
        advance(ms: number) {
            const target = now + ms;
            while (timer && timer.at <= target) {
                const due = timer;
                now = due.at;
                timer = undefined;
                due.handler();
            }
            now = target;
        },
        /** The page sleeps: time passes and nothing runs; on waking, the overdue timer fires at once. */
        sleep(ms: number) {
            now += ms;
        },
        fireOverdue() {
            if (timer && timer.at <= now) {
                const due = timer;
                timer = undefined;
                due.handler();
            }
        },
        get armed() {
            return timer !== undefined;
        },
    };
}

function fakePage(): VisibilitySource & { setHidden(hidden: boolean): void } {
    const listeners = new Set<() => void>();
    const page = {
        hidden: false,
        addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: "visibilitychange", listener: () => void) => listeners.delete(listener),
        setHidden(hidden: boolean) {
            page.hidden = hidden;
            listeners.forEach((listener) => listener());
        },
    };
    return page;
}

function setup(open = true) {
    const time = fakeClock();
    const page = fakePage();
    const onTimeout = vi.fn();
    const onResume = vi.fn();
    const socket = { open };
    const watchdog = new PingWatchdog({
        delay: DELAY,
        onTimeout,
        onResume,
        isOpen: () => socket.open,
        clock: time.clock,
        visibility: page,
    });
    return { time, page, onTimeout, onResume, socket, watchdog };
}

describe("PingWatchdog", () => {
    it("calls the connection dead when the server stops pinging, page awake", () => {
        const { time, onTimeout, watchdog } = setup();
        watchdog.ping();
        time.advance(DELAY - 1);
        expect(onTimeout).not.toHaveBeenCalled();
        time.advance(1);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("keeps the connection while pings keep coming", () => {
        const { time, onTimeout, watchdog } = setup();
        watchdog.ping();
        for (let i = 0; i < 5; i++) {
            time.advance(80_000);
            watchdog.ping();
        }
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("does not drop a healthy connection when the page wakes from a long sleep", () => {
        const { time, page, onTimeout, onResume, watchdog } = setup();
        watchdog.ping();
        page.setHidden(true);
        time.sleep(3 * 60_000);
        // On waking, the overdue timer runs before the pings waiting on the socket are read.
        time.fireOverdue();
        expect(onTimeout).not.toHaveBeenCalled();
        page.setHidden(false);
        expect(onResume).toHaveBeenCalledWith(3 * 60_000);
        // The waiting ping is read.
        watchdog.ping();
        time.advance(DELAY - 1);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("gives a fresh window when the page comes back to the foreground", () => {
        const { time, page, onTimeout, watchdog } = setup();
        watchdog.ping();
        page.setHidden(true);
        time.advance(90_000);
        page.setHidden(false);
        time.advance(DELAY - 1);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("still calls a connection that really died dead, one window later at most", () => {
        const { time, page, onTimeout, watchdog } = setup();
        watchdog.ping();
        page.setHidden(true);
        time.sleep(3 * 60_000);
        time.fireOverdue();
        page.setHidden(false);
        // No ping ever comes.
        time.advance(DELAY);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("never grants a fresh window to a socket that is already closed", () => {
        const { time, socket, onTimeout, watchdog } = setup();
        watchdog.ping();
        socket.open = false;
        time.sleep(DELAY + LATE_TIMER_TOLERANCE_MS + 1);
        time.fireOverdue();
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("grants the late-timer window once per ping, so a throttled tab can't postpone forever", () => {
        const { time, onTimeout, watchdog } = setup();
        watchdog.ping();
        time.sleep(DELAY + 60_000);
        time.fireOverdue();
        expect(onTimeout).not.toHaveBeenCalled();
        time.sleep(DELAY + 60_000);
        time.fireOverdue();
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("stops for good", () => {
        const { time, page, onTimeout, onResume, watchdog } = setup();
        watchdog.ping();
        watchdog.stop();
        expect(time.armed).toBe(false);
        time.advance(DELAY * 2);
        page.setHidden(true);
        page.setHidden(false);
        expect(onTimeout).not.toHaveBeenCalled();
        expect(onResume).not.toHaveBeenCalled();
    });

    it("reports how long the page has been away", () => {
        const { time, page, watchdog } = setup();
        expect(watchdog.hiddenForMs).toBe(0);
        page.setHidden(true);
        time.sleep(12_000);
        expect(watchdog.hiddenForMs).toBe(12_000);
    });
});
