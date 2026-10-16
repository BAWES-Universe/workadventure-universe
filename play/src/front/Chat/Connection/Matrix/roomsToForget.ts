import type { MatrixClient } from "matrix-js-sdk";

const STORAGE_PREFIX = "universe:matrix:rooms-to-forget:";
/** A room that still cannot be forgotten after this many tries is let go (it is gone, or the server keeps refusing). */
const MAX_ATTEMPTS = 5;
/** How long to wait before each new try while rooms are still written down. The last wait is kept after that. */
export const FORGET_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

interface RoomToForget {
    roomId: string;
    attempts: number;
}

type ForgetClient = Pick<MatrixClient, "forget" | "getRoom">;

function isRoomToForget(value: unknown): value is RoomToForget {
    if (typeof value !== "object" || value === null) return false;
    const { roomId, attempts } = value as Partial<RoomToForget>;
    return typeof roomId === "string" && typeof attempts === "number";
}

function read(userId: string): RoomToForget[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter(isRoomToForget) : [];
    } catch {
        return [];
    }
}

function write(userId: string, rooms: RoomToForget[]): void {
    try {
        if (rooms.length === 0) localStorage.removeItem(STORAGE_PREFIX + userId);
        else localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(rooms));
    } catch {
        // Storage can be full or blocked: the room is then forgotten only if the first try worked.
    }
}

/**
 * A chat that was left but could not be forgotten stays in other apps (Element lists it as an empty room), and the game
 * no longer lists it, so nothing would ever try again. It is written down here per account and tried again later.
 */
export function rememberRoomToForget(userId: string, roomId: string): void {
    const rooms = read(userId);
    if (rooms.some((room) => room.roomId === roomId)) return;
    write(userId, [...rooms, { roomId, attempts: 1 }]);
}

/** Runs of one account do not overlap: two at once would try the same rooms twice and count their attempts twice. */
const running = new Map<string, Promise<void>>();

/**
 * Forgets the rooms written down for that account. A room that shows as joined or invited is not forgotten now: the
 * client's own copy of the membership lags behind a leave until the next sync, so the room is kept for a later run
 * (and let go after the same number of tries as any other, which covers a room that really was joined again).
 */
export function forgetRememberedRooms(client: ForgetClient, userId: string): Promise<void> {
    const current = running.get(userId);
    if (current) return current;
    const run = (async () => {
        const started = read(userId);
        const kept: RoomToForget[] = [];
        const retryLater = (entry: RoomToForget) => {
            if (entry.attempts + 1 < MAX_ATTEMPTS) kept.push({ ...entry, attempts: entry.attempts + 1 });
        };
        for (const entry of started) {
            const membership = client.getRoom(entry.roomId)?.getMyMembership();
            if (membership === "join" || membership === "invite") {
                retryLater(entry);
                continue;
            }
            try {
                // One room at a time, so a bad network does not send them all at once.
                // eslint-disable-next-line no-await-in-loop
                await client.forget(entry.roomId);
            } catch (error) {
                console.warn("Could not forget a room that was left", error);
                retryLater(entry);
            }
        }
        // Rooms written down while this run was going are not in `started`: they must survive the write.
        const startedIds = new Set(started.map((entry) => entry.roomId));
        const addedMeanwhile = read(userId).filter((entry) => !startedIds.has(entry.roomId));
        write(userId, [...kept, ...addedMeanwhile]);
    })().finally(() => {
        running.delete(userId);
    });
    running.set(userId, run);
    return run;
}

/** One chain of tries is waiting per account: several deleted chats share it, so they do not use up each other's tries. */
const retryChains = new Set<string>();

/**
 * Tries again to forget the rooms written down for that account, with a growing wait, for as long as some are still
 * written down (a room is let go after its last allowed try, see `forgetRememberedRooms`). Without this a server that
 * stays down for a while would leave the room in other apps until the next start or reconnect.
 */
export function retryForgettingRememberedRooms(client: ForgetClient, userId: string): void {
    if (retryChains.has(userId)) return;
    retryChains.add(userId);
    scheduleRetry(client, userId, 0);
}

/**
 * At start and reconnect: forgets the rooms written down for that account now, and keeps trying with the same growing
 * wait for those that still could not be forgotten. Without the wait, a room written down before a reload during an
 * outage would only be tried again at the next start or reconnect, however long the tab stays open.
 */
export async function forgetRememberedRoomsAndRetry(client: ForgetClient, userId: string): Promise<void> {
    try {
        await forgetRememberedRooms(client, userId);
    } finally {
        if (read(userId).length > 0) retryForgettingRememberedRooms(client, userId);
    }
}

function scheduleRetry(client: ForgetClient, userId: string, step: number): void {
    const delay = FORGET_RETRY_DELAYS_MS[Math.min(step, FORGET_RETRY_DELAYS_MS.length - 1)];
    setTimeout(() => {
        const retry = async () => {
            try {
                await forgetRememberedRooms(client, userId);
            } catch (error) {
                console.warn("Could not forget the rooms that were left", error);
            }
            if (read(userId).length > 0) scheduleRetry(client, userId, step + 1);
            else retryChains.delete(userId);
        };
        void retry();
    }, delay);
}
