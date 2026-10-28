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
const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

function stepsEvent(
    content: Record<string, unknown>,
    unsigned: Record<string, unknown> = {},
    replacing?: Record<string, unknown>
): MatrixEvent {
    return {
        getId: () => "$steps",
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getSender: () => BOT,
        getOriginalContent: () => content,
        getUnsigned: () => unsigned,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => (replacing ? "$edit" : undefined),
        replacingEvent: () => (replacing ? { getOriginalContent: () => replacing } : null),
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

const field = (state: string, line: string) => ({
    v: 1,
    state,
    line,
    startedAt: 1000,
    steps: [{ doing: "Make a song", done: "Make a song", state: state === "working" ? "running" : "done" }],
});
const notice = (state: string, line: string) => ({
    msgtype: "m.notice",
    body: line,
    "universe.steps": field(state, line),
});

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

describe("MatrixChatMessage steps line", () => {
    it("shows a steps line read from history where its last edit left it", () => {
        const bundled = {
            "m.relations": { "m.replace": { content: { "m.new_content": notice("done", "Make a song") } } },
        };
        const message = new MatrixChatMessage(
            stepsEvent(notice("working", "Make a song"), bundled),
            fakeRoom(),
            false,
            true
        );
        expect(get(message.steps)?.state).toBe("done");
    });

    it("reads the edit the SDK applied when the history carried none", () => {
        const edit = { "m.new_content": notice("done", "Make a song") };
        const message = new MatrixChatMessage(
            stepsEvent(notice("working", "Make a song"), {}, edit),
            fakeRoom(),
            false,
            true
        );
        expect(get(message.steps)?.state).toBe("done");
    });

    it("takes an edit only from the bot that sent the line", () => {
        const message = new MatrixChatMessage(stepsEvent(notice("working", "Make a song")), fakeRoom(), false, true);
        message.modifySteps("@someone:matrix.test", notice("done", "Make a song"));
        expect(get(message.steps)?.state).toBe("working");
        message.modifySteps(BOT, notice("done", "Make a song"));
        expect(get(message.steps)?.state).toBe("done");
    });

    it("has no steps line on an ordinary reply", () => {
        const message = new MatrixChatMessage(
            stepsEvent({ msgtype: "m.text", body: "Hello" }),
            fakeRoom(),
            false,
            true
        );
        expect(get(message.steps)).toBeUndefined();
    });
});
