import { describe, expect, it, vi } from "vitest";
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
    const sendStateEvent = vi.fn((_roomId: string, _type: string, content: { pinned: string[] }) => {
        state.pinned = content.pinned;
        return Promise.resolve({ event_id: "$state" });
    });
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
    return { room, sendStateEvent, state };
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

    it("pins a message at the end (the newest pin) and moves one pinned again there", async () => {
        const { room, sendStateEvent } = roomWithPins(["$a", "$b"]);
        await room.setMessagePinned("$c", true);
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
