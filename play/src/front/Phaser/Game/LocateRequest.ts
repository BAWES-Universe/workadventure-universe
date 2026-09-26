/**
 * The name of the person last looked for from the People tab. The server's answer only carries their avatar id, and
 * their avatar may not be on this map yet, so the card shows this name while searching instead of a placeholder.
 */

/** An answer later than this belongs to some other request. */
export const LOCATE_REQUEST_TTL_MS = 15_000;

let pending: { name: string | undefined; at: number; cancelled: boolean } | undefined;

export function rememberLocateRequest(name: string | undefined, now: number = Date.now()): void {
    pending = { name, at: now, cancelled: false };
}

/** The name asked for, if a request was made recently (the answer being awaited is for it). */
export function locateRequestName(now: number = Date.now()): string | undefined {
    if (!pending || pending.cancelled || now - pending.at > LOCATE_REQUEST_TTL_MS) return undefined;
    return pending.name;
}

/** Another card opened before the answer came: the answer, when it comes, no longer opens a card. */
export function cancelLocateRequest(): void {
    if (pending) pending.cancelled = true;
}

/**
 * Takes the request an answer belongs to (a recent one, or none: a search started elsewhere). Once taken, it's gone.
 */
export function takeLocateRequest(
    now: number = Date.now()
): { name: string | undefined; cancelled: boolean } | undefined {
    const request = pending && now - pending.at <= LOCATE_REQUEST_TTL_MS ? pending : undefined;
    pending = undefined;
    return request ? { name: request.name, cancelled: request.cancelled } : undefined;
}
