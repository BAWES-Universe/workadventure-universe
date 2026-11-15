/**
 * The links a Brick's answer carries to the Usage page: "[What it used](#usage=<task>)" opens Usage on Activity with that
 * task's receipt open, and "[Usage](#usage)" opens the page. Nothing in here reads a store, so every rule can be unit tested.
 */

/** The link a Brick's words carry to the Usage page, with or without a task. Followed in the game instead of leaving it. */
export const USAGE_LINK = "#usage";

/** What a link asks for: the page, and one task's receipt open on it. */
export interface UsageRequest {
    receiptId: string | undefined;
}

/**
 * What a link to Usage asks for, or undefined when it is not one. A task id that is not a plain id is no task: the page
 * still opens.
 */
export function usageLinkRequest(href: string | null | undefined): UsageRequest | undefined {
    if (href === USAGE_LINK) return { receiptId: undefined };
    if (!href?.startsWith(`${USAGE_LINK}=`)) return undefined;
    const id = href.slice(USAGE_LINK.length + 1).trim();
    return { receiptId: /^[\w-]{1,64}$/.test(id) ? id : undefined };
}
