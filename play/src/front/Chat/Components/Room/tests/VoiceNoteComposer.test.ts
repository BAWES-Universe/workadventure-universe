import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const recorder = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../../VoiceNote/VoiceNoteRecorder", () => ({ startVoiceNoteRecording: recorder.start }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = () => () => "label";
    const voiceNote = new Proxy({}, { get: () => text() });
    return { default: readable({ chat: { voiceNote } }) };
});

import type { VoiceNoteDetails } from "../../../VoiceNote/VoiceNote";
import VoiceNoteComposer from "../VoiceNote/VoiceNoteComposer.svelte";

const details: VoiceNoteDetails = { duration: 3000, waveform: [0.1, 0.5, 0.9] };

describe("a voice note that is still being stopped", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    let finish: (value: { file: File; details: VoiceNoteDetails }) => void;
    let cancel: ReturnType<typeof vi.fn>;
    let createUrl: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.stubGlobal("MediaRecorder", Object.assign(class {}, { isTypeSupported: () => true }));
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
        createUrl = vi.fn(() => "blob:note");
        URL.createObjectURL = createUrl as unknown as typeof URL.createObjectURL;
        URL.revokeObjectURL = vi.fn();
        // jsdom does not play media.
        HTMLMediaElement.prototype.pause = vi.fn();
        cancel = vi.fn();
        recorder.start.mockResolvedValue({
            level: () => 0,
            cancel,
            stop: () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        });
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
        vi.unstubAllGlobals();
    });

    const click = async (testId: string) => {
        target.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
        await tick();
        await Promise.resolve();
        await tick();
    };

    it("is dropped, not brought back to review, when Delete is pressed before the stop finishes", async () => {
        shown = new VoiceNoteComposer({
            target,
            props: { canRecord: true, onSend: () => Promise.resolve(true), onError: vi.fn() },
        });
        await tick();
        await click("voiceRecordButton");
        expect(target.querySelector('[data-testid="voiceRecording"]')).not.toBeNull();

        await click("voiceStopButton");
        await click("voiceDeleteButton");
        finish({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details });
        await tick();
        await Promise.resolve();
        await tick();

        expect(target.querySelector('[data-testid="voiceReview"]')).toBeNull();
        expect(createUrl).not.toHaveBeenCalled();
        expect(target.querySelector('[data-testid="voiceRecordButton"]')).not.toBeNull();
    });

    it("tells the box when a recording starts, and a note held for review is dropped by discard()", async () => {
        const onStart = vi.fn();
        const composer = new VoiceNoteComposer({
            target,
            props: { canRecord: true, onSend: () => Promise.resolve(true), onError: vi.fn(), onStart },
        });
        shown = composer;
        await tick();
        await click("voiceRecordButton");
        expect(onStart).toHaveBeenCalledTimes(1);

        await click("voiceStopButton");
        finish({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details });
        await tick();
        await Promise.resolve();
        await tick();
        expect(target.querySelector('[data-testid="voiceReview"]')).not.toBeNull();

        composer.discard();
        await tick();

        expect(target.querySelector('[data-testid="voiceReview"]')).toBeNull();
        expect(target.querySelector('[data-testid="voiceRecordButton"]')).not.toBeNull();
    });

    it("sends once the stop has finished when Send is pressed while it is still finishing", async () => {
        const onSend = vi.fn(() => Promise.resolve(true));
        shown = new VoiceNoteComposer({ target, props: { canRecord: true, onSend, onError: vi.fn() } });
        await tick();
        await click("voiceRecordButton");

        await click("voiceStopButton");
        await click("voiceSendButton");
        expect(onSend).not.toHaveBeenCalled();

        const file = new File([new Uint8Array(10)], "Voice message.m4a");
        finish({ file, details });

        await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
        expect(onSend).toHaveBeenCalledWith(file, details);
    });

    it("sends the note once when Send is pressed twice while the stop is still finishing", async () => {
        const onSend = vi.fn(() => Promise.resolve(true));
        shown = new VoiceNoteComposer({ target, props: { canRecord: true, onSend, onError: vi.fn() } });
        await tick();
        await click("voiceRecordButton");

        await click("voiceStopButton");
        await click("voiceSendButton");
        await click("voiceSendButton");

        finish({ file: new File([new Uint8Array(10)], "Voice message.m4a"), details });

        await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
        await tick();
        expect(onSend).toHaveBeenCalledTimes(1);
    });
});
