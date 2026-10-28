import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "matrix-js-sdk";
import { get, writable } from "svelte/store";

vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: {} }));
vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        MATRIX_ADMIN_USER: "admin",
        MATRIX_DOMAIN: "domain",
    };
});
vi.mock("../../../Stores/ChatStore.ts", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});

import { MatrixChatRoom } from "../MatrixChatRoom";

/** Only what the pin methods read: the room's state and a client that sends state events. */
function roomWithPins(pinned: unknown, maySend = true) {
    const state = { pinned };
    const sent: string[][] = [];
    const sendStateEvent = vi.fn((_roomId: string, _type: string, content: { pinned: string[] }) => {
        sent.push(content.pinned);
        return Promise.resolve({ event_id: "$state" });
    });
    // The room's state catches up with what was sent, as a sync brings it back.
    const echo = () => {
        state.pinned = sent.shift();
    };
    const matrixRoom = {
        currentState: {
            getStateEvents: (type: string) =>
                type === EventType.RoomPinnedEvents ? { getContent: () => ({ pinned: state.pinned }) } : undefined,
            maySendStateEvent: () => maySend,
        },
        client: { getSafeUserId: () => "@me:chat.example.com", sendStateEvent },
    };
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, {
        matrixRoom,
        id: "!room:chat.example.com",
        pictureMxc: writable(undefined),
        members: writable([]),
        isEncrypted: writable(true),
        pinnedMessageIds: writable<string[]>([]),
        canPinMessages: writable(false),
    });
    return { room, sendStateEvent, state, echo };
}

function stateEvent(type: string) {
    return { getType: () => type, getStateKey: () => "" } as never;
}

describe("pinned messages in a Matrix chat", () => {
    it("reads the pinned ids from the room's state, ignoring anything that is not an id", () => {
        const { room } = roomWithPins(["$a", 3, "$b", null]);
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(get(room.pinnedMessageIds)).toEqual(["$a", "$b"]);
    });

    it("has no pins when the state is missing or malformed", () => {
        const { room } = roomWithPins(undefined);
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(get(room.pinnedMessageIds)).toEqual([]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("pins a message at the end (the newest pin) and moves one pinned again there", async () => {
        const { room, sendStateEvent, echo } = roomWithPins(["$a", "$b"]);
        await room.setMessagePinned("$c", true);
        echo();
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(sendStateEvent).toHaveBeenLastCalledWith(
            "!room:chat.example.com",
            EventType.RoomPinnedEvents,
            { pinned: ["$a", "$b", "$c"] },
            ""
        );
        await room.setMessagePinned("$a", true);
        expect(sendStateEvent).toHaveBeenLastCalledWith(
            "!room:chat.example.com",
            EventType.RoomPinnedEvents,
            { pinned: ["$b", "$c", "$a"] },
            ""
        );
    });

    it("unpins a message and keeps the others in order", async () => {
        const { room, sendStateEvent } = roomWithPins(["$a", "$b", "$c"]);
        await room.setMessagePinned("$b", false);
        expect(sendStateEvent).toHaveBeenLastCalledWith(
            "!room:chat.example.com",
            EventType.RoomPinnedEvents,
            { pinned: ["$a", "$c"] },
            ""
        );
    });

    it("builds a pin made right after another on it, before the room's state has caught up", async () => {
        const { room, sendStateEvent, echo, state } = roomWithPins(["$a"]);
        await room.setMessagePinned("$b", true);
        expect(get(room.pinnedMessageIds)).toEqual(["$a", "$b"]);
        await room.setMessagePinned("$c", true);
        expect(sendStateEvent).toHaveBeenLastCalledWith(
            "!room:chat.example.com",
            EventType.RoomPinnedEvents,
            { pinned: ["$a", "$b", "$c"] },
            ""
        );

        // The first pin coming back doesn't take the second away.
        echo();
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(get(room.pinnedMessageIds)).toEqual(["$a", "$b", "$c"]);
        await room.setMessagePinned("$a", false);
        expect(sendStateEvent).toHaveBeenLastCalledWith(
            "!room:chat.example.com",
            EventType.RoomPinnedEvents,
            { pinned: ["$b", "$c"] },
            ""
        );
        echo();
        echo();
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(get(room.pinnedMessageIds)).toEqual(["$b", "$c"]);

        // Caught up: someone else's pin shows again.
        state.pinned = ["$b", "$c", "$d"];
        room["onRoomStateEvent"](stateEvent(EventType.RoomPinnedEvents), {} as never, null);
        expect(get(room.pinnedMessageIds)).toEqual(["$b", "$c", "$d"]);
    });

    it("goes back to the room's pins when sending fails, or when what was sent never shows", async () => {
        vi.useFakeTimers();
        const { room, sendStateEvent } = roomWithPins(["$a"]);
        sendStateEvent.mockRejectedValueOnce(new Error("offline"));
        await expect(room.setMessagePinned("$b", true)).rejects.toThrow("offline");
        expect(get(room.pinnedMessageIds)).toEqual(["$a"]);

        await room.setMessagePinned("$c", true);
        expect(get(room.pinnedMessageIds)).toEqual(["$a", "$c"]);
        await vi.advanceTimersByTimeAsync(10000);
        expect(get(room.pinnedMessageIds)).toEqual(["$a"]);
    });

    it("follows whether this person may pin when the room's power levels change", () => {
        const allowed = roomWithPins([], true).room;
        allowed["onRoomStateEvent"](stateEvent(EventType.RoomPowerLevels), {} as never, null);
        expect(get(allowed.canPinMessages)).toBe(true);

        const refused = roomWithPins([], false).room;
        refused.canPinMessages.set(true);
        refused["onRoomStateEvent"](stateEvent(EventType.RoomPowerLevels), {} as never, null);
        expect(get(refused.canPinMessages)).toBe(false);
    });
});
