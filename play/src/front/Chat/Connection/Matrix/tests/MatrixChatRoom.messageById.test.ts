import { describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";

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
vi.mock("../MatrixChatMessage", () => ({
    MatrixChatMessage: class {
        removed = false;
        destroyed = false;
        body = "";
        constructor(public event: { decrypted: boolean }) {}
        markAsRemoved() {
            this.removed = true;
        }
        destroy() {
            this.destroyed = true;
        }
        modifyContent(body: string) {
            this.body = body;
        }
    },
}));

import { MatrixChatRoom } from "../MatrixChatRoom";

/** Only what reading one message on its own touches: a client that fetches and decrypts it. */
function roomReading() {
    const event = { decrypted: false, getId: () => "$old", isEncrypted: () => true };
    const client = {
        getEventTimeline: vi.fn(() => Promise.resolve({ getEvents: () => [event] })),
        decryptEventIfNeeded: vi.fn(() => {
            event.decrypted = true;
            return Promise.resolve();
        }),
    };
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, {
        matrixRoom: { client, getUnfilteredTimelineSet: () => ({}), findEventById: () => undefined },
        id: "!room:chat.example.com",
        type: "multiple",
        messages: { get: () => undefined },
        detachedMessages: new Map(),
        members: writable([]),
    });
    return { room, client };
}

describe("a message read on its own, outside the loaded conversation", () => {
    it("is decrypted before it is read, and read once", async () => {
        const { room, client } = roomReading();
        const first = (await room.getMessageById("$old")) as unknown as { event: { decrypted: boolean } };
        expect(first.event.decrypted).toBe(true);
        expect(await room.getMessageById("$old")).toBe(first);
        expect(client.decryptEventIfNeeded).toHaveBeenCalledTimes(2);
    });

    it("is told when it is deleted", async () => {
        const { room } = roomReading();
        const message = (await room.getMessageById("$old")) as unknown as { removed: boolean };
        room["handleDeletion"]({ getAssociatedId: () => "$old" } as never);
        expect(message.removed).toBe(true);
    });

    it("gets an edit made while it is shown", async () => {
        const { room } = roomReading();
        const message = (await room.getMessageById("$old")) as unknown as { body: string };
        room["handleMessageModification"]({
            getRelation: () => ({ event_id: "$old" }),
            getOriginalContent: () => ({ "m.new_content": { body: "Meet at the lobby" } }),
        } as never);
        expect(message.body).toBe("Meet at the lobby");
    });
});
