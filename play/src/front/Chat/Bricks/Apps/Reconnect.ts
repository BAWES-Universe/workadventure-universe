import { botApiService } from "../../../external-modules/bots/services/BotApiService";

/**
 * "Reconnect" for an app whose sign-in ended: the app's own sign-in page opens in a window, the way a bot's app signs in,
 * and one return fills the app again for everyone who uses it. Resolves "done" when the app told us it signed in again,
 * "stopped" when the window was closed or the sign-in failed, and "blocked" when the window could not open or the sign-in
 * did not start. Call it straight from the tap: the window is opened first so the browser does not block it.
 */
export type ReconnectResult = "done" | "stopped" | "blocked";

export function reconnectApp(appId: string): Promise<ReconnectResult> {
    return signInInPopup(appId);
}

/**
 * The same window for connecting an app for the first time (a Brick's card in a chat): the connection may still be being
 * made when the tap happens, so the window opens first and the app's id may be a promise. A connection that cannot be made
 * is "blocked", like a sign-in that did not start.
 */
export async function signInInPopup(appId: string | Promise<string>): Promise<ReconnectResult> {
    const popup = window.open("", "oauth-popup", "width=600,height=700");
    if (!popup) return "blocked";
    let authorizeUrl: string;
    try {
        authorizeUrl = await botApiService.startAppSignIn(
            await appId,
            window.location.href.split("?")[0].split("#")[0],
            `${window.location.origin}/api/oauth/mcp-callback`
        );
    } catch (error) {
        console.warn("Could not start the sign-in", error);
        try {
            popup.close();
        } catch {
            // already closed
        }
        return "blocked";
    }
    // eslint-disable-next-line require-atomic-updates
    popup.location.href = authorizeUrl;
    return await new Promise<ReconnectResult>((resolve) => {
        const finish = (result: ReconnectResult) => {
            window.removeEventListener("message", onMessage);
            window.removeEventListener("focus", onFocus);
            resolve(result);
        };
        // GitHub (game #2041): the sign-in is being finished, or already is and the window went on to pick where it works
        let finishing = false;
        let signedIn = false;
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
            if (data?.type === "oauth-success") finish("done");
            else if (data?.type === "oauth-failure") finish("stopped");
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
