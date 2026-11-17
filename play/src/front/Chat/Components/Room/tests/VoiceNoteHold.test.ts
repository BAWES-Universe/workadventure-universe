import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const recorder = vi.hoisted(() => ({ start: vi.fn(), context: vi.fn() }));

vi.mock("../../../VoiceNote/VoiceNoteRecorder", () => ({
    startVoiceNoteRecording: recorder.start,
    makeVoiceNoteContext: recorder.context,
}));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (name: string) => () => name;
    const voiceNote = new Proxy({}, { get: (_target, name: string) => text(name) });
    return { default: readable({ chat: { voiceNote } }) };
});

import type { VoiceNoteDetails } from "../../../VoiceNote/VoiceNote";
import VoiceNoteComposer from "../VoiceNote/VoiceNoteComposer.svelte";

const details: VoiceNoteDetails = { duration: 3, waveform: [0.1, 0.5, 0.9] };

describe("recording a voice note by holding the mic", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    let cancel: ReturnType<typeof vi.fn>;
    let contextClose: ReturnType<typeof vi.fn>;
    let onSend: ReturnType<typeof vi.fn>;
    let onStart: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("MediaRecorder", Object.assign(class {}, { isTypeSupported: () => true }));
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
        URL.createObjectURL = vi.fn(() => "blob:note") as unknown as typeof URL.createObjectURL;
        URL.revokeObjectURL = vi.fn();
        HTMLMediaElement.prototype.pause = vi.fn();
        cancel = vi.fn();
        contextClose = vi.fn(() => Promise.resolve());
        recorder.context.mockImplementation(() => ({ close: contextClose }));
        recorder.start.mockReset();
        recorder.start.mockResolvedValue({
            level: () => 0.3,
            metering: () => true,
            cancel,
            stop: () => Promise.resolve({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details }),
        });
        onSend = vi.fn(() => Promise.resolve(true));
        onStart = vi.fn();
        target = document.createElement("div");
        document.body.appendChild(target);
        shown = new VoiceNoteComposer({
            target,
            props: { canRecord: true, onSend, onError: vi.fn(), onStart },
        });
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const find = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const settle = async (ms = 0) => {
        await vi.advanceTimersByTimeAsync(ms);
        await tick();
        await Promise.resolve();
        await tick();
    };
    const pointer = (type: string, x: number, y: number, pointerType = "touch") => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { pointerType, pointerId: 1, isPrimary: true, clientX: x, clientY: y, button: 0 });
        find("voiceRecordButton")?.dispatchEvent(event);
    };
    const press = async () => {
        pointer("pointerdown", 200, 400);
        await settle(250);
    };

    it("starts after a fifth of a second and sends on release", async () => {
        pointer("pointerdown", 200, 400);
        await settle(100);
        expect(recorder.start).not.toHaveBeenCalled();
        expect(find("voiceHolding")).toBeNull();

        await settle(150);
        expect(recorder.start).toHaveBeenCalledTimes(1);
        // The context made when the finger landed is handed to the recording.
        expect(recorder.start.mock.calls[0][1]).toBe(recorder.context.mock.results[0].value);
        expect(find("voiceHolding")).not.toBeNull();
        expect(onStart).toHaveBeenCalledTimes(1);

        await settle(1500);
        pointer("pointerup", 200, 400);
        await settle();
        await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
        expect(find("voiceHolding")).toBeNull();
    });

    it("keeps the same button under the finger while it is held", async () => {
        const button = find("voiceRecordButton");
        await press();
        expect(find("voiceRecordButton")).toBe(button);
    });

    it("cancels, uploading nothing, when slid left before letting go", async () => {
        await press();
        await settle(1500);
        pointer("pointermove", 150, 402);
        pointer("pointermove", 90, 402);
        await settle();
        expect(find("voiceHolding")?.textContent).toContain("releaseToCancel");
        pointer("pointerup", 90, 402);
        await settle();
        expect(onSend).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalled();
        expect(find("voiceHolding")).toBeNull();
        expect(find("voiceRecordButton")).not.toBeNull();
    });

    it("sends after all if the finger slides back before letting go", async () => {
        await press();
        await settle(1500);
        pointer("pointermove", 90, 400);
        pointer("pointermove", 190, 400);
        pointer("pointerup", 190, 400);
        await settle();
        await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    });

    it("locks when slid up: the recorder bar takes over and lifting the finger sends nothing", async () => {
        await press();
        await settle(1200);
        pointer("pointermove", 200, 360);
        pointer("pointermove", 200, 320);
        await settle();
        expect(find("voiceHolding")).toBeNull();
        expect(find("voiceRecording")).not.toBeNull();
        expect(find("voiceStopButton")).not.toBeNull();

        pointer("pointerup", 200, 320);
        await settle();
        expect(onSend).not.toHaveBeenCalled();
        expect(find("voiceRecording")).not.toBeNull();
    });

    it("records nothing for a quick tap, and says how to record", async () => {
        pointer("pointerdown", 200, 400);
        await settle(90);
        pointer("pointerup", 200, 400);
        await settle();
        // The click the touch ends with does not start a recording either.
        find("voiceRecordButton")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        await settle(400);
        expect(recorder.start).not.toHaveBeenCalled();
        expect(find("voiceHint")?.textContent).toContain("holdToRecord");
        // The context made for the press is let go.
        expect(contextClose).toHaveBeenCalled();
        // And the hint goes by itself.
        await settle(5000);
        expect(find("voiceHint")).toBeNull();
    });

    it("drops a note held for less than a second, with the hint", async () => {
        await press();
        await settle(300);
        pointer("pointerup", 200, 400);
        await settle();
        expect(onSend).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalled();
        expect(find("voiceHint")?.textContent).toContain("holdToRecord");
        expect(find("voiceRecordButton")).not.toBeNull();
    });

    it("keeps what was said, for review, when the system takes the touch away", async () => {
        await press();
        await settle(1500);
        pointer("pointercancel", 200, 400);
        await settle();
        expect(onSend).not.toHaveBeenCalled();
        expect(find("voiceReview")).not.toBeNull();
    });

    it("deals with a finger that lifted while the microphone was still being asked for", async () => {
        let allow: (value: unknown) => void = () => undefined;
        recorder.start.mockReturnValueOnce(
            new Promise((resolve) => {
                allow = resolve;
            })
        );
        pointer("pointerdown", 200, 400);
        await settle(250);
        pointer("pointerup", 200, 400);
        await settle();
        expect(onSend).not.toHaveBeenCalled();
        allow({
            level: () => 0,
            metering: () => true,
            cancel,
            stop: () => Promise.resolve({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details }),
        });
        await settle();
        // Held for a moment only: dropped, not sent, with the hint.
        expect(onSend).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalled();
        expect(find("voiceHint")).not.toBeNull();
        expect(find("voiceRecordButton")).not.toBeNull();
    });

    it("leaves a mouse to click: no hold, the recording opens locked as before", async () => {
        pointer("pointerdown", 200, 400, "mouse");
        await settle(300);
        expect(recorder.start).not.toHaveBeenCalled();
        find("voiceRecordButton")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        await settle();
        expect(recorder.start).toHaveBeenCalledTimes(1);
        expect(find("voiceRecording")).not.toBeNull();
        expect(find("voiceHolding")).toBeNull();
    });

    it("opens a locked recording for the keyboard and screen readers, with no hold", async () => {
        find("voiceRecordButton")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await settle();
        expect(recorder.start).toHaveBeenCalledTimes(1);
        expect(find("voiceRecording")).not.toBeNull();
        expect(find("voiceStopButton")).not.toBeNull();
    });
    it("does not carry a release from a recording that failed to start into the next one", async () => {
        recorder.start.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
        pointer("pointerdown", 200, 400);
        await settle(250);
        pointer("pointerup", 200, 400);
        await settle();
        expect(find("voiceRecordButton")).not.toBeNull();

        // The next one is a click that opens a locked recording: no stale release ends it.
        find("voiceRecordButton")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await settle(500);
        expect(find("voiceRecording")).not.toBeNull();
        expect(onSend).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it("shows no recording dot or timer while the microphone is still being asked for", async () => {
        let allow!: (value: unknown) => void;
        recorder.start.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    allow = resolve;
                })
        );
        pointer("pointerdown", 200, 400);
        await settle(250);
        // The finger is held and the button stays under it, but nothing records yet.
        expect(find("voiceHolding")).not.toBeNull();
        expect(target.querySelector(".voice-rec-dot")).toBeNull();
        expect(target.querySelector(".voice-clock")).toBeNull();

        allow({
            level: () => 0.3,
            metering: () => true,
            cancel,
            stop: () => Promise.resolve({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details }),
        });
        await settle(100);
        expect(target.querySelector(".voice-rec-dot")).not.toBeNull();
        expect(target.querySelector(".voice-clock")).not.toBeNull();
    });

    it("asks for sound again when the finger lifts", async () => {
        const resume = vi.fn();
        recorder.start.mockResolvedValueOnce({
            level: () => 0,
            metering: () => false,
            resume,
            cancel,
            stop: () => Promise.resolve({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details }),
        });
        await press();
        await settle(1200);
        pointer("pointerup", 200, 400);
        await settle();
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it("still sees the finger lift after locking swapped the mic for the recorder bar", async () => {
        const resume = vi.fn();
        recorder.start.mockResolvedValueOnce({
            level: () => 0,
            metering: () => false,
            resume,
            cancel,
            stop: () => Promise.resolve({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details }),
        });
        await press();
        await settle(1200);
        pointer("pointermove", 200, 360);
        pointer("pointermove", 200, 320);
        await settle();
        expect(find("voiceRecordButton")).toBeNull();

        // The button is gone: the lift arrives on the window.
        const lift = new Event("pointerup", { bubbles: true });
        Object.assign(lift, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 200, clientY: 320 });
        window.dispatchEvent(lift);
        await settle();
        expect(resume).toHaveBeenCalledTimes(1);
        expect(onSend).not.toHaveBeenCalled();
        expect(find("voiceRecording")).not.toBeNull();
    });

    it("offers a tap on the hint for a finger that cannot hold, and opens a locked recording", async () => {
        pointer("pointerdown", 200, 400);
        await settle(50);
        pointer("pointerup", 200, 400);
        await settle();
        expect(recorder.start).not.toHaveBeenCalled();
        // The hint stays long enough to be reached.
        await settle(3000);
        const action = find("voiceHintRecord");
        expect(action).not.toBeNull();

        action?.click();
        await settle();
        expect(recorder.start).toHaveBeenCalledTimes(1);
        expect(find("voiceRecording")).not.toBeNull();
        expect(find("voiceHint")).toBeNull();
        expect(onSend).not.toHaveBeenCalled();
    });

    describe("in a language read right to left, the mic is at the left end", () => {
        const rtl = () => {
            const button = find("voiceRecordButton");
            if (button) button.style.direction = "rtl";
        };

        it("cancels by sliding to the right, away from the mic, and ignores a slide to the left", async () => {
            rtl();
            await press();
            await settle(1200);
            // Toward the text: nothing is armed.
            pointer("pointermove", 100, 400);
            await settle();
            expect(find("voiceHolding")?.textContent).toContain("slideToCancel");
            expect(find("voiceHolding")?.textContent).not.toContain("releaseToCancel");

            // Back, then away from the mic: it arms, and letting go drops the note.
            pointer("pointermove", 200, 400);
            pointer("pointermove", 320, 400);
            await settle();
            expect(find("voiceHolding")?.textContent).toContain("releaseToCancel");
            pointer("pointerup", 320, 400);
            await settle();
            expect(onSend).not.toHaveBeenCalled();
            expect(cancel).toHaveBeenCalled();
        });

        it("locks by sliding up, as on the other side", async () => {
            rtl();
            await press();
            await settle(1200);
            pointer("pointermove", 200, 360);
            pointer("pointermove", 200, 320);
            await settle();
            expect(find("voiceRecordButton")).toBeNull();
            expect(find("voiceRecording")).not.toBeNull();
        });
    });
});
