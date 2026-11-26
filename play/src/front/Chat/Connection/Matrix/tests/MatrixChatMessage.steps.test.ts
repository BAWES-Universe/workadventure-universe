import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { MatrixEvent, type Room } from "matrix-js-sdk";

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
    replacing?: Record<string, unknown>,
    replacingTs = 171_000
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
        replacingEvent: () => (replacing ? { getOriginalContent: () => replacing, getTs: () => replacingTs } : null),
        getTs: () => 161_000,
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

    describe("when the SDK holds a stale bundled edit beside a newer one (game #2131)", () => {
        const stale = (ts?: number) => ({
            "m.relations": {
                "m.replace": {
                    event_id: "$stale",
                    content: { "m.new_content": notice("working", "Make a song") },
                    ...(ts === undefined ? {} : { origin_server_ts: ts }),
                },
            },
        });
        const done = { "m.new_content": notice("done", "Make a song") };

        it("shows the newer edit the SDK applied, not an older bundled one", () => {
            const message = new MatrixChatMessage(
                stepsEvent(notice("working", "Make a song"), stale(165_000), done, 171_000),
                fakeRoom(),
                false,
                true
            );
            expect(get(message.steps)?.state).toBe("done");
        });

        it("shows the bundled edit when it is the newer one", () => {
            const message = new MatrixChatMessage(
                stepsEvent(
                    notice("working", "Make a song"),
                    {
                        "m.relations": {
                            "m.replace": {
                                event_id: "$late",
                                content: { "m.new_content": notice("done", "Make a song") },
                                origin_server_ts: 180_000,
                            },
                        },
                    },
                    { "m.new_content": notice("working", "Make a song") },
                    171_000
                ),
                fakeRoom(),
                false,
                true
            );
            expect(get(message.steps)?.state).toBe("done");
        });

        it("trusts the applied edit over a bundle with no time", () => {
            const message = new MatrixChatMessage(
                stepsEvent(notice("working", "Make a song"), stale(), done),
                fakeRoom(),
                false,
                true
            );
            expect(get(message.steps)?.state).toBe("done");
        });
    });

    describe("with real events from the SDK (game #2131)", () => {
        const ROOM = "!room:matrix.test";
        const original = (unsigned: Record<string, unknown> = {}) =>
            new MatrixEvent({
                type: "m.room.message",
                event_id: "$steps",
                sender: BOT,
                room_id: ROOM,
                origin_server_ts: 161_000,
                content: notice("working", "Make a song"),
                unsigned,
            });
        const edit = (newContent: Record<string, unknown> | undefined, ts: number) =>
            new MatrixEvent({
                type: "m.room.message",
                event_id: "$edit",
                sender: BOT,
                room_id: ROOM,
                origin_server_ts: ts,
                content: {
                    msgtype: "m.notice",
                    body: "* Make a song",
                    ...(newContent ? { "m.new_content": newContent } : {}),
                    "m.relates_to": { rel_type: "m.replace", event_id: "$steps" },
                },
            });
        const bundled = (ts: number) => ({
            "m.relations": {
                "m.replace": {
                    event_id: "$stale",
                    origin_server_ts: ts,
                    content: { "m.new_content": notice("working", "Make a song") },
                },
            },
        });

        it("shows the applied edit that is newer than a bundled one the SDK also holds", () => {
            const event = original(bundled(165_000));
            event.makeReplaced(edit(notice("done", "Make a song"), 171_000));
            const message = new MatrixChatMessage(event, fakeRoom(), false, true);
            expect(get(message.steps)?.state).toBe("done");
        });

        it("keeps the readable bundled edit when a newer applied edit has nothing readable in it", () => {
            const event = original({
                "m.relations": {
                    "m.replace": {
                        event_id: "$stale",
                        origin_server_ts: 165_000,
                        content: { "m.new_content": notice("done", "Make a song") },
                    },
                },
            });
            event.makeReplaced(edit(undefined, 171_000));
            const message = new MatrixChatMessage(event, fakeRoom(), false, true);
            expect(get(message.steps)?.state).toBe("done");
        });
    });
});
