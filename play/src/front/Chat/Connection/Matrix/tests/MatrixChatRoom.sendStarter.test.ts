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
    return { selectedRoomStore: writable(undefined) };
});
vi.mock("../MatrixChatMessage", () => ({ MatrixChatMessage: class {} }));

import { MatrixChatRoom } from "../MatrixChatRoom";

function roomSending(sendMessage = vi.fn(() => Promise.resolve({ event_id: "$sent" }))) {
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, { matrixRoom: { client: { sendMessage }, roomId: "!brick:chat.example.com" } });
    return { room, sendMessage };
}

describe("a tap on one of a Brick's ways to start (#1995)", () => {
    it("sends the words as the person's own message, and says which starter it was", async () => {
        const { room, sendMessage } = roomSending();
        await room.sendStarter("What can you do for me?", "ideas");
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith("!brick:chat.example.com", {
            body: "What can you do for me?",
            msgtype: "m.text",
            formatted_body: "What can you do for me?",
            "universe.starter": "ideas",
        });
    });

    it("tells the chat when the message could not be sent, so the card stays", async () => {
        const { room } = roomSending(vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(room.sendStarter("What can you do for me?", "ideas")).rejects.toThrow("offline");
    });
});
