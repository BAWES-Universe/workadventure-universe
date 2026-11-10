import { describe, expect, it } from "vitest";
import { parseNoteTranscript, readNoteTranscript } from "../BotTranscript";

const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";
const notice = (field: unknown) => ({ msgtype: "m.notice", body: "x", "universe.transcript": field });

describe("what a bot heard in a voice note", () => {
    it("reads the three states of a note", () => {
        expect(readNoteTranscript(BOT, notice({ v: 1, for: "$n", state: "listening" }))).toEqual({
            for: "$n",
            state: "listening",
        });
        expect(readNoteTranscript(BOT, notice({ v: 1, for: "$n", state: "heard", text: " hello there " }))).toEqual({
            for: "$n",
            state: "heard",
            text: "hello there",
        });
        expect(readNoteTranscript(BOT, notice({ v: 1, for: "$n", state: "failed" }))).toEqual({
            for: "$n",
            state: "failed",
        });
    });

    it("counts a heard note with no words as one that could not be listened to", () => {
        expect(parseNoteTranscript({ v: 1, for: "$n", state: "heard", text: "   " })).toEqual({
            for: "$n",
            state: "failed",
        });
    });

    it("ignores anything a bot did not send, or that is not a notice, or is malformed", () => {
        const field = { v: 1, for: "$n", state: "heard", text: "hi" };
        expect(readNoteTranscript("@alice:matrix.test", notice(field))).toBeUndefined();
        expect(readNoteTranscript(BOT, { msgtype: "m.text", "universe.transcript": field })).toBeUndefined();
        expect(parseNoteTranscript({ v: 2, for: "$n", state: "heard", text: "hi" })).toBeUndefined();
        expect(parseNoteTranscript({ v: 1, state: "heard", text: "hi" })).toBeUndefined();
        expect(parseNoteTranscript({ v: 1, for: "$n", state: "gone" })).toBeUndefined();
        expect(parseNoteTranscript("heard")).toBeUndefined();
    });

    it("cuts a transcript that is far longer than a note can hold", () => {
        const heard = parseNoteTranscript({ v: 1, for: "$n", state: "heard", text: "a".repeat(20000) });
        expect(heard?.text).toHaveLength(8000);
    });
});
