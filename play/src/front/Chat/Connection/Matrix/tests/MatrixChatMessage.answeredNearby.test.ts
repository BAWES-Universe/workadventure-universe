import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

function event(sender: string, content: Record<string, unknown>): MatrixEvent {
    return {
        getId: () => "$copy",
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getSender: () => sender,
        getOriginalContent: () => content,
        getContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

function fakeRoom(): Room {
    return {
        client: {
            getUserId: () => ME,
            getSafeUserId: () => ME,
            getUser: () => null,
        },
        getMember: (userId: string) => ({ userId, powerLevelNorm: 0 }),
        getLiveTimeline: () => ({
            getState: () => ({ hasSufficientPowerLevelFor: () => false }),
        }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

describe("MatrixChatMessage: an answer from nearby chat, in the bot's direct messages (#1993)", () => {
    const copy = { msgtype: "m.notice", body: "It is at 10 on Thursday.", "universe.answered_nearby": true };

    it("is the bot's answer, read as any reply of it, and marked as answered in nearby chat", () => {
        const message = new MatrixChatMessage(event(BOT, copy), fakeRoom(), false, true);
        expect(message.answeredNearby).toBe(true);
        expect(message.type).toBe("text");
        expect(get(message.content).body).toBe("It is at 10 on Thursday.");
    });

    it("marks no ordinary reply of the bot, and nothing a person sent with the same field", () => {
        const reply = new MatrixChatMessage(event(BOT, { msgtype: "m.text", body: "Hello" }), fakeRoom(), false, true);
        expect(reply.answeredNearby).toBe(false);
        const forged = new MatrixChatMessage(event("@sara:matrix.test", copy), fakeRoom(), false, true);
        expect(forged.answeredNearby).toBe(false);
    });
});
