import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVoiceNoteRecording } from "./VoiceNoteRecorder";
import { readAudioShape } from "./AudioShape";
import type { RecordingFormat } from "./VoiceNote";

vi.mock("./AudioShape", () => ({ readAudioShape: vi.fn() }));

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
    let contextResume: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        FakeRecorder.instances = [];
        FakeRecorder.failOnStart = false;
        trackStop = vi.fn();
        contextClose = vi.fn(() => Promise.resolve());
        contextResume = vi.fn(() => Promise.resolve());
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
                resume = contextResume;
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

    it("starts its sound in the tap, before waiting for the microphone (an iPhone keeps it silent otherwise)", async () => {
        let micAsked = false;
        let resumedBeforeMic = false;
        contextResume.mockImplementation(() => {
            resumedBeforeMic = !micAsked;
            return Promise.resolve();
        });
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                getUserMedia: () => {
                    micAsked = true;
                    return Promise.resolve({ getTracks: () => [{ stop: trackStop }] });
                },
            },
        });

        const recording = await startVoiceNoteRecording(format);

        expect(resumedBeforeMic).toBe(true);
        recording.cancel();
    });

    it("lets its sound go when the microphone is refused", async () => {
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: () => Promise.reject(new DOMException("no", "NotAllowedError")) },
        });

        await expect(startVoiceNoteRecording(format)).rejects.toThrow("no");

        expect(contextClose).toHaveBeenCalled();
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
    it("reads the note's shape from the file when the browser kept sound from running the whole time", async () => {
        const state = { value: "suspended" };
        vi.stubGlobal(
            "AudioContext",
            class {
                get state() {
                    return state.value;
                }
                createAnalyser() {
                    return { fftSize: 0, getFloatTimeDomainData: () => undefined };
                }
                createMediaStreamSource() {
                    return { connect: () => undefined };
                }
                close = contextClose;
                resume = contextResume;
            }
        );
        URL.createObjectURL = vi.fn(() => "blob:note") as unknown as typeof URL.createObjectURL;
        const revoke = vi.fn();
        URL.revokeObjectURL = revoke;
        vi.mocked(readAudioShape).mockResolvedValue({ duration: 3, levels: [0.2, 0.9, 0.5] });
        const recording = await startVoiceNoteRecording(format);
        await vi.advanceTimersByTimeAsync(1000);

        const { details } = await recording.stop();

        expect(details.waveform).toEqual([0.2, 0.9, 0.5]);
        expect(revoke).toHaveBeenCalledWith("blob:note");
    });

    it("keeps the meter's own shape when sound was running", async () => {
        vi.mocked(readAudioShape).mockClear();
        const recording = await startVoiceNoteRecording(format);
        await vi.advanceTimersByTimeAsync(1000);

        await recording.stop();

        expect(readAudioShape).not.toHaveBeenCalled();
    });

    it("asks the browser again to let sound run, but not once it runs or is closed", async () => {
        const recording = await startVoiceNoteRecording(format);
        contextResume.mockClear();
        recording.resume();
        // The stubbed context says it is running: nothing to ask.
        expect(contextResume).not.toHaveBeenCalled();
        recording.cancel();
    });
});
