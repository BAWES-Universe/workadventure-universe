import { botApiService } from "../../../external-modules/bots/services/BotApiService";

/**
 * "Reconnect" for an app whose sign-in ended: the app's own sign-in page opens in a window, the way a bot's app signs in,
 * and one return fills the app again for everyone who uses it. Resolves "done" when the app told us it signed in again,
 * "stopped" when the window was closed or the sign-in failed, and "blocked" when the window could not open or the sign-in
 * did not start. Call it straight from the tap: the window is opened first so the browser does not block it.
 */
export type ReconnectResult = "done" | "stopped" | "blocked";

export async function reconnectApp(appId: string): Promise<ReconnectResult> {
    const popup = window.open("", "oauth-popup", "width=600,height=700");
    if (!popup) return "blocked";
    let authorizeUrl: string;
    try {
        authorizeUrl = await botApiService.startAppSignIn(
            appId,
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
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const type = (event.data as { type?: unknown } | null)?.type;
            if (type === "oauth-success") finish("done");
            else if (type === "oauth-failure") finish("stopped");
        };
        // The window closed by hand before it finished: noticed when this window gets focus back
        const onFocus = () => {
            try {
                if (popup.closed) finish("stopped");
            } catch {
                // the window is on another site while it signs in
            }
        };
        window.addEventListener("message", onMessage);
        window.addEventListener("focus", onFocus);
    });
}
