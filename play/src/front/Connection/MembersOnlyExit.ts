import { localUserStore } from "./LocalUserStore";

/** The code Orbit sends when a player is not allowed into a members-only room. */
export const MEMBERS_ONLY_CODE = "MEMBERS_ONLY";

interface RoomLeft {
    href: string;
    name: string | undefined;
    /** The room that was being entered. */
    toKey: string;
}

/** Where the player was just before moving to another room in this tab (Visit, an exit, WA.nav.goToRoom). */
let roomLeft: RoomLeft | undefined;

export function rememberRoomLeft(from: { href: string; roomName?: string }, to: { key: string }): void {
    roomLeft = { href: from.href, name: from.roomName, toKey: to.key };
}

export type MembersOnlyExit =
    /** The room the player came from. */
    | { kind: "back"; href: string; name: string | undefined }
    /** Opened from a shared link or a fresh start: there is no room to go back to. */
    | { kind: "start"; href: string };

/** Where the "Members only" screen sends the player: back to the room they came from, else the start room. */
export function membersOnlyExit(deniedKey: string | undefined, origin: string): MembersOnlyExit {
    if (roomLeft && deniedKey !== undefined && roomLeft.toKey === deniedKey) {
        return { kind: "back", href: roomLeft.href, name: roomLeft.name };
    }
    return { kind: "start", href: new URL("/", origin).toString() };
}

/**
 * The room that turned the player away is not their last room: opening Universe again goes to the room they
 * came from, or to the start room.
 */
export function forgetDeniedRoom(exit: MembersOnlyExit): Promise<void> {
    return localUserStore.setLastRoomUrl(exit.href);
}
