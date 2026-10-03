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
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => {
        this.state = "closed";
        return Promise.resolve();
    });
    createMediaStreamSource = vi.fn(() => fakeNode());
    createMediaStreamDestination = vi.fn(() => ({
        stream: { getAudioTracks: () => [{ kind: "audio", stop: vi.fn() }] },
    }));
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
