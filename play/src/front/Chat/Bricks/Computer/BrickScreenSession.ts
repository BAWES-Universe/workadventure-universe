import type { RfbConnection, RfbConstructor } from "./novnc";

/**
 * One Brick's screen connection, kept apart from the page so it can be tested. It asks for a ticket for what the person may do now
 * (watch, or input after they took over), opens the screen with it, and when the connection ends it asks again with the ticket that now
 * fits: nothing is cached, because a ticket is worth a minute and the server decides each time. A try that did not go through is asked
 * again after a wait that doubles, a few times, and then every so often for as long as the screen is wanted (the computer may be waking, or the
 * connection down for a while): it is never left stuck on the waiting picture.
 *
 * A tab that is hidden shows nothing and costs the bot server a socket and the computer a stream for no one: the connection is closed the
 * moment the tab is hidden, nothing is asked or retried while it stays hidden, and a new ticket and connection are made when it is seen again
 * (build handoff v2, section 4: "Hidden tabs disconnect"). What the screen is wanted to show is kept meanwhile.
 */

export type ScreenMode = "watch" | "input";

/** Whether the page is out of sight, and a way to hear when that changes (it returns what ends the listening). */
export interface Visibility {
    hidden(): boolean;
    onChange(listener: () => void): () => void;
}

/** The page's own visibility: a tab that is switched away from, or a window that is minimised, is hidden. */
export function documentVisibility(doc: Document): Visibility {
    return {
        hidden: () => doc.visibilityState === "hidden",
        onChange(listener) {
            doc.addEventListener("visibilitychange", listener);
            return () => doc.removeEventListener("visibilitychange", listener);
        },
    };
}

export interface ScreenSessionDeps {
    ticket(mode: ScreenMode): Promise<{ ticket: string } | undefined | "failed">;
    socketUrl(ticket: string): string | null;
    load(): Promise<RfbConstructor>;
    /** Without it the page is taken to be always seen. */
    visibility?: Visibility;
    /** For tests. */
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface ScreenSession {
    /** What the screen should be showing now: nothing (""), watching, or the person at the keyboard. Changing it reconnects. */
    want(mode: ScreenMode | ""): void;
    destroy(): void;
}

export const SCREEN_RETRY_MS = 1000;
export const SCREEN_RETRIES = 6;
/** After the quick tries, how long between slower ones. */
export const SCREEN_SLOW_RETRY_MS = 30_000;

export function createScreenSession(
    deps: ScreenSessionDeps,
    target: HTMLElement,
    onLive: (live: boolean) => void
): ScreenSession {
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let generation = 0;
    let failures = 0;
    let retry: unknown;
    let connection: RfbConnection | undefined;
    let wanted: ScreenMode | "" = "";
    let hidden = deps.visibility?.hidden() ?? false;
    // The tab going out of sight closes the screen; coming back asks for it again with a ticket that fits now
    const stopListening = deps.visibility?.onChange(() => {
        const now = deps.visibility?.hidden() ?? false;
        if (now === hidden) return;
        hidden = now;
        if (hidden) {
            stop();
        } else if (wanted) {
            stop();
            failures = 0;
            void start(wanted);
        }
    });

    function stop() {
        generation += 1;
        if (retry !== undefined) clearTimer(retry);
        retry = undefined;
        const old = connection;
        connection = undefined;
        onLive(false);
        try {
            old?.disconnect();
        } catch {
            // already gone
        }
    }

    function again(mine: number) {
        if (mine !== generation) return;
        const wait = failures >= SCREEN_RETRIES ? SCREEN_SLOW_RETRY_MS : SCREEN_RETRY_MS * 2 ** failures;
        if (failures < SCREEN_RETRIES) failures += 1;
        retry = setTimer(() => {
            if (mine === generation) void start(wanted as ScreenMode);
        }, wait);
    }

    async function start(mode: ScreenMode) {
        const mine = ++generation;
        try {
            const answer = await deps.ticket(mode);
            if (mine !== generation) return;
            const url = answer && answer !== "failed" ? deps.socketUrl(answer.ticket) : null;
            if (!url) return again(mine);
            const Rfb = await deps.load();
            if (mine !== generation) return;
            const next = new Rfb(target, url, { wsProtocols: ["binary"] });
            next.scaleViewport = true;
            next.resizeSession = false;
            // Watching only looks; the keyboard and mouse are the person's after they take over
            next.viewOnly = mode === "watch";
            next.focusOnClick = mode === "input";
            next.background = "transparent";
            const onConnect = () => {
                if (mine !== generation) return;
                failures = 0;
                onLive(true);
            };
            const onDisconnect = () => {
                next.removeEventListener("connect", onConnect);
                next.removeEventListener("disconnect", onDisconnect);
                if (mine !== generation) return;
                connection = undefined;
                onLive(false);
                again(mine);
            };
            next.addEventListener("connect", onConnect);
            next.addEventListener("disconnect", onDisconnect);
            connection = next;
        } catch (error) {
            console.error(error);
            again(mine);
        }
    }

    return {
        want(mode) {
            if (mode === wanted && (connection || retry !== undefined)) return;
            wanted = mode;
            stop();
            failures = 0;
            if (mode && !hidden) void start(mode);
        },
        destroy() {
            wanted = "";
            stopListening?.();
            stop();
        },
    };
}
