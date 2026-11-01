import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayback, clampAudioVolume } from "../../../../src/front/Components/AudioManager/AudioPlayback";
import type { AudioControls } from "../../../../src/front/Components/AudioManager/AudioPlayback";

class FakeAudio {
    src = "";
    volume = 1;
    muted = false;
    loop = false;
    paused = true;
    preload = "";
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    load = vi.fn();
    pause = vi.fn(() => {
        this.paused = true;
    });
    removeAttribute = vi.fn(() => {
        this.src = "";
    });
    play = vi.fn((): Promise<void> => {
        this.paused = false;
        return Promise.resolve();
    });
}

const controls: AudioControls = {
    volume: 0.8,
    muted: false,
    paused: false,
    stopped: false,
    talking: false,
    decreaseWhileTalking: true,
};
const source = (url: string, volume = 1, loop = true) => ({ url, volume, loop });
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("native audio playback", () => {
    let media: FakeAudio[];
    let nextPlayFailure: Error | undefined;
    let nextPlayPromise: Promise<void> | undefined;
    let writableVolume: boolean;
    let player: AudioPlayback;
    let state: ReturnType<typeof vi.fn>;
    let ended: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.useFakeTimers();
        media = [];
        writableVolume = true;
        nextPlayFailure = undefined;
        nextPlayPromise = undefined;
        state = vi.fn();
        ended = vi.fn();
        player = new AudioPlayback(state, ended, () => {
            const audio = new FakeAudio();
            if (!writableVolume) {
                Object.defineProperty(audio, "volume", { get: () => 1, set: () => undefined });
            }
            if (nextPlayPromise) {
                audio.play.mockReturnValueOnce(nextPlayPromise);
                nextPlayPromise = undefined;
            }
            if (nextPlayFailure) {
                audio.play.mockRejectedValueOnce(nextPlayFailure);
                nextPlayFailure = undefined;
            }
            media.push(audio);
            return audio as unknown as HTMLAudioElement;
        });
        player.setControls(controls);
    });
    afterEach(() => {
        player.destroy();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("composes master, authored gain and ducking without changing user controls", async () => {
        player.setSource(source("a", 0.2));
        await flush();
        expect(media[0].volume).toBeCloseTo(0.16);
        player.setControls({ ...controls, talking: true });
        expect(media[0].volume).toBeCloseTo(0.08);
        player.setControls({ ...controls, talking: false });
        player.setSource(source("a", 0.6));
        expect(media[0].volume).toBeCloseTo(0.48);
        player.setSource(source("a", 0));
        expect(media[0].volume).toBe(0);
        expect(media[0].play).toHaveBeenCalledTimes(1);
        expect(media[0].load).toHaveBeenCalledTimes(1);
        expect(controls.volume).toBe(0.8);
    });

    it("honors zero and clamps invalid volumes", () => {
        expect(clampAudioVolume(0)).toBe(0);
        expect(clampAudioVolume(-1)).toBe(0);
        expect(clampAudioVolume(3)).toBe(1);
        expect(clampAudioVolume(NaN)).toBe(1);
        expect(clampAudioVolume(undefined)).toBe(1);
        player.setControls({ ...controls, volume: 0 });
        player.setSource(source("a"));
        expect(media[0].volume).toBe(0);
    });

    it("preserves mute before play and throughout source changes", async () => {
        player.setControls({ ...controls, muted: true });
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        expect(media.every((audio) => audio.muted)).toBe(true);
        vi.advanceTimersByTime(1800);
        expect(media[1].muted).toBe(true);
    });

    it("crossfades for 1.6 seconds and unloads the old element", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b", 0.5));
        await flush();
        expect(media[1].volume).toBe(0);
        vi.advanceTimersByTime(816);
        expect(media[0].volume).toBeCloseTo(0.4);
        expect(media[1].volume).toBeCloseTo(0.2);
        vi.advanceTimersByTime(900);
        expect(media[0].src).toBe("");
        expect(media[0].paused).toBe(true);
        expect(media[0].onended).toBeNull();
        expect(media[1].volume).toBeCloseTo(0.4);
    });

    it("fades a source back up from where it is when returning to it mid-fade", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        vi.advanceTimersByTime(400);
        const fadedOut = media[0].volume;
        expect(fadedOut).toBeLessThan(0.8);
        player.setSource(source("a"));
        await flush();
        // Same element, not reloaded or restarted, and no third element.
        expect(media).toHaveLength(2);
        expect(media[0].src).toBe("a");
        expect(media[0].load).toHaveBeenCalledTimes(1);
        expect(media[0].play).toHaveBeenCalledTimes(1);
        expect(media[0].paused).toBe(false);
        expect(state).toHaveBeenLastCalledWith("playing");
        vi.advanceTimersByTime(800);
        expect(media[0].volume).toBeGreaterThan(fadedOut);
        vi.advanceTimersByTime(1000);
        expect(media[0].volume).toBeCloseTo(0.8);
        expect(media[1].src).toBe("");
        expect(media[1].paused).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("loads a source fresh when returning to it after its fade finished", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        vi.advanceTimersByTime(1800);
        expect(media[0].src).toBe("");
        player.setSource(source("a"));
        await flush();
        expect(media[0].src).toBe("a");
        expect(media[0].load).toHaveBeenCalledTimes(3);
        expect(media[0].play).toHaveBeenCalledTimes(2);
        expect(media[0].volume).toBe(0);
        vi.advanceTimersByTime(1800);
        expect(media[0].volume).toBeCloseTo(0.8);
        expect(media[1].src).toBe("");
    });

    it("bounds rapid changes to two live elements, canceling previous fades", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        vi.advanceTimersByTime(500);
        player.setSource(source("c"));
        await flush();
        expect(media[0].src).toBe("a");
        expect(media[0].volume).toBeGreaterThan(0.5);
        expect(media[1].src).toBe("c");
        expect(media).toHaveLength(2);
        vi.advanceTimersByTime(1800);
        expect(media[0].src).toBe("");
        expect(media[1].volume).toBeCloseTo(0.8);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("pauses both slots during a fade and resumes only the latest source", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        vi.advanceTimersByTime(400);
        player.setControls({ ...controls, paused: true });
        expect(media.every((audio) => audio.paused)).toBe(true);
        expect(media[0].src).toBe("");
        expect(vi.getTimerCount()).toBe(0);
        media[1].play.mockClear();
        player.setSource(source("c"));
        await flush();
        expect(media[1].src).toBe("c");
        expect(media[1].play).not.toHaveBeenCalled();
        player.setControls(controls);
        await flush();
        expect(media[1].play).toHaveBeenCalledTimes(1);
        expect(media[0].play).toHaveBeenCalledTimes(1);
    });

    it("stops and unloads without restarting from late promises", async () => {
        let resolve: (() => void) | undefined;
        player.setControls({ ...controls, paused: true });
        player.setSource(source("a"));
        media[0].play.mockImplementationOnce(
            () =>
                new Promise<void>((done) => {
                    resolve = done;
                })
        );
        player.setControls(controls);
        player.setControls({ ...controls, stopped: true });
        player.setSource(undefined);
        resolve?.();
        await flush();
        expect(media[0].src).toBe("");
        expect(state).not.toHaveBeenCalledWith("playing");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps a one-shot playing across visibility changes and reports its end", async () => {
        const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
        player.setSource(source("cue", 0.5, false));
        await flush();
        hidden.mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        hidden.mockReturnValue(false);
        document.dispatchEvent(new Event("visibilitychange"));
        expect(media[0].paused).toBe(false);
        expect(media[0].play).toHaveBeenCalledTimes(1);
        media[0].paused = true;
        media[0].onended?.();
        expect(ended).toHaveBeenCalledTimes(1);
        expect(state).toHaveBeenLastCalledWith(undefined);
    });

    it("plays a source first set while hidden without changing mute or pause", async () => {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        player.setControls({ ...controls, muted: true });
        player.setSource(source("a"));
        await flush();
        expect(media[0].play).toHaveBeenCalledTimes(1);
        expect(media[0].muted).toBe(true);
        player.setControls({ ...controls, paused: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(media[0].paused).toBe(true);
        expect(media[0].play).toHaveBeenCalledTimes(1);
    });

    it("retries autoplay synchronously only for the latest source", async () => {
        player.setControls({ ...controls, paused: true });
        player.setSource(source("a"));
        media[0].play.mockRejectedValueOnce(new DOMException("gesture needed", "NotAllowedError"));
        player.setControls(controls);
        await flush();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        player.setSource(source("b"));
        await flush();
        player.setControls({ ...controls, paused: true });
        player.setControls(controls);
        expect(media).toHaveLength(1);
        expect(media[0].src).toBe("b");
        expect(media[0].play).toHaveBeenCalledTimes(3);
        player.retry();
        await flush();
        expect(media[0].play).toHaveBeenCalledTimes(3);
    });

    it("requires a retry after a rejection, rather than retrying on volume updates", async () => {
        player.setControls({ ...controls, paused: true });
        player.setSource(source("a"));
        media[0].play.mockRejectedValueOnce(new DOMException("gesture needed", "NotAllowedError"));
        player.setControls(controls);
        await flush();
        player.setControls({ ...controls, volume: 0.2 });
        expect(media[0].play).toHaveBeenCalledTimes(1);
        player.retry();
        expect(media[0].play).toHaveBeenCalledTimes(2);
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("ignores a canceled source's rejection and media events", async () => {
        let reject: ((error: Error) => void) | undefined;
        player.setControls({ ...controls, paused: true });
        player.setSource(source("a"));
        media[0].play.mockImplementationOnce(
            () =>
                new Promise<void>((resolve, fail) => {
                    reject = fail;
                })
        );
        player.setControls(controls);
        const staleEnded = media[0].onended;
        const staleError = media[0].onerror;
        player.setSource(source("b"));
        await flush();
        reject?.(new Error("old source"));
        staleEnded?.();
        staleError?.();
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
        expect(ended).not.toHaveBeenCalled();
        expect(media[0].src).toBe("b");
    });

    it("handles source errors without keeping an old track audible", async () => {
        player.setSource(source("a"));
        await flush();
        // The new source fails before its playback is confirmed.
        nextPlayPromise = new Promise<void>(() => {
            // Never settles: playback is not confirmed.
        });
        player.setSource(source("broken"));
        await flush();
        media[1].onerror?.();
        expect(state).toHaveBeenLastCalledWith("error");
        expect(media.every((audio) => audio.paused)).toBe(true);
        expect(media[0].src).toBe("");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("updates loop without reloading and does not restart a finished nonloop track", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("a", 1, false));
        expect(media[0].loop).toBe(false);
        media[0].paused = true;
        media[0].onended?.();
        player.setControls({ ...controls, volume: 0.4 });
        player.retry();
        await flush();
        expect(ended).toHaveBeenCalledTimes(1);
        expect(media[0].play).toHaveBeenCalledTimes(1);
        expect(media[0].load).toHaveBeenCalledTimes(1);
    });

    it("retains the established bed when canceled before the first fade frame", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        expect(media[1].volume).toBe(0);
        player.setSource(source("c"));
        await flush();
        expect(media[0].src).toBe("a");
        expect(media[0].volume).toBe(0.8);
        expect(media[1].src).toBe("c");
        expect(media).toHaveLength(2);
    });

    it("reuses the same two elements across many settled source changes", async () => {
        for (let n = 0; n < 10; n++) {
            player.setSource(source(String(n)));
            // Each transition must settle before testing reuse on the next one.
            // eslint-disable-next-line no-await-in-loop
            await flush();
            vi.advanceTimersByTime(1800);
        }
        expect(media).toHaveLength(2);
        expect(media.filter((audio) => audio.src)).toHaveLength(1);
    });

    it("keeps an unlocked outgoing bed during autoplay rejection and retries without reloading", async () => {
        player.setSource(source("a"));
        await flush();
        nextPlayFailure = new DOMException("second slot needs gesture", "NotAllowedError");
        player.setSource(source("b"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        expect(media[0].paused).toBe(false);
        expect(media[0].src).toBe("a");
        expect(media[0].volume).toBe(0.8);
        player.retry();
        expect(media[1].play).toHaveBeenCalledTimes(2);
        expect(media[1].load).toHaveBeenCalledTimes(1);
        await flush();
        vi.advanceTimersByTime(1800);
        expect(media[0].src).toBe("");
        expect(media[1].volume).toBe(0.8);
    });

    it.each(["pause", "stop", "unload"])("silences a retained autoplay bed on %s", async (action) => {
        player.setSource(source("a"));
        await flush();
        nextPlayFailure = new DOMException("gesture", "NotAllowedError");
        player.setSource(source("b"));
        await flush();
        if (action === "pause") player.setControls({ ...controls, paused: true });
        if (action === "stop") player.setControls({ ...controls, stopped: true });
        if (action === "unload") player.setSource(undefined);
        expect(media.every((audio) => audio.paused)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the state and the audio when an error arrives after playback was confirmed", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        player.setSource(source("a"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
        state.mockClear();
        // Firefox reports one on a file it is already playing; the old player only logged it.
        media[0].onerror?.();
        expect(state).not.toHaveBeenCalled();
        expect(media[0].paused).toBe(false);
        expect(media[0].load).toHaveBeenCalledTimes(1);
        // An element that has really stopped still fails.
        media[0].paused = true;
        media[0].onerror?.();
        expect(state).toHaveBeenLastCalledWith("error");
    });

    it("reloads a resource error on explicit retry", async () => {
        // The error arrives before playback is confirmed.
        nextPlayPromise = new Promise<void>(() => {
            // Never settles: playback is not confirmed.
        });
        player.setSource(source("a"));
        await flush();
        media[0].onerror?.();
        expect(state).toHaveBeenLastCalledWith("error");
        player.retry();
        expect(media[0].load).toHaveBeenCalledTimes(2);
        expect(media[0].play).toHaveBeenCalledTimes(2);
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it.each(["pending", "fading"])("hard-resets old-map %s playback before a new map source", async (phase) => {
        player.setSource(source("https://maps.example/v1/bed.mp3"));
        await flush();
        let resolveOld: (() => void) | undefined;
        if (phase === "pending") {
            nextPlayPromise = new Promise<void>((resolve) => {
                resolveOld = resolve;
            });
        }
        player.setSource(source("https://maps.example/v1/zone.mp3"));
        await flush();
        const oldEnded = media[1].onended;
        const oldError = media[1].onerror;
        if (phase === "fading") vi.advanceTimersByTime(400);
        // GameScene.cleanupClosingScene -> audioManagerFileStore.unloadAudio emits undefined.
        player.setSource(undefined);
        expect(media.every((audio) => !audio.src && audio.paused)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        player.setSource(source("https://maps.example/v2/bed.mp3"));
        await flush();
        resolveOld?.();
        oldEnded?.();
        oldError?.();
        await flush();
        vi.advanceTimersByTime(2000);
        expect(media.filter((audio) => audio.src).map((audio) => audio.src)).toEqual([
            "https://maps.example/v2/bed.mp3",
        ]);
        expect(state).toHaveBeenLastCalledWith("playing");
        expect(ended).not.toHaveBeenCalled();
        expect(media).toHaveLength(2);
    });

    it("finishes a throttled fade on its first late timer tick without animation frames", async () => {
        const clock = vi.spyOn(performance, "now").mockReturnValue(0);
        const animationFrame = vi.spyOn(globalThis, "requestAnimationFrame");
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        expect(media[0].src).toBe("a");
        expect(media[1].volume).toBe(0);
        clock.mockReturnValue(2400);
        vi.advanceTimersByTime(50);
        expect(animationFrame).not.toHaveBeenCalled();
        expect(media[0].src).toBe("");
        expect(media[0].paused).toBe(true);
        expect(media[1].volume).toBe(0.8);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("switches immediately after incoming playback confirms when volume is unsupported", async () => {
        writableVolume = false;
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        expect(media[0].paused).toBe(true);
        expect(media[0].src).toBe("");
        expect(media[1].paused).toBe(false);
        expect(media.filter((audio) => !audio.paused)).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("keeps the outgoing slot on unsupported-volume autoplay rejection until a gesture succeeds", async () => {
        writableVolume = false;
        player.setSource(source("a"));
        await flush();
        nextPlayFailure = new DOMException("gesture", "NotAllowedError");
        player.setSource(source("b"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        expect(media[0].paused).toBe(false);
        expect(media[0].src).toBe("a");
        expect(media[1].paused).toBe(true);
        player.retry();
        await flush();
        expect(media[0].paused).toBe(true);
        expect(media[0].src).toBe("");
        expect(media[1].paused).toBe(false);
        expect(media.filter((audio) => !audio.paused)).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("destroys both slots and cancels every scheduled callback", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        player.destroy();
        expect(media.every((audio) => !audio.src && audio.paused && !audio.onended && !audio.onerror)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        player.retry();
        player.setSource(source("c"));
        await flush();
        expect(media).toHaveLength(2);
    });
});

class FakeGainParam {
    value = 1;
    cancelScheduledValues = vi.fn();
    setValueAtTime = vi.fn((value: number) => {
        this.value = value;
    });
    setTargetAtTime = vi.fn((value: number) => {
        this.value = value;
    });
}

class FakeContext {
    state: "running" | "suspended" = "running";
    currentTime = 0;
    destination = {};
    listeners = new Set<() => void>();
    gains: { gain: FakeGainParam; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    sources: unknown[] = [];
    nodes: { disconnect: ReturnType<typeof vi.fn> }[] = [];
    addEventListener = vi.fn((_type: string, listener: () => void) => this.listeners.add(listener));
    removeEventListener = vi.fn((_type: string, listener: () => void) => this.listeners.delete(listener));
    changeState(): void {
        for (const listener of [...this.listeners]) listener();
    }
    resume = vi.fn((): Promise<void> => {
        this.state = "running";
        this.changeState();
        return Promise.resolve();
    });
    close = vi.fn((): Promise<void> => Promise.resolve());
    createMediaElementSource = vi.fn((element: unknown) => {
        this.sources.push(element);
        const source = { connect: vi.fn(), disconnect: vi.fn() };
        this.nodes.push(source);
        return source;
    });
    createGain = vi.fn(() => {
        const gain = { gain: new FakeGainParam(), connect: vi.fn(), disconnect: vi.fn() };
        this.gains.push(gain);
        this.nodes.push(gain);
        return gain;
    });
}

describe("audio playback on browsers that ignore element volume (iPhone)", () => {
    let media: (FakeAudio & { crossOrigin?: string | null })[];
    let context: FakeContext;
    let player: AudioPlayback;
    let state: ReturnType<typeof vi.fn>;
    let failNextCorsLoad: boolean;
    let failAllLoads: boolean;
    let hostHasCors: boolean;
    let noGesture: boolean;
    const checkCors = vi.fn((_url: string, _signal: AbortSignal): Promise<boolean> => Promise.resolve(hostHasCors));
    beforeEach(() => {
        vi.useFakeTimers();
        media = [];
        context = new FakeContext();
        failNextCorsLoad = false;
        failAllLoads = false;
        hostHasCors = true;
        noGesture = false;
        checkCors.mockClear();
        state = vi.fn();
        player = new AudioPlayback(
            state,
            vi.fn(),
            () => {
                const audio: FakeAudio & { crossOrigin?: string | null } = new FakeAudio();
                // iOS Safari: element volume reads back 1 and cannot be changed.
                Object.defineProperty(audio, "volume", { get: () => 1, set: () => undefined });
                audio.play.mockImplementation(() => {
                    if (noGesture) return Promise.reject(new DOMException("gesture", "NotAllowedError"));
                    if (failAllLoads || (failNextCorsLoad && audio.crossOrigin === "anonymous")) {
                        return Promise.reject(new DOMException("no CORS", "NotSupportedError"));
                    }
                    audio.paused = false;
                    return Promise.resolve();
                });
                media.push(audio);
                return audio as unknown as HTMLAudioElement;
            },
            1600,
            undefined,
            () => context as unknown as AudioContext,
            checkCors
        );
        player.setControls(controls);
    });
    afterEach(() => {
        player.destroy();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("sets the level with a gain node instead of the element volume", async () => {
        player.setSource(source("https://maps.example/a.mp3", 0.5));
        await flush();
        expect(media[0].crossOrigin).toBe("anonymous");
        expect(context.createMediaElementSource).toHaveBeenCalledWith(media[0]);
        expect(context.gains[0].gain.value).toBeCloseTo(0.4);
        player.setControls({ ...controls, volume: 0 });
        expect(context.gains[0].gain.value).toBe(0);
        player.setControls({ ...controls, volume: 1 });
        expect(context.gains[0].gain.value).toBeCloseTo(0.5);
        player.setControls({ ...controls, volume: 1, talking: true });
        expect(context.gains[0].gain.value).toBeCloseTo(0.25);
    });

    it("silences the gain and the element when muted", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        player.setControls({ ...controls, muted: true });
        expect(media[0].muted).toBe(true);
        expect(context.gains[0].gain.value).toBe(0);
    });

    it("crossfades between tracks again, since the gain node can fade", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        player.setSource(source("https://maps.example/b.mp3"));
        await flush();
        expect(media.filter((audio) => !audio.paused)).toHaveLength(2);
        vi.advanceTimersByTime(1800);
        expect(media[0].paused).toBe(true);
        expect(media[1].paused).toBe(false);
        expect(context.gains[1].gain.value).toBeCloseTo(0.8);
    });

    it("reuses the gain node of a recycled element", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        player.setSource(source("https://maps.example/b.mp3"));
        await flush();
        vi.advanceTimersByTime(1800);
        player.setSource(source("https://maps.example/c.mp3"));
        await flush();
        vi.advanceTimersByTime(1800);
        expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
        expect(media).toHaveLength(2);
    });

    it("waits for a tap when the context is suspended, then resumes it inside that tap", async () => {
        context.state = "suspended";
        context.resume.mockImplementation(() => Promise.resolve());
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        expect(state).not.toHaveBeenCalledWith("playing");
        context.resume.mockClear();
        context.resume.mockImplementation(() => {
            context.state = "running";
            context.changeState();
            return Promise.resolve();
        });
        player.retry();
        expect(context.resume).toHaveBeenCalledTimes(1);
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("falls back to a plain element when the host does not allow CORS", async () => {
        failNextCorsLoad = true;
        player.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        await flush();
        expect(state).not.toHaveBeenCalledWith("error");
        expect(media).toHaveLength(2);
        expect(media[1].crossOrigin).toBeUndefined();
        expect(media[1].src).toBe("https://nocors.example/a.mp3");
        expect(media[1].paused).toBe(false);
        expect(state).toHaveBeenLastCalledWith("playing");
        expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
        // The blocked host stays on plain elements; other hosts still get the gain node.
        player.setSource(source("https://nocors.example/b.mp3"));
        await flush();
        expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
        player.setSource(source("https://maps.example/c.mp3"));
        await flush();
        expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
    });

    it("tries the gain node again for a track whose plain retry was dropped before it played", async () => {
        const plays: string[] = [];
        player.destroy();
        const fresh = new AudioPlayback(
            state,
            vi.fn(),
            () => {
                const audio: FakeAudio & { crossOrigin?: string | null } = new FakeAudio();
                Object.defineProperty(audio, "volume", { get: () => 1, set: () => undefined });
                audio.play.mockImplementation(() => {
                    const isA = audio.src.endsWith("/a.mp3");
                    plays.push(`${isA ? "a" : "b"}:${audio.crossOrigin === "anonymous" ? "graph" : "plain"}`);
                    if (isA && audio.crossOrigin === "anonymous") {
                        return Promise.reject(new DOMException("no CORS", "NotSupportedError"));
                    }
                    audio.paused = false;
                    // The plain retry of "a" never settles, like a slow host.
                    if (isA) {
                        return new Promise<void>(() => {
                            // never settles
                        });
                    }
                    return Promise.resolve();
                });
                media.push(audio);
                return audio as unknown as HTMLAudioElement;
            },
            1600,
            undefined,
            () => context as unknown as AudioContext
        );
        fresh.setControls(controls);
        fresh.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        await flush();
        fresh.setSource(source("https://nocors.example/b.mp3"));
        await flush();
        fresh.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        expect(plays).toEqual(["a:graph", "a:plain", "b:graph", "a:graph", "a:plain"]);
        fresh.destroy();
    });

    it("gives a host without CORS its plain element before the tap, so one tap is enough", async () => {
        hostHasCors = false;
        failNextCorsLoad = true;
        noGesture = true;
        player.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        await flush();
        // The probe came back "no CORS" while play was still blocked: the track already sits on a plain element.
        expect(checkCors).toHaveBeenCalledTimes(1);
        expect(media).toHaveLength(2);
        expect(media[1].crossOrigin).toBeUndefined();
        expect(media[0].src).toBe("");
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        noGesture = false;
        player.retry();
        await flush();
        expect(media[1].paused).toBe(false);
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("asks a host that failed again, so a dropped connection only costs volume control for a track", async () => {
        hostHasCors = false;
        noGesture = true;
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        await flush();
        expect(media[1].crossOrigin).toBeUndefined();
        noGesture = false;
        player.retry();
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
        // The connection is back: the next track asks again and is told yes, the one after gets the gain node.
        hostHasCors = true;
        player.setSource(source("https://maps.example/b.mp3"));
        await flush();
        await flush();
        expect(checkCors).toHaveBeenCalledTimes(2);
        player.setSource(source("https://maps.example/c.mp3"));
        await flush();
        expect(media.find((audio) => audio.src.endsWith("/c.mp3"))?.crossOrigin).toBe("anonymous");
        expect(checkCors).toHaveBeenCalledTimes(2);
    });

    it("reuses an idle plain element for a host without CORS instead of creating one", async () => {
        hostHasCors = false;
        player.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        await flush();
        player.setSource(source("https://nocors.example/b.mp3"));
        await flush();
        vi.advanceTimersByTime(1800);
        const created = media.length;
        player.setSource(source("https://nocors.example/c.mp3"));
        await flush();
        vi.advanceTimersByTime(1800);
        expect(media).toHaveLength(created);
    });

    it("never blames CORS for a same-origin file that failed once", async () => {
        failNextCorsLoad = true;
        player.setSource(source(`${window.location.origin}/music/a.mp3`));
        await flush();
        await flush();
        // The graph load failed once and the plain retry played; the next same-origin track still gets the gain node.
        failNextCorsLoad = false;
        player.setSource(source(`${window.location.origin}/music/b.mp3`));
        await flush();
        expect(media.find((audio) => audio.src.endsWith("/b.mp3"))?.crossOrigin).toBe("anonymous");
    });

    it("stops waiting for a host that never answers, remembers nothing and asks again on the next track", async () => {
        let aborted = false;
        checkCors.mockImplementationOnce((_url: string, signal: AbortSignal) => {
            const onAbort = (): void => {
                aborted = true;
                signal.removeEventListener("abort", onAbort);
            };
            signal.addEventListener("abort", onAbort);
            return new Promise<boolean>(() => {
                // Never answers.
            });
        });
        player.setSource(source("https://slow.example/a.mp3"));
        await flush();
        expect(checkCors).toHaveBeenCalledTimes(1);
        // Still waiting: the host is not asked a second time for the next track.
        player.setSource(source("https://slow.example/b.mp3"));
        await flush();
        expect(checkCors).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(8000);
        expect(aborted).toBe(true);
        // Unknown, not "no CORS": the track keeps its gain node and the next track asks the host again.
        expect(media.find((audio) => audio.src.endsWith("/b.mp3"))?.crossOrigin).toBe("anonymous");
        player.setSource(source("https://slow.example/c.mp3"));
        await flush();
        expect(checkCors).toHaveBeenCalledTimes(2);
        expect(media.find((audio) => audio.src.endsWith("/c.mp3"))?.crossOrigin).toBe("anonymous");
    });

    it("asks a host only once and keeps the gain node when it allows CORS", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        player.setSource(source("https://maps.example/b.mp3"));
        await flush();
        expect(checkCors).toHaveBeenCalledTimes(1);
        expect(media[0].crossOrigin).toBe("anonymous");
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("keeps the gain node for other tracks when a file fails for another reason", async () => {
        failAllLoads = true;
        player.setSource(source("https://maps.example/missing.mp3"));
        await flush();
        await flush();
        expect(state).toHaveBeenLastCalledWith("error");
        failAllLoads = false;
        player.setSource(source("https://maps.example/b.mp3"));
        await flush();
        expect(media.at(-1)?.crossOrigin).toBe("anonymous");
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("asks for a tap again after the context is interrupted while playing", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("playing");
        context.resume.mockImplementation(() => Promise.resolve());
        context.state = "suspended";
        context.changeState();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        expect(context.resume).toHaveBeenCalled();
        context.state = "running";
        context.changeState();
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("leaves the element out of CORS mode when the gain node cannot be set up", async () => {
        context.createMediaElementSource.mockImplementationOnce(() => {
            throw new DOMException("closed", "InvalidStateError");
        });
        player.setSource(source("https://nocors.example/a.mp3"));
        await flush();
        expect(media[0].crossOrigin).toBeNull();
        expect(media[0].paused).toBe(false);
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("keeps plain playback when Web Audio is not available", async () => {
        player.destroy();
        player = new AudioPlayback(
            state,
            vi.fn(),
            () => {
                const audio = new FakeAudio();
                Object.defineProperty(audio, "volume", { get: () => 1, set: () => undefined });
                media.push(audio);
                return audio as unknown as HTMLAudioElement;
            },
            1600,
            undefined,
            () => undefined
        );
        player.setControls(controls);
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        expect(media.at(-1)?.paused).toBe(false);
        expect(state).toHaveBeenLastCalledWith("playing");
    });

    it("leaves the shared audio context running on destroy and lets go of its own nodes", async () => {
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        player.destroy();
        expect(context.close).not.toHaveBeenCalled();
        expect(context.listeners.size).toBe(0);
        expect(context.nodes.length).toBeGreaterThan(0);
        for (const node of context.nodes) expect(node.disconnect).toHaveBeenCalled();
    });

    it("plays a later sound with its volume once one tap has started the shared context (object sounds)", async () => {
        context.state = "suspended";
        context.resume.mockImplementation(() => Promise.resolve());
        player.setSource(source("https://maps.example/a.mp3"));
        await flush();
        expect(state).toHaveBeenLastCalledWith("not_allowed");
        context.resume.mockImplementation(() => {
            context.state = "running";
            context.changeState();
            return Promise.resolve();
        });
        player.retry();
        expect(state).toHaveBeenLastCalledWith("playing");
        // A new sound starts later, outside any tap, in its own player: it shares the running context.
        const laterState = vi.fn();
        const later = new AudioPlayback(
            laterState,
            vi.fn(),
            () => {
                const audio = new FakeAudio();
                Object.defineProperty(audio, "volume", { get: () => 1, set: () => undefined });
                audio.play.mockImplementation(() => {
                    audio.paused = false;
                    return Promise.resolve();
                });
                media.push(audio);
                return audio as unknown as HTMLAudioElement;
            },
            1600,
            undefined,
            () => context as unknown as AudioContext,
            checkCors
        );
        later.setControls(controls);
        later.setSource(source("https://maps.example/b.mp3", 0.3));
        await flush();
        vi.advanceTimersByTime(2000);
        expect(laterState).toHaveBeenLastCalledWith("playing");
        expect(context.gains.at(-1)?.gain.value).toBeCloseTo(0.3 * controls.volume);
        later.destroy();
    });
});
