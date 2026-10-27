/**
 * The name and Woka of the person last looked for from the People tab. The server's answer only carries their avatar
 * id, and their avatar may not be on this map yet (far away on a large map), so the card shows these while searching
 * instead of a placeholder and an empty space where the Woka goes.
 */

import type { PictureStore } from "../../Stores/PictureStore";

/** An answer later than this belongs to some other request. */
export const LOCATE_REQUEST_TTL_MS = 15_000;

let pending:
    | {
          name: string | undefined;
          picture?: PictureStore;
          at: number;
          cancelled: boolean;
          avatarId?: number;
          uuid?: string;
      }
    | undefined;

/**
 * `avatarId` and `uuid` are the avatar and account asked for, when known. The server may answer with another avatar of
 * the same account (the asked one left), so an answer is told apart by account, never by avatar alone.
 */
export function rememberLocateRequest(
    name: string | undefined,
    picture?: PictureStore,
    now: number = Date.now(),
    avatarId?: number,
    uuid?: string
): void {
    pending = { name, picture, at: now, cancelled: false, avatarId, uuid };
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
 * An answer about another person than the one now asked for: the one asked for first, which another search replaced.
 * Told apart only when both accounts are known: the same account answering with another of its avatars, or an account
 * not known on this map, is taken for the answer awaited.
 */
export function isStaleLocateAnswer(
    now: number = Date.now(),
    answeredAvatarId?: number,
    answeredUuid?: string
): boolean {
    return (
        pending !== undefined &&
        pending.avatarId !== undefined &&
        answeredAvatarId !== undefined &&
        pending.avatarId !== answeredAvatarId &&
        pending.uuid !== undefined &&
        answeredUuid !== undefined &&
        pending.uuid !== answeredUuid &&
        now - pending.at <= LOCATE_REQUEST_TTL_MS
    );
}

/**
 * Takes the request an answer belongs to (a recent one, or none: a search started elsewhere). Once taken, it's gone.
 * An answer about another person than the one asked for (two people looked for in a row) leaves the request for
 * its own answer.
 */
export function takeLocateRequest(
    now: number = Date.now(),
    answeredAvatarId?: number,
    answeredUuid?: string
): { name: string | undefined; picture?: PictureStore; cancelled: boolean } | undefined {
    if (isStaleLocateAnswer(now, answeredAvatarId, answeredUuid)) return undefined;
    const request = pending && now - pending.at <= LOCATE_REQUEST_TTL_MS ? pending : undefined;
    pending = undefined;
    return request ? { name: request.name, picture: request.picture, cancelled: request.cancelled } : undefined;
}
