import { createHash, createHmac, hkdfSync, timingSafeEqual } from "crypto";

/**
 * A signed receipt for one chat upload (voice notes for every bot, plan v3 section 5): it says who uploaded which file, with
 * the file's own hash, so a bot server can trust a file a guest names without trusting the guest. The bot server checks the
 * receipt, fetches the file through the uploader's own path for that id, and refuses it when the hash no longer matches.
 *
 * The key is derived from SECRET_KEY for receipts only (HKDF, "receipt" label, a key id for rotation): it is never the plain
 * secret that signs game tokens. The bot server derives the same key (bots/server/UploadReceipts.ts).
 *
 * A receipt is `base64url(claims JSON).base64url(HMAC-SHA256)`.
 */

export const RECEIPT_KID = "r1";
export const RECEIPT_VERSION = 1;
/** How long a receipt is good for: a guest's upload is kept about a day. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
/** How old an expired receipt may be and still be renewed by the one who uploaded the file. */
export const RECEIPT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export type ReceiptPurpose = "chat-file" | "chat-note" | "guest-brick";
export const RECEIPT_PURPOSES: readonly ReceiptPurpose[] = ["chat-file", "chat-note", "guest-brick"];

export interface ReceiptClaims {
  iss: "uploader";
  v: number;
  kid: string;
  /** The uploader: the game token's identifier (a guest's id, or an account's). */
  sub: string;
  /** What the upload is for. */
  aud: ReceiptPurpose;
  /** The immutable file id the uploader gave it. */
  fid: string;
  /** The bucket it is kept in, or null for the uploader's own storage. */
  bkt: string | null;
  /** Where the uploader said it can be read. */
  loc: string;
  /** The hash of the bytes the uploader stored, hex. */
  sha256: string;
  /** Its name, type and size, as the uploader checked them. */
  name: string;
  type: string;
  size: number;
  /** Where a length would come from: never from the device; the bot server measures a note itself. */
  len: "unmeasured";
  iat: number;
  exp: number;
}

export function receiptKey(secret: string, kid: string = RECEIPT_KID): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "universe-upload-receipt", `receipt:${kid}`, 32));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

export function signReceipt(claims: Omit<ReceiptClaims, "iss" | "v" | "kid">, secret: string): string {
  const full: ReceiptClaims = { iss: "uploader", v: RECEIPT_VERSION, kid: RECEIPT_KID, ...claims };
  const body = base64url(JSON.stringify(full));
  const mac = createHmac("sha256", receiptKey(secret, full.kid)).update(body).digest();
  return `${body}.${base64url(mac)}`;
}

/**
 * The claims of a receipt this uploader signed, or null. An expired one is null too, unless `allowExpiredFor` says how long
 * after its expiry it may still be read (to renew it).
 */
export function readReceipt(
  token: unknown,
  secret: string,
  now: number = Date.now(),
  allowExpiredFor = 0
): ReceiptClaims | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  let claims: ReceiptClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReceiptClaims;
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object" || claims.iss !== "uploader" || claims.v !== RECEIPT_VERSION) return null;
  if (claims.kid !== RECEIPT_KID) return null;
  const expected = createHmac("sha256", receiptKey(secret, claims.kid)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (typeof claims.exp !== "number" || claims.exp + allowExpiredFor < now) return null;
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.fid !== "string" || !claims.fid) return null;
  return claims;
}
