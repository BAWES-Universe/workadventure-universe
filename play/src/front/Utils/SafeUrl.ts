/**
 * Links that would run code in the game's page when opened, instead of loading a page.
 */
const SCRIPT_PROTOCOLS: ReadonlySet<string> = new Set(["javascript:", "data:", "vbscript:"]);

/**
 * False for a link that would run code in the game's page when navigated to (javascript:, data:...), or that is not
 * a link at all. Relative links are fine.
 */
export function isNavigableUrl(url: string, base: string = window.location.href): boolean {
    try {
        return !SCRIPT_PROTOCOLS.has(new URL(url, base).protocol);
    } catch {
        return false;
    }
}

/**
 * True only for an absolute http(s) link.
 */
export function isHttpUrl(url: string): boolean {
    try {
        const protocol = new URL(url).protocol;
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}
