import { botApiService } from "../../../external-modules/bots/services/BotApiService";

/**
 * "Reconnect" for an app whose sign-in ended: the app's own sign-in page opens in a window, the way a bot's app signs in,
 * and one return fills the app again for everyone who uses it. Resolves "done" when the app told us it signed in again,
 * "stopped" when the window was closed or the sign-in failed, and "blocked" when the window could not open or the sign-in
 * did not start. Call it straight from the tap: the window is opened first so the browser does not block it.
 */
export type ReconnectResult = "done" | "stopped" | "blocked";

/**
 * A window name of its own for each sign-in. One shared name would hand two overlapping sign-ins the same window (the second
 * would navigate the first's), and each would then take the other's return as its own.
 */
export function newPopupName(): string {
    const random =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `oauth-popup-${random}`;
}

export function reconnectApp(appId: string): Promise<ReconnectResult> {
    return signInInPopup(appId);
}

/** What a sign-in window may be given besides the app. */
export interface SignInOptions {
    /**
     * Ends this sign-in from outside (the sheet that started it was closed): the window is closed, nothing is listened to, and it
     * answers "stopped". A sign-in that already finished is not changed by it.
     */
    signal?: AbortSignal;
    /**
     * Asked once the app's id is known, with the window already open: true when the app needs no sign-in (it is connected as it is). The window is
     * then closed at once and the answer is "done", with no sign-in started. Orbit does not say how an app signs in before it is
     * made, and a window can only be opened straight from the tap, so this is the earliest it can be told.
     */
    alreadyConnected?: (appId: string) => Promise<boolean>;
}

/**
 * The same window for connecting an app for the first time (a Brick's card in a chat): the connection may still be being
 * made when the tap happens, so the window opens first and the app's id may be a promise, or a function that makes the
 * connection once the window is open (so a window the browser blocks never leaves a connection behind). A connection that
 * cannot be made is "blocked", like a sign-in that did not start.
 */
export async function signInInPopup(
    appId: string | Promise<string> | (() => Promise<string>),
    options: SignInOptions = {}
): Promise<ReconnectResult> {
    const { signal } = options;
    const popup = window.open("", newPopupName(), "width=600,height=700");
    if (!popup) return "blocked";
    // Cancellation is listened to from the first moment: while the app's connection, its "already connected" question or the sign-in
    // request is out, closing the sheet closes the window and ends this at once, without waiting for any of them
    let stopListening: () => void = () => undefined;
    const cancelled = new Promise<"cancelled">((resolve) => {
        if (signal?.aborted) {
            resolve("cancelled");
            return;
        }
        const onCancel = () => resolve("cancelled");
        signal?.addEventListener("abort", onCancel, { once: true });
        stopListening = () => signal?.removeEventListener("abort", onCancel);
    });
    // What is needed before the window can go to the app's sign-in page: its address, or the end of this when none is needed. A late
    // completion (after the sheet was closed) goes no further: it starts nothing once the signal says so
    const setup = async (): Promise<ReconnectResult | { url: string }> => {
        try {
            const id = await (typeof appId === "function" ? appId() : appId);
            if (signal?.aborted) {
                closeQuietly(popup);
                return "stopped";
            }
            if (options.alreadyConnected) {
                const connected = await options.alreadyConnected(id).catch(() => false);
                if (signal?.aborted) {
                    closeQuietly(popup);
                    return "stopped";
                }
                if (connected) {
                    closeQuietly(popup);
                    return "done";
                }
            }
            return {
                url: await botApiService.startAppSignIn(
                    id,
                    window.location.href.split("?")[0].split("#")[0],
                    `${window.location.origin}/api/oauth/mcp-callback`
                ),
            };
        } catch (error) {
            console.warn("Could not start the sign-in", error);
            closeQuietly(popup);
            return "blocked";
        }
    };
    const prepared = await Promise.race([setup(), cancelled]);
    stopListening();
    if (prepared === "cancelled") {
        closeQuietly(popup);
        return "stopped";
    }
    if (typeof prepared === "string") return prepared;
    const authorizeUrl = prepared.url;
    if (signal?.aborted) {
        closeQuietly(popup);
        return "stopped";
    }
    // The window was closed by hand while the request was on its way: nothing is left to sign in to
    try {
        if (popup.closed) return "stopped";
        popup.location.href = authorizeUrl;
    } catch (error) {
        console.warn("Could not open the sign-in window", error);
        return "blocked";
    }
    return await new Promise<ReconnectResult>((resolve) => {
        const finish = (result: ReconnectResult) => {
            window.removeEventListener("message", onMessage);
            window.removeEventListener("focus", onFocus);
            window.clearInterval(watch);
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
        };
        // The sheet that started this was closed: nobody is left to finish it, so the window goes and nothing stays listening
        const onAbort = () => {
            closeQuietly(popup);
            finish("stopped");
        };
        // GitHub (game #2041): the sign-in is being finished, or already is and the window went on to pick where it works
        let finishing = false;
        let signedIn = false;
        const onMessage = (event: MessageEvent) => {
            // Only this sign-in's own window, on the game's own origin: another sign-in's return is not this one's
            if (event.origin !== window.location.origin || event.source !== popup) return;
            const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
            if (data?.type === "oauth-success") finish("done");
            else if (data?.type === "oauth-failure") finish(signedIn ? "done" : "stopped");
            else if (data?.type === "oauth-github" && typeof data.state === "string" && typeof data.code === "string") {
                if (finishing) return;
                finishing = true;
                void finishGitHub(popup, data.state, data.code).then((result) => {
                    finishing = false;
                    if (result === "install") signedIn = true;
                    else finish(result);
                });
            }
        };
        // The window closed by hand before it finished: noticed when this window gets focus back. Not while a GitHub sign-in is
        // being finished (its own answer decides), and "done" once it is signed in, even if they skip picking where it works.
        const onFocus = () => {
            if (finishing) return;
            try {
                if (popup.closed) finish(signedIn ? "done" : "stopped");
            } catch {
                // the window is on another site while it signs in
            }
        };
        window.addEventListener("message", onMessage);
        window.addEventListener("focus", onFocus);
        signal?.addEventListener("abort", onAbort);
        // A window closed without this one getting focus back is noticed here, so the page never waits on a closed window
        const watch = window.setInterval(onFocus, 1000);
    });
}

/**
 * GitHub's sign-in came back to the window (game #2041): it is finished here, with the person's own sign-in, so only the person who
 * started it can finish it (a sign-in address someone else made never lands their GitHub on this person's account, or this person's
 * on theirs). When Universe's GitHub App is not added anywhere of theirs yet, the same window goes on to pick where it works, and
 * that page's own return says "done".
 */
async function finishGitHub(popup: Window, state: string, code: string): Promise<ReconnectResult | "install"> {
    let installUrl: string | null = null;
    try {
        installUrl = (await botApiService.finishGitHubSignIn(state, code)).installUrl;
    } catch (error) {
        console.warn("Could not finish the GitHub sign-in", error);
        closeQuietly(popup);
        return "stopped";
    }
    if (installUrl) {
        try {
            popup.location.href = installUrl;
            return "install";
        } catch {
            // the window was closed meanwhile: signed in all the same
        }
    }
    closeQuietly(popup);
    return "done";
}

function closeQuietly(popup: Window): void {
    try {
        popup.close();
    } catch {
        // already closed
    }
}
