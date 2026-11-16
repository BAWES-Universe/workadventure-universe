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

function roomSending(sendEvent = vi.fn(() => Promise.resolve({ event_id: "$sent" }))) {
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, { matrixRoom: { client: { sendEvent }, roomId: "!brick:chat.example.com" } });
    return { room, sendEvent };
}

describe("a Brick told to carry on after an App was connected from its card (#2001)", () => {
    it("sends an event with the App and no message of the person's", async () => {
        const { room, sendEvent } = roomSending();
        await room.sendAppConnected({ app: "google-calendar", name: "Google Calendar" });
        expect(sendEvent).toHaveBeenCalledTimes(1);
        expect(sendEvent).toHaveBeenCalledWith("!brick:chat.example.com", "universe.app_connected", {
            app: "google-calendar",
            name: "Google Calendar",
        });
    });

    it("tells the card when it could not be sent", async () => {
        const { room } = roomSending(vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(room.sendAppConnected({ app: "notion", name: "Notion" })).rejects.toThrow("offline");
    });
});
