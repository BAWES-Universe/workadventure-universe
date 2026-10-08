import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { EventStatus, EventType } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";

function fakeEvent(): MatrixEvent {
    return {
        getId: () => "$message",
        getDate: () => new Date(0),
        getSender: () => ME,
        getOriginalContent: () => ({ msgtype: "m.text", body: "hi" }),
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

interface Deferred {
    resolve: () => void;
    reject: (error: Error) => void;
}

/** A room whose sends and removals wait until the test answers them, like a slow server. */
function fakeRoom() {
    const calls: string[] = [];
    const waiting: Deferred[] = [];
    let nextId = 0;
    const pending: MatrixEvent[] = [];
    const cancelPendingEvent = vi.fn();
    const wait = <T>(value: () => T) =>
        new Promise<T>((resolve, reject) => {
            waiting.push({ resolve: () => resolve(value()), reject });
        });
    const room = {
        roomId: "!room",
        myUserId: ME,
        client: {
            getUserId: () => ME,
            getSafeUserId: () => ME,
            getUser: () => null,
            sendEvent: (_roomId: string, type: string, content: { "m.relates_to": { key: string } }) => {
                calls.push(`send ${content["m.relates_to"].key}`);
                expect(type).toBe(EventType.Reaction);
                return wait(() => ({ event_id: `$reaction${++nextId}` }));
            },
            redactEvent: (_roomId: string, eventId: string) => {
                calls.push(`remove ${eventId}`);
                return wait(() => ({}));
            },
            cancelPendingEvent,
        },
        getMember: () => null,
        getLiveTimeline: () => ({ getState: () => ({ hasSufficientPowerLevelFor: () => false }) }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
        findEventById: () => undefined,
        getPendingEvent: () => null,
        getPendingEvents: () => pending,
    } as unknown as Room;
    return {
        room,
        calls,
        pending,
        cancelPendingEvent,
        /** Answers the oldest request still waiting. */
        answer: async () => {
            waiting.shift()?.resolve();
            await vi.advanceTimersByTimeAsync(0);
        },
        refuse: async () => {
            waiting.shift()?.reject(new Error("M_DUPLICATE_ANNOTATION"));
            await vi.advanceTimersByTimeAsync(0);
        },
    };
}

describe("MatrixChatMessage reactions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("sends a single click at once", async () => {
        const server = fakeRoom();
        const message = new MatrixChatMessage(fakeEvent(), server.room);
        const done = message.toggleReaction("👍");
        expect(server.calls).toEqual(["send 👍"]);
        await server.answer();
        await vi.advanceTimersByTimeAsync(1000);
        await done;
        expect(server.calls).toEqual(["send 👍"]);
    });

    it("never sends the same reaction twice while clicks are quick, and ends where the last click says", async () => {
        const server = fakeRoom();
        const message = new MatrixChatMessage(fakeEvent(), server.room);
        message.toggleReaction("👍").catch(() => {});
        // Four more clicks while the first is on its way: on, off, on, off, on.
        for (let i = 0; i < 4; i++) {
            message.toggleReaction("👍").catch(() => {});
            // eslint-disable-next-line no-await-in-loop
            await vi.advanceTimersByTimeAsync(50);
        }
        await server.answer();
        expect(server.calls).toEqual(["send 👍"]);
        // Five clicks end on "on", which is already on the server: nothing else to send.
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.calls).toEqual(["send 👍"]);

        // Two quick clicks end on "on" again: the reaction is taken off once, not sent again.
        message.toggleReaction("👍").catch(() => {});
        expect(server.calls).toEqual(["send 👍", "remove $reaction1"]);
        message.toggleReaction("👍").catch(() => {});
        await server.answer();
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.calls).toEqual(["send 👍", "remove $reaction1", "send 👍"]);
        await server.answer();
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.calls).toHaveLength(3);
    });

    it("drops a refused reaction so the rest of the chat keeps sending", async () => {
        const server = fakeRoom();
        const refused = {
            status: EventStatus.NOT_SENT,
            getType: () => EventType.Reaction,
            isRedaction: () => false,
        } as unknown as MatrixEvent;
        const unsentMessage = {
            status: EventStatus.NOT_SENT,
            getType: () => EventType.RoomMessage,
            isRedaction: () => false,
        } as unknown as MatrixEvent;
        server.pending.push(refused, unsentMessage);
        const message = new MatrixChatMessage(fakeEvent(), server.room);
        const done = message.toggleReaction("👍");
        await server.refuse();
        await done;
        expect(server.cancelPendingEvent).toHaveBeenCalledWith(refused);
        expect(server.cancelPendingEvent).not.toHaveBeenCalledWith(unsentMessage);
        // The next click starts again from what the server has.
        message.toggleReaction("👍").catch(() => {});
        expect(server.calls).toEqual(["send 👍", "send 👍"]);
    });
});
