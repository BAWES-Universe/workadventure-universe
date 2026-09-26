/**
 * Gives up on a connection attempt that neither joins nor fails (the caller only drops one whose socket never opened).
 *
 * A socket to the server resolves the attempt when the room is joined, and rejects it on an error or a close. On a
 * phone coming back from another app, a new socket can instead hang (never opened, never failed) for minutes: the
 * app then waits on it forever behind the "Reconnecting" screen, and the retries never start. This drops such an
 * attempt after a time limit, and at once when the page comes back to the foreground with one pending for a while
 * (made while the phone was putting the page away, it is the likeliest to hang), so the usual retry takes over.
 */

/** Longer than a join takes on a slow network: an attempt still pending then is hanging. */
export const CONNECT_ATTEMPT_TIMEOUT_MS = 15_000;
/** Back in the foreground with an attempt pending at least this long: start again rather than wait on it. */
export const RESUME_STALE_ATTEMPT_MS = 5_000;

export type GiveUpReason = "timeout" | "resume";

export interface ConnectAttemptWatchEnv {
    now(): number;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
    document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
}

const defaultEnv = (): ConnectAttemptWatchEnv => ({
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    document,
});

/**
 * Starts watching an attempt. `giveUp` is called at most once, with why and how long the attempt was pending.
 * Returns the function to call when the attempt settles (joined or failed): the watch stops.
 */
export function watchConnectAttempt(
    giveUp: (reason: GiveUpReason, pendingMs: number) => void,
    env: ConnectAttemptWatchEnv = defaultEnv()
): () => void {
    const startedAt = env.now();
    let done = false;

    const stop = () => {
        if (done) return;
        done = true;
        env.clearTimeout(timer);
        env.document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const end = (reason: GiveUpReason) => {
        if (done) return;
        stop();
        giveUp(reason, env.now() - startedAt);
    };
    const onVisibilityChange = () => {
        if (env.document.visibilityState !== "visible") return;
        if (env.now() - startedAt >= RESUME_STALE_ATTEMPT_MS) end("resume");
    };

    const timer = env.setTimeout(() => end("timeout"), CONNECT_ATTEMPT_TIMEOUT_MS);
    env.document.addEventListener("visibilitychange", onVisibilityChange);
    return stop;
}
