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

describe('a tap on "Start a new job", on the card for a job Orbit would not carry on (GPT\'s sixth answer, finding 6)', () => {
    it("sends the button's words as the person's own message, carrying the job the card named", async () => {
        const { room, sendMessage } = roomSending();
        await room.sendNewJob("Start a new job", { title: "Visa form" });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith("!brick:chat.example.com", {
            body: "Start a new job",
            msgtype: "m.text",
            formatted_body: "Start a new job",
            "universe.computer_new_job": { title: "Visa form" },
        });
    });

    it("tells the chat when the message could not be sent, so the card stays", async () => {
        const { room } = roomSending(vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(room.sendNewJob("Start a new job", { title: "Visa form" })).rejects.toThrow("offline");
    });
});
