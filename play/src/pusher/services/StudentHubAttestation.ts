import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * StudentHub embed (contract "Universe entry", card E3): the pusher's host attestation.
 *
 * StudentHub shows a person's own profile inside Universe only after Universe proves who is playing. The proof is a
 * `bawes-aa.v1` assertion, the one actor-assertion format StudentHub verifies (`@bawes/actor-assertion`):
 *
 *     bawes-aa.v1.<base64url(claimsJson)>.<base64url(ed25519 signature over "bawes-aa.v1.<payload>")>
 *
 * It is signed with the pusher's own Ed25519 key (never the person's provider), is addressed to StudentHub's embed
 * identity audience, lasts 60 seconds, and carries StudentHub's one-use challenge as its `jti`. Its subject is the
 * provider's verified `sub`, read fresh from the provider's userinfo, never the e-mail, the game token's identifier or
 * other player data.
 *
 * Everything here is off unless STUDENTHUB_EMBED_ORIGIN is set; when it is, every other value must be set and valid,
 * or the pusher refuses to start (all or nothing, as StudentHub's own embed configuration).
 */

export const ATTESTATION_ENVELOPE_PREFIX = "bawes-aa.v1";
/** StudentHub's strict verifier takes at most 60 s between `iat` and `exp`. */
export const ATTESTATION_LIFETIME_SECONDS = 60;
/** StudentHub's challenge: 32 random bytes, base64url (43 characters). A little room either way, nothing else. */
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** The subject shapes StudentHub accepts per provider `sub_mode` (same patterns as `@bawes/actor-assertion`). */
export const SUBJECT_FORMATS = {
    user_email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    hashed_user_id: /^[0-9a-f]{32,128}$/,
} as const;
export type SubjectFormat = keyof typeof SUBJECT_FORMATS;

export interface StudentHubAttestationSigner {
    /** `universe-pusher@<environment>`: the issuer StudentHub registers this pusher's public key under. */
    readonly issuer: string;
    /** `studenthub-embed/identity@<environment>`. */
    readonly audience: string;
    /** The key id StudentHub lists in UNIVERSE_EMBED_PUSHER_KEYS; removing it there retires the key. */
    readonly keyId: string;
    readonly privateKey: KeyObject;
    readonly subjectFormat: SubjectFormat;
}

export interface StudentHubConfig {
    /** StudentHub's main origin, opened in a new tab when the embed is off. Undefined: no launcher. */
    readonly url: string | undefined;
    /** The embed host's exact origin. Undefined: the embed is off. */
    readonly embedOrigin: string | undefined;
    /** Set exactly when the embed is on. */
    readonly signer: StudentHubAttestationSigner | undefined;
}

export interface StudentHubEnvironment {
    STUDENTHUB_URL?: string;
    STUDENTHUB_EMBED_ORIGIN?: string;
    STUDENTHUB_EMBED_ATTESTATION_ISSUER?: string;
    STUDENTHUB_EMBED_ATTESTATION_AUDIENCE?: string;
    STUDENTHUB_EMBED_ATTESTATION_KEY_ID?: string;
    STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY?: string;
    STUDENTHUB_EMBED_SUBJECT_FORMAT?: string;
}

const EMBED_NAMES = [
    "STUDENTHUB_EMBED_ATTESTATION_ISSUER",
    "STUDENTHUB_EMBED_ATTESTATION_AUDIENCE",
    "STUDENTHUB_EMBED_ATTESTATION_KEY_ID",
    "STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY",
    "STUDENTHUB_EMBED_SUBJECT_FORMAT",
] as const;

function present(value: string | undefined): value is string {
    return value !== undefined && value.trim() !== "";
}

/** An exact `https` origin: no path, query, fragment, credentials or trailing dot. */
function exactHttpsOrigin(name: string, value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${name} must be an https origin`);
    }
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hostname.endsWith(".") ||
        url.origin !== value
    ) {
        throw new Error(`${name} must be an exact https origin such as https://studenthub.example.com`);
    }
    return value;
}

/**
 * Reads the StudentHub configuration. Throws (the pusher does not start) on any invalid value, on a partial embed
 * configuration, or on an embed without OpenID Connect (no provider to check, so no attestation can ever be issued).
 * The error names the variable, never its value.
 */
export function parseStudentHubConfig(env: StudentHubEnvironment, openIdEnabled: boolean): StudentHubConfig {
    let url: string | undefined;
    if (present(env.STUDENTHUB_URL)) {
        let parsed: URL;
        try {
            parsed = new URL(env.STUDENTHUB_URL);
        } catch {
            throw new Error("STUDENTHUB_URL must be an https URL");
        }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
            throw new Error("STUDENTHUB_URL must be an https URL without credentials");
        }
        url = parsed.toString();
    }

    if (!present(env.STUDENTHUB_EMBED_ORIGIN)) {
        const stray = EMBED_NAMES.filter((name) => present(env[name]));
        if (stray.length > 0) {
            throw new Error(`${stray.join(", ")} set without STUDENTHUB_EMBED_ORIGIN`);
        }
        return { url, embedOrigin: undefined, signer: undefined };
    }

    const embedOrigin = exactHttpsOrigin("STUDENTHUB_EMBED_ORIGIN", env.STUDENTHUB_EMBED_ORIGIN);
    const missing = EMBED_NAMES.filter((name) => !present(env[name]));
    if (missing.length > 0) {
        throw new Error(`STUDENTHUB_EMBED_ORIGIN is set but ${missing.join(", ")} is not`);
    }
    if (!openIdEnabled) {
        throw new Error(
            "STUDENTHUB_EMBED_ORIGIN needs OpenID Connect (OPENID_CLIENT_ID): only a provider check proves a player"
        );
    }

    const issuer = env.STUDENTHUB_EMBED_ATTESTATION_ISSUER as string;
    const audience = env.STUDENTHUB_EMBED_ATTESTATION_AUDIENCE as string;
    // The same rules StudentHub applies to UNIVERSE_EMBED_PUSHER_ISSUER and UNIVERSE_EMBED_IDENTITY_AUDIENCE.
    if (!/^universe-pusher@[a-z0-9-]+$/.test(issuer)) {
        throw new Error("STUDENTHUB_EMBED_ATTESTATION_ISSUER must look like universe-pusher@<environment>");
    }
    if (!/^studenthub-embed\/identity@[a-z0-9-]+$/.test(audience)) {
        throw new Error("STUDENTHUB_EMBED_ATTESTATION_AUDIENCE must look like studenthub-embed/identity@<environment>");
    }
    if (issuer.split("@")[1] !== audience.split("@")[1]) {
        throw new Error("STUDENTHUB_EMBED_ATTESTATION_ISSUER and _AUDIENCE must name the same environment");
    }

    const keyId = env.STUDENTHUB_EMBED_ATTESTATION_KEY_ID as string;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
        throw new Error(
            "STUDENTHUB_EMBED_ATTESTATION_KEY_ID must be 1 to 64 letters, digits, dots, dashes or underscores"
        );
    }

    let privateKey: KeyObject;
    try {
        // Deployment secrets often carry the PEM with escaped newlines.
        privateKey = createPrivateKey((env.STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY as string).replace(/\\n/g, "\n"));
    } catch {
        throw new Error("STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY is not a readable private key");
    }
    if (privateKey.asymmetricKeyType !== "ed25519") {
        throw new Error("STUDENTHUB_EMBED_ATTESTATION_PRIVATE_KEY must be an Ed25519 private key");
    }

    const subjectFormat = env.STUDENTHUB_EMBED_SUBJECT_FORMAT as string;
    if (!Object.prototype.hasOwnProperty.call(SUBJECT_FORMATS, subjectFormat)) {
        throw new Error("STUDENTHUB_EMBED_SUBJECT_FORMAT must be user_email or hashed_user_id");
    }

    return {
        url,
        embedOrigin,
        signer: { issuer, audience, keyId, privateKey, subjectFormat: subjectFormat as SubjectFormat },
    };
}

export interface AttestationClaims {
    v: 1;
    iss: string;
    kid: string;
    aud: string;
    sub: string;
    iat: number;
    exp: number;
    jti: string;
}

/**
 * Signs a host attestation. `verifiedAt` is when the provider check completed (epoch milliseconds); `iat` is that
 * moment rounded down, so StudentHub's lease (at most `iat` + 600 s) never runs past ten minutes after the check.
 * Returns undefined when the subject or challenge does not have the expected shape: nothing is signed then.
 */
export function signStudentHubAttestation(
    signer: StudentHubAttestationSigner,
    subject: string,
    challenge: string,
    verifiedAt: number
): string | undefined {
    if (!SUBJECT_FORMATS[signer.subjectFormat].test(subject)) return undefined;
    if (!CHALLENGE_PATTERN.test(challenge)) return undefined;
    if (!Number.isFinite(verifiedAt)) return undefined;
    const iat = Math.floor(verifiedAt / 1000);
    const claims: AttestationClaims = {
        v: 1,
        iss: signer.issuer,
        kid: signer.keyId,
        aud: signer.audience,
        sub: subject,
        iat,
        exp: iat + ATTESTATION_LIFETIME_SECONDS,
        jti: challenge,
    };
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${ATTESTATION_ENVELOPE_PREFIX}.${payload}`;
    const signature = sign(null, Buffer.from(signingInput, "utf8"), signer.privateKey);
    return `${signingInput}.${signature.toString("base64url")}`;
}
