import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { ChatRoom, RoomFolder } from "../../../Connection/ChatConnection";
import { InvitationClock } from "../OneListOrder";
import type { OneListEntry } from "../OneListStore";
import {
    OrderFreeze,
    brickEntry,
    createOneListStore,
    directRoomsWith,
    directRoomsWithStore,
    freezeWhileHeld,
} from "../OneListStore";

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
    // A manual scheduler: the test decides when the coalesced flush runs.
    let queued: (() => void)[] = [];
    const flush = () => {
        const run = queued;
        queued = [];
        run.forEach((callback) => callback());
    };
    const store = createOneListStore(
        { directRooms, rooms, invitations, folders, hiddenRoomIds, search },
        clock,
        (callback) => queued.push(callback)
    );
    let current: OneListEntry[] = [];
    let emissions = 0;
    const unsubscribe = store.subscribe((value) => {
        emissions++;
        current = value;
    });
    return {
        flush,
        pendingFlushes: () => queued.length,
        emissions: () => emissions,
        current: () => current,
        directRooms,
        rooms,
        invitations,
        folders,
        hiddenRoomIds,
        search,
        unsubscribe,
        ids: () => {
            flush();
            return current.map((entry) => entry.id);
        },
        entry: (id: string) => {
            flush();
            return current.find((entry) => entry.id === id);
        },
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
        list.flush();
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

    it('finds every chat with a bot when "Bot" or "Brick" is searched, whatever the bot is named (#1995)', () => {
        const list = setup();
        const withBot = fakeRoom("Melody", 3, {
            type: "direct",
            members: writable([{ id: "@me:chat.test" }, { id: "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test" }]),
        } as unknown as Partial<ChatRoom>);
        const withSara = fakeRoom("Sara", 2, {
            type: "direct",
            members: writable([{ id: "@me:chat.test" }, { id: "@sara:chat.test" }]),
        } as unknown as Partial<ChatRoom>);
        const group = fakeRoom("Design", 1);
        list.directRooms.set([withBot, withSara]);
        list.rooms.set([group]);
        for (const word of ["bot", "Bots", "brick", " Bricks "]) {
            list.search.set(word);
            expect(list.ids()).toEqual(["Melody"]);
        }
        // Part of the word is a name being typed: nobody extra is listed
        list.search.set("bo");
        expect(list.ids()).toEqual([]);
        list.search.set("sar");
        expect(list.ids()).toEqual(["Sara"]);
        list.search.set("");
        expect(list.ids()).toEqual(["Melody", "Sara", "Design"]);
    });

    it('finds a direct chat by "Bot" once its bot member arrives, and a folder that holds a chat with a bot', () => {
        const list = setup();
        const members = writable([{ id: "@me:chat.test" }]);
        const late = fakeRoom("Melody", 3, { type: "direct", members } as unknown as Partial<ChatRoom>);
        const inFolder = fakeRoom("Helper", 2, {
            members: writable([{ id: "@me:chat.test" }, { id: "@bot_1c8d2e3f-2222-4333-8444-a55566667777:chat.test" }]),
        } as unknown as Partial<ChatRoom>);
        list.directRooms.set([late]);
        list.folders.set([fakeFolder("Team", [inFolder])]);
        list.search.set("bot");
        expect(list.ids()).toEqual(["Team"]);
        members.set([{ id: "@me:chat.test" }, { id: "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test" }]);
        expect(list.ids()).toEqual(["Melody", "Team"]);
    });

    it('lists a folder by "Bot" once a bot joins one of its chats, after the search started', () => {
        const list = setup();
        const members = writable([{ id: "@me:chat.test" }, { id: "@sara:chat.test" }]);
        const inFolder = fakeRoom("Helper", 2, { members } as unknown as Partial<ChatRoom>);
        list.folders.set([fakeFolder("Team", [inFolder])]);
        list.search.set("bot");
        expect(list.ids()).toEqual([]);
        // Nothing else of the chat changes: only who is in it
        members.set([
            { id: "@me:chat.test" },
            { id: "@sara:chat.test" },
            { id: "@bot_1c8d2e3f-2222-4333-8444-a55566667777:chat.test" },
        ]);
        expect(list.ids()).toEqual(["Team"]);
    });

    it("drops every room subscription when unsubscribed", () => {
        const list = setup();
        const room = fakeRoom("a", 1);
        const inside = fakeRoom("b", 1);
        list.rooms.set([room]);
        list.folders.set([fakeFolder("f", [inside])]);
        list.flush();
        expect(room.subscriberCount()).toBeGreaterThan(0);
        expect(inside.subscriberCount()).toBeGreaterThan(0);
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

describe("createOneListStore batching", () => {
    it("coalesces many rapid emissions into one flush and one emission", () => {
        const list = setup();
        const rooms = Array.from({ length: 20 }, (_, index) => fakeRoom(`r${index}`, index));
        list.flush();
        const before = list.emissions();
        // Initial sync: the room list grows one room at a time.
        for (let i = 1; i <= rooms.length; i++) list.rooms.set(rooms.slice(0, i));
        rooms.forEach((room, index) => room.receive(1000 + index));
        expect(list.pendingFlushes()).toBe(1);
        list.flush();
        expect(list.emissions()).toBe(before + 1);
        expect(list.ids()[0]).toBe("r19");
    });

    it("does not emit when a change leaves every row the same", () => {
        const list = setup();
        const a = fakeRoom("a", 200);
        const b = fakeRoom("b", 100);
        list.rooms.set([a, b]);
        list.flush();
        const before = list.emissions();
        const snapshot = list.current();
        // A reaction or an edit: the messages store emits, the time and unread count stay the same.
        b.messagesStore.update((messages) => [...messages]);
        list.flush();
        expect(list.emissions()).toBe(before);
        expect(list.current()).toBe(snapshot);
    });

    it("keeps the entry objects of rows that did not change", () => {
        const list = setup();
        const a = fakeRoom("a", 200);
        const b = fakeRoom("b", 100);
        list.rooms.set([a, b]);
        list.flush();
        const entryA = list.entry("a");
        b.receive(300, 1);
        list.flush();
        expect(list.ids()).toEqual(["b", "a"]);
        expect(list.entry("a")).toBe(entryA);
    });

    it("only subscribes to rooms that arrive and unsubscribes from rooms that leave", () => {
        const list = setup();
        const a = fakeRoom("a", 1);
        const b = fakeRoom("b", 2);
        list.rooms.set([a]);
        list.flush();
        const subscriptionsOfA = a.subscriberCount();
        list.rooms.set([a, b]);
        list.flush();
        expect(a.subscriberCount()).toBe(subscriptionsOfA);
        expect(b.subscriberCount()).toBeGreaterThan(0);
        list.rooms.set([b]);
        list.flush();
        expect(a.subscriberCount()).toBe(0);
    });
});

describe("createOneListStore search on folders", () => {
    it("drops a folder whose name and contents all fail the search, and keeps one that matches inside", () => {
        const list = setup();
        const nested = fakeFolder("Archive", [fakeRoom("Old design", 1)]);
        list.folders.set([fakeFolder("Team", [fakeRoom("Sales", 5)]), fakeFolder("Projects", [], [nested])]);
        list.search.set("design");
        expect(list.ids()).toEqual(["Projects"]);
        list.search.set("team");
        expect(list.ids()).toEqual(["Team"]);
        list.search.set("nothing like this");
        expect(list.ids()).toEqual([]);
        list.search.set("");
        expect(list.ids().sort()).toEqual(["Projects", "Team"]);
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

describe("the row of a person's own Brick before its chat exists (#1995)", () => {
    const brick = {
        id: "0b7c1d2e-1111-4222-8333-944455556666",
        name: "Recipe Brick",
        description: null,
        characterTextureId: "brick-orange",
        enabled: true,
        isDefault: false,
        createdAt: "2026-11-11T10:00:00.000Z",
        hello: null,
    };

    it("is sorted in by when the Brick was made, and is never unread", () => {
        expect(brickEntry(brick, "")).toEqual({
            id: "brick:0b7c1d2e-1111-4222-8333-944455556666",
            kind: "brick",
            name: "Recipe Brick",
            timestamp: Date.parse("2026-11-11T10:00:00.000Z"),
            unreadCount: 0,
            hasUnread: false,
            item: brick,
        });
    });

    it('is listed with the chats, and found by its name, by "Brick" and by "Bot"', () => {
        const extraEntries = writable<OneListEntry[]>([]);
        const search = writable("");
        const store = createOneListStore(
            {
                directRooms: writable<ChatRoom[]>([
                    fakeRoom("Sara", Date.parse("2026-11-11T11:00:00.000Z"), { type: "direct" }),
                ]),
                rooms: writable<ChatRoom[]>([]),
                invitations: writable<ChatRoom[]>([]),
                folders: writable<RoomFolder[]>([]),
                hiddenRoomIds: writable<ReadonlySet<string>>(new Set()),
                search,
                extraEntries,
            },
            new InvitationClock(() => 50),
            (callback) => callback()
        );
        let current: OneListEntry[] = [];
        const stop = store.subscribe((value) => (current = value));
        const show = (text: string) => {
            search.set(text);
            extraEntries.set([brickEntry({ ...brick, name: "Melody" }, text)]);
            return current.map((entry) => entry.id);
        };
        expect(show("")).toEqual(["Sara", "brick:0b7c1d2e-1111-4222-8333-944455556666"]);
        expect(show("mel")).toEqual(["brick:0b7c1d2e-1111-4222-8333-944455556666"]);
        expect(show("Brick")).toEqual(["brick:0b7c1d2e-1111-4222-8333-944455556666"]);
        expect(show("bot")).toEqual(["brick:0b7c1d2e-1111-4222-8333-944455556666"]);
        expect(show("bri")).toEqual([]);
        expect(show("sara")).toEqual(["Sara"]);
        stop();
    });
});

describe("the chat of a Brick its owner deleted (#1996)", () => {
    const withMembers = (id: string, ...members: string[]) =>
        ({ id, members: writable(members.map((member) => ({ id: member }))) } as unknown as ChatRoom);
    const studio = "@bot_2d9e3f40-3333-4444-8555-b66677778888:chat.test";
    const rooms = [
        withMembers("!studio", "@me:chat.test", studio),
        withMembers("!sara", "@me:chat.test", "@sara:chat.test"),
        { id: "!bare" } as unknown as ChatRoom,
    ];

    it("is out of Chats while the Brick waits under Deleted, and nobody else's chat is", () => {
        expect(directRoomsWith(rooms, new Set([studio]))).toEqual(["!studio"]);
    });

    it("is back as soon as nothing is deleted", () => {
        expect(directRoomsWith(rooms, new Set())).toEqual([]);
    });

    it("is out of Chats when someone put it in a folder, also in a folder inside one, and back with Undo", () => {
        const inner = fakeFolder("inner", [withMembers("!nested", "@me:chat.test", studio)]);
        const outer = fakeFolder("outer", [], []);
        const folders = writable<RoomFolder[]>([outer]);
        const deleted = writable<ReadonlySet<string>>(new Set([studio]));
        let hidden: string[] = [];
        const stop = directRoomsWithStore(writable([]), deleted, folders).subscribe((ids) => (hidden = ids));
        expect(hidden).toEqual([]);
        // The folder gets a folder with the Brick's chat in it after the list was read
        outer.foldersStore.set([inner]);
        expect(hidden).toEqual(["!nested"]);
        deleted.set(new Set());
        expect(hidden).toEqual([]);
        stop();
    });

    it("is out of Chats as soon as its members arrive, after the chat itself", () => {
        const members = writable([{ id: "@me:chat.test" }]);
        const late = { id: "!late", members } as unknown as ChatRoom;
        const deleted = writable<ReadonlySet<string>>(new Set([studio]));
        let hidden: string[] = [];
        const stop = directRoomsWithStore(writable([late]), deleted).subscribe((ids) => (hidden = ids));
        expect(hidden).toEqual([]);
        members.set([{ id: "@me:chat.test" }, { id: studio }]);
        expect(hidden).toEqual(["!late"]);
        deleted.set(new Set());
        expect(hidden).toEqual([]);
        stop();
    });
});
