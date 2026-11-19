import { writable } from "svelte/store";
import type { Readable } from "svelte/store";

/**
 * The link a Brick's words carry to one of the owner's Apps (game #2006): after other people used up the day, the note in the
 * owner's own chat says `[Change the limit](#apps=<id>)`, and the App's page opens here on that App. Followed here, never
 * as an address. An id that is not the person's own opens a page that says it could not be read, nothing else.
 */
export const APP_LINK = "#apps=";

/** The App a link points at, when it is such a link. */
export function appLinkId(href: string | null | undefined): string | undefined {
    if (!href?.startsWith(APP_LINK)) return undefined;
    const id = href.slice(APP_LINK.length).trim();
    return id && /^[\w-]{1,64}$/.test(id) ? id : undefined;
}

const wanted = writable<string | undefined>(undefined);
/** The App whose page the Apps page should open when it sees this; it clears it once read. */
export const appPageStart: Readable<string | undefined> = { subscribe: wanted.subscribe };

export function takeAppPageStart(): void {
    wanted.set(undefined);
}

/** Asks the Apps page to open this App; the caller opens the Apps page itself (kept apart so this file stays light). */
export function requestAppPage(appId: string): void {
    wanted.set(appId);
}
