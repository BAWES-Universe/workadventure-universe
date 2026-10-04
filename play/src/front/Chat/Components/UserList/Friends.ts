import type { Friend, FriendSession } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";

/**
 * Pure rules for the People tab's friends: which group a friend is in, the faces row, and the time labels.
 * Kept free of Svelte and game state so they can be unit tested.
 */

export type FriendGroupKey = "here" | "inThisWorld" | "otherWorlds" | "offline";

/** Where a friend is, as far as the People tab knows. */
export interface PlacedFriend {
    friend: Friend;
    group: FriendGroupKey;
    /** The session to reach them at: the one here, else the one in this world, else their latest. */
    session: FriendSession | undefined;
    /** Online, but where is not known: they hide it, or presence is unavailable. */
    locationUnknown: boolean;
    status: AvailabilityStatus;
}

/** Someone online in this world, from the world's own list (it knows where they are even when presence is down). */
export interface WorldSighting {
    playUri: string;
    roomName: string;
    status: AvailabilityStatus;
}

/** "/@/universe/world" of a Universe room link, or the link's path for other maps (one map, one "world"). */
export function worldOf(playUri: string | undefined): string | undefined {
    if (!playUri) return undefined;
    let path: string;
    try {
        path = new URL(playUri, "https://universe.invalid").pathname;
    } catch {
        return undefined;
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "@" && parts.length >= 3) return `/@/${parts[1]}/${parts[2]}`;
    return path;
}

export function isOnline(status: AvailabilityStatus | undefined): boolean {
    return status !== undefined && status !== AvailabilityStatus.UNCHANGED;
}

/**
 * Puts each friend in one group. The world's own list wins for anyone in it: they are here or in this world even
 * when presence is unavailable. Otherwise presence decides; without presence everyone else is offline (and the panel
 * says their status is unavailable).
 */
export function placeFriends(
    friends: readonly Friend[],
    currentRoomUrl: string | undefined,
    inWorld: (uuid: string) => WorldSighting | undefined,
    presenceAvailable: boolean
): PlacedFriend[] {
    const currentWorld = worldOf(currentRoomUrl);
    return friends.map((friend) => {
        const sighting = inWorld(friend.uuid);
        if (sighting) {
            const session: FriendSession = {
                playUri: sighting.playUri,
                universeName: "",
                worldName: "",
                roomName: sighting.roomName,
                availabilityStatus: sighting.status,
            };
            return {
                friend,
                group: sighting.playUri === currentRoomUrl ? "here" : "inThisWorld",
                session,
                locationUnknown: false,
                status: sighting.status,
            };
        }
        const presence = presenceAvailable ? friend.presence : undefined;
        if (!presence?.online) {
            return { friend, group: "offline", session: undefined, locationUnknown: !presenceAvailable, status: 0 };
        }
        const sessions = presence.sessions;
        const session =
            sessions.find((s) => s.playUri === currentRoomUrl) ??
            sessions.find((s) => currentWorld !== undefined && worldOf(s.playUri) === currentWorld) ??
            sessions[0];
        let group: FriendGroupKey = "otherWorlds";
        if (session && session.playUri === currentRoomUrl) group = "here";
        else if (session && currentWorld !== undefined && worldOf(session.playUri) === currentWorld)
            group = "inThisWorld";
        return {
            friend,
            group,
            session,
            locationUnknown: presence.locationHidden || !session,
            status: presence.availabilityStatus,
        };
    });
}

export function byName(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** The four groups of the Friends view, each alphabetical. */
export function groupFriends(placed: readonly PlacedFriend[]): Record<FriendGroupKey, PlacedFriend[]> {
    const groups: Record<FriendGroupKey, PlacedFriend[]> = { here: [], inThisWorld: [], otherWorlds: [], offline: [] };
    for (const entry of placed) groups[entry.group].push(entry);
    for (const key of Object.keys(groups) as FriendGroupKey[]) {
        groups[key].sort((a, b) => byName(a.friend, b.friend));
    }
    return groups;
}

/** Friends online in other worlds, for the Everyone view's faces row: the most available first, then by name. */
export function otherWorldFaces(placed: readonly PlacedFriend[]): PlacedFriend[] {
    return placed
        .filter((entry) => entry.group === "otherWorlds" && !entry.locationUnknown)
        .sort((a, b) => statusRank(a.status) - statusRank(b.status) || byName(a.friend, b.friend));
}

// Free to talk first; busy and do-not-disturb last.
function statusRank(status: AvailabilityStatus): number {
    switch (status) {
        case AvailabilityStatus.ONLINE:
            return 0;
        case AvailabilityStatus.BUSY:
        case AvailabilityStatus.DO_NOT_DISTURB:
            return 2;
        default:
            return 1;
    }
}

/** "5 min ago", "2 h ago", "yesterday"... in the player's language. Empty for a missing or unreadable date. */
export function relativeTime(iso: string | undefined, now: number, locale: string): string {
    if (!iso) return "";
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return "";
    const seconds = Math.round((time - now) / 1000);
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    const abs = Math.abs(seconds);
    if (abs < 60) return format.format(0, "minute");
    if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
    if (abs < 86400 * 30) return format.format(Math.round(seconds / 86400), "day");
    if (abs < 86400 * 365) return format.format(Math.round(seconds / (86400 * 30)), "month");
    return format.format(Math.round(seconds / (86400 * 365)), "year");
}
