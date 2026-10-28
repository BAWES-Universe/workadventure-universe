import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    fromMatrixWaveform,
    hasPlayedVoiceNote,
    isVoiceNoteFileName,
    isVoiceNoteUnplayed,
    markVoiceNotePlayed,
    pickRecordingFormat,
    resampleWaveform,
    secondsFromMatrixDuration,
    toMatrixWaveform,
    voiceNoteFileName,
    waveformOf,
} from "./VoiceNote";

describe("the format a browser records a voice note in", () => {
    it("prefers MP4 (it plays everywhere), then Opus in WebM, then Opus in Ogg", () => {
        expect(pickRecordingFormat(() => true)?.fileType).toBe("audio/mp4");
        expect(
            pickRecordingFormat((type) => type.startsWith("audio/webm") || type.startsWith("audio/ogg"))?.fileType
        ).toBe("audio/webm");
        expect(pickRecordingFormat((type) => type.startsWith("audio/ogg"))?.fileType).toBe("audio/ogg");
    });

    it("is undefined when the browser records none of them", () => {
        expect(pickRecordingFormat(() => false)).toBeUndefined();
    });

    it("names WebM and Ogg notes so the nearby chat does not read them as video", () => {
        const names = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].map((wanted) =>
            voiceNoteFileName(pickRecordingFormat((type) => type === wanted)!)
        );
        expect(names).toEqual(["Voice message.weba", "Voice message.oga"]);
    });
});

describe("telling a voice note's file name from other audio", () => {
    it.each(["Voice message.m4a", "Voice message.weba", "voice message.OGA", " Voice message.m4a "])(
        "knows %s",
        (name) => expect(isVoiceNoteFileName(name)).toBe(true)
    );
    it.each(["Interview.mp3", "Voice message", "Voice message final.m4a", "My Voice message.m4a", "", undefined])(
        "does not take %s for a note",
        (name) => expect(isVoiceNoteFileName(name)).toBe(false)
    );
});

describe("the shape of a note", () => {
    it("is one bar per slice at its loudest, the loudest bar at 1", () => {
        expect(waveformOf([0.1, 0.2, 0.5, 0.25], 2)).toEqual([0.4, 1]);
    });

    it("never draws a bar below the floor, and shows a quiet note", () => {
        expect(waveformOf([0, 0, 0, 0], 4).every((bar) => bar >= 0.08)).toBe(true);
        expect(waveformOf([], 3)).toEqual([0.08, 0.08, 0.08]);
    });

    it("can be drawn with more bars than levels", () => {
        const bars = resampleWaveform([0.5, 1], 6);
        expect(bars).toHaveLength(6);
        expect(Math.max(...bars)).toBe(1);
    });

    it("goes to Matrix as whole numbers from 0 to 1024, 100 of them", () => {
        const sent = toMatrixWaveform([0.25, 1, 0.5]);
        expect(sent).toHaveLength(100);
        expect(Math.max(...sent)).toBe(1024);
        expect(sent.every((level) => Number.isInteger(level) && level >= 0 && level <= 1024)).toBe(true);
    });

    it("comes back from Element's 0 to 1024 scale", () => {
        expect(fromMatrixWaveform([0, 512, 1024, 2000, -5])).toEqual([0.08, 0.5, 1, 1, 0.08]);
    });

    it.each([undefined, null, [], "loud", { length: 3 }])("is undefined for an unusable waveform (%j)", (raw) => {
        expect(fromMatrixWaveform(raw)).toBeUndefined();
    });

    it("reads Element's length in milliseconds as seconds", () => {
        expect(secondsFromMatrixDuration(4500)).toBe(4.5);
        expect(secondsFromMatrixDuration(0)).toBeUndefined();
        expect(secondsFromMatrixDuration("4500")).toBeUndefined();
        expect(secondsFromMatrixDuration(Number.NaN)).toBeUndefined();
    });
});

describe("which received notes are new on this device", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("is new until it is played, and stays played", () => {
        const sentNow = new Date(Date.now() + 1000);
        expect(isVoiceNoteUnplayed("$a", sentNow)).toBe(true);
        markVoiceNotePlayed("$a");
        expect(hasPlayedVoiceNote("$a")).toBe(true);
        expect(isVoiceNoteUnplayed("$a", sentNow)).toBe(false);
        expect(isVoiceNoteUnplayed("$b", sentNow)).toBe(true);
    });

    it("does not mark a note sent before this device first showed notes", () => {
        isVoiceNoteUnplayed("$first", new Date());
        expect(isVoiceNoteUnplayed("$old", new Date(Date.now() - 24 * 3600 * 1000))).toBe(false);
    });

    it("marks the first note of a new device when it arrives after the code loaded", async () => {
        vi.useFakeTimers();
        try {
            localStorage.clear();
            vi.resetModules();
            const fresh = await import("./VoiceNote");
            const sentAt = new Date(Date.now() + 1000);
            // The note is drawn some time after it was sent.
            await vi.advanceTimersByTimeAsync(5000);

            expect(fresh.isVoiceNoteUnplayed("$first", sentAt)).toBe(true);
            expect(fresh.isVoiceNoteUnplayed("$history", new Date(Date.now() - 3600 * 1000))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the newest 500 played notes", () => {
        for (let i = 0; i < 510; i++) markVoiceNotePlayed(`$m${i}`);
        expect(hasPlayedVoiceNote("$m0")).toBe(false);
        expect(hasPlayedVoiceNote("$m509")).toBe(true);
    });

    it("carries on when the browser blocks its storage", () => {
        const blocked = () => {
            throw new Error("blocked");
        };
        const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
        try {
            expect(() => markVoiceNotePlayed("$a")).not.toThrow();
            expect(hasPlayedVoiceNote("$a")).toBe(false);
            expect(isVoiceNoteUnplayed("$a", new Date())).toBe(true);
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
        }
    });

    it("keeps one baseline for the session when the browser blocks its storage", () => {
        vi.useFakeTimers();
        const blocked = () => {
            throw new Error("blocked");
        };
        const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
        try {
            const sentAt = new Date();
            vi.advanceTimersByTime(5000);
            // Sent after the code loaded, shown 5 seconds later: still new, and an old one is still not.
            expect(isVoiceNoteUnplayed("$a", sentAt)).toBe(true);
            expect(isVoiceNoteUnplayed("$old", new Date(Date.now() - 24 * 3600 * 1000))).toBe(false);
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
            vi.useRealTimers();
        }
    });
});
