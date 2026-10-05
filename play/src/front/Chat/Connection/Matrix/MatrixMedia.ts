import type { MatrixClient } from "matrix-js-sdk";
import type { Readable } from "svelte/store";
import { readable } from "svelte/store";

// One download per file per session: the same image in a reply, a thread or after a decryption isn't fetched again.
const resolvedUrls = new Map<string, Promise<string | undefined>>();

const ENDPOINT_UNKNOWN_STATUSES = [400, 404, 405];

/**
 * Returns a URL the browser can show for a Matrix file (mxc://…).
 *
 * Synapse 1.120+ serves new uploads only from the authenticated media endpoints, which need the access token in an
 * Authorization header. An <img>, <video> or download link can't send it, so the file is fetched here and shown from
 * a blob: URL. Servers without authenticated media keep the legacy URL.
 */
export function resolveMatrixMediaUrl(
    client: MatrixClient,
    mxcUrl: unknown,
    thumbnailSize?: number
): Promise<string | undefined> {
    if (typeof mxcUrl !== "string" || !mxcUrl.startsWith("mxc://")) {
        return Promise.resolve(undefined);
    }
    const key = thumbnailSize ? `${mxcUrl}#${thumbnailSize}` : mxcUrl;
    let resolved = resolvedUrls.get(key);
    if (!resolved) {
        resolved = fetchMatrixMedia(client, mxcUrl, key, thumbnailSize);
        resolvedUrls.set(key, resolved);
    }
    return resolved;
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

async function fetchMatrixMedia(
    client: MatrixClient,
    mxcUrl: string,
    key: string,
    thumbnailSize?: number
): Promise<string | undefined> {
    const size = thumbnailSize ?? undefined;
    const method = thumbnailSize ? "scale" : undefined;
    const legacyUrl = client.mxcUrlToHttp(mxcUrl, size, size, method) ?? undefined;
    const authenticatedUrl = client.mxcUrlToHttp(mxcUrl, size, size, method, false, true, true);
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
                resolvedUrls.delete(key);
            }
            return legacyUrl;
        }
        return URL.createObjectURL(await response.blob());
    } catch (error) {
        console.error("Could not load a chat file", error);
        // A network blip: try again the next time the file is shown.
        resolvedUrls.delete(key);
        return legacyUrl;
    }
}
