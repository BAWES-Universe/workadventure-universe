import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createWorklet, createDeepFilterNetWorklet, observeMessages } = vi.hoisted(() => ({
    createWorklet: vi.fn(),
    createDeepFilterNetWorklet: vi.fn(),
    observeMessages: vi.fn(() => () => {}),
}));

vi.mock("@workadventure/noise-suppression/audio-worklet", () => ({
    createNoiseSuppressionAudioWorklet: createWorklet,
    observeNoiseSuppressionAudioWorkletMessages: observeMessages,
}));

vi.mock("@workadventure/noise-suppression/deepfilternet", () => ({
    createDeepFilterNetAudioWorklet: createDeepFilterNetWorklet,
    DEEPFILTERNET_SAMPLE_RATE: 48000,
}));

import { NoiseSuppressionTransformer } from "../../../../src/front/WebRtc/NoiseSuppression/NoiseSuppressionTransformer";

function fakeNode() {
    return { connect: vi.fn(), disconnect: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function fakeHandle(ready: Promise<void> = Promise.resolve()) {
    return { node: fakeNode(), ready, dispose: vi.fn() };
}

class FakeAudioContext {
    static lastOptions: AudioContextOptions | undefined;
    constructor(options?: AudioContextOptions) {
        FakeAudioContext.lastOptions = options;
    }
    state = "running";
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
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
        createDeepFilterNetWorklet.mockReset();
        FakeAudioContext.lastOptions = undefined;
        observeMessages.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("creates one worklet when two transforms overlap", async () => {
        const creation = deferred<ReturnType<typeof fakeHandle>>();
        createWorklet.mockReturnValue(creation.promise);
        const transformer = new NoiseSuppressionTransformer({ engine: "dtln" });

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
        const transformer = new NoiseSuppressionTransformer({ engine: "dtln" });
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
        const transformer = new NoiseSuppressionTransformer({ engine: "dtln" });
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
        const transformer = new NoiseSuppressionTransformer({ engine: "dtln" });

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

    describe("DeepFilterNet3", () => {
        it("runs at 48 kHz and starts DeepFilterNet3, not DTLN", async () => {
            createDeepFilterNetWorklet.mockResolvedValue(fakeHandle());
            const transformer = new NoiseSuppressionTransformer({ engine: "deepfilternet" });
            await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);

            expect(FakeAudioContext.lastOptions).toEqual({ sampleRate: 48000 });
            expect(createDeepFilterNetWorklet).toHaveBeenCalledOnce();
            expect(createWorklet).not.toHaveBeenCalled();
        });

        it("runs DTLN at 16 kHz", () => {
            new NoiseSuppressionTransformer({ engine: "dtln" });
            expect(FakeAudioContext.lastOptions).toEqual({ sampleRate: 16000 });
        });

        it("wires the microphone only once the model is loaded", async () => {
            const ready = deferred<void>();
            const handle = fakeHandle(ready.promise);
            createDeepFilterNetWorklet.mockResolvedValue(handle);
            const transformer = new NoiseSuppressionTransformer({ engine: "deepfilternet" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audioContext = (transformer as any).audioContext as FakeAudioContext;

            const pending = transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
            expect(audioContext.createMediaStreamSource).not.toHaveBeenCalled();
            expect(handle.node.connect).not.toHaveBeenCalled();

            ready.resolve();
            await pending;
            expect(audioContext.createMediaStreamSource).toHaveBeenCalledOnce();
            expect(handle.node.connect).toHaveBeenCalledOnce();
        });

        it("rejects the transform when the model fails to load", async () => {
            createDeepFilterNetWorklet.mockResolvedValue(fakeHandle(Promise.reject(new Error("no wasm"))));
            const onStatusChange = vi.fn();
            const transformer = new NoiseSuppressionTransformer({ engine: "deepfilternet", onStatusChange });

            await expect(transformer.transform({ id: "a" } as unknown as MediaStreamTrack)).rejects.toThrow("no wasm");
            expect(onStatusChange).toHaveBeenCalledWith({ status: "error", message: "no wasm", overloaded: false });
        });

        it("reports a crash once even when it comes through two channels", async () => {
            const handle = fakeHandle();
            createDeepFilterNetWorklet.mockResolvedValue(handle);
            const onStatusChange = vi.fn();
            const transformer = new NoiseSuppressionTransformer({ engine: "deepfilternet", onStatusChange });
            await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);

            const onProcessorError = handle.node.addEventListener.mock.calls.find(
                ([type]) => type === "processorerror"
            )?.[1] as () => void;
            onProcessorError();
            onProcessorError();

            const errors = onStatusChange.mock.calls.filter(([message]) => message.status === "error");
            expect(errors).toHaveLength(1);
        });

        it("reports when the device cannot keep up, as overloaded", async () => {
            createDeepFilterNetWorklet.mockResolvedValue(fakeHandle());
            const onStatusChange = vi.fn();
            const transformer = new NoiseSuppressionTransformer({ engine: "deepfilternet", onStatusChange });
            await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);

            const { onOverload } = createDeepFilterNetWorklet.mock.calls[0][1] as {
                onOverload: (load: number) => void;
            };
            onOverload(0.9);

            expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: "error", overloaded: true }));
        });
    });

    describe("resuming a suspended audio context", () => {
        async function transformerWithOutput() {
            createWorklet.mockResolvedValue(fakeHandle());
            const onStatusChange = vi.fn();
            const transformer = new NoiseSuppressionTransformer({ engine: "dtln", onStatusChange });
            await transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audioContext = (transformer as any).audioContext as FakeAudioContext;
            const resumeIfSuspended = audioContext.addEventListener.mock.calls.find(
                ([type]) => type === "statechange"
            )?.[1] as () => void;
            audioContext.resume.mockClear();
            return { transformer, audioContext, resumeIfSuspended, onStatusChange };
        }

        it("resumes when the browser suspends it while the microphone is wired", async () => {
            const { audioContext, resumeIfSuspended } = await transformerWithOutput();
            audioContext.state = "suspended";
            resumeIfSuspended();
            expect(audioContext.resume).toHaveBeenCalledOnce();
        });

        it("resumes a context the browser suspended while the model was loading", async () => {
            const ready = deferred<void>();
            createWorklet.mockResolvedValue(fakeHandle(ready.promise));
            const transformer = new NoiseSuppressionTransformer({ engine: "dtln" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audioContext = (transformer as any).audioContext as FakeAudioContext;

            const pending = transformer.transform({ id: "a" } as unknown as MediaStreamTrack);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
            audioContext.state = "suspended";
            audioContext.resume.mockClear();
            ready.resolve();
            await pending;

            expect(audioContext.resume).toHaveBeenCalledOnce();
        });

        it("stays paused after stop(), which suspends it on purpose", async () => {
            const { transformer, audioContext, resumeIfSuspended } = await transformerWithOutput();
            transformer.stop();
            audioContext.resume.mockClear();
            resumeIfSuspended();
            expect(audioContext.resume).not.toHaveBeenCalled();
        });

        it("gives up, so the browser's filter takes over, when it cannot be resumed", async () => {
            const { audioContext, resumeIfSuspended, onStatusChange } = await transformerWithOutput();
            audioContext.state = "suspended";
            audioContext.resume.mockReturnValueOnce(Promise.reject(new Error("blocked")));
            resumeIfSuspended();
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
            expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
        });
    });
});
