import type { Application, Request, Response } from "express";
import { z } from "zod";
import { errors as openIdErrors } from "openid-client";
import type { IntrospectionResponse } from "openid-client";
import { jwtTokenManager, type AuthTokenData } from "../services/JWTTokenManager";
import { openIDClient } from "../services/OpenIDClient";
import { renewedTokenMemo, type RenewedTokens } from "../services/RenewedTokenMemo";
import { describeError } from "../services/SafeErrorLog";
import { CHALLENGE_PATTERN, signStudentHubAttestation, type StudentHubConfig } from "../services/StudentHubAttestation";
import { BaseHttpController } from "./BaseHttpController";

export const STUDENTHUB_ATTESTATION_PATH = "/studenthub/embed/attestation";

/** The closed request body: the challenge StudentHub's embed asked Universe to answer, and nothing else. */
const AttestationRequest = z.object({ challenge: z.string().regex(CHALLENGE_PATTERN) }).strict();

/** The provider no longer accepts the access token (expired or revoked): the one case a refresh can mend. */
function accessTokenRefused(err: unknown): boolean {
    return err instanceof openIdErrors.OPError && (err.error === "invalid_token" || err.response?.statusCode === 401);
}

/**
 * A provider answer that refuses the player (4xx) is a refusal; a provider that failed (5xx) or could not be reached is
 * unavailable. Neither ever gives an attestation.
 */
function providerFailure(err: unknown): "refused" | "unavailable" {
    if (!(err instanceof openIdErrors.OPError)) return "unavailable";
    const status = err.response?.statusCode;
    return status !== undefined && status >= 500 ? "unavailable" : "refused";
}

/** Same rule the sign-in uses to name the player (AuthenticateController): the e-mail, or else the subject. */
function playerIdentifierOf(userInfo: IntrospectionResponse): string | undefined {
    const email = typeof userInfo.email === "string" && userInfo.email !== "" ? userInfo.email : undefined;
    const sub = typeof userInfo.sub === "string" && userInfo.sub !== "" ? userInfo.sub : undefined;
    return email ?? sub;
}

function refuse(res: Response, status: number, reason: string): void {
    res.status(status).json({ error: reason });
}

/**
 * E3 pusher endpoint: `POST /studenthub/embed/attestation`.
 *
 * Issues a 60-second `bawes-aa.v1` host attestation for StudentHub's challenge, only for a signed-in (non-guest)
 * player whose provider account is confirmed right now: the provider's userinfo is called with the access token the
 * game token holds (renewed once through the refresh token if the provider says it ran out). A valid game token alone
 * is never enough. The attestation's subject is the provider's verified `sub`, and `iat` is when that check completed.
 *
 * Nothing about the request, the subject or the attestation is logged. Every answer is `no-store`.
 */
export class StudentHubEmbedController extends BaseHttpController {
    constructor(app: Application, private readonly config: StudentHubConfig, private readonly now = () => Date.now()) {
        super(app);
    }

    protected routes(): void {
        this.app.options(STUDENTHUB_ATTESTATION_PATH, (req: Request, res: Response) => {
            res.status(200).send("");
        });
        this.app.post(STUDENTHUB_ATTESTATION_PATH, (req: Request, res: Response) => {
            res.setHeader("Cache-Control", "no-store");
            this.attest(req, res).catch((err) => {
                console.error(`StudentHub attestation failed: ${describeError(err)}`);
                if (!res.headersSent) refuse(res, 503, "unavailable");
            });
        });
    }

    private async attest(req: Request, res: Response): Promise<void> {
        const signer = this.config.signer;
        if (!signer) {
            refuse(res, 404, "not_enabled");
            return;
        }

        const token = req.header("authorization");
        if (!token) {
            refuse(res, 401, "no_token");
            return;
        }
        let tokenData: AuthTokenData;
        try {
            // Expiry is checked: a stale game token is refused, it is not renewed here.
            tokenData = jwtTokenManager.verifyJWTToken(token);
        } catch {
            refuse(res, 401, "invalid_token");
            return;
        }
        // A guest has no provider account to check.
        if (!tokenData.accessToken) {
            refuse(res, 403, "guest");
            return;
        }

        const body = AttestationRequest.safeParse(req.body);
        if (!body.success) {
            refuse(res, 400, "bad_request");
            return;
        }

        const verified = await this.checkWithProvider(token, tokenData);
        if (verified === "unavailable") {
            refuse(res, 503, "unavailable");
            return;
        }
        if (verified === "refused") {
            refuse(res, 403, "provider_refused");
            return;
        }
        const verifiedAt = this.now();

        const subject = typeof verified.userInfo.sub === "string" ? verified.userInfo.sub : "";
        // The provider's account must still be the one this game token was issued for (an address changed or handed
        // to someone else at the provider is a different player now).
        if (playerIdentifierOf(verified.userInfo) !== tokenData.identifier) {
            refuse(res, 403, "identity_mismatch");
            return;
        }

        const attestation = signStudentHubAttestation(signer, subject, body.data.challenge, verifiedAt);
        if (!attestation) {
            // The provider's subject does not have the shape StudentHub was told to expect (E0's pinned rule).
            refuse(res, 403, "subject_format");
            return;
        }
        res.status(200).json(
            verified.renewedAuthToken ? { attestation, authToken: verified.renewedAuthToken } : { attestation }
        );
    }

    /**
     * Confirms the player with the provider: userinfo with the stored access token; if the provider says that token ran
     * out, one renewal through the refresh token (shared with /me's renewal memo, so a provider that rotates refresh
     * tokens does not leave the game holding a cancelled one) and userinfo with the new token.
     */
    private async checkWithProvider(
        token: string,
        tokenData: AuthTokenData
    ): Promise<{ userInfo: IntrospectionResponse; renewedAuthToken?: string } | "refused" | "unavailable"> {
        const accessToken = tokenData.accessToken as string;
        try {
            return { userInfo: await openIDClient.checkTokenAuth(accessToken) };
        } catch (err) {
            if (!accessTokenRefused(err)) return providerFailure(err);
        }
        const refreshToken = tokenData.refreshToken;
        if (!refreshToken) return "refused";

        const renewed = await renewedTokenMemo.renew(
            token,
            tokenData.identifier,
            async (): Promise<RenewedTokens | null> => {
                try {
                    const refreshed = await openIDClient.refreshAccessToken(refreshToken);
                    const checked = await openIDClient.checkTokenAuth(refreshed.access_token);
                    const authToken = jwtTokenManager.createAuthToken({
                        identifier: tokenData.identifier,
                        accessToken: refreshed.access_token,
                        refreshToken: refreshed.refresh_token ?? refreshToken,
                        username: tokenData.username,
                        locale: tokenData.locale,
                        tags: tokenData.tags,
                        matrixUserId: tokenData.matrixUserId,
                    });
                    return { authToken, accessToken: refreshed.access_token, checked };
                } catch {
                    return null;
                }
            }
        );
        if (!renewed) return "refused";
        // A renewal remembered from /me may be up to a minute old: the attestation's check is always made now.
        try {
            return {
                userInfo: await openIDClient.checkTokenAuth(renewed.accessToken),
                renewedAuthToken: renewed.authToken,
            };
        } catch (err) {
            return providerFailure(err);
        }
    }
}
