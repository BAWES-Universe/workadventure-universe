import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    ATTESTATION_LIFETIME_SECONDS,
    parseStudentHubConfig,
    signStudentHubAttestation,
    type StudentHubAttestationSigner,
    type StudentHubEnvironment,
} from "../../src/pusher/services/StudentHubAttestation";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CHALLENGE = "Q2hhbGxlbmdlLXJlZmVyZW5jZS0zMi1ieXRlcy1sb25nIQ"; // 46 base64url characters

function fullEnv(overrides: Partial<StudentHubEnvironment> = {}): StudentHubEnvironment {
    return {
        STUDENTHUB_URL: "https://staging.studenthub.co",
        STUDENTHUB_EMBED_ORIGIN: "https://studenthub.bawes.net",
        STUDENTHUB_EMBED_ATTESTATION_ISSUER: "universe-pusher@staging",
        STUDENTHUB_EMBED_ATTESTATION_AUDIENCE: "studenthub-embed/identity@staging",
        STUDENTHUB_EMBED_ATTESTATION_KEY_ID: "pusher-2026-11",
        STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY: privatePem,
        STUDENTHUB_EMBED_SUBJECT_FORMAT: "user_email",
        ...overrides,
    };
}

function signer(overrides: Partial<StudentHubAttestationSigner> = {}): StudentHubAttestationSigner {
    const config = parseStudentHubConfig(fullEnv(), true);
    if (!config.signer) throw new Error("no signer");
    return { ...config.signer, ...overrides };
}

/**
 * A copy of what StudentHub checks (`verifyHostAttestation` in apps/gateway/src/universe/host-identity.ts on top of
 * `verifyAssertion` from @bawes/actor-assertion, strict mode): envelope, Ed25519 signature over the prefix and payload,
 * an active key for exactly (issuer, kid), issuer = the pusher issuer, audience, lifetime <= 60 s, not expired, iat not
 * more than 5 s ahead, the subject's registered shape, and the challenge as `jti`.
 */
function studentHubAccepts(
    token: string,
    registry: Map<string, KeyObject>,
    expected: { issuer: string; audience: string; challenge: string; now: number }
): { ok: true; sub: string; iat: number } | { ok: false; reason: string } {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "bawes-aa" || parts[1] !== "v1") return { ok: false, reason: "malformed" };
    const claims = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8")) as Record<string, unknown>;
    if (claims.v !== 1) return { ok: false, reason: "malformed" };
    const iat = claims.iat as number;
    const exp = claims.exp as number;
    if (exp <= iat || exp - iat > 60) return { ok: false, reason: "lifetime" };
    if (exp <= expected.now) return { ok: false, reason: "expired" };
    if (iat > expected.now + 5) return { ok: false, reason: "future_iat" };
    const key = registry.get(`${String(claims.iss)}\u0000${String(claims.kid)}`);
    if (!key) return { ok: false, reason: "unknown_issuer" };
    const signed = verify(
        null,
        Buffer.from(`bawes-aa.v1.${parts[2]}`, "utf8"),
        key,
        Buffer.from(parts[3], "base64url")
    );
    if (!signed) return { ok: false, reason: "bad_signature" };
    if (claims.aud !== expected.audience) return { ok: false, reason: "audience" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(claims.sub))) return { ok: false, reason: "subject_format" };
    if (claims.iss !== expected.issuer || claims.act !== undefined) return { ok: false, reason: "issuer" };
    if (claims.jti !== expected.challenge) return { ok: false, reason: "challenge" };
    return { ok: true, sub: String(claims.sub), iat };
}

const now = Date.UTC(2026, 10, 26, 9, 0, 0, 750);
const registry = new Map([["universe-pusher@staging\u0000pusher-2026-11", publicKey]]);
const expected = {
    issuer: "universe-pusher@staging",
    audience: "studenthub-embed/identity@staging",
    challenge: CHALLENGE,
    now: Math.floor(now / 1000),
};

describe("StudentHub attestation signing", () => {
    it("signs a bawes-aa.v1 attestation StudentHub accepts: verified subject, challenge as jti, 60 s from the check", () => {
        const token = signStudentHubAttestation(signer(), "player@example.com", CHALLENGE, now);
        expect(token).toBeDefined();
        const result = studentHubAccepts(token as string, registry, expected);
        expect(result).toEqual({ ok: true, sub: "player@example.com", iat: Math.floor(now / 1000) });
        const claims = JSON.parse(Buffer.from((token as string).split(".")[2], "base64url").toString("utf8"));
        expect(claims).toEqual({
            v: 1,
            iss: "universe-pusher@staging",
            kid: "pusher-2026-11",
            aud: "studenthub-embed/identity@staging",
            sub: "player@example.com",
            iat: Math.floor(now / 1000),
            exp: Math.floor(now / 1000) + ATTESTATION_LIFETIME_SECONDS,
            jti: CHALLENGE,
        });
    });

    it("rounds iat down to the check, so StudentHub's lease never ends later than 600 s after it", () => {
        const token = signStudentHubAttestation(signer(), "player@example.com", CHALLENGE, now) as string;
        const claims = JSON.parse(Buffer.from(token.split(".")[2], "base64url").toString("utf8"));
        expect(claims.iat * 1000).toBeLessThanOrEqual(now);
    });

    it("is refused once the 60 s are over (a stale attestation)", () => {
        const token = signStudentHubAttestation(signer(), "player@example.com", CHALLENGE, now) as string;
        expect(studentHubAccepts(token, registry, { ...expected, now: expected.now + 60 })).toEqual({
            ok: false,
            reason: "expired",
        });
    });

    it("is refused when its key was retired at StudentHub (kid removed from UNIVERSE_EMBED_PUSHER_KEYS)", () => {
        const token = signStudentHubAttestation(
            signer({ keyId: "pusher-2026-10" }),
            "player@example.com",
            CHALLENGE,
            now
        );
        expect(studentHubAccepts(token as string, registry, expected)).toEqual({ ok: false, reason: "unknown_issuer" });
    });

    it("is refused when signed by any other key under the registered kid", () => {
        const other = generateKeyPairSync("ed25519").privateKey;
        const token = signStudentHubAttestation(signer({ privateKey: other }), "player@example.com", CHALLENGE, now);
        expect(studentHubAccepts(token as string, registry, expected)).toEqual({ ok: false, reason: "bad_signature" });
    });

    it("is refused for another challenge (an attestation answers exactly one)", () => {
        const token = signStudentHubAttestation(signer(), "player@example.com", CHALLENGE, now) as string;
        expect(studentHubAccepts(token, registry, { ...expected, challenge: CHALLENGE.replace("Q", "R") })).toEqual({
            ok: false,
            reason: "challenge",
        });
    });

    it("signs nothing for a subject outside the pinned format, or a challenge of the wrong shape", () => {
        expect(signStudentHubAttestation(signer(), "not-an-email", CHALLENGE, now)).toBeUndefined();
        expect(
            signStudentHubAttestation(signer({ subjectFormat: "hashed_user_id" }), "player@example.com", CHALLENGE, now)
        ).toBeUndefined();
        expect(signStudentHubAttestation(signer(), "player@example.com", "short", now)).toBeUndefined();
        expect(signStudentHubAttestation(signer(), "player@example.com", `${CHALLENGE}.x`, now)).toBeUndefined();
    });
});

describe("StudentHub configuration", () => {
    it("is off with nothing set", () => {
        expect(parseStudentHubConfig({}, true)).toEqual({ url: undefined, embedOrigin: undefined, signer: undefined });
    });

    it("offers only the new tab with STUDENTHUB_URL alone", () => {
        const config = parseStudentHubConfig({ STUDENTHUB_URL: "https://staging.studenthub.co" }, false);
        expect(config.url).toBe("https://staging.studenthub.co/");
        expect(config.embedOrigin).toBeUndefined();
        expect(config.signer).toBeUndefined();
    });

    it("turns the embed on only with every value set", () => {
        const config = parseStudentHubConfig(fullEnv(), true);
        expect(config.embedOrigin).toBe("https://studenthub.bawes.net");
        expect(config.signer?.issuer).toBe("universe-pusher@staging");
    });

    it("accepts a private key with escaped newlines (as deployment secrets carry it)", () => {
        const config = parseStudentHubConfig(
            fullEnv({ STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY: privatePem.replace(/\n/g, "\\n") }),
            true
        );
        expect(config.signer?.privateKey.asymmetricKeyType).toBe("ed25519");
    });

    it.each([
        ["a missing value", { STUDENTHUB_EMBED_ATTESTATION_KEY_ID: undefined }],
        ["an embed origin with a path", { STUDENTHUB_EMBED_ORIGIN: "https://studenthub.bawes.net/universe" }],
        ["an http embed origin", { STUDENTHUB_EMBED_ORIGIN: "http://studenthub.bawes.net" }],
        ["a wrong issuer shape", { STUDENTHUB_EMBED_ATTESTATION_ISSUER: "https://auth.bawes.net" }],
        ["a wrong audience shape", { STUDENTHUB_EMBED_ATTESTATION_AUDIENCE: "studenthub" }],
        [
            "issuer and audience of two environments",
            { STUDENTHUB_EMBED_ATTESTATION_AUDIENCE: "studenthub-embed/identity@production" },
        ],
        ["a key id with spaces", { STUDENTHUB_EMBED_ATTESTATION_KEY_ID: "pusher key" }],
        ["an unreadable key", { STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY: "not a key" }],
        [
            "a key that is not Ed25519",
            {
                STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
                    .privateKey.export({ type: "pkcs8", format: "pem" })
                    .toString(),
            },
        ],
        ["an unknown subject format", { STUDENTHUB_EMBED_SUBJECT_FORMAT: "email" }],
        ["an http StudentHub URL", { STUDENTHUB_URL: "http://staging.studenthub.co" }],
    ])("refuses to start with %s", (_name, overrides) => {
        expect(() => parseStudentHubConfig(fullEnv(overrides), true)).toThrow();
    });

    it("refuses embed values without an embed origin (a partial configuration)", () => {
        expect(() => parseStudentHubConfig({ STUDENTHUB_EMBED_ATTESTATION_KEY_ID: "pusher-2026-11" }, true)).toThrow(
            /without STUDENTHUB_EMBED_ORIGIN/
        );
    });

    it("refuses the embed without OpenID Connect: no provider, no proof", () => {
        expect(() => parseStudentHubConfig(fullEnv(), false)).toThrow(/OpenID/);
    });

    it("never puts the private key in its error", () => {
        try {
            parseStudentHubConfig(fullEnv({ STUDENTHUB_EMBED_SUBJECT_FORMAT: "nope" }), true);
        } catch (err) {
            expect(String(err)).not.toContain("PRIVATE KEY");
        }
    });
});
