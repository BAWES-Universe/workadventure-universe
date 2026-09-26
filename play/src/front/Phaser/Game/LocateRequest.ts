/**
 * The name of the person last looked for from the People tab. The server's answer only carries their avatar id, and
 * their avatar may not be on this map yet, so the card shows this name while searching instead of a placeholder.
 */

/** An answer later than this belongs to some other request. */
export const LOCATE_REQUEST_TTL_MS = 15_000;

let pending: { name: string; at: number } | undefined;

export function rememberLocateRequest(name: string | undefined, now: number = Date.now()): void {
    pending = name ? { name, at: now } : undefined;
}

/** The name asked for, if a request was made recently (the answer being awaited is for it). */
export function locateRequestName(now: number = Date.now()): string | undefined {
    if (!pending || now - pending.at > LOCATE_REQUEST_TTL_MS) return undefined;
    return pending.name;
}
