import type { MatrixClient } from "matrix-js-sdk";
import type { Readable } from "svelte/store";
import { readable } from "svelte/store";

interface KeptFile {
    url: Promise<string | undefined>;
    /** How many shown messages use this file right now. */
    holders: number;
}

// One download per file: the same image in a reply, a thread or after a decryption isn't fetched again. Files that
// no shown message uses are kept up to a limit, most recently shown first; older blob: URLs are released so a long
// session doesn't hold every file in memory. A file still on screen is never released.
const keptFiles = new Map<string, KeptFile>();
export const MAX_KEPT_MEDIA = 200;
// Profile and room pictures are small thumbnails that several places show at once (a chat row and its header), so
// they're kept for the session.
const thumbnailUrls = new Map<string, Promise<string | undefined>>();

function revoke(url: Promise<string | undefined>): void {
    url.then((resolved) => {
        if (resolved?.startsWith("blob:")) URL.revokeObjectURL(resolved);
    }).catch(() => undefined);
}

/** Drops every downloaded file, for when the chat signs out: the next person never sees the files of the last. */
export function clearMatrixMedia(): void {
    for (const kept of keptFiles.values()) revoke(kept.url);
    keptFiles.clear();
    for (const url of thumbnailUrls.values()) revoke(url);
    thumbnailUrls.clear();
}

function releaseOldFiles(): void {
    let unheld = 0;
    for (const kept of keptFiles.values()) if (kept.holders === 0) unheld++;
    for (const [mxcUrl, kept] of keptFiles) {
        if (unheld <= MAX_KEPT_MEDIA) return;
        if (kept.holders > 0) continue;
        keptFiles.delete(mxcUrl);
        unheld--;
        revoke(kept.url);
    }
}

const ENDPOINT_UNKNOWN_STATUSES = [400, 404, 405];

export interface MatrixMediaHold {
    url: Promise<string | undefined>;
    /** Call once the file is no longer shown, so its URL can be released later. */
    release(): void;
}

/** A file sent in an end-to-end encrypted chat by another app (Element): its content is encrypted too. */
export interface EncryptedMatrixFile {
    url: string;
    key: { k: string };
    iv: string;
    hashes?: { sha256?: string };
}

export function parseEncryptedMatrixFile(value: unknown): EncryptedMatrixFile | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const { url, key, iv, hashes } = value as Record<string, unknown>;
    if (typeof url !== "string" || !url.startsWith("mxc://") || typeof iv !== "string") return undefined;
    if (typeof key !== "object" || key === null || typeof (key as Record<string, unknown>).k !== "string") {
        return undefined;
    }
    const sha256 =
        typeof hashes === "object" && hashes !== null ? (hashes as Record<string, unknown>).sha256 : undefined;
    return {
        url,
        key: { k: (key as { k: string }).k },
        iv,
        hashes: { sha256: typeof sha256 === "string" ? sha256 : undefined },
    };
}

/**
 * Returns a URL the browser can show for a Matrix file, kept valid until `release()` is called. The file is either
 * an mxc:// URL or, in an encrypted chat, an encrypted file (`file` in the message), decrypted here.
 *
 * Synapse 1.120+ serves new uploads only from the authenticated media endpoints, which need the access token in an
 * Authorization header. An <img>, <video> or download link can't send it, so the file is fetched here and shown from
 * a blob: URL. Servers without authenticated media keep the legacy URL.
 */
export function holdMatrixMedia(client: MatrixClient, source: unknown, mimetype?: string): MatrixMediaHold {
    const encrypted = parseEncryptedMatrixFile(source);
    const mxcUrl = encrypted?.url ?? source;
    if (typeof mxcUrl !== "string" || !mxcUrl.startsWith("mxc://")) {
        return { url: Promise.resolve(undefined), release: () => undefined };
    }
    let kept = keptFiles.get(mxcUrl);
    if (!kept) {
        const file: KeptFile = { url: Promise.resolve(undefined), holders: 0 };
        // Only this fetch's own entry: after a release and a new fetch, a late failure mustn't drop the new one.
        const forget = () => {
            if (keptFiles.get(mxcUrl) === file) keptFiles.delete(mxcUrl);
        };
        keptFiles.set(mxcUrl, file);
        file.url = encrypted
            ? fetchEncryptedMatrixMedia(client, encrypted, mimetype, forget)
            : fetchMatrixMedia(client, mxcUrl, forget);
        kept = file;
    }
    kept.holders++;
    const held = kept;
    let released = false;
    return {
        url: held.url,
        release: () => {
            if (released) return;
            released = true;
            held.holders--;
            if (held.holders > 0 || keptFiles.get(mxcUrl) !== held) return;
            // No longer shown: it's now the most recent of the files that may be released.
            keptFiles.delete(mxcUrl);
            keptFiles.set(mxcUrl, held);
            releaseOldFiles();
        },
    };
}

/**
 * The URL of a Matrix file without keeping it: it may be released once the limit is reached. With a size, a thumbnail
 * of that many pixels is asked for instead and kept for the session.
 */
export function resolveMatrixMediaUrl(
    client: MatrixClient,
    source: unknown,
    thumbnailSize?: number
): Promise<string | undefined> {
    if (thumbnailSize && typeof source === "string" && source.startsWith("mxc://")) {
        const key = `${source}#${thumbnailSize}`;
        let resolved = thumbnailUrls.get(key);
        if (!resolved) {
            resolved = fetchMatrixMedia(client, source, () => thumbnailUrls.delete(key), thumbnailSize);
            thumbnailUrls.set(key, resolved);
        }
        return resolved;
    }
    const hold = holdMatrixMedia(client, source);
    hold.release();
    return hold.url;
}

/**
 * A profile or room picture (mxc://…) as a store, shown the same way as chat files. A thumbnail of `size` pixels is
 * asked for, so a large photo set in another chat app isn't downloaded whole.
 */
export function matrixAvatarStore(
    client: MatrixClient,
    mxcUrl: string | null | undefined,
    size: number
): Readable<string | undefined> {
    return readable<string | undefined>(undefined, (set) => {
        let stopped = false;
        resolveMatrixMediaUrl(client, mxcUrl, size)
            .then((url) => {
                if (!stopped) set(url);
            })
            .catch((error) => console.error("Could not load a chat picture", error));
        return () => {
            stopped = true;
        };
    });
}

/** `forget` drops the cached answer, so the file is fetched again the next time it's shown. */
/**
 * Like `matrixAvatarStore`, for a picture that can change (someone sets a new one): follows `mxcUrl`, keeping the
 * old picture on screen until the new one is ready.
 */
export function changingMatrixAvatarStore(
    client: MatrixClient,
    mxcUrl: Readable<string | null | undefined>,
    size: number
): Readable<string | undefined> {
    return readable<string | undefined>(undefined, (set) => {
        let stopPicture: (() => void) | undefined;
        const stopUrl = mxcUrl.subscribe((mxc) => {
            stopPicture?.();
            stopPicture = matrixAvatarStore(client, mxc, size).subscribe((url) => {
                if (url !== undefined || !mxc) set(url);
            });
        });
        return () => {
            stopUrl();
            stopPicture?.();
        };
    });
}

async function fetchMatrixMedia(
    client: MatrixClient,
    mxcUrl: string,
    forget: () => void,
    thumbnailSize?: number
): Promise<string | undefined> {
    const method = thumbnailSize ? "scale" : undefined;
    const legacyUrl = client.mxcUrlToHttp(mxcUrl, thumbnailSize, thumbnailSize, method) ?? undefined;
    const authenticatedUrl = client.mxcUrlToHttp(mxcUrl, thumbnailSize, thumbnailSize, method, false, true, true);
    const accessToken = client.getAccessToken();
    if (!authenticatedUrl || !accessToken) {
        return legacyUrl;
    }
    try {
        const response = await fetch(authenticatedUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) {
            // Older servers don't know the authenticated endpoint (404/405/400); the legacy one is all they have.
            // Anything else (server error, rate limit, expired token) may pass next time the file is shown.
            if (!ENDPOINT_UNKNOWN_STATUSES.includes(response.status)) {
                forget();
            }
            return legacyUrl;
        }
        return URL.createObjectURL(await response.blob());
    } catch (error) {
        console.error("Could not load a chat file", error);
        // A network blip: try again the next time the file is shown.
        forget();
        return legacyUrl;
    }
}

function base64ToBytes(base64: string): Uint8Array {
    const standard = base64.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToUnpaddedBase64(bytes: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "");
}

/** Downloads an encrypted file and decrypts it (AES-CTR, as the Matrix spec sets for attachments). */
async function fetchEncryptedMatrixMedia(
    client: MatrixClient,
    file: EncryptedMatrixFile,
    mimetype: string | undefined,
    forget: () => void
): Promise<string | undefined> {
    const legacyUrl = client.mxcUrlToHttp(file.url) ?? undefined;
    const authenticatedUrl = client.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
    const accessToken = client.getAccessToken();
    try {
        let response =
            authenticatedUrl && accessToken
                ? await fetch(authenticatedUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
                : undefined;
        if ((!response || ENDPOINT_UNKNOWN_STATUSES.includes(response.status)) && legacyUrl) {
            response = await fetch(legacyUrl);
        }
        if (!response?.ok) {
            forget();
            return undefined;
        }
        const encrypted = await response.arrayBuffer();
        // A file that doesn't match the hash its sender gave isn't shown. It may be a cut-off download, so it's
        // fetched again the next time it's shown.
        if (file.hashes?.sha256) {
            const digest = await crypto.subtle.digest("SHA-256", encrypted);
            if (bytesToUnpaddedBase64(digest) !== file.hashes.sha256.replace(/=+$/, "")) {
                forget();
                return undefined;
            }
        }
        const key = await crypto.subtle.importKey(
            "jwk",
            { kty: "oct", k: file.key.k, alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"] },
            { name: "AES-CTR" },
            false,
            ["decrypt"]
        );
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CTR", counter: base64ToBytes(file.iv), length: 64 },
            key,
            encrypted
        );
        return URL.createObjectURL(new Blob([decrypted], mimetype ? { type: mimetype } : undefined));
    } catch (error) {
        console.error("Could not load an encrypted chat file", error);
        forget();
        return undefined;
    }
}
