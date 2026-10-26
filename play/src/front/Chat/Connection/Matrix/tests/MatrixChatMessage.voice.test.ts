import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(() => ({ url: Promise.resolve("blob:https://play.test/voice"), release: vi.fn() })),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";
import { getMediaCaption } from "../../../Components/Room/MessageActions/messageActions";

function fakeEvent(content: Record<string, unknown>): MatrixEvent {
    return {
        getId: () => "$event",
        getDate: () => new Date(0),
        getSender: () => "@alice:matrix.test",
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: () => {},
        off: () => {},
    } as unknown as MatrixEvent;
}

const room = {
    client: {
        getUserId: () => "@me:matrix.test",
        getSafeUserId: () => "@me:matrix.test",
        getUser: () => null,
    },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    findEventById: () => undefined,
} as unknown as Room;

function contentOf(content: Record<string, unknown>) {
    return get(new MatrixChatMessage(fakeEvent(content), room).content);
}

describe("a Matrix voice message", () => {
    // What Element X and Element Web send, and what our own voice notes send.
    const voice = {
        msgtype: "m.audio",
        body: "Voice message",
        url: "mxc://matrix.test/voice",
        info: { duration: 12000, mimetype: "audio/ogg", size: 4000 },
        "org.matrix.msc1767.audio": { duration: 12000, waveform: [0, 512, 1024, 256] },
        "org.matrix.msc3245.voice": {},
    };

    it("is flagged as a voice message with its length and shape, and has no caption", () => {
        const shown = contentOf(voice);

        expect(shown.isVoice).toBe(true);
        expect(shown.voiceDuration).toBe(12);
        expect(shown.voiceWaveform).toEqual([0.08, 0.5, 1, 0.25]);
        expect(getMediaCaption(shown)).toBeUndefined();
    });

    it("takes its length from the file info when the audio block has none", () => {
        const shown = contentOf({ ...voice, "org.matrix.msc1767.audio": { waveform: [100, 200] } });

        expect(shown.voiceDuration).toBe(12);
    });

    it("still plays when its sender wrote no length or shape", () => {
        const shown = contentOf({ msgtype: "m.audio", body: "Voice message", url: "mxc://x/y", "m.voice": {} });

        expect(shown.isVoice).toBe(true);
        expect(shown.voiceDuration).toBeUndefined();
        expect(shown.voiceWaveform).toBeUndefined();
    });

    it("is not one for an audio file", () => {
        const shown = contentOf({
            msgtype: "m.audio",
            body: "Interview.mp3",
            url: "mxc://x/y",
            info: { duration: 5000 },
        });

        expect(shown.isVoice).toBe(false);
        expect(shown.voiceDuration).toBeUndefined();
        expect(shown.filename).toBe("Interview.mp3");
    });
});
