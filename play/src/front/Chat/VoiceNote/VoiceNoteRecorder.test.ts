import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVoiceNoteRecording } from "./VoiceNoteRecorder";
import type { RecordingFormat } from "./VoiceNote";

const format: RecordingFormat = { recorderType: "audio/mp4", fileType: "audio/mp4", extension: "m4a" };

class FakeRecorder {
    static instances: FakeRecorder[] = [];
    static failOnStart = false;
    state: "inactive" | "recording" = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
        FakeRecorder.instances.push(this);
    }
    start() {
        if (FakeRecorder.failOnStart) throw new DOMException("already recording", "InvalidStateError");
        this.state = "recording";
    }
    stop() {
        this.endByItself();
    }
    /** What a browser does when the microphone is unplugged: the recorder stops without being asked. */
    endByItself() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(100)]) });
        this.onstop?.();
    }
}

describe("recording a voice note", () => {
    let trackStop: ReturnType<typeof vi.fn>;
    let contextClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        FakeRecorder.instances = [];
        FakeRecorder.failOnStart = false;
        trackStop = vi.fn();
        contextClose = vi.fn(() => Promise.resolve());
        vi.stubGlobal("MediaRecorder", FakeRecorder);
        vi.stubGlobal(
            "AudioContext",
            class {
                state = "running";
                createAnalyser() {
                    return { fftSize: 0, getFloatTimeDomainData: () => undefined };
                }
                createMediaStreamSource() {
                    return { connect: () => undefined };
                }
                close = contextClose;
            }
        );
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: trackStop }] }) },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("returns the note as a file named like an Element voice message, with its length", async () => {
        const recording = await startVoiceNoteRecording(format);
        await vi.advanceTimersByTimeAsync(3000);

        const { file, details } = await recording.stop();

        expect(file.name).toBe("Voice message.m4a");
        expect(file.type).toBe("audio/mp4");
        expect(file.size).toBe(100);
        expect(details.duration).toBeGreaterThanOrEqual(3);
        expect(details.waveform.length).toBeGreaterThan(0);
        expect(trackStop).toHaveBeenCalled();
        expect(contextClose).toHaveBeenCalled();
    });

    it("still stops when the recorder had already stopped by itself", async () => {
        const recording = await startVoiceNoteRecording(format);
        FakeRecorder.instances[0].endByItself();

        await expect(recording.stop()).resolves.toMatchObject({ file: { size: 100 } });
        expect(trackStop).toHaveBeenCalled();
    });

    it("lets the microphone go and leaves no timer running when the recorder cannot start", async () => {
        FakeRecorder.failOnStart = true;

        await expect(startVoiceNoteRecording(format)).rejects.toThrow("already recording");

        expect(trackStop).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets the microphone go and stops the meter when cancelled", async () => {
        const recording = await startVoiceNoteRecording(format);
        expect(vi.getTimerCount()).toBe(1);

        recording.cancel();
        await vi.advanceTimersByTimeAsync(10);

        expect(trackStop).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
