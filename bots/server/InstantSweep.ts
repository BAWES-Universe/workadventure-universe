/**
 * Orbit's Instant sweep, asked for now and then like the computer sweep: Instant runs that lost their answer are settled (and given back
 * when they failed), app link sessions are read back so none allows Instant, trusted prices are checked and the failure-rate pause is
 * checked. Orbit does the work and is safe to ask twice; nothing here depends on exactly when it runs, and a failure blocks nothing.
 */

/** Once a minute, like the computer sweep: a run that lost its answer is settled within minutes, and Orbit keeps its own slower clock for the price check. */
export const INSTANT_SWEEP_EVERY_MS = 60 * 1000;

export interface InstantSweepAsker {
    sweepInstant(): Promise<void>;
}

/**
 * Asks on a timer. A pass that is still running is never joined by another (a slow Orbit answer cannot pile up requests), and a pass that
 * throws is swallowed so the timer keeps going. Returns the stop function.
 */
export function startInstantSweep(admin: InstantSweepAsker, everyMs: number = INSTANT_SWEEP_EVERY_MS): () => void {
    let running = false;
    const timer = setInterval(() => {
        if (running) return;
        running = true;
        void Promise.resolve()
            .then(() => admin.sweepInstant())
            .catch(() => undefined)
            .finally(() => {
                running = false;
            });
    }, everyMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
