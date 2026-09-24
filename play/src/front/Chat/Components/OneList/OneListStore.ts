import { derived, get, readable, writable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import type { ChatRoom, RoomFolder } from "../../Connection/ChatConnection";
import type { FolderSnapshot, OneListCandidate, OneListKind } from "./OneListOrder";
import {
    InvitationClock,
    applyFrozenOrder,
    mergeOneList,
    normalizeTimestamp,
    reuseUnchanged,
    summarizeFolder,
} from "./OneListOrder";

export type OneListEntry = OneListCandidate<ChatRoom | RoomFolder>;

export interface OneListSources {
    directRooms: Readable<ChatRoom[]>;
    rooms: Readable<ChatRoom[]>;
    invitations: Readable<ChatRoom[]>;
    folders: Readable<RoomFolder[]>;
    /** Area chat rooms: they have their own row and never show in this list. */
    hiddenRoomIds: Readable<ReadonlySet<string>>;
    search: Readable<string>;
}

/** Per tab and in memory: when this tab first saw an invitation whose invite event has no time. */
const tabInvitationClock = new InvitationClock();

function unreadCountOf(room: ChatRoom): number {
    return get(room.unreadNotificationCount);
}

function snapshotFolder(folder: RoomFolder, visited: Set<string> = new Set()): FolderSnapshot {
    if (visited.has(folder.id)) return { id: folder.id, rooms: [], folders: [] };
    visited.add(folder.id);
    return {
        id: folder.id,
        rooms: get(folder.rooms).map((room) => ({
            id: room.id,
            timestamp: room.lastMessageTimestamp,
            unreadCount: unreadCountOf(room),
            hasUnread: get(room.hasUnreadMessages),
        })),
        folders: get(folder.folders).map((child) => snapshotFolder(child, visited)),
    };
}

function collectFolderNames(folder: RoomFolder, names: string[], visited: Set<string>): void {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    for (const room of get(folder.rooms)) names.push(get(room.name));
    for (const child of get(folder.folders)) {
        names.push(get(child.name));
        collectFolderNames(child, names, visited);
    }
}

/** How a store is watched: a joined room in full, an invitation by name and members, a folder by structure. */
type WatchMode = "room" | "invitation" | "folder";

/** Schedules one flush per microtask; overridable in tests. */
export type FlushScheduler = (flush: () => void) => void;
const microtaskScheduler: FlushScheduler = (flush) => queueMicrotask(flush);

/**
 * One list of DMs, rooms, invitations and root folders, newest first.
 *
 * `lastMessageTimestamp` is a plain getter, so the list is worked out again when any room's messages, unread count,
 * unread flag or name changes. Every change only marks the list dirty; one flush per microtask then:
 * - syncs the per-room subscriptions by object (only rooms and folders that arrived or left are (un)subscribed),
 *   when a membership list changed;
 * - computes the list once, keeps the previous entry objects for rows that did not change, and emits only when
 *   something visible changed.
 * Everything is dropped when the last subscriber leaves, so nothing leaks.
 */
export function createOneListStore(
    sources: OneListSources,
    clock: InvitationClock = tabInvitationClock,
    schedule: FlushScheduler = microtaskScheduler
): Readable<OneListEntry[]> {
    return readable<OneListEntry[]>([], (set) => {
        let directRooms: ChatRoom[] = [];
        let rooms: ChatRoom[] = [];
        let invitations: ChatRoom[] = [];
        let folders: RoomFolder[] = [];
        let hiddenRoomIds: ReadonlySet<string> = new Set();
        let search = "";

        let active = false;
        let syncing = false;
        let flushQueued = false;
        let structureDirty = true;
        let valuesDirty = true;
        let current: OneListEntry[] = [];
        const watched = new Map<object, { mode: WatchMode; unsubscribers: Unsubscriber[] }>();

        const compute = (): OneListEntry[] => {
            const candidates: OneListEntry[] = [];
            const push = (kind: OneListKind, room: ChatRoom) => {
                candidates.push({
                    id: room.id,
                    kind,
                    name: get(room.name),
                    timestamp: normalizeTimestamp(room.lastMessageTimestamp),
                    unreadCount: unreadCountOf(room),
                    hasUnread: get(room.hasUnreadMessages),
                    item: room,
                });
            };
            directRooms.forEach((room) => push("direct", room));
            rooms.forEach((room) => push("room", room));
            for (const folder of folders) {
                const summary = summarizeFolder(snapshotFolder(folder), hiddenRoomIds);
                const searchNames: string[] = [];
                if (search.trim() !== "") collectFolderNames(folder, searchNames, new Set());
                candidates.push({
                    id: folder.id,
                    kind: "folder",
                    name: get(folder.name),
                    timestamp: summary.timestamp,
                    unreadCount: summary.unreadCount,
                    hasUnread: summary.hasUnread,
                    item: folder,
                    searchNames,
                });
            }
            const invitationIds = new Set<string>();
            for (const invitation of invitations) {
                invitationIds.add(invitation.id);
                candidates.push({
                    id: invitation.id,
                    kind: "invitation",
                    name: get(invitation.name),
                    timestamp: clock.timestampFor(invitation.id, invitation.inviteTimestamp),
                    unreadCount: 0,
                    hasUnread: false,
                    item: invitation,
                });
            }
            clock.retain(invitationIds);
            return mergeOneList(candidates, hiddenRoomIds, search);
        };

        const markValues = () => {
            if (syncing) return;
            valuesDirty = true;
            queueFlush();
        };

        const markStructure = () => {
            if (syncing) return;
            structureDirty = true;
            queueFlush();
        };

        const subscribeFor = (target: ChatRoom | RoomFolder, mode: WatchMode): Unsubscriber[] => {
            if (mode === "folder") {
                const folder = target as RoomFolder;
                return [
                    folder.name.subscribe(markValues),
                    // A room or folder joining or leaving the folder changes what must be watched.
                    folder.rooms.subscribe(markStructure),
                    folder.folders.subscribe(markStructure),
                ];
            }
            if (mode === "invitation") {
                const unsubscribers = [target.name.subscribe(markValues)];
                // The inviter and the invite time can arrive with lazily loaded members.
                if ("members" in target && target.members && typeof target.members === "object") {
                    unsubscribers.push((target.members as Readable<unknown>).subscribe(markValues));
                }
                return unsubscribers;
            }
            return [
                target.name.subscribe(markValues),
                target.messages.subscribe(markValues),
                target.unreadNotificationCount.subscribe(markValues),
                target.hasUnreadMessages.subscribe(markValues),
            ];
        };

        /** Subscribes to what arrived and unsubscribes from what left; untouched rooms keep their subscriptions. */
        const syncSubscriptions = () => {
            const wanted = new Map<object, WatchMode>();
            const addFolder = (folder: RoomFolder, visited: Set<string>) => {
                if (visited.has(folder.id)) return;
                visited.add(folder.id);
                wanted.set(folder, "folder");
                get(folder.rooms).forEach((room) => wanted.set(room, "room"));
                get(folder.folders).forEach((child) => addFolder(child, visited));
            };
            directRooms.forEach((room) => wanted.set(room, "room"));
            rooms.forEach((room) => wanted.set(room, "room"));
            invitations.forEach((room) => {
                if (!wanted.has(room)) wanted.set(room, "invitation");
            });
            const visited = new Set<string>();
            folders.forEach((folder) => addFolder(folder, visited));

            syncing = true;
            try {
                for (const [target, entry] of watched) {
                    if (wanted.get(target) !== entry.mode) {
                        entry.unsubscribers.forEach((unsubscribe) => unsubscribe());
                        watched.delete(target);
                    }
                }
                for (const [target, mode] of wanted) {
                    if (!watched.has(target)) {
                        watched.set(target, { mode, unsubscribers: subscribeFor(target as ChatRoom, mode) });
                    }
                }
            } finally {
                syncing = false;
            }
        };

        const flush = () => {
            flushQueued = false;
            if (!active) return;
            // A folder's rooms can change while its subscriptions are synced: loop until stable.
            let guard = 0;
            while (structureDirty && guard++ < 10) {
                structureDirty = false;
                valuesDirty = true;
                syncSubscriptions();
            }
            if (!valuesDirty) return;
            valuesDirty = false;
            const { list, changed } = reuseUnchanged(current, compute());
            if (!changed) return;
            current = list;
            set(current);
        };

        function queueFlush() {
            if (flushQueued || !active) return;
            flushQueued = true;
            schedule(flush);
        }

        const sourceUnsubscribers: Unsubscriber[] = [
            sources.directRooms.subscribe((value) => {
                directRooms = value;
                markStructure();
            }),
            sources.rooms.subscribe((value) => {
                rooms = value;
                markStructure();
            }),
            sources.invitations.subscribe((value) => {
                invitations = value;
                markStructure();
            }),
            sources.folders.subscribe((value) => {
                folders = value;
                markStructure();
            }),
            sources.hiddenRoomIds.subscribe((value) => {
                hiddenRoomIds = value;
                markValues();
            }),
            sources.search.subscribe((value) => {
                search = value;
                markValues();
            }),
        ];

        // The first value is computed right away, so the list never flashes empty.
        active = true;
        structureDirty = true;
        flush();

        return () => {
            active = false;
            sourceUnsubscribers.forEach((unsubscribe) => unsubscribe());
            for (const entry of watched.values()) entry.unsubscribers.forEach((unsubscribe) => unsubscribe());
            watched.clear();
            current = [];
        };
    });
}

/**
 * Holds the list's order still while any holder is active: a finger or pointer down on a row, or an open row menu.
 * A new order is applied once every holder has let go.
 */
export class OrderFreeze {
    private readonly holders = writable<ReadonlySet<unknown>>(new Set());
    readonly held: Readable<boolean> = derived(this.holders, ($holders) => $holders.size > 0);

    hold(holder: unknown): void {
        this.holders.update((holders) => (holders.has(holder) ? holders : new Set([...holders, holder])));
    }

    release(holder: unknown): void {
        this.holders.update((holders) => {
            if (!holders.has(holder)) return holders;
            const next = new Set(holders);
            next.delete(holder);
            return next;
        });
    }

    setHeld(holder: unknown, isHeld: boolean): void {
        if (isHeld) this.hold(holder);
        else this.release(holder);
    }
}

/** The Svelte context key under which the one list shares its `OrderFreeze` with row menus. */
export const ONE_LIST_FREEZE_CONTEXT = Symbol("oneListFreeze");

/**
 * The list as displayed: the live order, except while `held` is true, when rows keep the order they had
 * the moment the hold started (with fresh data, new rows at the end).
 */
export function freezeWhileHeld<T extends { id: string }>(
    source: Readable<T[]>,
    held: Readable<boolean>
): Readable<T[]> {
    let frozenIds: string[] | undefined;
    let displayed: T[] = [];
    return derived([source, held], ([$source, $held]) => {
        if ($held) {
            if (frozenIds === undefined) frozenIds = displayed.map((entry) => entry.id);
        } else {
            frozenIds = undefined;
        }
        displayed = applyFrozenOrder($source, frozenIds);
        return displayed;
    });
}
