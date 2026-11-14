/**
 * Upload receipts, as the bot server reads them (plan v3 section 5): the uploader signs one for each chat upload, with a key
 * derived from SECRET_KEY for receipts only (uploader/src/Service/UploadReceipt.ts). A guest names a file by its receipt; the
 * file counts only when the receipt is this guest's, for this purpose, and not expired. Its bytes are then read through the
 * uploader's own path for that id, bounded, and refused when their hash is not the one the uploader stored.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const RECEIPT_KID = 'r1';
const RECEIPT_VERSION = 1;

export type ReceiptPurpose = 'chat-file' | 'chat-note' | 'guest-brick';

export interface ReceiptClaims {
    iss: 'uploader';
    v: number;
    kid: string;
    sub: string;
    aud: ReceiptPurpose;
    fid: string;
    bkt: string | null;
    loc: string;
    sha256: string;
    name: string;
    type: string;
    size: number;
    len: 'unmeasured';
    iat: number;
    exp: number;
}

export function receiptKey(secret: string, kid: string = RECEIPT_KID): Buffer {
    return Buffer.from(hkdfSync('sha256', secret, 'universe-upload-receipt', `receipt:${kid}`, 32));
}

/** For tests and the uploader's own format check: a receipt signed the uploader's way. */
export function signReceipt(claims: Omit<ReceiptClaims, 'iss' | 'v' | 'kid'>, secret: string): string {
    const full: ReceiptClaims = { iss: 'uploader', v: RECEIPT_VERSION, kid: RECEIPT_KID, ...claims };
    const body = Buffer.from(JSON.stringify(full)).toString('base64url');
    return `${body}.${createHmac('sha256', receiptKey(secret)).update(body).digest('base64url')}`;
}

export type ReceiptCheck = { ok: true; claims: ReceiptClaims } | { ok: false; reason: 'invalid' | 'expired' | 'not-yours' };

/** Whether `token` is a receipt the uploader signed for `sub`'s upload, for one of `purposes`, still good at `now`. */
export function checkReceipt(token: unknown, secret: string, sub: string, purposes: readonly ReceiptPurpose[], now: number = Date.now()): ReceiptCheck {
    if (typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'invalid' };
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };
    const [body, mac] = parts;
    let claims: ReceiptClaims;
    try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ReceiptClaims;
    } catch {
        return { ok: false, reason: 'invalid' };
    }
    if (!claims || typeof claims !== 'object' || claims.iss !== 'uploader' || claims.v !== RECEIPT_VERSION || claims.kid !== RECEIPT_KID) return { ok: false, reason: 'invalid' };
    const expected = createHmac('sha256', receiptKey(secret, claims.kid)).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' };
    if (typeof claims.fid !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(claims.fid) || typeof claims.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(claims.sha256)) {
        return { ok: false, reason: 'invalid' };
    }
    if (claims.sub !== sub || !purposes.includes(claims.aud)) return { ok: false, reason: 'not-yours' };
    if (typeof claims.exp !== 'number' || claims.exp < now) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
}

/**
 * The uploader's own path for a file: its lasting chat-file link for a bucket (which sends on to the file), its own storage
 * otherwise. Never a link the device sent.
 */
export function uploaderPathOf(claims: Pick<ReceiptClaims, 'fid' | 'bkt'>, uploaderUrl: string): string {
    const base = uploaderUrl.replace(/\/+$/, '');
    return claims.bkt ? `${base}/chat-file/${encodeURIComponent(claims.bkt)}/${encodeURIComponent(claims.fid)}` : `${base}/upload-file/${encodeURIComponent(claims.fid)}`;
}

/**
 * What a fetch says when the uploader could not be asked just now: a 5xx, 408 or 429, a timeout, a dropped connection, or a DNS
 * lookup that was not answered.
 * Anything else, a 4xx or a link the fetch refuses (an address it must not reach), is not going to change on its own.
 */
const TRANSIENT_FETCH = /^HTTP (5\d\d|408|429)\b|timed? ?out|timeout|aborted|fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|network|DNS not answered/i;

/**
 * A fetch's error without the addresses it names (a link, a quoted host): those carry names a person chose, such as a file
 * called "photo.timeout", and only what the fetch itself says decides whether to ask again.
 */
function withoutAddresses(message: string): string {
    return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<link>').replace(/'[^']*'/g, "'<host>'");
}

export type ReceiptFile = { ok: true; bytes: Uint8Array; claims: ReceiptClaims } | { ok: false; reason: 'gone' | 'changed' | 'too-big' | 'not-now' };

/**
 * The bytes of a receipt's file, read through the uploader's path with at most `maxBytes`, and only when they are the bytes the
 * uploader stored. `fetchBytes` is the SSRF-safe bounded fetch (it validates every redirect). A timeout, a dropped connection
 * or a 5xx (408 and 429 too) is `not-now`, to ask again; anything else, a 4xx or a link the fetch refuses, is `gone`.
 */
export async function readReceiptFile(
    claims: ReceiptClaims,
    uploaderUrl: string,
    maxBytes: number,
    fetchBytes: (url: string, maxBytes: number) => Promise<ArrayBuffer | Uint8Array>
): Promise<ReceiptFile> {
    if (claims.size > maxBytes) return { ok: false, reason: 'too-big' };
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await fetchBytes(uploaderPathOf(claims, uploaderUrl), maxBytes));
    } catch (error) {
        const message = withoutAddresses((error as Error)?.message ?? '');
        if (/too large/i.test(message)) return { ok: false, reason: 'too-big' };
        return { ok: false, reason: TRANSIENT_FETCH.test(message) ? 'not-now' : 'gone' };
    }
    if (createHash('sha256').update(bytes).digest('hex') !== claims.sha256) return { ok: false, reason: 'changed' };
    return { ok: true, bytes, claims };
}
