/**
 * Resolves the WebSocket endpoint handed to the bot clients.
 *
 * WS_URL accepts absolute and root-relative values (the environment schema used by the app also
 * accepts "/"), and a bot has no page origin to resolve a relative value against, so relative values
 * are resolved against the pusher URL — mirroring how the front resolves them against window.location.
 * An unset or empty WS_URL (docker compose passes an empty string when the operator does not set it)
 * falls back to the pusher URL.
 *
 * Only http(s) and ws(s) are accepted. The shared validator also passes any absolute URL (for instance
 * `ftp://`), which would otherwise surface as a confusing failure inside the socket client, so an
 * unsupported scheme is rejected here instead. The result is normalized to http(s) so that BotClient
 * can switch it to ws(s) itself.
 */
const SUPPORTED_WS_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

export function resolveWsUrl(wsUrl: string | undefined, pusherUrl: string): string {
    const absolutePusherUrl = pusherUrl.replace('ws://', 'http://').replace('wss://', 'https://');

    if (!wsUrl) {
        return absolutePusherUrl;
    }

    const resolved = new URL(wsUrl, absolutePusherUrl);

    if (!SUPPORTED_WS_PROTOCOLS.includes(resolved.protocol)) {
        throw new Error(
            `Unsupported WS_URL protocol "${resolved.protocol}" — use http:, https:, ws: or wss: (got "${wsUrl}").`
        );
    }

    if (resolved.protocol === 'ws:') {
        resolved.protocol = 'http:';
    } else if (resolved.protocol === 'wss:') {
        resolved.protocol = 'https:';
    }

    return resolved.toString();
}
