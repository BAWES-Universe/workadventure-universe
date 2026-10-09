import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const ALICE = "@alice:matrix.test";

function fakeEvent(sender: string): MatrixEvent {
    return {
        getId: () => "$event",
        getDate: () => new Date(0),
        getSender: () => sender,
        getOriginalContent: () => ({ msgtype: "m.text", body: "hi" }),
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
    const levels: Record<string, number> = { [ME]: 100, [ALICE]: 0 };
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

describe("MatrixChatMessage canDelete", () => {
    it("in a DM, lets me delete only my own messages, even as the room's admin", () => {
        expect(get(new MatrixChatMessage(fakeEvent(ME), fakeRoom(), false, true).canDelete)).toBe(true);
        expect(get(new MatrixChatMessage(fakeEvent(ALICE), fakeRoom(), false, true).canDelete)).toBe(false);
    });

    it("in a group, still lets a moderator delete others' messages", () => {
        expect(get(new MatrixChatMessage(fakeEvent(ALICE), fakeRoom(), false, false).canDelete)).toBe(true);
        expect(get(new MatrixChatMessage(fakeEvent(ALICE), fakeRoom()).canDelete)).toBe(true);
    });
});
