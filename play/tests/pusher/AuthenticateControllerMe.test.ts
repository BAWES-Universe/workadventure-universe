import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// A renewal is remembered for a minute, by game token: start every test with nothing remembered.
beforeEach(() => {
    renewedTokenMemo.clear();
});

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

    it("checks a token the provider accepts only once", async () => {
        await callMe({ token: "game-token", playUri });
        expect(checkTokenAuth).toHaveBeenCalledTimes(1);
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["old-access"]);
    });

    it("renews an access token the provider still accepts when asked to", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        const res = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledWith("refresh");
        expect(createAuthToken).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: "new-access", refreshToken: "new-refresh" })
        );
        expect(res.body).toEqual(expect.objectContaining({ authToken: "renewed-game-token" }));
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["new-access"]);
    });

    it("falls back to the token it has when the asked-for renewal fails", async () => {
        refreshAccessToken.mockRejectedValue(new Error("provider down"));
        const res = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual(expect.objectContaining({ authToken: "game-token" }));
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["old-access"]);
    });
});

describe("GET /me asked again for a token it already renewed", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
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

    afterEach(() => {
        vi.useRealTimers();
    });

    it("answers a repeat within the time limit with the same renewed token and one provider call", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        const first = await callMe({ token: "game-token", playUri, refresh: "true" });
        const again = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(again.body).toEqual(first.body);
        expect(again.body).toEqual(expect.objectContaining({ authToken: "renewed-game-token" }));
    });

    it("still asks Orbit afresh on a repeat, so what Orbit says about the player is never remembered", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        await callMe({ token: "game-token", playUri, refresh: "true" });
        fetchMemberDataByUuid.mockClear();
        await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(1);
    });

    it("makes one provider call for renewals of the same token that overlap", async () => {
        let finish: (value: { access_token: string; refresh_token: string }) => void = () => {};
        refreshAccessToken.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const first = callMe({ token: "game-token", playUri, refresh: "true" });
        const second = callMe({ token: "game-token", playUri, refresh: "true" });
        // Both reach the provider call before it answers.
        await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalled());
        finish({ access_token: "new-access", refresh_token: "new-refresh" });
        const [a, b] = await Promise.all([first, second]);
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(a.body).toEqual(expect.objectContaining({ authToken: "renewed-game-token" }));
        expect(b.body).toEqual(a.body);
    });

    it("renews again once the remembered answer is more than a minute old", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        await callMe({ token: "game-token", playUri, refresh: "true" });
        vi.setSystemTime(Date.now() + 61_000);
        await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it("does not remember a renewal that failed", async () => {
        refreshAccessToken.mockRejectedValueOnce(new Error("provider down"));
        const failed = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(failed.body).toEqual(expect.objectContaining({ authToken: "game-token" }));
        refreshAccessToken.mockResolvedValueOnce({ access_token: "new-access", refresh_token: "new-refresh" });
        const retried = await callMe({ token: "game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(2);
        expect(retried.body).toEqual(expect.objectContaining({ authToken: "renewed-game-token" }));
    });

    it("does not share a renewal between different game tokens", async () => {
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        await callMe({ token: "game-token", playUri, refresh: "true" });
        await callMe({ token: "another-game-token", playUri, refresh: "true" });
        expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it("does not remember anything for a guest, who has nothing to renew", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "guest" });
        const res = await callMe({ token: "guest-token", playUri });
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(res.body).toEqual(expect.objectContaining({ authToken: "guest-token" }));
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
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ ...membersOnly, authToken: "renewed-game-token" });
    });

    it("doesn't check the access token that ran out again once Orbit knows the owner with the renewed one", async () => {
        await callMe({ token: "game-token", playUri });
        expect(checkTokenAuth.mock.calls.map((call) => call[0])).toEqual(["expired-access", "new-access"]);
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("asks Orbit once, with the renewed access token, never with the one that ran out", async () => {
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["new-access"]);
    });

    it("asks Orbit with the token that ran out when it can't be renewed", async () => {
        refreshAccessToken.mockRejectedValue(new Error("provider down"));
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["expired-access"]);
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

    it("asks Orbit about them in a public room with the renewed token, so the visit is theirs (#1232)", async () => {
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(1);
        expect(fetchMemberDataByUuid.mock.calls[0][1]).toBe("new-access");
    });
});

describe("GET /me says whether the name is the account's (#1192)", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        verifyJWTToken.mockReturnValue({ identifier: "owner", accessToken: "expired-access", refreshToken: "refresh" });
        checkTokenAuth.mockImplementation((accessToken: string) =>
            accessToken === "new-access"
                ? Promise.resolve({})
                : Promise.reject(new openIdErrors.OPError({ error: "invalid_token" }))
        );
        refreshAccessToken.mockResolvedValue({ access_token: "new-access", refresh_token: "new-refresh" });
        createAuthToken.mockReturnValue("renewed-game-token");
    });

    it("answers with the account's name, asked of Orbit with the renewed token", async () => {
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            username: "Khalid",
            tags: ["admin"],
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        const res = await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid.mock.calls.map((call) => call[1])).toEqual(["new-access"]);
        expect(res.body).toEqual(
            expect.objectContaining({
                status: "ok",
                authToken: "renewed-game-token",
                username: "Khalid",
                usernameFromAccount: true,
                tags: ["admin"],
            })
        );
    });

    it("says the name is only the one from sign-in when Orbit has no name for the account", async () => {
        verifyJWTToken.mockReturnValue({
            identifier: "owner",
            accessToken: "expired-access",
            refreshToken: "refresh",
            username: "K",
        });
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        const res = await callMe({ token: "game-token", playUri });
        expect(res.body).toEqual(expect.objectContaining({ username: "K", usernameFromAccount: false }));
    });

    it("answers with the account's name from Orbit over a name the provider's user info carries", async () => {
        checkTokenAuth.mockResolvedValue({ username: "provider-name" });
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            username: "Khalid",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        const res = await callMe({ token: "game-token", playUri });
        expect(res.body).toEqual(expect.objectContaining({ username: "Khalid", usernameFromAccount: true }));
    });

    it("asks Orbit only once when the token is still good", async () => {
        checkTokenAuth.mockResolvedValue({});
        fetchMemberDataByUuid.mockResolvedValue({
            status: "ok",
            userUuid: "owner",
            isCharacterTexturesValid: true,
            isCompanionTextureValid: true,
        });
        await callMe({ token: "game-token", playUri });
        expect(fetchMemberDataByUuid).toHaveBeenCalledTimes(1);
        expect(refreshAccessToken).not.toHaveBeenCalled();
    });
});
