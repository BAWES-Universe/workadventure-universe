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
    let player: AudioPlayback;
    let state: ReturnType<typeof vi.fn>;
    let ended: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.useFakeTimers();
        media = [];
        nextPlayFailure = undefined;
        nextPlayPromise = undefined;
        state = vi.fn();
        ended = vi.fn();
        player = new AudioPlayback(state, ended, () => {
            const audio = new FakeAudio();
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

    it("silences background tabs and never replays missed one-shot cues", async () => {
        player.setSource(source("a"));
        await flush();
        player.setSource(source("b"));
        await flush();
        player.setHidden(true);
        expect(media.every((audio) => audio.paused)).toBe(true);
        media.forEach((audio) => audio.play.mockClear());
        player.setSource(source("cue", 0.5, false));
        player.setHidden(false);
        player.retry();
        await flush();
        expect(media.find((audio) => audio.src === "cue")?.play).not.toHaveBeenCalled();
        player.setSource(source("bed"));
        await flush();
        expect(media.find((audio) => audio.src === "bed")?.play).toHaveBeenCalledTimes(1);
    });

    it("resumes a looping bed after backgrounding without changing pause or mute", async () => {
        player.setControls({ ...controls, muted: true });
        player.setSource(source("a"));
        await flush();
        player.setHidden(true);
        player.setHidden(false);
        await flush();
        expect(media[0].play).toHaveBeenCalledTimes(2);
        expect(media[0].muted).toBe(true);
        player.setControls({ ...controls, paused: true });
        player.setHidden(true);
        player.setHidden(false);
        await flush();
        expect(media[0].play).toHaveBeenCalledTimes(2);
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
        player.setHidden(true);
        player.setHidden(false);
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

    it.each(["pause", "stop", "hidden", "unload"])("silences a retained autoplay bed on %s", async (action) => {
        player.setSource(source("a"));
        await flush();
        nextPlayFailure = new DOMException("gesture", "NotAllowedError");
        player.setSource(source("b"));
        await flush();
        if (action === "pause") player.setControls({ ...controls, paused: true });
        if (action === "stop") player.setControls({ ...controls, stopped: true });
        if (action === "hidden") player.setHidden(true);
        if (action === "unload") player.setSource(undefined);
        expect(media.every((audio) => audio.paused)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("reloads a resource error on explicit retry", async () => {
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
