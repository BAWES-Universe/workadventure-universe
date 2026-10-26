import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import type { ChatMessage, ChatMessageContent, ChatMessageType } from "../../../../Connection/ChatConnection";
import type { SavedNearbyItem } from "../NearbySaved";

const api = vi.hoisted(() => ({
    canKeep: true,
    saveNearbyShared: vi.fn<(items: SavedNearbyItem[]) => Promise<boolean>>(),
    getNearbyShared: vi.fn<() => Promise<{ items: SavedNearbyItem[]; next: string | null } | null>>(),
}));

vi.mock("../../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        canKeepNearbyShared: () => api.canKeep,
        saveNearbyShared: api.saveNearbyShared,
        getNearbyShared: api.getNearbyShared,
    },
}));
vi.mock("../../../../../Enum/EnvironmentVariable", () => ({ UPLOADER_URL: "https://uploader.example.com" }));
vi.mock("../../../../Connection/Proximity/ProximityChatRoom", () => ({ ProximityChatRoom: class {} }));

import { keepNearbyShared, nearbySavedFor } from "../NearbySavedStore";
import type { ProximityChatRoom } from "../../../../Connection/Proximity/ProximityChatRoom";

function message(id: string, type: ChatMessageType, content: Partial<ChatMessageContent>) {
    const store = writable<ChatMessageContent>({
        body: "",
        url: undefined,
        urls: undefined,
        filename: undefined,
        fileNames: undefined,
        ...content,
    });
    return {
        message: {
            id,
            type,
            isMyMessage: false,
            sender: { username: "Sara" },
            date: new Date("2026-10-26T09:49:00.000Z"),
            content: store,
            isDeleted: writable(false),
            sharedFile:
                type === "image" || type === "file"
                    ? { name: content.filename ?? "file", size: undefined, voice: false }
                    : undefined,
        } as unknown as ChatMessage,
        content: store,
    };
}

function fakeRoom(): { room: ProximityChatRoom; messages: Writable<ChatMessage[]> } {
    const messages = writable<ChatMessage[]>([]);
    return { room: { messages } as unknown as ProximityChatRoom, messages };
}

describe("keeping what the nearby chat shows", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        api.canKeep = true;
        api.saveNearbyShared.mockReset();
        api.saveNearbyShared.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("sends an image as it arrives, and a text's links once the text stops changing", async () => {
        const { room, messages } = fakeRoom();
        const stop = keepNearbyShared(room);
        const image = message("img-1", "image", { url: "https://cdn.example.com/door.png", filename: "door.png" });
        const text = message("txt-1", "proximity", { body: "Look at https://bawes" });
        messages.set([image.message, text.message]);

        // A bot's reply still arriving: the link isn't whole yet.
        await vi.advanceTimersByTimeAsync(2000);
        text.content.update((content) => ({ ...content, body: "Look at https://bawes.net/universe" }));
        await vi.advanceTimersByTimeAsync(6000);

        const sent = api.saveNearbyShared.mock.calls.flatMap(([items]) => items);
        expect(sent.map((row) => row.itemKey)).toEqual(["img-1", "txt-1 https://bawes.net/universe"]);
        stop();
    });

    it("sends nothing for a guest", async () => {
        api.canKeep = false;
        const { room, messages } = fakeRoom();
        const stop = keepNearbyShared(room);
        messages.set([message("img-2", "image", { url: "https://cdn.example.com/a.png", filename: "a.png" }).message]);
        await vi.advanceTimersByTimeAsync(10000);
        expect(api.saveNearbyShared).not.toHaveBeenCalled();
        stop();
    });

    it("sends an item once, even when the chat comes along to the next map", async () => {
        const first = fakeRoom();
        const image = message("img-3", "image", { url: "https://cdn.example.com/b.png", filename: "b.png" });
        const stopFirst = keepNearbyShared(first.room);
        first.messages.set([image.message]);
        await vi.advanceTimersByTimeAsync(3000);
        stopFirst();

        const next = fakeRoom();
        const stopNext = keepNearbyShared(next.room);
        next.messages.set([image.message]);
        await vi.advanceTimersByTimeAsync(3000);

        expect(api.saveNearbyShared.mock.calls.flatMap(([items]) => items).map((row) => row.itemKey)).toEqual([
            "img-3",
        ]);
        stopNext();
    });

    it("tries a batch Orbit didn't keep once more, then lets it go", async () => {
        api.saveNearbyShared.mockResolvedValue(false);
        const { room, messages } = fakeRoom();
        const stop = keepNearbyShared(room);
        messages.set([message("img-4", "image", { url: "https://cdn.example.com/c.png", filename: "c.png" }).message]);
        await vi.advanceTimersByTimeAsync(60000);
        expect(api.saveNearbyShared).toHaveBeenCalledTimes(2);
        expect(get(messages)).toHaveLength(1);
        stop();
    });
});

describe("reading what was kept", () => {
    it("asks again the next time the details open when Orbit didn't answer", async () => {
        const { ProximityChatRoom } = await import("../../../../Connection/Proximity/ProximityChatRoom");
        const room = new (ProximityChatRoom as unknown as new () => ProximityChatRoom)();
        const saved = nearbySavedFor(room);
        expect(saved).toBeDefined();
        api.canKeep = true;
        api.getNearbyShared.mockReset();
        api.getNearbyShared.mockResolvedValueOnce(null).mockResolvedValueOnce({ items: [], next: "c1" });

        let stop = saved?.items.subscribe(() => undefined);
        await vi.waitFor(() => expect(api.getNearbyShared).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        stop?.();

        stop = saved?.items.subscribe(() => undefined);
        await vi.waitFor(() => expect(api.getNearbyShared).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(saved && get(saved.hasMore)).toBe(true));
        stop?.();
    });
});
