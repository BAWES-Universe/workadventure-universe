import { derived, get, readable, writable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import type { ChatRoom, RoomFolder } from "../../Connection/ChatConnection";
import type { FolderSnapshot, OneListCandidate, OneListKind } from "./OneListOrder";
import { InvitationClock, applyFrozenOrder, mergeOneList, normalizeTimestamp, summarizeFolder } from "./OneListOrder";

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

/**
 * One list of DMs, rooms, invitations and root folders, newest first.
 *
 * `lastMessageTimestamp` is a plain getter, so the list re-derives whenever any room's messages, unread count,
 * unread flag or name changes. The subscriptions to every room (including the rooms and nested folders inside
 * folders) are rebuilt whenever a membership list changes, and all of them are dropped when the last subscriber
 * leaves, so nothing leaks.
 */
export function createOneListStore(
    sources: OneListSources,
    clock: InvitationClock = tabInvitationClock
): Readable<OneListEntry[]> {
    return readable<OneListEntry[]>([], (set) => {
        let directRooms: ChatRoom[] = [];
        let rooms: ChatRoom[] = [];
        let invitations: ChatRoom[] = [];
        let folders: RoomFolder[] = [];
        let hiddenRoomIds: ReadonlySet<string> = new Set();
        let search = "";

        let started = false;
        let building = false;
        let roomUnsubscribers: Unsubscriber[] = [];

        const compute = () => {
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
                candidates.push({
                    id: folder.id,
                    kind: "folder",
                    name: get(folder.name),
                    timestamp: summary.timestamp,
                    unreadCount: summary.unreadCount,
                    hasUnread: summary.hasUnread,
                    item: folder,
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

        const recompute = () => {
            if (!started || building) return;
            set(compute());
        };

        const watchRoom = (room: ChatRoom) => {
            roomUnsubscribers.push(
                room.name.subscribe(recompute),
                room.messages.subscribe(recompute),
                room.unreadNotificationCount.subscribe(recompute),
                room.hasUnreadMessages.subscribe(recompute)
            );
        };

        const watchFolder = (folder: RoomFolder, visited: Set<string>) => {
            if (visited.has(folder.id)) return;
            visited.add(folder.id);
            roomUnsubscribers.push(
                folder.name.subscribe(recompute),
                // A room or folder joining or leaving the folder changes what must be watched.
                folder.rooms.subscribe(() => rebuild()),
                folder.folders.subscribe(() => rebuild())
            );
            get(folder.rooms).forEach(watchRoom);
            get(folder.folders).forEach((child) => watchFolder(child, visited));
        };

        const unwatchAll = () => {
            const unsubscribers = roomUnsubscribers;
            roomUnsubscribers = [];
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };

        function rebuild() {
            if (!started || building) return;
            building = true;
            try {
                unwatchAll();
                directRooms.forEach(watchRoom);
                rooms.forEach(watchRoom);
                invitations.forEach((invitation) => roomUnsubscribers.push(invitation.name.subscribe(recompute)));
                const visited = new Set<string>();
                folders.forEach((folder) => watchFolder(folder, visited));
            } finally {
                building = false;
            }
            recompute();
        }

        const sourceUnsubscribers: Unsubscriber[] = [
            sources.directRooms.subscribe((value) => {
                directRooms = value;
                rebuild();
            }),
            sources.rooms.subscribe((value) => {
                rooms = value;
                rebuild();
            }),
            sources.invitations.subscribe((value) => {
                invitations = value;
                rebuild();
            }),
            sources.folders.subscribe((value) => {
                folders = value;
                rebuild();
            }),
            sources.hiddenRoomIds.subscribe((value) => {
                hiddenRoomIds = value;
                recompute();
            }),
            sources.search.subscribe((value) => {
                search = value;
                recompute();
            }),
        ];

        started = true;
        rebuild();

        return () => {
            started = false;
            sourceUnsubscribers.forEach((unsubscribe) => unsubscribe());
            unwatchAll();
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
