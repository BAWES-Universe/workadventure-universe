import type { MatrixClient } from "matrix-js-sdk";
import type { Readable } from "svelte/store";
import { derived, readable } from "svelte/store";

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
// The thumbnails already fetched, so a picture shown again appears at once instead of after its letter.
const resolvedThumbnails = new Map<string, string | undefined>();

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
    resolvedThumbnails.clear();
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

// matrix-js-sdk 32 builds authenticated media URLs on MSC3916's unstable prefix. Synapse dropped that prefix once the
// stable endpoints shipped (Matrix 1.11): Synapse 1.160 answers it with 404, so the stable one is asked for instead.
const UNSTABLE_MEDIA_PREFIX = "/_matrix/client/unstable/org.matrix.msc3916/media/";
const STABLE_MEDIA_PREFIX = "/_matrix/client/v1/media/";

function authenticatedMediaUrl(
    client: MatrixClient,
    mxcUrl: string,
    thumbnailSize?: number,
    method?: "scale"
): string | undefined {
    const url = client.mxcUrlToHttp(mxcUrl, thumbnailSize, thumbnailSize, method, false, true, true);
    return url ? url.replace(UNSTABLE_MEDIA_PREFIX, STABLE_MEDIA_PREFIX) : undefined;
}

/** Whether the server answered that it has no such file, rather than not knowing the endpoint. */
async function isMissingFile(response: Response): Promise<boolean> {
    if (response.status !== 404) return false;
    try {
        const body: unknown = await response.json();
        return typeof body === "object" && body !== null && (body as { errcode?: unknown }).errcode === "M_NOT_FOUND";
    } catch {
        return false;
    }
}

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
            const fetched = fetchMatrixMedia(client, source, () => thumbnailUrls.delete(key), thumbnailSize);
            thumbnailUrls.set(key, fetched);
            fetched
                .then((url) => {
                    // Only an answer that is still kept: a forgotten one is fetched again next time.
                    if (thumbnailUrls.get(key) === fetched) resolvedThumbnails.set(key, url);
                })
                .catch(() => undefined);
            resolved = fetched;
        }
        return resolved;
    }
    const hold = holdMatrixMedia(client, source);
    hold.release();
    return hold.url;
}

/** A Matrix picture store that also says whether its picture is still downloading. */
export type MatrixPictureStore = Readable<string | undefined> & {
    /** True until the first answer: the avatar stays plain meanwhile, so no letter flashes before the picture. */
    loading: Readable<boolean>;
};

interface PictureState {
    url: string | undefined;
    loading: boolean;
}

function toPictureStore(state: Readable<PictureState>): MatrixPictureStore {
    return Object.assign(
        derived(state, ($state) => $state.url),
        { loading: derived(state, ($state) => $state.loading) }
    );
}

/**
 * A profile or room picture (mxc://…) as a store, shown the same way as chat files. A thumbnail of `size` pixels is
 * asked for, so a large photo set in another chat app isn't downloaded whole. A picture fetched before starts shown.
 */
export function matrixAvatarStore(
    client: MatrixClient,
    mxcUrl: string | null | undefined,
    size: number
): MatrixPictureStore {
    const key = `${mxcUrl}#${size}`;
    const hasPicture = typeof mxcUrl === "string" && mxcUrl.startsWith("mxc://");
    return toPictureStore(
        readable<PictureState>({ url: undefined, loading: hasPicture }, (set) => {
            if (!hasPicture) return;
            if (resolvedThumbnails.has(key)) {
                set({ url: resolvedThumbnails.get(key), loading: false });
                return;
            }
            let stopped = false;
            resolveMatrixMediaUrl(client, mxcUrl, size)
                .then((url) => {
                    if (!stopped) set({ url, loading: false });
                })
                .catch((error) => {
                    console.error("Could not load a chat picture", error);
                    if (!stopped) set({ url: undefined, loading: false });
                });
            return () => {
                stopped = true;
            };
        })
    );
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
): MatrixPictureStore {
    return toPictureStore(
        readable<PictureState>({ url: undefined, loading: true }, (set) => {
            let shown: string | undefined;
            let stopPicture: (() => void) | undefined;
            const stopUrl = mxcUrl.subscribe((mxc) => {
                stopPicture?.();
                const picture = matrixAvatarStore(client, mxc, size);
                stopPicture = derived([picture, picture.loading], (values) => values).subscribe(([url, loading]) => {
                    if (url !== undefined || !mxc) shown = url;
                    set({ url: shown, loading: shown === undefined && loading });
                });
            });
            return () => {
                stopUrl();
                stopPicture?.();
            };
        })
    );
}

async function fetchMatrixMedia(
    client: MatrixClient,
    mxcUrl: string,
    forget: () => void,
    thumbnailSize?: number
): Promise<string | undefined> {
    const method = thumbnailSize ? "scale" : undefined;
    const legacyUrl = client.mxcUrlToHttp(mxcUrl, thumbnailSize, thumbnailSize, method) ?? undefined;
    const authenticatedUrl = authenticatedMediaUrl(client, mxcUrl, thumbnailSize, method);
    const accessToken = client.getAccessToken();
    if (!authenticatedUrl || !accessToken) {
        return legacyUrl;
    }
    try {
        const response = await fetch(authenticatedUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) {
            // Older servers don't know the authenticated endpoint (404/405/400); the legacy one is all they have.
            // A file the server says it doesn't have is missing from the legacy one too.
            if (ENDPOINT_UNKNOWN_STATUSES.includes(response.status)) {
                return (await isMissingFile(response)) ? undefined : legacyUrl;
            }
            // Anything else (server error, rate limit, expired token) may pass next time the file is shown. Servers
            // with authenticated media refuse the legacy URL for new files, so nothing is shown meanwhile rather
            // than a broken picture.
            forget();
            return undefined;
        }
        return URL.createObjectURL(await response.blob());
    } catch (error) {
        console.error("Could not load a chat file", error);
        // A network blip: try again the next time the file is shown.
        forget();
        return undefined;
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
    const authenticatedUrl = authenticatedMediaUrl(client, file.url);
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
