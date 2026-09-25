/**
 * Decides when the game connection is dead because the server stopped pinging.
 *
 * The server pings every 80 s; with no ping for a while, the connection is closed and the game reconnects. A phone
 * freezes a page in the background (another app, the lock screen): no timer runs and no message is read. When the
 * page wakes, the overdue timer can fire before the pings waiting on the socket are read, and a healthy connection
 * was closed, which is the disconnect/reconnect you see after switching apps. So a timer that fires late (the page
 * was asleep) and a page coming back to the foreground both give the server a fresh window to ping, once, before
 * the connection is called dead. A connection that really died still closes, one window later at most.
 */

/** A timer that fires this much later than asked was held up by a frozen or throttled page. */
export const LATE_TIMER_TOLERANCE_MS = 5_000;

export interface WatchdogClock {
    now(): number;
    setTimeout(handler: () => void, timeout: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface VisibilitySource {
    readonly hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PingWatchdogOptions {
    /** How long without a ping before the connection is called dead. */
    delay: number;
    /** Called once when the connection is called dead. */
    onTimeout: () => void;
    /** Whether the connection is still open: a fresh window only makes sense for one. */
    isOpen: () => boolean;
    /** Called when the page comes back to the foreground, with how long it was away. */
    onResume?: (hiddenMs: number) => void;
    clock?: WatchdogClock;
    visibility?: VisibilitySource;
}

const defaultClock: WatchdogClock = {
    now: () => Date.now(),
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class PingWatchdog {
    private readonly clock: WatchdogClock;
    private readonly visibility: VisibilitySource | undefined;
    private handle: unknown;
    private armedAt = 0;
    private running = false;
    /** A fresh window was already given since the last ping: the next timeout is final. */
    private graceUsed = false;
    private hiddenAt: number | undefined;

    constructor(private readonly options: PingWatchdogOptions) {
        this.clock = options.clock ?? defaultClock;
        this.visibility = options.visibility ?? (typeof document !== "undefined" ? document : undefined);
        this.hiddenAt = this.visibility?.hidden ? this.clock.now() : undefined;
        this.visibility?.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    /** A ping arrived (or the socket just opened): a full window again. */
    public ping(): void {
        this.running = true;
        this.graceUsed = false;
        this.arm();
    }

    /** Stops watching for good. */
    public stop(): void {
        this.running = false;
        this.disarm();
        this.visibility?.removeEventListener("visibilitychange", this.onVisibilityChange);
    }

    /** How long the page has been in the background, 0 when it is in front. */
    public get hiddenForMs(): number {
        return this.hiddenAt === undefined ? 0 : this.clock.now() - this.hiddenAt;
    }

    private arm(): void {
        this.disarm();
        this.armedAt = this.clock.now();
        this.handle = this.clock.setTimeout(this.fire, this.options.delay);
    }

    private disarm(): void {
        if (this.handle !== undefined) {
            this.clock.clearTimeout(this.handle);
            this.handle = undefined;
        }
    }

    private readonly fire = (): void => {
        this.handle = undefined;
        if (!this.running) return;
        const late = this.clock.now() - this.armedAt - this.options.delay > LATE_TIMER_TOLERANCE_MS;
        if (late && !this.graceUsed && this.options.isOpen()) {
            // The page was asleep: the pings may be waiting on the socket. Let the server show it's still there.
            this.graceUsed = true;
            this.arm();
            return;
        }
        this.running = false;
        this.options.onTimeout();
    };

    private readonly onVisibilityChange = (): void => {
        if (this.visibility?.hidden) {
            this.hiddenAt ??= this.clock.now();
            return;
        }
        const hiddenMs = this.hiddenAt === undefined ? 0 : this.clock.now() - this.hiddenAt;
        this.hiddenAt = undefined;
        this.options.onResume?.(hiddenMs);
        if (this.running && !this.graceUsed && this.options.isOpen()) {
            // Back in front: however long the page slept, the server gets a full window to ping again.
            this.graceUsed = true;
            this.arm();
        }
    };
}
