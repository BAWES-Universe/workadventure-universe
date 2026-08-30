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
    if (!value || typeof value !== "object") {
        return false;
    }

    const message = value as Partial<OrbitAuthReadyMessage>;
    return (
        message.type === "orbit-auth-ready-v2" &&
        message.version === ORBIT_AUTH_VERSION &&
        typeof message.nonce === "string" &&
        message.nonce.length >= 16 &&
        message.nonce.length <= 128
    );
}

export function buildAdminLoginUrl(adminUrl: string, roomId: string): string {
    const loginUrl = new URL("/admin/login", adminUrl);
    loginUrl.searchParams.set("playUri", roomId);
    return loginUrl.toString();
}
