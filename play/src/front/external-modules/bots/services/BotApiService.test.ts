import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService, isOrbitSessionResponse } from "./BotApiService";

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
