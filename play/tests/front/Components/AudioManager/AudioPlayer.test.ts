import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { get, writable } from "svelte/store";

// Vitest's Node conditions select Svelte's SSR no-op onMount; use the browser
// lifecycle hook that the compiled DOM component uses in the running client.
vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

vi.mock("../../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: { getAudioPlayerMuted: () => false, getAudioPlayerVolume: () => 0.8, getBubbleSound: () => "ding" },
}));
vi.mock("../../../../src/front/Stores/PeerStore", () => ({ videoStreamElementsStore: writable([]) }));
vi.mock("../../../../src/front/Stores/MenuStore", () => ({ activeSecondaryZoneActionBarStore: writable(undefined) }));
vi.mock("../../../../src/front/Stores/ActionsMenuStore", () => ({ actionsMenuStore: { clear: vi.fn() } }));
vi.mock("../../../../src/front/Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));
vi.mock("../../../../src/i18n/i18n-svelte", () => ({
    LL: writable({ audio: { manager: { notAllowed: () => "Allow audio", error: () => "Audio error" } } }),
}));

import AudioPlayer from "../../../../src/front/Components/AudioManager/AudioPlayer.svelte";
import { activeSecondaryZoneActionBarStore } from "../../../../src/front/Stores/MenuStore";
import {
    audioManagerFileStore,
    audioManagerPlayerState,
    audioManagerRetryPlaySubject,
    audioManagerVisibilityStore,
    audioManagerVolumeStore,
    nativeSoundscapeListenerStore,
} from "../../../../src/front/Stores/AudioManagerStore";

const flush = async () => {
    await tick();
    await Promise.resolve();
    await tick();
};
const play = (url: string) => audioManagerFileStore.playAudio(url, "https://maps.example/map.json", 0.5, true);

describe("native audio panel integration", () => {
    let component: AudioPlayer | undefined;
    let media: HTMLMediaElement[];
    beforeEach(async () => {
        media = [];
        audioManagerFileStore.unloadAudio();
        if (get(audioManagerVolumeStore).paused) audioManagerVolumeStore.togglePause();
        audioManagerVolumeStore.stopSound(false);
        vi.spyOn(document, "hidden", "get").mockReturnValue(false);
        vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
            if (!media.includes(this)) media.push(this);
            Object.defineProperty(this, "paused", { configurable: true, value: false });
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", { configurable: true, value: true });
        });
        component = new AudioPlayer({ target: document.body });
        await flush();
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        audioManagerFileStore.unloadAudio();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        nativeSoundscapeListenerStore.set(undefined);
        vi.useRealTimers();
    });

    it("opens the existing panel on a new source, but not on gain updates or resume", async () => {
        play("a.ogg");
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBe("audio-manager");
        activeSecondaryZoneActionBarStore.set(undefined);
        audioManagerFileStore.setVolume(0);
        audioManagerFileStore.setLoop(false);
        audioManagerVolumeStore.togglePause();
        audioManagerVolumeStore.togglePause();
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        play("b.ogg");
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBe("audio-manager");
    });

    it("opens only after a paused new source is explicitly resumed", async () => {
        audioManagerVolumeStore.togglePause();
        play("a.ogg");
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        audioManagerVolumeStore.togglePause();
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBe("audio-manager");
    });

    it("opens after the native gesture recovers blocked initial playback", async () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(
            new DOMException("gesture", "NotAllowedError")
        );
        play("a.ogg");
        await flush();
        expect(get(audioManagerPlayerState)).toBe("not_allowed");
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        audioManagerRetryPlaySubject.next();
        await flush();
        expect(get(audioManagerPlayerState)).toBe("playing");
        expect(get(activeSecondaryZoneActionBarStore)).toBe("audio-manager");
    });

    it("keeps a one-shot alive through hide/show and hides the native controls when it ends", async () => {
        audioManagerFileStore.playAudio("cue.ogg", "https://maps.example/map.json", 0.5, false);
        await flush();
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        vi.spyOn(document, "hidden", "get").mockReturnValue(false);
        document.dispatchEvent(new Event("visibilitychange"));
        expect(media[0].paused).toBe(false);
        expect(get(audioManagerPlayerState)).toBe("playing");
        media[0].dispatchEvent(new Event("ended"));
        await flush();
        expect(get(audioManagerPlayerState)).toBeUndefined();
        expect(get(audioManagerVisibilityStore)).toBe("hidden");
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
    });

    it("starts a source first selected in a background tab", async () => {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        play("a.ogg");
        await flush();
        expect(media[0].paused).toBe(false);
        expect(get(audioManagerPlayerState)).toBe("playing");
    });

    it("owns the existing native audio DOM hooks and removes retired or unloaded slots", async () => {
        vi.useFakeTimers();
        const elements = () => document.querySelectorAll("audio.audio-manager-audioplayer");
        play("a.ogg");
        await flush();
        expect(elements()).toHaveLength(1);
        play("b.ogg");
        await flush();
        expect(elements()).toHaveLength(2);
        vi.advanceTimersByTime(1800);
        expect(elements()).toHaveLength(1);
        audioManagerFileStore.unloadAudio();
        expect(elements()).toHaveLength(0);
        play("c.ogg");
        await flush();
        expect(elements()).toHaveLength(1);
        component?.$destroy();
        component = undefined;
        expect(elements()).toHaveLength(0);
    });

    it("forgets a pending panel-open request when the map unloads", async () => {
        audioManagerVolumeStore.togglePause();
        play("a.ogg");
        audioManagerFileStore.unloadAudio();
        audioManagerVolumeStore.togglePause();
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
    });
    it("contains invalid native music metadata without poisoning unrelated Svelte store dispatch", async () => {
        const unrelated = writable(0);
        let observed = 0;
        const unsubscribe = unrelated.subscribe((value) => {
            observed = value;
        });
        const emitter = {
            url: "https://maps.example/water.mp3",
            volume: 0.3,
            loop: true,
            x: 0,
            y: 0,
            innerRadius: 10,
            outerRadius: 100,
        };
        expect(() =>
            audioManagerFileStore.playAudio(
                "data:audio/mp3;base64,AA==",
                "https://maps.example/map.json",
                0.5,
                true,
                emitter
            )
        ).not.toThrow();
        unrelated.set(1);
        expect(observed).toBe(1);
        expect(get(audioManagerPlayerState)).toBe("error");
        audioManagerFileStore.unloadAudio();
        play("recovered.mp3");
        await flush();
        unrelated.set(2);
        expect(observed).toBe(2);
        expect(get(audioManagerPlayerState)).toBe("playing");
        unsubscribe();
    });

    it.each([false, true])(
        "rejects late first opt-in without restarting music (suspended controls=%s)",
        async (suspended) => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            play("music.mp3");
            await flush();
            const music = media[0];
            music.currentTime = 37;
            const originalSource = music.src;
            const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
            const calls = playSpy.mock.calls.length;
            audioManagerVolumeStore.setMuted(suspended);
            if (suspended) audioManagerVolumeStore.togglePause();
            audioManagerVolumeStore.stopSound(suspended);
            const controls = { ...get(audioManagerVolumeStore) };
            audioManagerFileStore.setSoundscape({
                url: "https://maps.example/water.mp3",
                volume: 0.3,
                loop: true,
                x: 0,
                y: 0,
                innerRadius: 10,
                outerRadius: 100,
            });
            await flush();
            expect(document.querySelectorAll("audio")).toHaveLength(1);
            expect(document.querySelector("audio")).toBe(music);
            expect(music.src).toBe(originalSource);
            expect(music.currentTime).toBe(37);
            expect(playSpy.mock.calls).toHaveLength(calls);
            expect(get(audioManagerVolumeStore)).toEqual(controls);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("late same-track opt-in was ignored"));
            audioManagerFileStore.setSoundscape(undefined);
            await flush();
            expect(music.currentTime).toBe(37);
        }
    );

    it("keeps real media attached, retries a suspended native context, and removes same-URL area emitters without restarting music", async () => {
        const contexts: FakeAudioContext[] = [];
        class FakeAudioContext {
            state = "suspended";
            currentTime = 0;
            destination = {};
            onstatechange: (() => void) | null = null;
            gains: Array<{ value: number }> = [];
            resume = vi.fn(() => {
                this.state = "running";
                return Promise.resolve();
            });
            close = vi.fn(() => {
                this.state = "closed";
                return Promise.resolve();
            });
            constructor() {
                contexts.push(this);
            }
            createMediaElementSource() {
                return { connect: vi.fn(), disconnect: vi.fn() };
            }
            createGain() {
                const parameter = {
                    value: 0,
                    cancelScheduledValues: vi.fn(),
                    setValueAtTime(value: number) {
                        this.value = value;
                    },
                    setTargetAtTime(value: number) {
                        this.value = value;
                    },
                };
                this.gains.push(parameter);
                return { gain: parameter, connect: vi.fn(), disconnect: vi.fn() };
            }
        }
        vi.stubGlobal("AudioContext", FakeAudioContext);
        nativeSoundscapeListenerStore.set({ x: 0, y: 0 });
        const emitter = {
            url: "https://maps.example/water.mp3",
            volume: 0.3,
            loop: true,
            x: 0,
            y: 0,
            innerRadius: 10,
            outerRadius: 110,
        };
        audioManagerFileStore.playAudio("music.mp3", "https://maps.example/map.json", 0.5, true, emitter);
        await flush();
        expect(document.querySelectorAll("audio")).toHaveLength(2);
        expect(get(audioManagerPlayerState)).toBe("not_allowed");
        audioManagerRetryPlaySubject.next();
        await flush();
        expect(contexts[0].resume).toHaveBeenCalledTimes(1);
        expect(get(audioManagerPlayerState)).toBe("playing");
        const musicMedia = media[0];
        musicMedia.currentTime = 7;
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
        const musicCalls = () => playSpy.mock.contexts.filter((entry) => entry === musicMedia).length;
        const before = musicCalls();
        audioManagerFileStore.setSoundscape({ ...emitter, url: "https://maps.example/water2.mp3" });
        await flush();
        expect(document.querySelectorAll("audio")).toHaveLength(2);
        expect(musicMedia.currentTime).toBe(7);
        expect(musicCalls()).toBe(before);
        nativeSoundscapeListenerStore.set(undefined);
        expect(contexts[0].gains[1].value).toBe(0);
        audioManagerFileStore.setSoundscape(undefined);
        await flush();
        expect(document.querySelectorAll("audio")).toHaveLength(1);
        expect(musicMedia.currentTime).toBe(7);
        expect(musicCalls()).toBe(before);
        expect(contexts[0].close).not.toHaveBeenCalled();
        audioManagerFileStore.setSoundscape(emitter);
        await flush();
        expect(document.querySelectorAll("audio")).toHaveLength(2);
        expect(musicMedia.currentTime).toBe(7);
        expect(musicCalls()).toBe(before);
        expect(contexts).toHaveLength(1);
        audioManagerFileStore.unloadAudio();
        await flush();
        expect(document.querySelectorAll("audio")).toHaveLength(0);
        expect(contexts[0].close).toHaveBeenCalledTimes(1);
    });
});
