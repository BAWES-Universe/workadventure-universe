export const ORBIT_AUTH_VERSION = 2 as const;

export interface OrbitAuthReadyMessage {
    type: "orbit-auth-ready-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
    /** Orbit was refused with the last token it got: get a fresh one before answering. */
    refresh?: boolean;
}

export interface OrbitAuthTokenMessage {
    type: "orbit-auth-token-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
    accessToken: string;
}

/** The game is still getting a token (renewing it, or waiting for the connection): Orbit keeps waiting. */
export interface OrbitAuthWaitMessage {
    type: "orbit-auth-wait-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
}

/** The game can't get a token: the sign-in was refused, or the play server didn't answer for a long while. */
export interface OrbitAuthFailedMessage {
    type: "orbit-auth-failed-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
}

export function isOrbitAuthReadyMessage(value: unknown): value is OrbitAuthReadyMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<OrbitAuthReadyMessage>;
    return (
        message.type === "orbit-auth-ready-v2" &&
        message.version === ORBIT_AUTH_VERSION &&
        typeof message.nonce === "string" &&
        message.nonce.length >= 16 &&
        message.nonce.length <= 128 &&
        (message.refresh === undefined || typeof message.refresh === "boolean")
    );
}

export function resolveCredentialUrl(value: string, baseUrl?: string): URL {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
        hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
        throw new Error("Orbit credentials require HTTPS outside local development");
    }
    return url;
}

export function buildAdminLoginUrl(
    adminUrl: string,
    roomId: string,
    baseUrl?: string,
    redirect?: string,
    resume?: boolean
): string {
    const loginUrl = new URL("/admin/login", resolveCredentialUrl(adminUrl, baseUrl));
    loginUrl.searchParams.set("playUri", roomId);
    // The Orbit page to land on after signing in (Orbit only follows its own /admin paths).
    if (redirect) loginUrl.searchParams.set("redirect", redirect);
    // Orbit opened again after a reconnect: it lands on the page it was on, kept in its own tab storage.
    if (resume) loginUrl.searchParams.set("resume", "1");
    return loginUrl.toString();
}
