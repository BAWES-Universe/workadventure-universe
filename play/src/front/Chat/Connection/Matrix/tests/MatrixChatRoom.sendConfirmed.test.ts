import { describe, expect, it, vi } from "vitest";

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
    return {
        selectedRoomStore: writable(undefined),
        selectedChatMessageToReply: writable(null),
    };
});
vi.mock("../MatrixChatMessage", () => ({ MatrixChatMessage: class {} }));

import { get } from "svelte/store";
import type { ChatMessage } from "../../ChatConnection";
import { selectedChatMessageToReply } from "../../../Stores/ChatStore";
import { MatrixChatRoom } from "../MatrixChatRoom";

function roomSending(sendMessage = vi.fn(() => Promise.resolve({ event_id: "$sent" }))) {
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, { matrixRoom: { client: { sendMessage }, roomId: "!brick:chat.example.com" } });
    return { room, sendMessage };
}

describe("a message the chat server confirms (what was written while a Brick's chat was made)", () => {
    it("is sent as plain words, even when a reply was picked in another chat, and leaves that reply target alone", async () => {
        const other = { id: "$other" } as unknown as ChatMessage;
        selectedChatMessageToReply.set(other);
        const { room, sendMessage } = roomSending();
        await room.sendMessageConfirmed("brief at 8?");
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith("!brick:chat.example.com", {
            body: "brief at 8?",
            msgtype: "m.text",
            formatted_body: "brief at 8?",
        });
        // The reply the person picked in the other chat is still picked there
        expect(get(selectedChatMessageToReply)).toBe(other);
        selectedChatMessageToReply.set(null);
    });

    it("tells the caller when the chat server did not take it", async () => {
        const { room } = roomSending(vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(room.sendMessageConfirmed("hi")).rejects.toThrow("offline");
    });
});
