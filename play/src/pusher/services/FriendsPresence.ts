import type { FriendPresence, FriendSession, FriendsUpdateMessage } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { SocketData } from "../models/Websocket/SocketData";
import type { FriendPlace } from "./FriendsService";
import { FRIEND_PLACES_MAX_URIS } from "./FriendsService";

type FriendsSocketData = Pick<
    SocketData,
    | "userUuid"
    | "isLogged"
    | "roomId"
    | "roomName"
    | "availabilityStatus"
    | "disconnecting"
    | "tags"
    | "characterTextures"
>;

export interface FriendsSocket {
    getUserData(): FriendsSocketData;
}

export interface FriendsPresenceDependencies<S extends FriendsSocket> {
    send(socket: S, message: FriendsUpdateMessage): void;
    /** Display names of rooms (at most FRIEND_PLACES_MAX_URIS per call). May reject. */
    lookupPlaces(playUris: string[]): Promise<Record<string, FriendPlace | null>>;
    now?: () => number;
    /** How long changes of one user are gathered before their watchers are told. */
    coalesceMs?: number;
    placesTtlMs?: number;
    /** How long a failed places lookup is not retried. */
    placesFailureTtlMs?: number;
    /** How long a presence push waits for room names before sending what it has. */
    placesTimeoutMs?: number;
}

export interface FriendWatch {
    uuid: string;
    shareLocation: boolean;
}

/** One open tab of a signed-in user. */
export interface PresenceSession {
    playUri: string;
    roomName: string;
    availabilityStatus: AvailabilityStatus;
    joinedAt: number;
    /** The Woka's layer images, as the player wears it in this tab. */
    woka: string[];
}

/** The live directory as Orbit reads it: who is where, and how many guests and bots are with them. */
export interface PresenceSnapshot {
    generatedAt: number;
    users: {
        uuid: string;
        status: LiveStatus;
        woka: string[];
        sessions: { playUri: string; since: number }[];
    }[];
    /** Per room, the players who aren't signed in. */
    rooms: Record<string, { guests: number; bots: number }>;
}

export type LiveStatus = "online" | "busy" | "away";

const AWAY_STATUSES = new Set([AvailabilityStatus.BACK_IN_A_MOMENT, AvailabilityStatus.AWAY]);
const BUSY_STATUSES = new Set([
    AvailabilityStatus.BUSY,
    AvailabilityStatus.DO_NOT_DISTURB,
    AvailabilityStatus.LIVEKIT,
    AvailabilityStatus.JITSI,
    AvailabilityStatus.BBB,
    AvailabilityStatus.SPEAKER,
    AvailabilityStatus.LISTENER,
]);

/** The three dots Orbit shows: in a meeting or call reads as busy. */
export function liveStatus(status: AvailabilityStatus): LiveStatus {
    if (AWAY_STATUSES.has(status)) return "away";
    if (BUSY_STATUSES.has(status)) return "busy";
    return "online";
}

export function isBotSocket(data: Pick<SocketData, "tags" | "userUuid">): boolean {
    return data.tags.includes("bot") || data.userUuid.startsWith("bot-");
}

const ROOM_NAME_MAX_LENGTH = 80;
const DEFAULT_COALESCE_MS = 500;
const DEFAULT_PLACES_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PLACES_FAILURE_TTL_MS = 30 * 1000;
const DEFAULT_PLACES_TIMEOUT_MS = 3000;
const PLACES_CACHE_SWEEP_SIZE = 5000;

// Most available first. A status missing from the list ranks below all of them.
const AVAILABILITY_ORDER: AvailabilityStatus[] = [
    AvailabilityStatus.ONLINE,
    AvailabilityStatus.LIVEKIT,
    AvailabilityStatus.JITSI,
    AvailabilityStatus.BBB,
    AvailabilityStatus.LISTENER,
    AvailabilityStatus.SPEAKER,
    AvailabilityStatus.SILENT,
    AvailabilityStatus.DENY_PROXIMITY_MEETING,
    AvailabilityStatus.BACK_IN_A_MOMENT,
    AvailabilityStatus.AWAY,
    AvailabilityStatus.BUSY,
    AvailabilityStatus.DO_NOT_DISTURB,
];

function availabilityRank(status: AvailabilityStatus): number {
    const rank = AVAILABILITY_ORDER.indexOf(status);
    return rank === -1 ? AVAILABILITY_ORDER.length : rank;
}

export function mostAvailableStatus(statuses: AvailabilityStatus[]): AvailabilityStatus {
    let best: AvailabilityStatus | undefined;
    for (const status of statuses) {
        if (best === undefined || availabilityRank(status) < availabilityRank(best)) {
            best = status;
        }
    }
    if (best === undefined) {
        return AvailabilityStatus.UNCHANGED;
    }
    // Online with no known status yet: say online rather than the "offline" UNCHANGED.
    return availabilityRank(best) === AVAILABILITY_ORDER.length ? AvailabilityStatus.ONLINE : best;
}

function pairKey(userUuidA: string, userUuidB: string): string {
    return userUuidA < userUuidB ? `${userUuidA}|${userUuidB}` : `${userUuidB}|${userUuidA}`;
}

export function cleanRoomName(roomName: string): string {
    return roomName.trim().slice(0, ROOM_NAME_MAX_LENGTH);
}

export function computePresence(
    sessions: PresenceSession[],
    shareLocation: boolean,
    places: ReadonlyMap<string, FriendPlace | null>
): FriendPresence {
    const online = sessions.length > 0;
    const availabilityStatus = mostAvailableStatus(sessions.map((session) => session.availabilityStatus));
    if (!shareLocation) {
        return { online, locationHidden: online, availabilityStatus, sessions: [] };
    }
    return {
        online,
        locationHidden: false,
        availabilityStatus,
        sessions: [...sessions]
            .sort((a, b) => b.joinedAt - a.joinedAt)
            .map((session): FriendSession => {
                const place = places.get(session.playUri);
                return {
                    playUri: session.playUri,
                    universeName: place?.universe ?? "",
                    worldName: place?.world ?? "",
                    roomName: place?.room || session.roomName,
                    availabilityStatus: session.availabilityStatus,
                };
            }),
    };
}

/**
 * Who of the signed-in players is connected, where, and who wants to hear about it.
 *
 * In memory: prod and dev run a single pusher, so this pusher sees every connected player. With several
 * pushers this class is what would move to a shared store (Redis), behind the same methods.
 *
 * A watcher is a socket that fetched its friends list: it is told every presence change of each of those
 * friends (FriendsUpdateMessage.presence), with or without their location depending on the friend's choice.
 */
export class FriendsPresence<S extends FriendsSocket> {
    // userUuid => that user's open tabs
    private readonly sessions = new Map<string, Map<S, PresenceSession>>();
    // watched userUuid => the sockets watching them
    private readonly watchers = new Map<string, Map<S, { shareLocation: boolean }>>();
    // socket => the userUuids it watches
    private readonly watching = new Map<S, Set<string>>();
    private readonly pendingPushes = new Map<string, ReturnType<typeof setTimeout>>();
    // socket => where a guest or a bot is: counted per room, never named
    private readonly visitors = new Map<S, { playUri: string; bot: boolean }>();
    private readonly places = new Map<string, { place: FriendPlace | null; expiresAt: number }>();
    private readonly placesInFlight = new Map<string, Promise<void>>();
    // A friends list loaded before a block or a removal still has that person in it. Loads and unlinks are numbered on
    // one clock, so a load can tell it began before an unlink. Unlinks are only remembered while such a load runs.
    private clock = 0;
    private readonly listLoadsRunning = new Set<number>();
    private readonly unlinkedAt = new Map<string, number>();

    private readonly now: () => number;
    private readonly coalesceMs: number;
    private readonly placesTtlMs: number;
    private readonly placesFailureTtlMs: number;
    private readonly placesTimeoutMs: number;

    constructor(private readonly deps: FriendsPresenceDependencies<S>) {
        this.now = deps.now ?? Date.now;
        this.coalesceMs = deps.coalesceMs ?? DEFAULT_COALESCE_MS;
        this.placesTtlMs = deps.placesTtlMs ?? DEFAULT_PLACES_TTL_MS;
        this.placesFailureTtlMs = deps.placesFailureTtlMs ?? DEFAULT_PLACES_FAILURE_TTL_MS;
        this.placesTimeoutMs = deps.placesTimeoutMs ?? DEFAULT_PLACES_TIMEOUT_MS;
    }

    /** A socket joined its room. Signed-in players are tracked by name; guests and bots only counted. */
    track(socket: S): void {
        const data = socket.getUserData();
        if (data.disconnecting) {
            return;
        }
        if (!data.isLogged || !data.userUuid) {
            if (data.roomId) this.visitors.set(socket, { playUri: data.roomId, bot: isBotSocket(data) });
            return;
        }
        let userSessions = this.sessions.get(data.userUuid);
        if (!userSessions) {
            userSessions = new Map();
            this.sessions.set(data.userUuid, userSessions);
        }
        userSessions.set(socket, {
            playUri: data.roomId,
            roomName: cleanRoomName(data.roomName),
            availabilityStatus: data.availabilityStatus,
            joinedAt: this.now(),
            woka: data.characterTextures.map((texture) => texture.url).filter(Boolean),
        });
        this.schedulePush(data.userUuid);
    }

    /** A socket is closing: it is no longer a session, nor a watcher. */
    untrack(socket: S): void {
        this.unwatchAll(socket);
        this.visitors.delete(socket);
        const userUuid = socket.getUserData().userUuid;
        const userSessions = this.sessions.get(userUuid);
        if (!userSessions?.delete(socket)) {
            return;
        }
        if (userSessions.size === 0) {
            this.sessions.delete(userUuid);
        }
        this.schedulePush(userUuid);
    }

    setStatus(socket: S, availabilityStatus: AvailabilityStatus): void {
        if (availabilityStatus === AvailabilityStatus.UNCHANGED) {
            return;
        }
        const userUuid = socket.getUserData().userUuid;
        const session = this.sessions.get(userUuid)?.get(socket);
        if (!session || session.availabilityStatus === availabilityStatus) {
            return;
        }
        session.availabilityStatus = availabilityStatus;
        this.schedulePush(userUuid);
    }

    /** Replaces what the socket watches. */
    watch(socket: S, friends: FriendWatch[]): void {
        this.unwatchAll(socket);
        if (socket.getUserData().disconnecting || friends.length === 0) {
            return;
        }
        const watched = new Set<string>();
        for (const friend of friends) {
            let friendWatchers = this.watchers.get(friend.uuid);
            if (!friendWatchers) {
                friendWatchers = new Map();
                this.watchers.set(friend.uuid, friendWatchers);
            }
            friendWatchers.set(socket, { shareLocation: friend.shareLocation });
            watched.add(friend.uuid);
        }
        this.watching.set(socket, watched);
    }

    /** A friends list is about to be loaded. Pass the number to withoutUnlinked, then to finishListLoad. */
    startListLoad(): number {
        const load = ++this.clock;
        this.listLoadsRunning.add(load);
        return load;
    }

    /** The answer built from a friends list is ready (or the load failed). */
    finishListLoad(load: number): void {
        this.listLoadsRunning.delete(load);
        if (this.listLoadsRunning.size === 0) {
            this.unlinkedAt.clear();
            return;
        }
        const oldestLoad = Math.min(...this.listLoadsRunning);
        for (const [pair, at] of this.unlinkedAt) {
            if (at <= oldestLoad) this.unlinkedAt.delete(pair);
        }
    }

    /**
     * Drops from a friends list the people who were blocked or removed after the list began loading: that list still
     * has them, and must not watch them again or show where they are. The block always wins.
     */
    withoutUnlinked<T extends { uuid: string }>(load: number, userUuid: string, friends: T[]): T[] {
        return friends.filter((friend) => (this.unlinkedAt.get(pairKey(userUuid, friend.uuid)) ?? 0) < load);
    }

    /** Two players stop hearing about each other (a friendship removed, or a block), on every tab. */
    unlink(userUuidA: string, userUuidB: string): void {
        if (this.listLoadsRunning.size > 0) {
            this.unlinkedAt.set(pairKey(userUuidA, userUuidB), ++this.clock);
        }
        for (const socket of this.socketsOf(userUuidA)) {
            this.unwatch(socket, userUuidB);
        }
        for (const socket of this.socketsOf(userUuidB)) {
            this.unwatch(socket, userUuidA);
        }
    }

    /** The user changed whether their friends see where they are. */
    setShareLocation(userUuid: string, shareLocation: boolean): void {
        const userWatchers = this.watchers.get(userUuid);
        if (!userWatchers) {
            return;
        }
        let changed = false;
        for (const watch of userWatchers.values()) {
            if (watch.shareLocation !== shareLocation) {
                watch.shareLocation = shareLocation;
                changed = true;
            }
        }
        if (changed) {
            this.schedulePush(userUuid);
        }
    }

    /** The open, signed-in tabs of a user. */
    /** Everyone connected right now. Orbit decides who may see whom. */
    snapshot(): PresenceSnapshot {
        const users: PresenceSnapshot["users"] = [];
        for (const [uuid, userSessions] of this.sessions) {
            const sessions = [...userSessions.values()].sort((a, b) => b.joinedAt - a.joinedAt);
            if (sessions.length === 0) continue;
            users.push({
                uuid,
                status: liveStatus(mostAvailableStatus(sessions.map((session) => session.availabilityStatus))),
                woka: sessions[0].woka,
                sessions: sessions.map((session) => ({ playUri: session.playUri, since: session.joinedAt })),
            });
        }
        const rooms: PresenceSnapshot["rooms"] = {};
        for (const visitor of this.visitors.values()) {
            const room = (rooms[visitor.playUri] ??= { guests: 0, bots: 0 });
            if (visitor.bot) room.bots++;
            else room.guests++;
        }
        return { generatedAt: this.now(), users, rooms };
    }

    socketsOf(userUuid: string): S[] {
        return Array.from(this.sessions.get(userUuid)?.keys() ?? []).filter(
            (socket) => !socket.getUserData().disconnecting
        );
    }

    /** The most available status across a user's open tabs; UNCHANGED when they have none. */
    statusOf(userUuid: string): AvailabilityStatus {
        return mostAvailableStatus(this.sessionsOf(userUuid).map((session) => session.availabilityStatus));
    }

    /** Display names of one room, from the cache or Orbit; null when unknown or the lookup failed. */
    async placeOf(playUri: string): Promise<FriendPlace | null> {
        return (await this.resolvePlaces([playUri])).get(playUri) ?? null;
    }

    /** The current presence of each friend, for a friends list. */
    async presencesOf(friends: FriendWatch[]): Promise<Map<string, FriendPresence>> {
        const playUris = friends
            .filter((friend) => friend.shareLocation)
            .flatMap((friend) => this.sessionsOf(friend.uuid).map((session) => session.playUri));
        const places = await this.resolvePlaces(playUris);
        return new Map(
            friends.map((friend) => [
                friend.uuid,
                computePresence(this.sessionsOf(friend.uuid), friend.shareLocation, places),
            ])
        );
    }

    private sessionsOf(userUuid: string): PresenceSession[] {
        return Array.from(this.sessions.get(userUuid)?.values() ?? []);
    }

    private unwatch(socket: S, watchedUuid: string): void {
        const friendWatchers = this.watchers.get(watchedUuid);
        friendWatchers?.delete(socket);
        if (friendWatchers?.size === 0) {
            this.watchers.delete(watchedUuid);
        }
        this.watching.get(socket)?.delete(watchedUuid);
    }

    private unwatchAll(socket: S): void {
        for (const watchedUuid of this.watching.get(socket) ?? []) {
            const friendWatchers = this.watchers.get(watchedUuid);
            friendWatchers?.delete(socket);
            if (friendWatchers?.size === 0) {
                this.watchers.delete(watchedUuid);
            }
        }
        this.watching.delete(socket);
    }

    // A room change is a leave then a join: gathering changes for a moment sends watchers one update.
    private schedulePush(userUuid: string): void {
        if (this.pendingPushes.has(userUuid)) {
            return;
        }
        this.pendingPushes.set(
            userUuid,
            setTimeout(() => {
                this.pendingPushes.delete(userUuid);
                this.push(userUuid).catch((e) => {
                    console.error("FriendsPresence => error while pushing a presence", e);
                });
            }, this.coalesceMs)
        );
    }

    private async push(userUuid: string): Promise<void> {
        const watchersBefore = this.watchers.get(userUuid);
        if (!watchersBefore || watchersBefore.size === 0) {
            return;
        }
        let places = await this.placesFor(userUuid, watchersBefore, new Map());

        // Sessions and watchers may have changed while the names were looked up: use the latest,
        // and look up the names a new session or a newly added watcher who sees places still needs.
        const userWatchers = this.watchers.get(userUuid);
        if (!userWatchers) {
            return;
        }
        places = await this.placesFor(userUuid, userWatchers, places);
        const sessions = this.sessionsOf(userUuid);
        const visible = computePresence(sessions, true, places);
        const hidden = computePresence(sessions, false, places);
        for (const [socket, watch] of userWatchers) {
            if (socket.getUserData().disconnecting) {
                continue;
            }
            try {
                this.deps.send(socket, {
                    update: {
                        $case: "presence",
                        presence: { uuid: userUuid, presence: watch.shareLocation ? visible : hidden },
                    },
                });
            } catch (e) {
                console.warn("FriendsPresence => error while sending a presence", e);
            }
        }
    }

    /** Adds the room names still missing from known, when one of these watchers sees places. */
    private async placesFor(
        userUuid: string,
        userWatchers: Map<S, { shareLocation: boolean }>,
        known: Map<string, FriendPlace | null>
    ): Promise<Map<string, FriendPlace | null>> {
        if (!Array.from(userWatchers.values()).some((watch) => watch.shareLocation)) {
            return known;
        }
        const missing = this.sessionsOf(userUuid)
            .map((session) => session.playUri)
            .filter((uri) => !known.has(uri));
        if (missing.length === 0) {
            return known;
        }
        return new Map([...known, ...(await this.resolvePlaces(missing))]);
    }

    /** Room names by play URI, from the cache or Orbit; never waits longer than placesTimeoutMs. */
    private async resolvePlaces(playUris: string[]): Promise<Map<string, FriendPlace | null>> {
        const uris = Array.from(new Set(playUris));
        const now = this.now();
        const missing = uris.filter((uri) => {
            const cached = this.places.get(uri);
            return (!cached || cached.expiresAt <= now) && !this.placesInFlight.has(uri);
        });
        for (let i = 0; i < missing.length; i += FRIEND_PLACES_MAX_URIS) {
            const chunk = missing.slice(i, i + FRIEND_PLACES_MAX_URIS);
            const lookup: Promise<void> = this.lookupPlaces(chunk).finally(() => {
                for (const uri of chunk) {
                    if (this.placesInFlight.get(uri) === lookup) {
                        this.placesInFlight.delete(uri);
                    }
                }
            });
            for (const uri of chunk) {
                this.placesInFlight.set(uri, lookup);
            }
        }

        const lookups = new Set(uris.map((uri) => this.placesInFlight.get(uri)).filter((lookup) => !!lookup));
        if (lookups.size > 0) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                Promise.all(lookups),
                new Promise<void>((resolve) => {
                    timeout = setTimeout(resolve, this.placesTimeoutMs);
                }),
            ]);
            clearTimeout(timeout);
        }

        return new Map(uris.map((uri) => [uri, this.places.get(uri)?.place ?? null]));
    }

    private async lookupPlaces(chunk: string[]): Promise<void> {
        try {
            const found = await this.deps.lookupPlaces(chunk);
            const expiresAt = this.now() + this.placesTtlMs;
            for (const uri of chunk) {
                this.places.set(uri, { place: found[uri] ?? null, expiresAt });
            }
        } catch (e) {
            console.warn("FriendsPresence => could not look up room names", e);
            // Keep any older names and do not ask again for a while.
            const expiresAt = this.now() + this.placesFailureTtlMs;
            for (const uri of chunk) {
                this.places.set(uri, { place: this.places.get(uri)?.place ?? null, expiresAt });
            }
        }
        this.sweepPlaces();
    }

    private sweepPlaces(): void {
        if (this.places.size < PLACES_CACHE_SWEEP_SIZE) {
            return;
        }
        const now = this.now();
        for (const [uri, cached] of this.places) {
            if (cached.expiresAt <= now) {
                this.places.delete(uri);
            }
        }
    }
}
