import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Request, Response } from "express";

const { verifyJWTToken, createAuthToken, checkTokenAuth, refreshAccessToken, fetchMemberDataByUuid } = vi.hoisted(
    () => ({
        verifyJWTToken: vi.fn(),
        createAuthToken: vi.fn(),
        checkTokenAuth: vi.fn(),
        refreshAccessToken: vi.fn(),
        fetchMemberDataByUuid: vi.fn(),
    })
);

vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: { verifyJWTToken, createAuthToken } }));
vi.mock("../../src/pusher/services/OpenIDClient", () => ({ openIDClient: { checkTokenAuth, refreshAccessToken } }));
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: { getCapabilities: () => Promise.resolve({}), fetchMemberDataByUuid },
}));
vi.mock("../../src/pusher/services/verifyDomain/VerifyDomainService", () => ({
    VerifyDomainService: { get: () => ({ verifyDomain: vi.fn() }) },
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
    body: unknown;
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    send(body: unknown) {
        this.body = body;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        return this;
    }
}

const playUri = "http://play.workadventure.localhost/_/global/maps.workadventure.localhost/map.json";

async function callMe(query: Record<string, string>) {
    const app = new FakeApp();
    new AuthenticateController(app as unknown as Application);
    const handler = app.getRoutes.get("/me");
    if (!handler) throw new Error("/me route not registered");
    const res = new FakeResponse();
    await handler(
        { query, originalUrl: "/me", method: "GET", header: () => undefined } as unknown as Request,
        res as unknown as Response
    );
    return res;
}

describe("GET /me with refresh", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "old-access", refreshToken: "refresh" });
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "u",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        checkTokenAuth.mockResolvedValue({});
        createAuthToken.mockReturnValue("renewed-game-token");
    });

    it("answers with the same token while the provider accepts it", async () => {
        const res = await callMe({ token: "game-token", playUri });
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(res.body).toEqual(expect.objectContaining({ authToken: "game-token" }));
    });

    it("renews an access token the provider still accepts when asked to", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        const res = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledWith("refresh");
        expect(createAuthToken).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: "new-access", refreshToken: "new-refresh" })
        );
        expect(res.body).toEqual(expect.objectContaining({ authToken: "renewed-game-token" }));
    });

    it("falls back to the token it has when the asked-for renewal fails", async () => {
        refreshAccessToken.mockRejectedValue(new Error("provider down"));
        const res = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual(expect.objectContaining({ authToken: "game-token" }));
    });
});
