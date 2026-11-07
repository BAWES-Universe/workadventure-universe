import { botApiService } from "./BotApiService";

/**
 * Signs a bot's tool server in again through the provider's own window (#1819): the same flow as Connect on the bot's
 * Tools page, for the places that offer Reconnect where the person already is (the chat card, the server's page).
 *   - "done": the provider accepted the sign-in and Orbit has it
 *   - "cancelled": the window was closed, or the provider said no
 *   - "blocked": the browser did not open the window, or Orbit could not start the sign-in
 */
export type ReconnectResult = "done" | "cancelled" | "blocked";

const GIVE_UP_AFTER_MS = 10 * 60 * 1000;

export function reconnectBotServer(botId: string, serverId: string): Promise<ReconnectResult> {
    // Opened at once, before anything is awaited, so the browser still takes it as the person's own tap
    const popup = window.open("", "oauth-popup", "width=600,height=700");
    if (!popup) return Promise.resolve("blocked");

    return new Promise<ReconnectResult>((resolve) => {
        let finished = false;
        const finish = (result: ReconnectResult) => {
            if (finished) return;
            finished = true;
            window.removeEventListener("message", onMessage);
            window.removeEventListener("focus", onFocus);
            clearTimeout(giveUp);
            resolve(result);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === "oauth-success") finish("done");
            else if (event.data?.type === "oauth-failure") finish("cancelled");
        };
        // The window was closed before the sign-in finished. Not polled while it moves between sites: some providers
        // pass through several before they come back.
        const onFocus = () => {
            try {
                if (popup.closed) finish("cancelled");
            } catch {
                // Another site's window can't be read while it is there
            }
        };
        const giveUp = setTimeout(() => finish("cancelled"), GIVE_UP_AFTER_MS);
        window.addEventListener("message", onMessage);
        window.addEventListener("focus", onFocus);

        const redirectUrl = window.location.href.split("?")[0].split("#")[0];
        const callbackUrl = `${window.location.origin}/api/oauth/mcp-callback`;
        botApiService.startOAuth(botId, serverId, redirectUrl, callbackUrl).then(
            (authorizeUrl) => {
                if (finished) return;
                popup.location.href = authorizeUrl;
            },
            () => {
                try {
                    popup.close();
                } catch {
                    // already closed
                }
                finish("blocked");
            }
        );
    });
}
