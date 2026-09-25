/** Link previews need a full URL: a relative image is resolved against the page it is on. */
export function absoluteUrl(src: string, pageUrl: string): string {
    try {
        return new URL(src, pageUrl).toString();
    } catch {
        return src;
    }
}

/**
 * The protocol the visitor used. Behind several proxies, X-Forwarded-Proto can list one value per hop
 * ("https, http"): the first is the visitor's.
 */
export function requestProtocol(forwardedProto: string | undefined, fallback: string): string {
    const first = forwardedProto?.split(",")[0]?.trim();
    return first || fallback;
}
