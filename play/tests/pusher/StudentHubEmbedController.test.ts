import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Request, Response } from "express";

const { verifyJWTToken, createAuthToken, checkTokenAuth, refreshAccessToken } = vi.hoisted(() => ({
    verifyJWTToken: vi.fn(),
    createAuthToken: vi.fn(),
    checkTokenAuth: vi.fn(),
    refreshAccessToken: vi.fn(),
}));

vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: { verifyJWTToken, createAuthToken } }));
vi.mock("../../src/pusher/services/OpenIDClient", () => ({ openIDClient: { checkTokenAuth, refreshAccessToken } }));

import { errors as openIdErrors } from "openid-client";
import {
    STUDENTHUB_ATTESTATION_PATH,
    StudentHubEmbedController,
} from "../../src/pusher/controllers/StudentHubEmbedController";
import { renewedTokenMemo } from "../../src/pusher/services/RenewedTokenMemo";
import { parseStudentHubConfig, type StudentHubConfig } from "../../src/pusher/services/StudentHubAttestation";

type Handler = (req: Request, res: Response) => void;

class FakeApp {
    readonly postRoutes = new Map<string, Handler>();
    post(path: string, handler: Handler) {
        this.postRoutes.set(path, handler);
    }
    options() {}
}

class FakeResponse {
    statusCode = 200;
    body: unknown;
    headers: Record<string, string> = {};
    headersSent = false;
    private resolve!: () => void;
    readonly done = new Promise<void>((resolve) => {
        this.resolve = resolve;
    });
    setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
    }
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        this.headersSent = true;
        this.resolve();
        return this;
    }
}

const CHALLENGE = "c".repeat(43);
const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const { privateKey } = generateKeyPairSync("ed25519");
const ENABLED = parseStudentHubConfig(
    {
        STUDENTHUB_EMBED_ORIGIN: "https://studenthub.bawes.net",
        STUDENTHUB_EMBED_ATTESTATION_ISSUER: "universe-pusher@staging",
        STUDENTHUB_EMBED_ATTESTATION_AUDIENCE: "studenthub-embed/identity@staging",
        STUDENTHUB_EMBED_ATTESTATION_KEY_ID: "pusher-2026-11",
        STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        STUDENTHUB_EMBED_SUBJECT_FORMAT: "user_email",
    },
    true
);

async function callAttest(options: {
    token?: string;
    body?: unknown;
    config?: StudentHubConfig;
}): Promise<FakeResponse> {
    const app = new FakeApp();
    new StudentHubEmbedController(app as unknown as Application, options.config ?? ENABLED, () => NOW);
    const handler = app.postRoutes.get(STUDENTHUB_ATTESTATION_PATH);
    if (!handler) throw new Error("attestation route not registered");
    const res = new FakeResponse();
    handler(
        {
            header: (name: string) => (name.toLowerCase() === "authorization" ? options.token : undefined),
            body: options.body ?? { challenge: CHALLENGE },
        } as unknown as Request,
        res as unknown as Response
    );
    await res.done;
    return res;
}

function claimsOf(attestation: unknown): Record<string, unknown> {
    return JSON.parse(Buffer.from(String(attestation).split(".")[2], "base64url").toString("utf8"));
}

function expiredAccessToken() {
    return new openIdErrors.OPError({ error: "invalid_token" });
}

const MEMBER = { identifier: "player@example.com", accessToken: "access-1", refreshToken: "refresh-1" };

beforeEach(() => {
    vi.resetAllMocks();
    renewedTokenMemo.clear();
});

describe("POST /studenthub/embed/attestation", () => {
    it("attests a signed-in player confirmed by the provider now: provider sub, challenge as jti, iat = the check", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        checkTokenAuth.mockResolvedValue({ sub: "player@example.com", email: "player@example.com" });

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(checkTokenAuth).toHaveBeenCalledWith("access-1");
        const claims = claimsOf((res.body as { attestation: string }).attestation);
        expect(claims).toMatchObject({
            iss: "universe-pusher@staging",
            aud: "studenthub-embed/identity@staging",
            kid: "pusher-2026-11",
            sub: "player@example.com",
            jti: CHALLENGE,
            iat: NOW / 1000,
            exp: NOW / 1000 + 60,
        });
        expect(res.body).not.toHaveProperty("authToken");
    });

    it("uses the provider's verified sub, never the e-mail or the game token's identifier", async () => {
        verifyJWTToken.mockReturnValue({ ...MEMBER, identifier: "player@example.com" });
        checkTokenAuth.mockResolvedValue({ sub: "other-shape@example.org", email: "player@example.com" });

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(200);
        expect(claimsOf((res.body as { attestation: string }).attestation).sub).toBe("other-shape@example.org");
    });

    it("refuses a guest (no provider account), without asking the provider", async () => {
        verifyJWTToken.mockReturnValue({ identifier: "4f0c1d2e-guest" });

        const res = await callAttest({ token: "guest-token" });

        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "guest" });
        expect(checkTokenAuth).not.toHaveBeenCalled();
    });

    it("refuses a stale or invalid game token: a valid old game JWT alone is never enough", async () => {
        verifyJWTToken.mockImplementation(() => {
            throw new Error("jwt expired");
        });

        const res = await callAttest({ token: "old-game-token" });

        expect(res.statusCode).toBe(401);
        expect(checkTokenAuth).not.toHaveBeenCalled();
        expect(res.body).not.toHaveProperty("attestation");
    });

    it("refuses without a game token", async () => {
        const res = await callAttest({});
        expect(res.statusCode).toBe(401);
    });

    it("refuses a revoked provider credential (access token refused and no refresh token)", async () => {
        verifyJWTToken.mockReturnValue({ ...MEMBER, refreshToken: undefined });
        checkTokenAuth.mockRejectedValue(expiredAccessToken());

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "provider_refused" });
        expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it("refuses when the provider refuses the refresh too (account revoked at the provider)", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        checkTokenAuth.mockRejectedValue(expiredAccessToken());
        refreshAccessToken.mockRejectedValue(new openIdErrors.OPError({ error: "invalid_grant" }));

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(403);
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it("renews an expired access token once, checks again now, and hands the game its renewed token", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        checkTokenAuth
            .mockRejectedValueOnce(expiredAccessToken())
            .mockResolvedValue({ sub: "player@example.com", email: "player@example.com" });
        refreshAccessToken.mockResolvedValue({ access_token: "access-2", refresh_token: "refresh-2" });
        createAuthToken.mockReturnValue("renewed-game-token");

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(200);
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(checkTokenAuth).toHaveBeenLastCalledWith("access-2");
        expect(createAuthToken).toHaveBeenCalledWith(
            expect.objectContaining({
                identifier: "player@example.com",
                accessToken: "access-2",
                refreshToken: "refresh-2",
            })
        );
        expect(res.body).toMatchObject({ authToken: "renewed-game-token" });
    });

    it("refuses an identity mismatch: the provider's account is no longer this game token's player", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        checkTokenAuth.mockResolvedValue({ sub: "someone-else@example.com", email: "someone-else@example.com" });

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "identity_mismatch" });
    });

    it("refuses a provider subject outside the pinned format, and signs nothing", async () => {
        verifyJWTToken.mockReturnValue({ ...MEMBER, identifier: "a1b2c3" });
        checkTokenAuth.mockResolvedValue({ sub: "a1b2c3" });

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ error: "subject_format" });
    });

    it("answers 503 when the provider cannot be reached, never an attestation", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        checkTokenAuth.mockRejectedValue(new Error("ECONNREFUSED"));

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(503);
        expect(res.body).not.toHaveProperty("attestation");
    });

    it("answers 503, not a refusal, when the provider itself fails (5xx)", async () => {
        verifyJWTToken.mockReturnValue(MEMBER);
        const failure = new openIdErrors.OPError({ error: "server_error" });
        Object.defineProperty(failure, "response", { value: { statusCode: 502 } });
        checkTokenAuth.mockRejectedValue(failure);

        const res = await callAttest({ token: "game-token" });

        expect(res.statusCode).toBe(503);
        expect(res.body).not.toHaveProperty("attestation");
    });

    it.each([
        ["no challenge", {}],
        ["a short challenge", { challenge: "abc" }],
        ["a challenge with other characters", { challenge: `${"c".repeat(42)}=` }],
        ["an extra field", { challenge: CHALLENGE, subject: "someone@example.com" }],
    ])("refuses %s", async (_name, body) => {
        verifyJWTToken.mockReturnValue(MEMBER);

        const res = await callAttest({ token: "game-token", body });

        expect(res.statusCode).toBe(400);
        expect(checkTokenAuth).not.toHaveBeenCalled();
    });

    it("answers 404 while the embed is off", async () => {
        const res = await callAttest({
            token: "game-token",
            config: { url: undefined, embedOrigin: undefined, signer: undefined },
        });

        expect(res.statusCode).toBe(404);
        expect(verifyJWTToken).not.toHaveBeenCalled();
    });
});
