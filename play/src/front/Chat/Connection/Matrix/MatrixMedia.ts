import type { MatrixClient } from "matrix-js-sdk";

// One download per file per session: the same image in a reply, a thread or after a decryption isn't fetched again.
const resolvedUrls = new Map<string, Promise<string | undefined>>();

/**
 * Returns a URL the browser can show for a Matrix file (mxc://…).
 *
 * Synapse 1.120+ serves new uploads only from the authenticated media endpoints, which need the access token in an
 * Authorization header. An <img>, <video> or download link can't send it, so the file is fetched here and shown from
 * a blob: URL. Servers without authenticated media keep the legacy URL.
 */
export function resolveMatrixMediaUrl(client: MatrixClient, mxcUrl: unknown): Promise<string | undefined> {
    if (typeof mxcUrl !== "string" || !mxcUrl.startsWith("mxc://")) {
        return Promise.resolve(undefined);
    }
    let resolved = resolvedUrls.get(mxcUrl);
    if (!resolved) {
        resolved = fetchMatrixMedia(client, mxcUrl);
        resolvedUrls.set(mxcUrl, resolved);
    }
    return resolved;
}

async function fetchMatrixMedia(client: MatrixClient, mxcUrl: string): Promise<string | undefined> {
    const legacyUrl = client.mxcUrlToHttp(mxcUrl) ?? undefined;
    const authenticatedUrl = client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, true, true);
    const accessToken = client.getAccessToken();
    if (!authenticatedUrl || !accessToken) {
        return legacyUrl;
    }
    try {
        const response = await fetch(authenticatedUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) {
            // Older servers don't know the authenticated endpoint; the legacy one is all they have.
            return legacyUrl;
        }
        return URL.createObjectURL(await response.blob());
    } catch (error) {
        console.error("Could not load a chat file", error);
        // A network blip: try again the next time the file is shown.
        resolvedUrls.delete(mxcUrl);
        return legacyUrl;
    }
}
