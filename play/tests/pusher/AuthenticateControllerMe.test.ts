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

import { errors as openIdErrors } from "openid-client";
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

describe("GET /me and the chat ID", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access" });
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "u",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        checkTokenAuth.mockResolvedValue({});
    });

    it("does not pass the chat ID the browser claims on to Orbit", async () => {
        await callMe({ token: "game-token", playUri, chatID: "@someone-else:matrix.test" });
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(1);
        expect(fetchMemberDataByUuid.mock.calls[0]).not.toContain("@someone-else:matrix.test");
        expect(fetchMemberDataByUuid.mock.calls[0][8]).toBeUndefined();
    });
});

describe("GET /me and a guest's saved name", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "u",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        checkTokenAuth.mockResolvedValue({});
    });

    it("passes the name a guest saved on to Orbit", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u" });
        await callMe({ token: "game-token", playUri, name: "  Nova  " });
        expect(fetchMemberDataByUuid.mock.calls[0][9]).toBe("Nova");
    });

    it("sends no name when the browser has none saved", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u" });
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid.mock.calls[0][9]).toBeUndefined();
    });

    it("does not pass a name for someone signed in", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "u", accessToken: "access" });
        await callMe({ token: "game-token", playUri, name: "Nova" });
        expect(fetchMemberDataByUuid.mock.calls[0][9]).toBeUndefined();
    });
});

describe("GET /me for a member whose access token ran out (Orbit #306)", () => {
    const membersOnly = {
        status: "error",
        type: "error",
        title: "Members only",
        subtitle: "This place is only open to its members",
        code: "MEMBERS_ONLY",
        details: "Ask one of its admins to invite you, then come back.",
    };

    beforeEach(() => {
        vi.resetAllMocks();
        verifyJWTToken.mockReturnValue({ identifier: "owner", accessToken: "expired-access", refreshToken: "refresh" });
        // Orbit can't verify an expired access token, so it treats the owner as a stranger.
        fetchMemberDataByUuid.mockImplementation((_id: string, accessToken: string | undefined) =>
            Promise.resolve(
                accessToken === "new-access"
                    ? { status: "ok", userUuid: "owner", isCharacterTexturesValid: true, isCompanionTextureValid: true }
                    : membersOnly
            )
        );
        checkTokenAuth.mockImplementation((accessToken: string) =>
            accessToken === "new-access"
                ? Promise.resolve({})
                : Promise.reject(new openIdErrors.OPError({ error: "invalid_token" }))
        );
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        createAuthToken.mockReturnValue("renewed-game-token");
    });

    it("renews the token and lets the owner into their members-only room", async () => {
        const res = await callMe({ token: "game-token", playUri });
        expect(refreshAccessToken).toHaveBeenCalledWith("refresh");
        expect(res.body).toEqual(expect.objectContaining({ status: "ok", authToken: "renewed-game-token" }));
    });

    it("keeps refusing a stranger whose token the provider still accepts, without renewing it", async () => {
        checkTokenAuth.mockResolvedValue({});
        const res = await callMe({ token: "game-token", playUri });
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(res.body).toEqual(membersOnly);
    });

    it("keeps refusing a guest, who has no token to renew", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "guest" });
        fetchMemberDataByUuid.mockResolvedValue(membersOnly);
        const res = await callMe({ token: "guest-token", playUri });
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(res.body).toEqual(membersOnly);
    });

    it("answers with Orbit's refusal when the token can't be renewed", async () => {
        refreshAccessToken.mockRejectedValue(new Error("provider down"));
        const res = await callMe({ token: "game-token", playUri });
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual(membersOnly);
    });

    it("keeps a stranger out after renewing, and sends the renewed token along with the refusal", async () => {
        fetchMemberDataByUuid.mockResolvedValue(membersOnly);
        const res = await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(2);
        expect(res.body).toEqual({ ...membersOnly, authToken: "renewed-game-token" });
    });

    it("asks Orbit again with the renewed access token", async () => {
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["expired-access", "new-access"]);
    });

    it("lets the same owner into a public room (control: Orbit answers ok to a guest)", async () => {
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        const res = await callMe({ token: "game-token", playUri });
        expect(refreshAccessToken).toHaveBeenCalledWith("refresh");
        expect(res.body).toEqual(expect.objectContaining({ status: "ok", authToken: "renewed-game-token" }));
    });
});
