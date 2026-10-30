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

    it("keeps asking, less often, while the server stays out of reach", async () => {
        vi.useFakeTimers();
        let online = false;
        const room = roomPinning(["$a"], (id) =>
            online ? Promise.resolve(pinnedMessage(id)) : Promise.reject(new Error("offline"))
        );
        const entries = pinnedEntriesStore(room);
        const stop = entries.subscribe(() => undefined);
        // 3s, 6s, 9s, 12s, 15s: five tries after the first.
        await vi.advanceTimersByTimeAsync(45000);
        expect(room.getMessageById).toHaveBeenCalledTimes(6);

        online = true;
        await vi.advanceTimersByTimeAsync(30000);
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

    it("fetches an older pinned message once for the chat, not each time its profile opens (#1585)", async () => {
        const room = roomPinning(["$a"], (id) => Promise.resolve(pinnedMessage(id)));
        const first = pinnedEntriesStore(room);
        const stop = first.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(first)[0].message?.id).toBe("$a"));
        stop();

        const again = pinnedEntriesStore(room);
        expect(again).toBe(first);
        expect(get(again)[0].message?.id).toBe("$a");
        expect(room.getMessageById).toHaveBeenCalledTimes(1);
    });
});
