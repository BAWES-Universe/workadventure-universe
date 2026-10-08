import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createWorklet, observeMessages } = vi.hoisted(() => ({
    createWorklet: vi.fn(),
    observeMessages: vi.fn(() => () => {}),
}));

vi.mock("@workadventure/noise-suppression/audio-worklet", () => ({
    createNoiseSuppressionAudioWorklet: createWorklet,
    observeNoiseSuppressionAudioWorkletMessages: observeMessages,
}));

import { NoiseSuppressionTransformer } from "../../../../src/front/WebRtc/NoiseSuppression/NoiseSuppressionTransformer";

function fakeNode() {
    return { connect: vi.fn(), disconnect: vi.fn() };
}

function fakeHandle() {
    return { node: fakeNode(), ready: new Promise<void>(() => {}), dispose: vi.fn() };
}

class FakeAudioContext {
    state = "running";
    resume = vi.fn(() => {
        this.state = "running";
        return Promise.resolve();
    });
    suspend = vi.fn(() => {
        this.state = "suspended";
        return Promise.resolve();
    });
    close = vi.fn(() => {
        this.state = "closed";
        return Promise.resolve();
    });
    createMediaStreamSource = vi.fn(() => fakeNode());
    createMediaStreamDestination = vi.fn(() => {
        const track = { kind: "audio", stop: vi.fn() };
        return { stream: { getAudioTracks: () => [track] } };
    });
}

class FakeMediaStream {
    constructor(public tracks: unknown[]) {}
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("NoiseSuppressionTransformer", () => {
    beforeEach(() => {
        vi.stubGlobal("AudioContext", FakeAudioContext);
        vi.stubGlobal("MediaStream", FakeMediaStream);
        createWorklet.mockReset();
        observeMessages.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("creates one worklet when two transforms overlap", async () => {
        const creation = deferred<ReturnType<typeof fakeHandle>>();
        createWorklet.mockReturnValue(creation.promise);
        const transformer = new NoiseSuppressionTransformer();

        const first = transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
        const second = transformer.transform({ id: "b" } as unknown as MediaStreamTrack);
        await Promise.resolve();
        await Promise.resolve();
        creation.resolve(fakeHandle());
        await Promise.all([first, second]);

        expect(createWorklet).toHaveBeenCalledTimes(1);
        expect(observeMessages).toHaveBeenCalledTimes(1);
    });

    it("keeps the previous output playing until the new microphone is wired", async () => {
        createWorklet.mockResolvedValue(fakeHandle());
        const transformer = new NoiseSuppressionTransformer();
        const firstOutput = await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);

        const resume = deferred<void>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (transformer as any).audioContext.resume.mockReturnValueOnce(resume.promise);
        const pending = transformer.transform({ id: "b" } as unknown as MediaStreamTrack);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(firstOutput.stop).not.toHaveBeenCalled();

        resume.resolve();
        const secondOutput = await pending;
        expect(secondOutput).not.toBe(firstOutput);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(firstOutput.stop).toHaveBeenCalledOnce();
    });

    it("pauses the audio context when stopped and resumes it on the next transform", async () => {
        createWorklet.mockResolvedValue(fakeHandle());
        const transformer = new NoiseSuppressionTransformer();
        await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioContext = (transformer as any).audioContext as FakeAudioContext;

        transformer.stop();
        expect(audioContext.suspend).toHaveBeenCalledOnce();
        expect(audioContext.state).toBe("suspended");

        await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
        expect(audioContext.state).toBe("running");
    });

    it("disposes a worklet that finishes loading after the transformer was destroyed", async () => {
        const creation = deferred<ReturnType<typeof fakeHandle>>();
        createWorklet.mockReturnValue(creation.promise);
        const transformer = new NoiseSuppressionTransformer();

        const pending = transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
        await Promise.resolve();
        await Promise.resolve();
        await transformer.closeAndDestroy();
        const handle = fakeHandle();
        creation.resolve(handle);

        await expect(pending).rejects.toThrow();
        expect(handle.dispose).toHaveBeenCalledTimes(1);
        expect(observeMessages).not.toHaveBeenCalled();
    });
});
