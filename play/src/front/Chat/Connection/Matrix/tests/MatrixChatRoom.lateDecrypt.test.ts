import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { MatrixEventEvent } from "matrix-js-sdk";
import { SearchableArrayStore } from "@workadventure/store-utils";

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
    return { selectedRoomStore: writable(undefined), botsChatIds: writable<string[]>([]) };
});
vi.mock("../MatrixMedia", () => ({ holdMatrixMedia: vi.fn() }));
vi.mock("../MatrixChatUser", () => ({ chatUserFactory: () => undefined }));

import { MatrixChatRoom } from "../MatrixChatRoom";
import type { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

/** An encrypted Brick message whose keys arrive after the room took it in. */
function encryptedFromBrick() {
    let content: Record<string, unknown> = { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "..." };
    const listeners: (() => void)[] = [];
    const event = {
        getId: () => "$late",
        getDate: () => new Date(0),
        localTimestamp: 5,
        getSender: () => BRICK,
        getContent: () => content,
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: (name: string, listener: () => void) => {
            if (name === MatrixEventEvent.Decrypted) listeners.push(listener);
        },
        off: () => {},
    } as unknown as MatrixEvent;
    return {
        event,
        decrypt: (clear: Record<string, unknown>) => {
            content = clear;
            listeners.forEach((listener) => listener());
        },
    };
}

const matrixRoom = {
    client: { getUserId: () => ME, getSafeUserId: () => ME, getUser: () => null },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

function roomHolding() {
    const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
    Object.assign(room, {
        matrixRoom,
        type: "direct",
        messages: new SearchableArrayStore<string, MatrixChatMessage>((item) => item.id),
        members: writable([]),
        noteBubbles: new Map(),
        noteTranscripts: new Map(),
        addEventContentInMemory: () => undefined,
    });
    return room;
}

describe("the list of a chat's messages when a Brick's message is decrypted after it came in", () => {
    it("is told, so what the timeline draws from it (a card of ideas) shows without the list being built again", () => {
        const room = roomHolding();
        const { event, decrypt } = encryptedFromBrick();
        room["handleNewMessage"](event, false);
        const emitted: MatrixChatMessage[][] = [];
        const stop = room.messages.subscribe((list) => emitted.push([...list]));
        const before = emitted.length;
        expect(get(room.messages).at(-1)?.brickIdeas).toBe(false);

        decrypt({ msgtype: "m.text", body: "A few things I could take off your plate.", "universe.brick_ideas": true });

        expect(emitted.length).toBeGreaterThan(before);
        // What a subscriber of the list now reads: the newest message carries its card
        expect(emitted.at(-1)?.at(-1)?.brickIdeas).toBe(true);
        stop();
    });

    it("does not tell the list for a decryption that changes no card", () => {
        const room = roomHolding();
        const { event, decrypt } = encryptedFromBrick();
        room["handleNewMessage"](event, false);
        let emitted = 0;
        const stop = room.messages.subscribe(() => emitted++);
        const before = emitted;
        decrypt({ msgtype: "m.text", body: "Plain words" });
        expect(emitted).toBe(before);
        stop();
    });
});
