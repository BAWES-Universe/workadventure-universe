import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { ChatRoom, RoomFolder } from "../../../Connection/ChatConnection";
import { InvitationClock } from "../OneListOrder";
import type { OneListEntry } from "../OneListStore";
import { OrderFreeze, createOneListStore, freezeWhileHeld } from "../OneListStore";

type FakeRoom = ChatRoom & {
    messagesStore: Writable<readonly unknown[]>;
    unread: Writable<number>;
    unreadFlag: Writable<boolean>;
    nameStore: Writable<string>;
    timestamp: number;
    /** Sends a message: the timestamp moves and the messages store changes, as with Matrix. */
    receive: (at: number, unread?: number) => void;
    subscriberCount: () => number;
};

function fakeRoom(id: string, timestamp = 0, extra: Partial<ChatRoom> = {}): FakeRoom {
    let subscribers = 0;
    const counted = <T>(store: Writable<T>): Writable<T> => ({
        ...store,
        subscribe: (run, invalidate) => {
            subscribers++;
            const unsubscribe = store.subscribe(run, invalidate);
            return () => {
                subscribers--;
                unsubscribe();
            };
        },
    });
    const messagesStore = writable<readonly unknown[]>([]);
    const unread = writable(0);
    const unreadFlag = writable(false);
    const nameStore = writable(id);
    const room: Record<string, unknown> & { timestamp: number } = {
        id,
        type: "multiple",
        isRoomFolder: false,
        name: counted(nameStore),
        messages: counted(messagesStore),
        unreadNotificationCount: counted(unread),
        hasUnreadMessages: counted(unreadFlag),
        messagesStore,
        unread,
        unreadFlag,
        nameStore,
        timestamp,
        get lastMessageTimestamp(): number {
            return room.timestamp;
        },
        receive(at: number, unreadCount = 0) {
            room.timestamp = at;
            unread.set(unreadCount);
            unreadFlag.set(unreadCount > 0);
            messagesStore.update((messages) => [...messages, { at }]);
        },
        subscriberCount: () => subscribers,
        ...extra,
    };
    return room as unknown as FakeRoom;
}

type FakeFolder = RoomFolder & { roomsStore: Writable<ChatRoom[]>; foldersStore: Writable<RoomFolder[]> };

function fakeFolder(id: string, rooms: ChatRoom[] = [], folders: RoomFolder[] = []): FakeFolder {
    const roomsStore = writable(rooms);
    const foldersStore = writable(folders);
    return {
        id,
        name: writable(id),
        rooms: roomsStore,
        folders: foldersStore,
        roomsStore,
        foldersStore,
        isRoomFolder: true,
        // A folder's own Matrix room time must never be used for sorting.
        lastMessageTimestamp: 1_000_000,
    } as unknown as FakeFolder;
}

function setup(clock = new InvitationClock(() => 50)) {
    const directRooms = writable<ChatRoom[]>([]);
    const rooms = writable<ChatRoom[]>([]);
    const invitations = writable<ChatRoom[]>([]);
    const folders = writable<RoomFolder[]>([]);
    const hiddenRoomIds = writable<ReadonlySet<string>>(new Set());
    const search = writable("");
    const store = createOneListStore({ directRooms, rooms, invitations, folders, hiddenRoomIds, search }, clock);
    let current: OneListEntry[] = [];
    const unsubscribe = store.subscribe((value) => (current = value));
    return {
        directRooms,
        rooms,
        invitations,
        folders,
        hiddenRoomIds,
        search,
        unsubscribe,
        ids: () => current.map((entry) => entry.id),
        entry: (id: string) => current.find((entry) => entry.id === id),
    };
}

describe("createOneListStore", () => {
    it("merges DMs, rooms, invitations and folders, newest first", () => {
        const list = setup();
        const dm = fakeRoom("dm", 300, { type: "direct" });
        const room = fakeRoom("room", 100);
        const folder = fakeFolder("folder", [fakeRoom("inside", 200)]);
        const invitation = fakeRoom("invite", 0, { inviteTimestamp: 250 });
        list.directRooms.set([dm]);
        list.rooms.set([room]);
        list.folders.set([folder]);
        list.invitations.set([invitation]);
        expect(list.ids()).toEqual(["dm", "invite", "folder", "room"]);
        expect(list.entry("dm")?.kind).toBe("direct");
        expect(list.entry("invite")?.kind).toBe("invitation");
        expect(list.entry("folder")?.kind).toBe("folder");
    });

    it("moves a room to the top when a message arrives", () => {
        const list = setup();
        const a = fakeRoom("a", 200);
        const b = fakeRoom("b", 100);
        list.rooms.set([a, b]);
        expect(list.ids()).toEqual(["a", "b"]);
        b.receive(300, 1);
        expect(list.ids()).toEqual(["b", "a"]);
        expect(list.entry("b")?.unreadCount).toBe(1);
    });

    it("moves a folder to the top when a message arrives in one of its rooms, even a nested one", () => {
        const list = setup();
        const nestedRoom = fakeRoom("nestedRoom", 10);
        const nested = fakeFolder("nested", [nestedRoom]);
        const folder = fakeFolder("folder", [fakeRoom("r1", 20, {})], [nested]);
        const other = fakeRoom("other", 100);
        list.rooms.set([other]);
        list.folders.set([folder]);
        expect(list.ids()).toEqual(["other", "folder"]);
        nestedRoom.receive(500, 4);
        expect(list.ids()).toEqual(["folder", "other"]);
        expect(list.entry("folder")?.timestamp).toBe(500);
        expect(list.entry("folder")?.unreadCount).toBe(4);
    });

    it("sums the unread counts of a folder's rooms", () => {
        const list = setup();
        const r1 = fakeRoom("r1", 1);
        const r2 = fakeRoom("r2", 2);
        list.folders.set([fakeFolder("folder", [r1, r2])]);
        r1.receive(3, 2);
        r2.receive(4, 5);
        expect(list.entry("folder")?.unreadCount).toBe(7);
        expect(list.entry("folder")?.hasUnread).toBe(true);
    });

    it("watches rooms that join a folder later, and stops watching rooms that left", () => {
        const list = setup();
        const folder = fakeFolder("folder");
        const other = fakeRoom("other", 100);
        list.rooms.set([other]);
        list.folders.set([folder]);
        const late = fakeRoom("late", 0);
        folder.roomsStore.set([late]);
        late.receive(200);
        expect(list.ids()).toEqual(["folder", "other"]);

        folder.roomsStore.set([]);
        expect(late.subscriberCount()).toBe(0);
        expect(list.entry("folder")?.timestamp).toBe(0);
    });

    it("sorts an invitation by when the invite arrived", () => {
        let now = 1000;
        const list = setup(new InvitationClock(() => now));
        list.rooms.set([fakeRoom("room", 1500)]);
        list.invitations.set([fakeRoom("sent", 0, { inviteTimestamp: 2000 }), fakeRoom("unknownTime", 0)]);
        // The invite without a time is dated when this tab first saw it (1000).
        expect(list.ids()).toEqual(["sent", "room", "unknownTime"]);
        now = 9000;
        list.rooms.update((rooms) => [...rooms]);
        expect(list.entry("unknownTime")?.timestamp).toBe(1000);
    });

    it("never shows area chat rooms, in the list or in a folder's sort time", () => {
        const list = setup();
        const areaRoom = fakeRoom("!area", 900, {});
        const areaInFolder = fakeRoom("!areaInFolder", 800);
        list.rooms.set([areaRoom, fakeRoom("room", 100)]);
        list.folders.set([fakeFolder("folder", [areaInFolder, fakeRoom("r", 50)])]);
        list.hiddenRoomIds.set(new Set(["!area", "!areaInFolder"]));
        expect(list.ids()).toEqual(["room", "folder"]);
        expect(list.entry("folder")?.timestamp).toBe(50);
    });

    it("deduplicates by id", () => {
        const list = setup();
        const room = fakeRoom("same", 10);
        list.directRooms.set([room]);
        list.rooms.set([room]);
        expect(list.ids()).toEqual(["same"]);
    });

    it("filters by the search", () => {
        const list = setup();
        list.rooms.set([fakeRoom("Design", 1), fakeRoom("Sales", 2)]);
        list.search.set("des");
        expect(list.ids()).toEqual(["Design"]);
    });

    it("drops every room subscription when unsubscribed", () => {
        const list = setup();
        const room = fakeRoom("a", 1);
        const inside = fakeRoom("b", 1);
        list.rooms.set([room]);
        list.folders.set([fakeFolder("f", [inside])]);
        expect(room.subscriberCount()).toBeGreaterThan(0);
        list.unsubscribe();
        expect(room.subscriberCount()).toBe(0);
        expect(inside.subscriberCount()).toBe(0);
    });

    it("keeps each tab's list independent", () => {
        const tabA = setup();
        const tabB = setup();
        tabA.rooms.set([fakeRoom("a", 1)]);
        expect(tabA.ids()).toEqual(["a"]);
        expect(tabB.ids()).toEqual([]);
    });
});

describe("freezeWhileHeld", () => {
    it("does not reorder while a row is pressed, and applies the new order on release", () => {
        const source = writable([{ id: "a" }, { id: "b" }]);
        const freeze = new OrderFreeze();
        const displayed = freezeWhileHeld(source, freeze.held);
        const seen: string[][] = [];
        const unsubscribe = displayed.subscribe((value) => seen.push(value.map((entry) => entry.id)));

        const finger = {};
        freeze.hold(finger);
        source.set([{ id: "b" }, { id: "a" }]);
        expect(get(displayed).map((entry) => entry.id)).toEqual(["a", "b"]);

        // A new row while pressed goes to the end, so nothing under the finger moves.
        source.set([{ id: "c" }, { id: "b" }, { id: "a" }]);
        expect(get(displayed).map((entry) => entry.id)).toEqual(["a", "b", "c"]);

        freeze.release(finger);
        expect(get(displayed).map((entry) => entry.id)).toEqual(["c", "b", "a"]);
        expect(seen.at(-1)).toEqual(["c", "b", "a"]);
        unsubscribe();
    });

    it("stays frozen until every holder (pointer and open menu) lets go", () => {
        const source = writable([{ id: "a" }, { id: "b" }]);
        const freeze = new OrderFreeze();
        const displayed = freezeWhileHeld(source, freeze.held);
        const unsubscribe = displayed.subscribe(() => undefined);
        const pointer = {};
        const menu = {};
        freeze.hold(pointer);
        freeze.setHeld(menu, true);
        source.set([{ id: "b" }, { id: "a" }]);
        freeze.release(pointer);
        expect(get(displayed).map((entry) => entry.id)).toEqual(["a", "b"]);
        freeze.setHeld(menu, false);
        expect(get(displayed).map((entry) => entry.id)).toEqual(["b", "a"]);
        // Releasing twice is harmless.
        freeze.release(menu);
        expect(get(freeze.held)).toBe(false);
        unsubscribe();
    });
});
