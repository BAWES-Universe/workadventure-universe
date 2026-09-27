import { AvailabilityStatus } from "@workadventure/messages";
import type { SelfIdentity } from "./PersonActions";
import { isConnected } from "./PersonActions";
import { userIdOnThisMap } from "./PersonTarget";

/**
 * Pure rules for showing one person once in the People tab, however many sessions (tabs, devices) they have open.
 *
 * Each session is its own entry in the world (its own space user id). The People tab groups them by account into one
 * row; the row stands for one "primary" session and lists the others under a toggle, each reachable on its own.
 * Counts are not affected: they keep counting sessions.
 */

export interface Session {
    spaceUserId?: string;
    uuid?: string;
    chatId?: string;
    playUri?: string;
    roomName?: string;
}

export interface PersonGroup<T extends Session> {
    /** Stable key for the row: the account (uuid, else chat id), else the session itself. */
    key: string;
    /** The session the row stands for: this tab for yourself, else one on your map, else the most available one. */
    primary: T;
    /** Every session of this person, primary first, then the ones on your map, then by room. */
    sessions: T[];
    /** One of the sessions is this tab. */
    isMe: boolean;
}

/** The account a session belongs to. Sessions without either id stay on their own. */
export function accountKey(session: Session): string | undefined {
    return session.uuid || session.chatId || undefined;
}

/** Lower is more available: online first, then busy-like statuses, then silent, then disconnected. */
export function availabilityRank(status: AvailabilityStatus | undefined): number {
    if (!isConnected(status)) return 3;
    if (status === AvailabilityStatus.ONLINE) return 0;
    if (status === AvailabilityStatus.SILENT || status === AvailabilityStatus.DENY_PROXIMITY_MEETING) return 2;
    return 1;
}

/** The most available of several statuses; undefined when there are none. */
export function bestStatus(statuses: (AvailabilityStatus | undefined)[]): AvailabilityStatus | undefined {
    let best: AvailabilityStatus | undefined;
    for (const status of statuses) {
        if (best === undefined || availabilityRank(status) < availabilityRank(best)) best = status;
    }
    return best;
}

/** Whether a session is this tab. Only the space user id can tell; account ids are shared by every session. */
export function isThisTab(session: Session, me: SelfIdentity): boolean {
    return !!session.spaceUserId && session.spaceUserId === me.spaceUserId;
}

/** Whether a session belongs to your own account (this tab or another of yours). */
export function isMyAccount(session: Session, me: SelfIdentity): boolean {
    return (
        (!!session.uuid && session.uuid === me.uuid) ||
        (!!session.chatId && session.chatId === me.chatId) ||
        isThisTab(session, me)
    );
}

/**
 * Groups sessions by account, keeping the order in which each account first appears.
 * `statusOf` reads a session's current status; it only decides which session stands for someone not on your map.
 */
export function groupSessions<T extends Session>(
    sessions: T[],
    me: SelfIdentity,
    currentRoomUrl: string | undefined,
    statusOf: (session: T) => AvailabilityStatus | undefined
): PersonGroup<T>[] {
    const byKey = new Map<string, T[]>();
    sessions.forEach((session, index) => {
        const key = accountKey(session) ?? `session:${session.spaceUserId ?? index}`;
        const list = byKey.get(key);
        if (list) list.push(session);
        else byKey.set(key, [session]);
    });

    return Array.from(byKey.entries()).map(([key, list]) => {
        const isMe = list.some((session) => isThisTab(session, me));
        const onMap = (session: T) => !!session.playUri && session.playUri === currentRoomUrl;
        const primary =
            list.find((session) => isThisTab(session, me)) ??
            mostAvailable(list.filter(onMap), statusOf) ??
            mostAvailable(list, statusOf) ??
            list[0];
        const others = list
            .filter((session) => session !== primary)
            .sort((a, b) => {
                const mapOrder = Number(onMap(b)) - Number(onMap(a));
                if (mapOrder !== 0) return mapOrder;
                return (a.roomName ?? a.playUri ?? "").localeCompare(b.roomName ?? b.playUri ?? "");
            });
        return { key, primary, sessions: [primary, ...others], isMe };
    });
}

function mostAvailable<T>(list: T[], statusOf: (session: T) => AvailabilityStatus | undefined): T | undefined {
    let best: T | undefined;
    for (const session of list) {
        if (best === undefined || availabilityRank(statusOf(session)) < availabilityRank(statusOf(best))) {
            best = session;
        }
    }
    return best;
}

/**
 * The session a Walk to or Locate on a person's row should reach: of their sessions on your map whose avatar you can
 * see, the one closest to you; otherwise the row's primary session.
 */
export function pickSessionToReach<T extends Session>(
    group: Pick<PersonGroup<T>, "primary" | "sessions">,
    currentRoomUrl: string | undefined,
    myPosition: { x: number; y: number } | undefined,
    positionOf: (userId: number) => { x: number; y: number } | undefined
): T {
    if (!myPosition) return group.primary;
    let nearest: T | undefined;
    let nearestDistance = Infinity;
    for (const session of group.sessions) {
        const userId = userIdOnThisMap(session, currentRoomUrl);
        if (userId === undefined) continue;
        const position = positionOf(userId);
        if (!position) continue;
        const distance = Math.hypot(position.x - myPosition.x, position.y - myPosition.y);
        if (distance < nearestDistance) {
            nearest = session;
            nearestDistance = distance;
        }
    }
    return nearest ?? group.primary;
}

/** People and bots of a list, each in the list's order. */
export function splitBots<G extends { primary: { isBot?: boolean } }>(groups: G[]): { people: G[]; bots: G[] } {
    const people: G[] = [];
    const bots: G[] = [];
    for (const group of groups) (group.primary.isBot ? bots : people).push(group);
    return { people, bots };
}

/** How many sessions a list of rows stands for: the People tab counts sessions, not rows. */
export function sessionCount(groups: { sessions: unknown[] }[]): number {
    return groups.reduce((total, group) => total + group.sessions.length, 0);
}
