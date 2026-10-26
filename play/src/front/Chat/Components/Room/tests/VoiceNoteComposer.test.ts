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
});
