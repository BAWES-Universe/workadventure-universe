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

    it("keeps the redirect flow for an empty token", async () => {
        const res = await callLogout({ playUri, token: "", redirect: "http://auth.example.com/logout" });

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
