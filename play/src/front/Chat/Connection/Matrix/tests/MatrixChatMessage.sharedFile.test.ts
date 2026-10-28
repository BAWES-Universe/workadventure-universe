import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";

const { holdMatrixMedia } = vi.hoisted(() => ({
    holdMatrixMedia: vi.fn(() => ({ url: Promise.resolve("blob:https://play.test/file"), release: vi.fn() })),
}));
vi.mock("../MatrixMedia", () => ({ holdMatrixMedia }));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

function fakeEvent(content: Record<string, unknown>, redacted = false): MatrixEvent {
    return {
        getId: () => "$event",
        getDate: () => new Date(0),
        getSender: () => "@alice:matrix.test",
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => redacted,
        replacingEventId: () => undefined,
        on: () => {},
        off: () => {},
    } as unknown as MatrixEvent;
}

const room = {
    client: { getUserId: () => "@me:matrix.test", getSafeUserId: () => "@me:matrix.test", getUser: () => null },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    findEventById: () => undefined,
} as unknown as Room;

describe("what a Matrix file message shares", () => {
    it("gives the file's name and size without fetching it", () => {
        const message = new MatrixChatMessage(
            fakeEvent({ msgtype: "m.file", body: "Q4 budget.xlsx", url: "mxc://matrix.test/a", info: { size: 5120 } }),
            room
        );

        expect(message.sharedFile).toEqual({ name: "Q4 budget.xlsx", size: 5120, voice: false });
        expect(holdMatrixMedia).not.toHaveBeenCalled();
    });

    it("tells a voice message apart from an audio file", () => {
        const voice = new MatrixChatMessage(
            fakeEvent({
                msgtype: "m.audio",
                body: "Voice message.ogg",
                url: "mxc://matrix.test/v",
                info: { mimetype: "audio/ogg" },
                "org.matrix.msc3245.voice": {},
            }),
            room
        );
        expect(voice.sharedFile?.voice).toBe(true);
    });

    it("tells a voice message flagged with the stable m.voice apart from an audio file", () => {
        const voice = new MatrixChatMessage(
            fakeEvent({
                msgtype: "m.audio",
                body: "Voice message.ogg",
                url: "mxc://matrix.test/v",
                info: { mimetype: "audio/ogg" },
                "m.voice": {},
            }),
            room
        );
        expect(voice.sharedFile?.voice).toBe(true);
    });

    it("has nothing for a file message that was deleted", () => {
        const deleted = new MatrixChatMessage(
            fakeEvent({ msgtype: "m.file", body: "Q4 budget.xlsx", url: "mxc://matrix.test/f" }, true),
            room
        );
        expect(deleted.sharedFile).toBeUndefined();
    });

    it("has nothing for a text message", () => {
        const text = new MatrixChatMessage(fakeEvent({ msgtype: "m.text", body: "hello" }), room);
        expect(text.sharedFile).toBeUndefined();
    });
});
