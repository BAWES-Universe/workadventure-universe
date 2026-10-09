import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService, isOrbitSessionResponse } from "./BotApiService";

const mocks = vi.hoisted(() => ({
    getAuthToken: vi.fn((): string | null => null),
    setAuthToken: vi.fn(),
    pusherGet: vi.fn(),
}));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: mocks.getAuthToken, setAuthToken: mocks.setAuthToken },
}));

vi.mock("../../../Connection/AxiosUtils", () => ({
    axiosToPusher: { get: mocks.pusherGet },
}));

function authToken(accessToken: string): string {
    return `header.${btoa(JSON.stringify({ accessToken }))}.signature`;
}

describe("BotApiService Orbit session contract", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("accepts only the exact opaque v2 response", () => {
        expect(isOrbitSessionResponse({ version: 2, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            true
        );
        expect(
            isOrbitSessionResponse({ version: 2, sessionToken: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })
        ).toBe(false);
        expect(isOrbitSessionResponse({ version: 2, sessionId: "eyJ1c2VySWQiOiJmb3JnZWQifQ==", expiresAt: 123 })).toBe(
            false
        );
        expect(isOrbitSessionResponse({ version: 1, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            false
        );
    });

    it("keeps a valid bot-server target when the Admin target is rejected", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ botsSpawned: 1 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        const service = new BotApiService();

        service.initialize(
            authToken("oidc-token"),
            "http://insecure.example.com",
            "room-1",
            "http://bot-server.workadventure.localhost"
        );

        await expect(service.notifyRoomEnter()).resolves.toEqual({ botsSpawned: 1 });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://bot-server.workadventure.localhost/api/bots/room-enter",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("sends the player's game token so the bot server lets guests open a room", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ botsSpawned: 0 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        const service = new BotApiService();
        const token = authToken("oidc-token");
        service.initialize(token, undefined, "room-1", "http://bot-server.workadventure.localhost");

        await service.notifyRoomEnter();

        expect(fetchMock).toHaveBeenCalledWith(
            "http://bot-server.workadventure.localhost/api/bots/room-enter",
            expect.objectContaining({ headers: expect.objectContaining({ "X-WA-Auth": token }) })
        );
    });

    it("clears a cached Orbit session when the authenticated token changes", () => {
        const service = new BotApiService();
        const firstToken = authToken("first-oidc-token");

        service.initialize(firstToken, "https://admin.example.com", "room-1");
        sessionStorage.setItem("orbit_admin_session_v2", `orb_sess_v2_${"a".repeat(64)}`);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60_000));

        service.initialize(firstToken, "https://admin.example.com", "room-1");
        expect(sessionStorage.getItem("orbit_admin_session_v2")).not.toBeNull();

        service.initialize(authToken("second-oidc-token"), "https://admin.example.com", "room-1");
        expect(sessionStorage.getItem("orbit_admin_session_v2")).toBeNull();
        expect(sessionStorage.getItem("orbit_admin_session_v2_expires")).toBeNull();
    });
});

describe("BotApiService once the OIDC access token has run out", () => {
    const ADMIN = "https://admin.example.com";
    const SESSION = `orb_sess_v2_${"b".repeat(64)}`;
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    function b64u(input: unknown): string {
        return btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    /** An OIDC access token (itself a JWT) that runs out at `exp` (seconds), or never says. */
    function oidcToken(name: string, exp?: number): string {
        return `${b64u({ alg: "none" })}.${b64u(exp === undefined ? { sub: name } : { sub: name, exp })}.sig`;
    }

    function meAnswer(gameToken: string) {
        return {
            data: {
                status: "ok",
                authToken: gameToken,
                userUuid: "user-1",
                isCharacterTexturesValid: true,
                isCompanionTextureValid: true,
            },
        };
    }

    /** Orbit accepts only `accepted` for a session, then lists no bots with it. */
    function orbitAccepting(accepted: string) {
        return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
            if (url === `${ADMIN}/api/auth/session`) {
                return Promise.resolve(
                    authorization === `Bearer ${accepted}`
                        ? new Response(
                              JSON.stringify({ version: 2, sessionId: SESSION, expiresAt: Date.now() + 3600_000 })
                          )
                        : new Response(JSON.stringify({ error: "Invalid or expired access token" }), { status: 401 })
                );
            }
            if (url.startsWith(`${ADMIN}/api/bots`) && authorization === `Bearer ${SESSION}`) {
                return Promise.resolve(new Response("[]"));
            }
            return Promise.resolve(new Response("unexpected", { status: 500 }));
        });
    }

    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
        mocks.getAuthToken.mockReset();
        mocks.setAuthToken.mockReset();
        mocks.pusherGet.mockReset();
    });

    it("renews an expired token through /me before asking Orbit for a session", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        const renewedAccess = oidcToken("new", nowSeconds() + 3600);
        const renewed = authToken(renewedAccess);
        mocks.getAuthToken.mockReturnValue(expired);
        mocks.pusherGet.mockResolvedValue(meAnswer(renewed));
        orbitAccepting(renewedAccess);
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", { params: { token: expired, playUri: "room-1" } });
        expect(mocks.setAuthToken).toHaveBeenCalledWith(renewed);
        expect(sessionStorage.getItem("orbit_admin_session_v2")).toBe(SESSION);
    });

    it("forces a renewal and tries again when Orbit refuses a token that doesn't look expired", async () => {
        const refused = authToken(oidcToken("old"));
        const renewedAccess = oidcToken("new", nowSeconds() + 3600);
        mocks.getAuthToken.mockReturnValue(refused);
        mocks.pusherGet.mockResolvedValue(meAnswer(authToken(renewedAccess)));
        orbitAccepting(renewedAccess);
        const service = new BotApiService();
        service.initialize(refused, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).toHaveBeenCalledTimes(1);
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", {
            params: { token: refused, playUri: "room-1", refresh: "true" },
        });
    });

    it("starts from the game's newest token when Orbit's frame already renewed it", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        const newerAccess = oidcToken("new", nowSeconds() + 3600);
        mocks.getAuthToken.mockReturnValue(authToken(newerAccess));
        orbitAccepting(newerAccess);
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).not.toHaveBeenCalled();
    });

    it("still reports the missing session when the token can't be renewed", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        mocks.getAuthToken.mockReturnValue(expired);
        mocks.pusherGet.mockRejectedValue(new Error("pusher down"));
        orbitAccepting("nothing-matches");
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).rejects.toThrow("Missing Orbit session");
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
    });
});
