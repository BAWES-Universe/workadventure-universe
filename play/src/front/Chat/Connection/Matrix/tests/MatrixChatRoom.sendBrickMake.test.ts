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

const offer = {
    topic: "recipes",
    ask: "You cook a lot. Want a Brick just for recipes?",
    name: "Recipe Brick",
    line: "It keeps your recipes in one place",
    instructions: "You keep recipes.",
};

describe('a tap on "Make it" on a Brick\'s suggestion (#1996)', () => {
    it("sends the words as the person's own message, with the Brick the card described and not its question", async () => {
        const { room, sendMessage } = roomSending();
        await room.sendBrickMake("Make Recipe Brick", offer);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith("!brick:chat.example.com", {
            body: "Make Recipe Brick",
            msgtype: "m.text",
            formatted_body: "Make Recipe Brick",
            "universe.brick_make": {
                topic: "recipes",
                name: "Recipe Brick",
                line: "It keeps your recipes in one place",
                instructions: "You keep recipes.",
            },
        });
    });

    it("tells the chat when the message could not be sent, so the card stays", async () => {
        const { room } = roomSending(vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(room.sendBrickMake("Make Recipe Brick", offer)).rejects.toThrow("offline");
    });
});
