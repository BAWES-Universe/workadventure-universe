export interface ChatSearchOpenInput {
    /** The search was already open (the search button was tapped, or an earlier fill or focus request opened it). */
    opened: boolean;
    /** The search text, from a typed query or a link that fills it ("Find people" after a proximity chat). */
    value: string;
    /** Something asked for the search field's focus ("New message", the search button). */
    focusRequested: boolean;
}

/**
 * Whether the footer shows the search field instead of Invite, search and "+": the person opened it, or something
 * else filled the text in or asked for the focus, which must show a field to land in.
 */
export function isChatSearchOpen({ opened, value, focusRequested }: ChatSearchOpenInput): boolean {
    return opened || value !== "" || focusRequested;
}
