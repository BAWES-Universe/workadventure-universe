import { opensHere } from "./EmbeddableLinks";
import { fetchWebPreview } from "./LinkPreviewFetcher";
import { openChatLinkHere } from "./openChatLinkHere";

/** The most profile links checked at once: a profile's links, as Orbit and the player card send them. */
export const MAX_PROFILE_LINKS = 10;

/** A list of links as Orbit or the player card send it: 1 to 10 addresses, none absurdly long. */
export function isProfileLinkList(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= MAX_PROFILE_LINKS &&
        value.every((url) => typeof url === "string" && url.length >= 1 && url.length <= 2048)
    );
}

/**
 * Whether a message comes from the card's own address. The card's frame can leave that address (a link inside it that
 * opens in the frame), and the frame's window stays the same, so the window alone does not say who is speaking.
 */
export function isFromCardOrigin(messageOrigin: string, cardUrl: string | undefined, base: string): boolean {
    if (!cardUrl) return false;
    try {
        return new URL(cardUrl, base).origin === messageOrigin;
    } catch {
        return false;
    }
}

function isHttps(url: string): boolean {
    try {
        return new URL(url).protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Which of someone's profile links open in the window: each is checked as a chat link is, by its preview, which says
 * whether the page may be shown inside the game. Asked when the card shows, so a click on one opens at once.
 */
export async function profileLinksOpeningHere(urls: readonly string[]): Promise<string[]> {
    const candidates = [...new Set(urls)].slice(0, MAX_PROFILE_LINKS).filter(isHttps);
    // A preview that can't load leaves its link out: it opens a new tab, as before.
    await Promise.all(candidates.map((url) => fetchWebPreview(url)));
    return candidates.filter((url) => opensHere(url));
}

/**
 * Opens a profile link in the window, in front of Orbit or a card, when it was checked and the page may be shown.
 * False for any other link, which the page then leaves alone.
 */
export function openProfileLinkHere(url: string): boolean {
    if (!opensHere(url)) return false;
    openChatLinkHere(url);
    return true;
}
