/**
 * Pure logic behind the one chat list: DMs, rooms, invitations and folders together, newest first.
 * No stores, no Matrix and no translations in here, so every rule can be unit tested.
 */

/** "proximity" is a proximity chat you had (an ended stay), shown as its own row among the saved conversations. */
export type OneListKind = "direct" | "room" | "invitation" | "folder" | "proximity";

/** A room as the list needs to see it at one moment. */
export interface RoomSnapshot {
    id: string;
    /** Time of the latest event, in ms. Anything not finite or not positive means "no message yet". */
    timestamp: number;
    unreadCount: number;
    hasUnread: boolean;
}

/** A folder as the list needs to see it: the rooms it holds and its nested folders. */
export interface FolderSnapshot {
    id: string;
    rooms: RoomSnapshot[];
    folders: FolderSnapshot[];
}

export interface ActivitySummary {
    /** Newest message time, 0 when there is none. */
    timestamp: number;
    unreadCount: number;
    hasUnread: boolean;
}

/** One candidate row, before it is sorted and filtered. */
export interface OneListCandidate<T> {
    id: string;
    kind: OneListKind;
    name: string;
    timestamp: number;
    unreadCount: number;
    hasUnread: boolean;
    item: T;
    /**
     * For a folder: the names of the rooms and folders inside it (nested too). While searching, a folder stays
     * only if its own name or one of these matches.
     */
    searchNames?: readonly string[];
}

/** Matrix reports `Number.MIN_SAFE_INTEGER` for a room with no events; the list treats that as "never". */
export function normalizeTimestamp(timestamp: number | undefined | null): number {
    if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp) || timestamp <= 0) return 0;
    return timestamp;
}

function normalizeCount(count: number): number {
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * A folder sorts by the newest message inside it (its rooms and nested folders, never its own Matrix room),
 * and its unread count is the sum of its rooms'. Hidden rooms (area chat rooms) count for nothing.
 */
export function summarizeFolder(
    folder: FolderSnapshot,
    hiddenRoomIds: ReadonlySet<string> = new Set(),
    visited: Set<string> = new Set()
): ActivitySummary {
    const summary: ActivitySummary = { timestamp: 0, unreadCount: 0, hasUnread: false };
    // A Matrix space can, in theory, list itself or an ancestor as a child: never loop.
    if (visited.has(folder.id)) return summary;
    visited.add(folder.id);

    for (const room of folder.rooms) {
        if (hiddenRoomIds.has(room.id)) continue;
        summary.timestamp = Math.max(summary.timestamp, normalizeTimestamp(room.timestamp));
        summary.unreadCount += normalizeCount(room.unreadCount);
        summary.hasUnread = summary.hasUnread || room.hasUnread || normalizeCount(room.unreadCount) > 0;
    }
    for (const child of folder.folders) {
        const childSummary = summarizeFolder(child, hiddenRoomIds, visited);
        summary.timestamp = Math.max(summary.timestamp, childSummary.timestamp);
        summary.unreadCount += childSummary.unreadCount;
        summary.hasUnread = summary.hasUnread || childSummary.hasUnread;
    }
    return summary;
}

/** Newest first; the name breaks ties, then the id so the order is always stable. */
export function compareOneListCandidates<T>(a: OneListCandidate<T>, b: OneListCandidate<T>): number {
    const byTime = normalizeTimestamp(b.timestamp) - normalizeTimestamp(a.timestamp);
    if (byTime !== 0) return byTime;
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function matchesSearch(name: string, search: string): boolean {
    const query = search.trim().toLocaleLowerCase();
    if (query === "") return true;
    return name.toLocaleLowerCase().includes(query);
}

export function candidateMatchesSearch<T>(candidate: OneListCandidate<T>, search: string): boolean {
    if (matchesSearch(candidate.name, search)) return true;
    return candidate.searchNames?.some((name) => matchesSearch(name, search)) ?? false;
}

function sameStrings(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    if (a === b) return true;
    if (a === undefined || b === undefined || a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
}

/** True when two candidates would render the same row. */
export function sameCandidate<T>(a: OneListCandidate<T>, b: OneListCandidate<T>): boolean {
    return (
        a.id === b.id &&
        a.kind === b.kind &&
        a.name === b.name &&
        a.timestamp === b.timestamp &&
        a.unreadCount === b.unreadCount &&
        a.hasUnread === b.hasUnread &&
        a.item === b.item &&
        sameStrings(a.searchNames, b.searchNames)
    );
}

/**
 * Reuses the previous entry objects for rows that did not change, and returns the previous array itself when
 * nothing changed at all, so subscribers (and the reorder animation) are not woken up for nothing.
 */
export function reuseUnchanged<T>(
    previous: readonly OneListCandidate<T>[],
    next: OneListCandidate<T>[]
): { list: OneListCandidate<T>[]; changed: boolean } {
    const previousById = new Map(previous.map((entry) => [entry.id, entry]));
    let changed = previous.length !== next.length;
    const list = next.map((entry, index) => {
        const old = previousById.get(entry.id);
        const kept = old !== undefined && sameCandidate(old, entry) ? old : entry;
        if (previous[index] !== kept) changed = true;
        return kept;
    });
    return { list: changed ? list : [...previous], changed };
}

/**
 * Merges every candidate into one list: deduplicated by id (the first one wins), without hidden rooms
 * (area chat rooms), filtered by the search, newest first.
 * While searching, a folder stays when its name or anything inside it matches (the search then filters its rooms).
 */
export function mergeOneList<T>(
    candidates: readonly OneListCandidate<T>[],
    hiddenRoomIds: ReadonlySet<string>,
    search = ""
): OneListCandidate<T>[] {
    const seen = new Set<string>();
    const merged: OneListCandidate<T>[] = [];
    for (const candidate of candidates) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        if (hiddenRoomIds.has(candidate.id)) continue;
        if (!candidateMatchesSearch(candidate, search)) continue;
        merged.push(candidate);
    }
    return merged.sort(compareOneListCandidates);
}

/**
 * Keeps the order the user is looking at while a row is pressed or a row menu is open.
 * Rows that are still there keep their frozen place (with fresh data), rows that left are dropped,
 * and new rows go to the end so nothing under the finger moves. Without a frozen order, the list is returned as is.
 */
export function applyFrozenOrder<T extends { id: string }>(
    next: readonly T[],
    frozenIds: readonly string[] | undefined
): T[] {
    if (frozenIds === undefined) return [...next];
    const byId = new Map(next.map((entry) => [entry.id, entry]));
    const result: T[] = [];
    const placed = new Set<string>();
    for (const id of frozenIds) {
        const entry = byId.get(id);
        if (entry === undefined || placed.has(id)) continue;
        result.push(entry);
        placed.add(id);
    }
    for (const entry of next) {
        if (!placed.has(entry.id)) result.push(entry);
    }
    return result;
}

/**
 * Remembers when this tab first saw each invitation, for invitations whose invite event carries no time.
 * Per tab and in memory only.
 */
export class InvitationClock {
    private readonly firstSeen = new Map<string, number>();

    constructor(private readonly now: () => number = () => Date.now()) {}

    timestampFor(id: string, inviteTimestamp: number | undefined): number {
        const known = normalizeTimestamp(inviteTimestamp);
        if (known > 0) return known;
        let seen = this.firstSeen.get(id);
        if (seen === undefined) {
            seen = this.now();
            this.firstSeen.set(id, seen);
        }
        return seen;
    }

    /** Forgets invitations that are gone, so the map does not grow forever. */
    retain(ids: ReadonlySet<string>): void {
        for (const id of this.firstSeen.keys()) {
            if (!ids.has(id)) this.firstSeen.delete(id);
        }
    }
}

export interface RowTimeLabels {
    justNow: string;
    minutes: (count: number) => string;
    yesterday: string;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A short row timestamp: "now", "2m", today's time, "Yesterday", a weekday within the week, else a short date.
 * Empty when there is no message.
 */
export function formatRowTime(timestamp: number, now: number, locale: string, labels: RowTimeLabels): string {
    const time = normalizeTimestamp(timestamp);
    if (time === 0) return "";
    const elapsed = now - time;
    if (elapsed < 60_000) return labels.justNow;
    if (elapsed < 3_600_000) return labels.minutes(Math.floor(elapsed / 60_000));

    const date = new Date(time);
    const today = new Date(now);
    try {
        if (isSameDay(date, today)) {
            return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
        }
        const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
        if (isSameDay(date, yesterday)) return labels.yesterday;
        if (elapsed < 6 * 24 * 3_600_000) {
            return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
        }
        if (date.getFullYear() === today.getFullYear()) {
            return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
        }
        return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
    } catch {
        return date.toLocaleDateString();
    }
}

/** Caps the unread pill at 99+. */
export function formatUnreadCount(count: number): string {
    return count > 99 ? "99+" : String(Math.max(0, Math.floor(count)));
}

/** A message body (which can be HTML) as one line of plain text for a row preview. */
export function toPlainText(body: string): string {
    try {
        const doc = new DOMParser().parseFromString(body, "text/html");
        return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    } catch {
        return body
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }
}
