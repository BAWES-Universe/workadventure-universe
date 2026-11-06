import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamVolume } from "../../../src/front/WebRtc/StreamVolume";
import type { StreamVolumeDependencies } from "../../../src/front/WebRtc/StreamVolume";

class FakeGainParam {
    value = 1;
    cancelScheduledValues = vi.fn();
    setValueAtTime = vi.fn((value: number) => {
        this.value = value;
    });
}

class FakeContext {
    state: "running" | "suspended" | "interrupted" | "closed" = "running";
    currentTime = 0;
    destination = {};
    listeners = new Set<() => void>();
    gains: { gain: FakeGainParam; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    sources: { stream: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    addEventListener = vi.fn((_type: string, listener: () => void) => this.listeners.add(listener));
    removeEventListener = vi.fn((_type: string, listener: () => void) => this.listeners.delete(listener));
    setState(state: FakeContext["state"]): void {
        this.state = state;
        for (const listener of [...this.listeners]) listener();
    }
    resume = vi.fn((): Promise<void> => Promise.resolve());
    createMediaStreamSource = vi.fn((stream: unknown) => {
        const source = { stream, connect: vi.fn(), disconnect: vi.fn() };
        this.sources.push(source);
        return source;
    });
    createGain = vi.fn(() => {
        const gain = { gain: new FakeGainParam(), connect: vi.fn(), disconnect: vi.fn() };
        this.gains.push(gain);
        return gain;
    });
}

const stream = (audio = true) =>
    ({ getAudioTracks: () => (audio ? [{ kind: "audio" }] : []) } as unknown as MediaStream);

describe("the volume of someone's live sound", () => {
    let element: { volume: number; muted: boolean };
    let context: FakeContext;
    let elementVolume: boolean | undefined;
    let gestures: EventTarget;
    const create = () => {
        const dependencies: StreamVolumeDependencies = {
            elementVolume: () => elementVolume,
            getContext: () => context as unknown as AudioContext,
            gestureTarget: gestures,
        };
        return new StreamVolume(element as unknown as HTMLMediaElement, dependencies);
    };
    beforeEach(() => {
        element = { volume: 1, muted: false };
        context = new FakeContext();
        elementVolume = false;
        gestures = new EventTarget();
    });

    it("sets the element's volume where the browser applies it (computers, iPad), as before", () => {
        elementVolume = true;
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.3);
        expect(element.volume).toBe(0.3);
        expect(element.muted).toBe(false);
        expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    });

    it("on iPhone, plays through a gain node below 100% and mutes the element", () => {
        const volume = create();
        const sound = stream();
        volume.setStream(sound);
        volume.setVolume(0.4);
        expect(context.createMediaStreamSource).toHaveBeenCalledWith(sound);
        expect(context.gains[0].gain.value).toBe(0.4);
        expect(element.muted).toBe(true);
        volume.setVolume(0);
        expect(context.gains[0].gain.value).toBe(0);
        expect(element.muted).toBe(true);
        expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
    });

    it("on iPhone, plays the element as before at 100%", () => {
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.5);
        volume.setVolume(1);
        expect(context.sources[0].disconnect).toHaveBeenCalled();
        expect(context.gains[0].disconnect).toHaveBeenCalled();
        expect(element.muted).toBe(false);
    });

    it("keeps the element playing until a tap starts the context, then hands over to the gain", () => {
        context.state = "suspended";
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.2);
        // Never lost: heard at the phone's volume until the context runs
        expect(element.muted).toBe(false);
        expect(context.resume).toHaveBeenCalledTimes(1);
        gestures.dispatchEvent(new Event("touchend"));
        expect(context.resume).toHaveBeenCalledTimes(2);
        context.setState("running");
        expect(element.muted).toBe(true);
        expect(context.gains[0].gain.value).toBe(0.2);
        // Once it runs, taps no longer try to start it
        gestures.dispatchEvent(new Event("touchend"));
        expect(context.resume).toHaveBeenCalledTimes(2);
    });

    it("unmutes the element when a call or the screen lock interrupts the context", () => {
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.5);
        expect(element.muted).toBe(true);
        context.setState("interrupted");
        expect(element.muted).toBe(false);
        context.setState("running");
        expect(element.muted).toBe(true);
    });

    it("follows a new stream with a new source", () => {
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.5);
        const next = stream();
        volume.setStream(next);
        expect(context.sources[0].disconnect).toHaveBeenCalled();
        expect(context.sources[1].stream).toBe(next);
        expect(context.gains[1].gain.value).toBe(0.5);
        expect(element.muted).toBe(true);
    });

    it("leaves the element alone when the stream has no sound or Web Audio is missing", () => {
        const volume = create();
        volume.setStream(stream(false));
        volume.setVolume(0.5);
        expect(context.createMediaStreamSource).not.toHaveBeenCalled();
        expect(element.muted).toBe(false);
        const noWebAudio = new StreamVolume(element as unknown as HTMLMediaElement, {
            elementVolume: () => false,
            getContext: () => undefined,
            gestureTarget: gestures,
        });
        noWebAudio.setStream(stream());
        noWebAudio.setVolume(0.5);
        expect(element.muted).toBe(false);
    });

    it("keeps the element playing when the gain node cannot be set up", () => {
        context.createMediaStreamSource.mockImplementation(() => {
            throw new Error("not allowed");
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.5);
        expect(element.muted).toBe(false);
    });

    it("lets go of its nodes and listeners on destroy", () => {
        context.state = "suspended";
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.5);
        volume.destroy();
        expect(context.sources[0].disconnect).toHaveBeenCalled();
        expect(context.gains[0].disconnect).toHaveBeenCalled();
        expect(context.listeners.size).toBe(0);
        gestures.dispatchEvent(new Event("touchend"));
        expect(context.resume).toHaveBeenCalledTimes(1);
    });

    it("sets the element volume while the browser's answer is not known yet", () => {
        elementVolume = undefined;
        const volume = create();
        volume.setStream(stream());
        volume.setVolume(0.6);
        expect(element.volume).toBe(0.6);
        expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    });
});
