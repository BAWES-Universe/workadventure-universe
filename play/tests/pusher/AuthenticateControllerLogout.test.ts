import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Request, Response } from "express";

const { verifyJWTToken, logoutUser, verifyDomain } = vi.hoisted(() => ({
    verifyJWTToken: vi.fn(),
    logoutUser: vi.fn(),
    verifyDomain: vi.fn(),
}));

vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: { verifyJWTToken } }));
vi.mock("../../src/pusher/services/OpenIDClient", () => ({ openIDClient: { logoutUser } }));
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: { getCapabilities: () => Promise.resolve({}) },
}));
vi.mock("../../src/pusher/services/verifyDomain/VerifyDomainService", () => ({
    VerifyDomainService: { get: () => ({ verifyDomain }) },
}));
vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    DISABLE_ANONYMOUS: false,
    FRONT_URL: "http://play.workadventure.localhost",
    MATRIX_PUBLIC_URI: undefined,
    PUSHER_URL: "http://play.workadventure.localhost",
}));

import { AuthenticateController } from "../../src/pusher/controllers/AuthenticateController";
import { renewedTokenMemo } from "../../src/pusher/services/RenewedTokenMemo";

type Handler = (req: Request, res: Response) => Promise<void>;

class FakeApp {
    readonly getRoutes = new Map<string, Handler>();
    get(path: string, handler: Handler) {
        this.getRoutes.set(path, handler);
    }
    post() {}
    options() {}
}

class FakeResponse {
    statusCode = 200;
    redirectedTo: string | undefined;
    cookies: Record<string, string> = {};
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    send() {
        return this;
    }
    json() {
        return this;
    }
    redirect(url: string) {
        this.redirectedTo = url;
    }
    cookie(name: string, value: string) {
        this.cookies[name] = value;
    }
}

const playUri = "http://play.workadventure.localhost/_/global/maps.workadventure.localhost/map.json";

async function callLogout(query: Record<string, string>) {
    const app = new FakeApp();
    new AuthenticateController(app as unknown as Application);
    const handler = app.getRoutes.get("/logout");
    if (!handler) throw new Error("/logout route not registered");
    const res = new FakeResponse();
    await handler({ query, originalUrl: "/logout", method: "GET" } as unknown as Request, res as unknown as Response);
    return res;
}

describe("GET /logout", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        verifyDomain.mockResolvedValue(true);
    });

    it("sends a user with an empty token back to the map without touching the OpenID provider", async () => {
        const res = await callLogout({ playUri, token: "" });

        expect(res.redirectedTo).toBe(playUri);
        expect(verifyJWTToken).not.toHaveBeenCalled();
        expect(logoutUser).not.toHaveBeenCalled();
    });

    it("still logs a user with a token out of the OpenID provider", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access", refreshToken: "refresh" });

        const res = await callLogout({ playUri, token: "header.payload.signature" });

        expect(logoutUser).toHaveBeenCalledWith("access");
        expect(logoutUser).toHaveBeenCalledWith("refresh");
        expect(res.redirectedTo).toBe(playUri);
    });

    it("forgets the renewed tokens it remembered for that player, and no one else's", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access", refreshToken: "refresh" });
        const renew = vi.fn().mockResolvedValue({ authToken: "renewed", accessToken: "new-access", checked: {} });
        renewedTokenMemo.clear();
        await renewedTokenMemo.renew("old-game-token", "u", renew);
        await renewedTokenMemo.renew("other-game-token", "someone-else", renew);
        renew.mockClear();

        await callLogout({ playUri, token: "header.payload.signature" });

        await renewedTokenMemo.renew("old-game-token", "u", renew);
        expect(renew).toHaveBeenCalledTimes(1);
        await renewedTokenMemo.renew("other-game-token", "someone-else", renew);
        expect(renew).toHaveBeenCalledTimes(1);
        renewedTokenMemo.clear();
    });

    it("does not keep a renewal that got in while the provider was revoking the tokens", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access", refreshToken: "refresh" });
        const renew = vi.fn().mockResolvedValue({ authToken: "renewed", accessToken: "new-access", checked: {} });
        renewedTokenMemo.clear();
        // A /me renewal of this player lands in the middle of the sign-out.
        logoutUser.mockImplementation(async () => {
            await renewedTokenMemo.renew("old-game-token", "u", renew);
        });

        await callLogout({ playUri, token: "header.payload.signature" });

        renew.mockClear();
        await renewedTokenMemo.renew("old-game-token", "u", renew);
        expect(renew).toHaveBeenCalledTimes(1);
        renewedTokenMemo.clear();
    });

    it("forgets what it remembered even when the provider fails to sign the player out", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access", refreshToken: "refresh" });
        const renew = vi.fn().mockResolvedValue({ authToken: "renewed", accessToken: "new-access", checked: {} });
        renewedTokenMemo.clear();
        logoutUser.mockImplementation(async () => {
            await renewedTokenMemo.renew("old-game-token", "u", renew);
            throw new Error("provider down");
        });

        await expect(callLogout({ playUri, token: "header.payload.signature" })).rejects.toThrow("provider down");

        renew.mockClear();
        await renewedTokenMemo.renew("old-game-token", "u", renew);
        expect(renew).toHaveBeenCalledTimes(1);
        renewedTokenMemo.clear();
    });

    it("ignores `redirect` for an empty token, so it can't be used to bounce people elsewhere", async () => {
        const res = await callLogout({ playUri, token: "", redirect: "https://evil.example/phish" });

        expect(res.redirectedTo).toBe(playUri);
        expect(res.cookies.playUri).toBeUndefined();
        expect(verifyJWTToken).not.toHaveBeenCalled();
    });

    it("keeps the redirect flow for a verified logout", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access" });

        const res = await callLogout({
            playUri,
            token: "header.payload.signature",
            redirect: "http://auth.example.com/logout",
        });

        expect(res.cookies.playUri).toBe(playUri);
        expect(res.redirectedTo).toBe("http://auth.example.com/logout");
    });

    it("still refuses a playUri on an unauthorized domain", async () => {
        verifyDomain.mockResolvedValue(false);

        const res = await callLogout({ playUri, token: "" });

        expect(res.statusCode).toBe(403);
        expect(res.redirectedTo).toBeUndefined();
    });
});
