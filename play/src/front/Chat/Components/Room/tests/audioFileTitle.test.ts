import { describe, expect, it } from "vitest";
import { audioFileKind, audioFileTitle, isMachineMadeName } from "../Message/audioFileTitle";

describe("audio file titles", () => {
    it("tidies a name a person gave the file", () => {
        expect(audioFileTitle("Desert Drive.mp3")).toBe("Desert Drive");
        expect(audioFileTitle("studio_take_3.wav")).toBe("studio take 3");
        expect(audioFileTitle("Recording 2026-10-26.m4a")).toBe("Recording 2026-10-26");
    });

    it("gives no title for a name a machine made", () => {
        expect(audioFileTitle("ed481479-5635-4eea-af1c-d3686553d637.mp3")).toBeUndefined();
        expect(audioFileTitle("1730045123456.mp3")).toBeUndefined();
        expect(audioFileTitle("a1b2c3d4e5f6a7b8c9d0.ogg")).toBeUndefined();
        expect(audioFileTitle("Qm3xT9vKpL2wR8sY5zN1bH7jD4.mp3")).toBeUndefined();
        expect(audioFileTitle(".mp3")).toBeUndefined();
        expect(audioFileTitle(undefined)).toBeUndefined();
    });

    it("keeps short everyday names", () => {
        expect(isMachineMadeName("song.mp3")).toBe(false);
        expect(isMachineMadeName("ambient-loop.mp3")).toBe(false);
    });

    it("reads the type from the name", () => {
        expect(audioFileKind("Desert Drive.mp3")).toBe("MP3");
        expect(audioFileKind("note.m4a")).toBe("M4A");
        expect(audioFileKind("no extension")).toBeUndefined();
    });
});
