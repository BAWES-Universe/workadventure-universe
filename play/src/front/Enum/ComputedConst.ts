import { PUSHER_URL, WS_URL } from "./EnvironmentVariable";

export const ABSOLUTE_PUSHER_URL = new URL(PUSHER_URL, window.location.toString()).toString();

// Public URL the game WebSocket connects to. It can deliberately point to a different host than the
// pusher (for instance to keep long-lived sockets off a proxy/CDN that closes them); when WS_URL is
// not set it falls back to the pusher URL, so the default behaviour is unchanged.
export const ABSOLUTE_WS_URL = new URL(WS_URL || PUSHER_URL, window.location.toString()).toString();
