import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { MatrixEventEvent } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

/** An encrypted Brick message whose keys arrive after the message is made: its content is the cipher until then. */
function encryptedFromBrick() {
    let content: Record<string, unknown> = { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "..." };
    const listeners: (() => void)[] = [];
    const event = {
        getId: () => "$late",
        getDate: () => new Date(0),
        localTimestamp: 5,
        getSender: () => BRICK,
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

const room = {
    client: { getUserId: () => ME, getSafeUserId: () => ME, getUser: () => null },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

describe("a Brick's message decrypted after it was made", () => {
    it("reads what it carries (ideas, answered nearby, a guest's chat) from the decrypted content", () => {
        const { event, decrypt } = encryptedFromBrick();
        const message = new MatrixChatMessage(event, room, false, true);
        expect(message.brickIdeas).toBe(false);
        expect(message.guestChat).toEqual([]);

        decrypt({
            msgtype: "m.text",
            body: "A few things I could take off your plate.",
            "universe.brick_ideas": true,
            "universe.guest_chat": [{ from: "guest", text: "Hello" }],
        });

        expect(message.brickIdeas).toBe(true);
        expect(message.guestChat).toEqual([expect.objectContaining({ from: "guest", text: "Hello" })]);
    });

    it("reads that it is the one private copy of an answer given nearby", () => {
        const { event, decrypt } = encryptedFromBrick();
        const message = new MatrixChatMessage(event, room, false, true);
        expect(message.answeredNearby).toBe(false);

        decrypt({ msgtype: "m.notice", body: "Here it is", "universe.answered_nearby": true });

        expect(message.answeredNearby).toBe(true);
    });
});
