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

function releaseOldFiles(): void {
    let unheld = 0;
    for (const kept of keptFiles.values()) if (kept.holders === 0) unheld++;
    for (const [mxcUrl, kept] of keptFiles) {
        if (unheld <= MAX_KEPT_MEDIA) return;
        if (kept.holders > 0) continue;
        keptFiles.delete(mxcUrl);
        unheld--;
        kept.url
            .then((url) => {
                if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
            })
            .catch(() => undefined);
    }
}

const ENDPOINT_UNKNOWN_STATUSES = [400, 404, 405];

export interface MatrixMediaHold {
    url: Promise<string | undefined>;
    /** Call once the file is no longer shown, so its URL can be released later. */
    release(): void;
}

/**
 * Returns a URL the browser can show for a Matrix file (mxc://…), kept valid until `release()` is called.
 *
 * Synapse 1.120+ serves new uploads only from the authenticated media endpoints, which need the access token in an
 * Authorization header. An <img>, <video> or download link can't send it, so the file is fetched here and shown from
 * a blob: URL. Servers without authenticated media keep the legacy URL.
 */
export function holdMatrixMedia(client: MatrixClient, mxcUrl: unknown): MatrixMediaHold {
    if (typeof mxcUrl !== "string" || !mxcUrl.startsWith("mxc://")) {
        return { url: Promise.resolve(undefined), release: () => undefined };
    }
    let kept = keptFiles.get(mxcUrl);
    if (!kept) {
        kept = { url: fetchMatrixMedia(client, mxcUrl, () => keptFiles.delete(mxcUrl)), holders: 0 };
        keptFiles.set(mxcUrl, kept);
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
    mxcUrl: unknown,
    thumbnailSize?: number
): Promise<string | undefined> {
    if (thumbnailSize && typeof mxcUrl === "string" && mxcUrl.startsWith("mxc://")) {
        const key = `${mxcUrl}#${thumbnailSize}`;
        let resolved = thumbnailUrls.get(key);
        if (!resolved) {
            resolved = fetchMatrixMedia(client, mxcUrl, () => thumbnailUrls.delete(key), thumbnailSize);
            thumbnailUrls.set(key, resolved);
        }
        return resolved;
    }
    const hold = holdMatrixMedia(client, mxcUrl);
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
