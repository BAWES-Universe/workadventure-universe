/** Added to a picture's address when it is asked for again; storages ignore query fields they don't know. */
export const SEPARATE_CACHE_PARAM = "wa_cors";

/**
 * The same picture's address with one more query field, or undefined when it is not a picture from another site or
 * was already asked for that way.
 *
 * Orbit, and the pickers that show a Woka as a plain picture, leave a copy in the browser's cache that lacks the
 * header that lets the game read it. A game load that asks for the header is then answered from that copy and fails at
 * once (#1133). The address with one more field has no cached copy, so the storage is asked and sends the header.
 */
export function withSeparateCache(url: string): string | undefined {
    let address: URL;
    try {
        address = new URL(url, window.location.href);
    } catch {
        return undefined;
    }
    if (
        address.origin === window.location.origin ||
        (address.protocol !== "https:" && address.protocol !== "http:") ||
        address.searchParams.has(SEPARATE_CACHE_PARAM)
    ) {
        return undefined;
    }
    address.searchParams.set(SEPARATE_CACHE_PARAM, "1");
    return address.toString();
}
