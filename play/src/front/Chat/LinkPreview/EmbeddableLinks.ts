/**
 * Which chat links open in the Open here window: the pages the server, reading them for their preview, found the game
 * may show (both frame headers, https all the way). Known before the click, so the click opens at once and a page that
 * refuses still gets its new tab straight from the click, never a blocked one.
 */
const embeddableLinks = new Set<string>();

function keyOf(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.href;
    } catch {
        return undefined;
    }
}

/** The server's answer for a previewed link, under the address asked for and the one the preview gives back. */
export function rememberEmbeddable(requestedUrl: string, preview: { url?: string; embeddable?: boolean } | undefined) {
    if (!preview?.embeddable) return;
    for (const url of [requestedUrl, preview.url]) {
        const key = url ? keyOf(url) : undefined;
        if (key) embeddableLinks.add(key);
    }
}

/**
 * A link to open in the window: an https page the server said can be shown, that isn't Universe itself (the game in a
 * frame of itself). Anything else, and any link not previewed yet, keeps opening a new tab.
 */
export function opensHere(url: string, ownOrigin: string = window.location.origin): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:" || parsed.origin === ownOrigin) return false;
    const key = keyOf(url);
    return key !== undefined && embeddableLinks.has(key);
}

/** A plain left click: Ctrl, Cmd, Shift, Alt and middle clicks are how people ask for a new tab. */
export function isPlainClick(event: MouseEvent): boolean {
    return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
