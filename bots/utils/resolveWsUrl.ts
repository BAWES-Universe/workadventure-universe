/**
 * Resolves the WebSocket endpoint handed to the bot clients.
 *
 * WS_URL accepts absolute and root-relative values (the environment schema used by the app also
 * accepts "/"), and a bot has no page origin to resolve a relative value against, so relative values
 * are resolved against the pusher URL — mirroring how the front resolves them against window.location.
 * An unset or empty WS_URL (docker compose passes an empty string when the operator does not set it)
 * falls back to the pusher URL.
 *
 * The result is always normalized to http(s) so that BotClient can switch it to ws(s) itself.
 */
export function resolveWsUrl(wsUrl: string | undefined, pusherUrl: string): string {
    const absolutePusherUrl = pusherUrl.replace('ws://', 'http://').replace('wss://', 'https://');

    if (!wsUrl) {
        return absolutePusherUrl;
    }

    return new URL(wsUrl, absolutePusherUrl).toString().replace('ws://', 'http://').replace('wss://', 'https://');
}
