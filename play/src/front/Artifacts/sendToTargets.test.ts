import { describe, expect, it } from "vitest";
import { get, readable, writable } from "svelte/store";
import type { ChatRoom, RoomFolder } from "../Chat/Connection/ChatConnection";
import { isBrickChat, sendEntriesStore } from "./sendToTargets";

function room(id: string, type: "direct" | "multiple", name: string, memberIds: string[], timestamp = 0) {
    const names = writable(name);
    const members = writable(memberIds.map((memberId) => ({ id: memberId })));
    return {
        id,
        type,
        name: names,
        members,
        lastMessageTimestamp: timestamp,
    } as unknown as ChatRoom & { members: typeof members };
}

function folder(id: string, rooms: ChatRoom[], folders: RoomFolder[] = []) {
    return { id, rooms: writable(rooms), folders: writable(folders) } as unknown as RoomFolder;
}

const ME = "@me:chat.test";

describe("the chats Send to can send to", () => {
    it("lists direct chats, groups and the chats put in folders, each once", () => {
        const laura = room("a", "direct", "Laura", [ME, "@laura:chat.test"], 10);
        const team = room("b", "multiple", "Team", [ME, "@x:chat.test", "@y:chat.test"], 20);
        const inFolder = room("c", "multiple", "In a folder", [ME], 5);
        const nested = room("d", "direct", "Nested", [ME, "@n:chat.test"], 1);
        const entries = sendEntriesStore(
            {
                directRooms: readable([laura]),
                // The same chat listed twice is one row
                rooms: readable([team, laura]),
                folders: readable([folder("f", [inFolder], [folder("g", [nested])])]),
            },
            readable(new Set())
        );
        const list = get(entries);
        expect(list.map((entry) => entry.room.id).sort()).toEqual(["a", "b", "c", "d"]);
        expect(list.find((entry) => entry.room.id === "b")).toMatchObject({
            roomName: "Team",
            memberIds: [ME, "@x:chat.test", "@y:chat.test"],
            timestamp: 20,
        });
    });

    it("leaves out a chat that is hidden from the list of chats", () => {
        const area = room("a", "multiple", "Area chat", [ME]);
        const laura = room("b", "direct", "Laura", [ME, "@laura:chat.test"]);
        const entries = sendEntriesStore(
            { directRooms: readable([laura]), rooms: readable([area]), folders: readable([]) },
            readable(new Set(["a"]))
        );
        expect(get(entries).map((entry) => entry.room.id)).toEqual(["b"]);
    });

    it("follows a name and members that arrive after the chat", () => {
        const late = room("a", "direct", "…", []);
        const entries = sendEntriesStore(
            { directRooms: readable([late]), rooms: readable([]), folders: readable([]) },
            readable(new Set())
        );
        const seen: string[][] = [];
        const stop = entries.subscribe((list) =>
            seen.push(list.map((entry) => `${entry.roomName}:${entry.memberIds.length}`))
        );
        (late.name as ReturnType<typeof writable<string>>).set("Laura");
        late.members.set([{ id: ME }, { id: "@laura:chat.test" }]);
        stop();
        expect(seen[seen.length - 1]).toEqual(["Laura:2"]);
    });

    it("follows a chat that joins the list while it is open", () => {
        const direct = writable<ChatRoom[]>([]);
        const entries = sendEntriesStore(
            { directRooms: direct, rooms: readable([]), folders: readable([]) },
            readable(new Set())
        );
        let list: { room: ChatRoom }[] = [];
        const stop = entries.subscribe((value) => (list = value));
        expect(list).toEqual([]);
        direct.set([room("a", "direct", "Laura", [ME, "@laura:chat.test"])]);
        expect(list.map((entry) => entry.room.id)).toEqual(["a"]);
        stop();
    });
});

describe("a chat with a Brick", () => {
    it("is a direct chat whose other member is a bot, whoever owns the Brick", () => {
        const withBrick = { room: room("a", "direct", "x", []), memberIds: [ME, "@bot_nudge:chat.test"] };
        expect(isBrickChat(withBrick, ME)).toBe(true);
        expect(isBrickChat({ ...withBrick, memberIds: [ME, "@laura:chat.test"] }, ME)).toBe(false);
        // A group that holds a Brick is a group
        expect(
            isBrickChat(
                { room: room("b", "multiple", "g", []), memberIds: [ME, "@bot_nudge:chat.test", "@o:chat.test"] },
                ME
            )
        ).toBe(false);
    });
});
