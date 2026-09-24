/**
 * Pure rules for deciding which avatar a People tab action should reach.
 *
 * One account can be in the world several times, once per tab (a "clone"). All tabs share the account uuid, and the
 * server resolves a uuid to whichever tab it finds first, so asking the server "where is uuid X" cannot target one
 * specific tab. A space user id, however, is built as `${roomUrl}_${userId}` where userId identifies one avatar in
 * that map. For someone on this map we can therefore find the exact avatar among the remote players we already know
 * and act on it locally, without asking the server.
 */

export interface PersonLocation {
    spaceUserId?: string;
    uuid?: string;
    playUri?: string;
}

/**
 * The avatar id (userId) of someone on this map, taken from their space user id.
 * Returns undefined for someone on another map, or when the space user id is missing or not in the expected form.
 */
export function userIdOnThisMap(person: PersonLocation, currentRoomUrl: string | undefined): number | undefined {
    if (!person.spaceUserId || !currentRoomUrl || person.playUri !== currentRoomUrl) {
        return undefined;
    }
    const match = /_(\d+)$/.exec(person.spaceUserId);
    if (!match) {
        return undefined;
    }
    const userId = Number(match[1]);
    return Number.isSafeInteger(userId) ? userId : undefined;
}

export type PersonTarget =
    /** The exact avatar is known locally: act on it directly. */
    | { kind: "avatar"; userId: number }
    /**
     * Only the account is known: ask the server by uuid.
     * `avatarOnThisMap` is true when the person is on this map but their avatar is not among the known remote players
     * (for instance out of view). In that case, looking up a visible avatar by uuid could pick another tab of the
     * same account, so callers should go straight to the server.
     */
    | { kind: "account"; uuid: string; playUri: string; avatarOnThisMap: boolean }
    | { kind: "none" };

export function resolvePersonTarget(
    person: PersonLocation,
    currentRoomUrl: string | undefined,
    isAvatarKnown: (userId: number) => boolean
): PersonTarget {
    const userId = userIdOnThisMap(person, currentRoomUrl);
    if (userId !== undefined && isAvatarKnown(userId)) {
        return { kind: "avatar", userId };
    }
    if (person.uuid) {
        return {
            kind: "account",
            uuid: person.uuid,
            playUri: person.playUri ?? "",
            avatarOnThisMap: userId !== undefined,
        };
    }
    return { kind: "none" };
}
