import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(() => ({ url: new Promise(() => {}), release: vi.fn() })),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

function event(
    id: string,
    sender: string,
    content: Record<string, unknown>,
    unsigned: Record<string, unknown> = {}
): MatrixEvent {
    return {
        getId: () => id,
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getSender: () => sender,
        getOriginalContent: () => content,
        getUnsigned: () => unsigned,
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replacingEvent: () => null,
        getTs: () => 161_000,
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

function fakeRoom(): Room {
    return {
        client: { getUserId: () => ME, getSafeUserId: () => ME, getUser: () => null, mxcUrlToHttp: (u: string) => u },
        getMember: (userId: string) => ({ userId, powerLevelNorm: 0 }),
        getLiveTimeline: () => ({
            getState: () => ({ hasSufficientPowerLevelFor: () => false }),
        }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

const voiceNote = event("$note", ME, {
    msgtype: "m.audio",
    body: "Voice message.m4a",
    url: "mxc://matrix.test/note",
    info: { mimetype: "audio/mp4", duration: 4000 },
    "org.matrix.msc3245.voice": {},
});
const transcriptNotice = (field: Record<string, unknown>, unsigned: Record<string, unknown> = {}) =>
    event(
        "$tx",
        BOT,
        { msgtype: "m.notice", body: "Listening…", "universe.transcript": { v: 1, for: "$note", ...field } },
        unsigned
    );

describe("a bot's transcript of a voice note", () => {
    it("knows the notice that carries it, which is never drawn as a message", () => {
        const notice = new MatrixChatMessage(transcriptNotice({ state: "listening" }), fakeRoom(), false, true);
        expect(notice.transcriptNotice).toBe(true);
        expect(notice.transcriptOf).toEqual({ for: "$note", state: "listening" });
        const note = new MatrixChatMessage(voiceNote, fakeRoom(), false, true);
        expect(note.transcriptNotice).toBe(false);
    });

    it("reads a notice from history as its last edit left it", () => {
        const bundled = {
            "m.relations": {
                "m.replace": {
                    content: {
                        "m.new_content": {
                            msgtype: "m.notice",
                            body: "hi",
                            "universe.transcript": { v: 1, for: "$note", state: "heard", text: "hi there" },
                        },
                    },
                },
            },
        };
        const notice = new MatrixChatMessage(
            transcriptNotice({ state: "listening" }, bundled),
            fakeRoom(),
            false,
            true
        );
        expect(notice.transcriptOf).toEqual({ for: "$note", state: "heard", text: "hi there" });
    });

    it("is shown inside the voice note's own content, and only a voice note takes it", () => {
        const note = new MatrixChatMessage(voiceNote, fakeRoom(), false, true);
        expect(get(note.content).transcript).toBeUndefined();
        note.setTranscript({ state: "heard", text: "hi there" });
        expect(get(note.content).transcript).toEqual({ state: "heard", text: "hi there" });
        expect(get(note.content).isVoice).toBe(true);

        const text = new MatrixChatMessage(event("$t", ME, { msgtype: "m.text", body: "hi" }), fakeRoom(), false, true);
        text.setTranscript({ state: "heard", text: "nope" });
        expect(get(text.content).transcript).toBeUndefined();
    });
});
