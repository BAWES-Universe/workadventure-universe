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

function noteEvent(content: Record<string, unknown>): MatrixEvent {
    return {
        getId: () => "$note",
        // The homeserver's clock is a minute ahead of ours; the SDK's local timestamp is on our clock.
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getSender: () => BOT,
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

/** A room where I'm admin (100) and Alice is a member (0), as in a DM I started before DMs were made equal. */
function fakeRoom(): Room {
    const levels: Record<string, number> = { [ME]: 100 };
    return {
        client: {
            getUserId: () => ME,
            getSafeUserId: () => ME,
            getUser: () => null,
        },
        getMember: (userId: string) => ({ userId, powerLevelNorm: levels[userId] ?? 0 }),
        getLiveTimeline: () => ({
            getState: () => ({ hasSufficientPowerLevelFor: (_action: string, level: number) => level >= 50 }),
        }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

describe("MatrixChatMessage bot status notes", () => {
    it("times a bot's note on this device's clock, not the homeserver's", () => {
        const note = {
            msgtype: "m.notice",
            body: "Resting",
            "universe.bot_status": { state: "resting", title: "Resting", text: "Back soon" },
        };
        const message = new MatrixChatMessage(noteEvent(note), fakeRoom(), false, true);
        expect(message.botStatus?.state).toBe("resting");
        expect(message.botStatusAt).toBe(101_000);
    });

    it("gives no note time to an ordinary reply", () => {
        const message = new MatrixChatMessage(noteEvent({ msgtype: "m.text", body: "Hello" }), fakeRoom(), false, true);
        expect(message.botStatus).toBeUndefined();
        expect(message.botStatusAt).toBeUndefined();
    });
});
