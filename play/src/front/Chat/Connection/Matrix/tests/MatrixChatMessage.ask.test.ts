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

function askEvent(
    content: Record<string, unknown>,
    unsigned: Record<string, unknown> = {},
    replacing?: Record<string, unknown>
): MatrixEvent {
    return {
        getId: () => "$ask",
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getTs: () => 161_000,
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

const field = (answer?: Record<string, unknown>) => ({
    v: 1,
    kind: "approval",
    id: "act_1",
    revision: 1,
    title: "Create a Linear issue",
    lines: [{ label: "Team", text: "WEB" }],
    options: [
        { id: "approve", label: "Create issue" },
        { id: "decline", label: "Don't create" },
    ],
    now: 1_000_000,
    expiresAt: 1_600_000,
    waitMinutes: 10,
    ...(answer ? { answer } : {}),
});
const notice = (answer?: Record<string, unknown>) => ({
    msgtype: "m.notice",
    body: "Create a Linear issue?",
    "universe.ask": field(answer),
});

function fakeRoom(): Room {
    return {
        client: { getUserId: () => ME, getSafeUserId: () => ME, getUser: () => null },
        getMember: (userId: string) => ({ userId, powerLevelNorm: 0 }),
        getLiveTimeline: () => ({ getState: () => ({ hasSufficientPowerLevelFor: () => false }) }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

describe("MatrixChatMessage card", () => {
    it("reads the card a bot's notice carries, counted from when this device got it", () => {
        const message = new MatrixChatMessage(askEvent(notice()), fakeRoom(), false, true);
        const ask = get(message.ask);
        expect(ask?.id).toBe("act_1");
        expect(ask?.expiresAt).toBe(101_000 + 600_000);
        expect(ask?.answer).toBeUndefined();
    });

    it("shows a card read from history where its last edit left it", () => {
        const bundled = { "m.relations": { "m.replace": { content: { "m.new_content": notice({ closed: true }) } } } };
        const message = new MatrixChatMessage(askEvent(notice(), bundled), fakeRoom(), false, true);
        expect(get(message.ask)?.answer).toEqual({ closed: true });
    });

    it("counts an edited card's time from when the edit was written, not from the first notice", () => {
        // The first notice was written at 161_000 on the server (101_000 here); "More time" at 461_000 (so 401_000 here)
        const more = { ...notice(), "universe.ask": { ...field(), now: 2_000_000, expiresAt: 2_600_000, revision: 2 } };
        const bundled = {
            "m.relations": {
                "m.replace": { origin_server_ts: 461_000, content: { "m.new_content": more } },
            },
        };
        const message = new MatrixChatMessage(askEvent(notice(), bundled), fakeRoom(), false, true);
        expect(get(message.ask)?.revision).toBe(2);
        expect(get(message.ask)?.expiresAt).toBe(401_000 + 600_000);
    });

    it("takes an edit only from the bot that sent the card", () => {
        const message = new MatrixChatMessage(askEvent(notice()), fakeRoom(), false, true);
        message.modifyAsk("@someone:matrix.test", notice({ option: "approve" }));
        expect(get(message.ask)?.answer).toBeUndefined();
        message.modifyAsk(BOT, notice({ option: "approve" }));
        expect(get(message.ask)?.answer).toEqual({ option: "approve" });
    });

    it("has no card on an ordinary reply", () => {
        const message = new MatrixChatMessage(askEvent({ msgtype: "m.text", body: "Hello" }), fakeRoom(), false, true);
        expect(get(message.ask)).toBeUndefined();
    });
});
