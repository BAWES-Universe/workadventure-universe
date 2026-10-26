import { afterEach, describe, expect, it, vi } from "vitest";
import { get, readable, writable } from "svelte/store";
import type { ChatMessage, ChatRoom, ChatRoomPins } from "../../../../Connection/ChatConnection";

vi.mock("../../../../Stores/SelectRoomStore", () => ({ selectedRoomStore: writable(undefined) }));

import { pinnedEntriesStore } from "../Pins";

function pinnedMessage(id: string): ChatMessage {
    return { id, isDeleted: readable(false) } as unknown as ChatMessage;
}

function roomPinning(ids: string[], getMessageById: (id: string) => Promise<ChatMessage | undefined>) {
    return {
        pinnedMessageIds: writable(ids),
        messages: writable<ChatMessage[]>([]),
        getMessageById: vi.fn(getMessageById),
    } as unknown as ChatRoom & ChatRoomPins;
}

describe("the pinned messages of a chat", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("asks again for a pinned message it couldn't fetch for a moment", async () => {
        vi.useFakeTimers();
        let online = false;
        const room = roomPinning(["$a"], (id) =>
            online ? Promise.resolve(pinnedMessage(id)) : Promise.reject(new Error("offline"))
        );
        const entries = pinnedEntriesStore(room);
        const stop = entries.subscribe(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(get(entries)).toEqual([{ id: "$a", message: undefined }]);

        online = true;
        await vi.advanceTimersByTimeAsync(3000);
        expect(get(entries)[0].message?.id).toBe("$a");
        stop();
    });

    it("leaves out a pinned message the server says is gone", async () => {
        const room = roomPinning(["$a", "$b"], (id) =>
            id === "$a"
                ? Promise.reject(Object.assign(new Error("not found"), { httpStatus: 404 }))
                : Promise.resolve(pinnedMessage(id))
        );
        const entries = pinnedEntriesStore(room);
        const stop = entries.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(entries).map((entry) => entry.message?.id)).toEqual(["$b"]));
        stop();
    });
});
