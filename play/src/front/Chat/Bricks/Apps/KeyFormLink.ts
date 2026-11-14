import { writable } from "svelte/store";
import type { Readable } from "svelte/store";

/**
 * The link and the sheet's open state of the safe form for a key (Keys for Apps, game #2044), kept apart from the form's reading so
 * the chat's link handling stays light. A Brick never takes a key in chat: it opens a link in its words,
 * `[Add your Tap key](#key-form=<id>)`, and the form is where the key is typed.
 */

/** The link a Brick's words carry to the form: "#key-form=<id>". Followed here instead of leaving the game. */
export const KEY_FORM_LINK = "#key-form=";

/** The form a link points at, when it is such a link. */
export function keyFormLinkId(href: string | null | undefined): string | undefined {
    if (!href?.startsWith(KEY_FORM_LINK)) return undefined;
    const id = href.slice(KEY_FORM_LINK.length).trim();
    return id && /^[\w-]{1,64}$/.test(id) ? id : undefined;
}

const open = writable<string | undefined>(undefined);
/** The form whose sheet is open now, if any. One host at a time draws it. */
export const keyFormOpen: Readable<string | undefined> = { subscribe: open.subscribe };

export function openKeyFormSheet(formId: string): void {
    open.set(formId);
}

export function closeKeyFormSheet(): void {
    open.set(undefined);
}

/** Where several hosts are mounted at once (the chat and the Apps page), only the latest one draws the sheet. */
const hosts = writable<symbol[]>([]);
export const keyFormHosts: Readable<symbol[]> = { subscribe: hosts.subscribe };

export function mountHost(me: symbol): () => void {
    hosts.update((all) => [...all, me]);
    return () => hosts.update((all) => all.filter((one) => one !== me));
}

export function isActiveHost(me: symbol, all: symbol[]): boolean {
    return all[all.length - 1] === me;
}
