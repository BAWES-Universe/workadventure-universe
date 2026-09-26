export const ORBIT_AUTH_VERSION = 2 as const;

export interface OrbitAuthReadyMessage {
    type: "orbit-auth-ready-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
}

export interface OrbitAuthTokenMessage {
    type: "orbit-auth-token-v2";
    version: typeof ORBIT_AUTH_VERSION;
    nonce: string;
    accessToken: string;
}

export function isOrbitAuthReadyMessage(value: unknown): value is OrbitAuthReadyMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<OrbitAuthReadyMessage>;
    return (
        message.type === "orbit-auth-ready-v2" &&
        message.version === ORBIT_AUTH_VERSION &&
        typeof message.nonce === "string" &&
        message.nonce.length >= 16 &&
        message.nonce.length <= 128
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
    roomRevision?: string
): string {
    const loginUrl = new URL("/admin/login", resolveCredentialUrl(adminUrl, baseUrl));
    loginUrl.searchParams.set("playUri", roomId);
    // The Orbit page to land on after signing in (Orbit only follows its own /admin paths).
    if (redirect) loginUrl.searchParams.set("redirect", redirect);
    // This visit (see orbitBridge.ts): Orbit reopens on the page it last showed during the same visit.
    if (roomRevision) loginUrl.searchParams.set("rev", roomRevision);
    return loginUrl.toString();
}
