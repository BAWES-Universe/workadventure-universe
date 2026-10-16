import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
vi.mock("../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: {
        getAudioPlayerMuted: () => true,
        getAudioPlayerVolume: () => 0.7,
        getBubbleSound: () => "ding",
    },
}));
vi.mock("../../../src/front/Stores/PeerStore", () => ({ videoStreamElementsStore: writable([]) }));
vi.mock("../../../src/front/Stores/MenuStore", () => ({ activeSecondaryZoneActionBarStore: writable(undefined) }));
import {
    audioManagerFileStore,
    audioManagerSourceStore,
    audioManagerVolumeStore,
} from "../../../src/front/Stores/AudioManagerStore";

describe("native audio source and master stores", () => {
    beforeEach(() => {
        audioManagerFileStore.unloadAudio();
    });
    it("initializes master preferences once from local storage", () => {
        expect(get(audioManagerVolumeStore)).toMatchObject({ muted: true, volume: 0.7 });
    });
    it("preserves master mute, pause and volume across quiet/loud sources and unload", () => {
        audioManagerVolumeStore.setMuted(true);
        audioManagerVolumeStore.setVolume(0.8);
        audioManagerVolumeStore.togglePause();
        audioManagerFileStore.playAudio("quiet.mp3", "https://example.com/map.json", 0.2, true);
        audioManagerFileStore.playAudio("louder.mp3", "https://example.com/map.json", 0.6);
        expect(get(audioManagerVolumeStore)).toMatchObject({ volume: 0.8, muted: true, paused: true });
        expect(get(audioManagerSourceStore)).toEqual({
            url: "https://example.com/louder.mp3",
            volume: 0.6,
            loop: false,
        });
        expect(get(audioManagerFileStore)).toBe("https://example.com/louder.mp3");
        audioManagerFileStore.unloadAudio();
        expect(get(audioManagerSourceStore)).toBeUndefined();
        expect(get(audioManagerFileStore)).toBe("");
        expect(get(audioManagerVolumeStore)).toMatchObject({ volume: 0.8, muted: true, paused: true });
        audioManagerVolumeStore.togglePause();
    });
    it("handles source-only volume and loop updates, including zero and default gain", () => {
        audioManagerFileStore.playAudio("bed.mp3", "https://example.com/", 0);
        expect(get(audioManagerSourceStore)?.volume).toBe(0);
        audioManagerFileStore.setVolume(0.6);
        audioManagerFileStore.setLoop(true);
        expect(get(audioManagerSourceStore)).toMatchObject({ volume: 0.6, loop: true });
        audioManagerFileStore.setVolume(undefined);
        expect(get(audioManagerSourceStore)?.volume).toBe(1);
        audioManagerFileStore.unloadAudio();
        audioManagerFileStore.setVolume(0.5);
        expect(get(audioManagerSourceStore)).toBeUndefined();
    });
    it("keeps legacy stop semantics: next explicit source resets stop but not pause", () => {
        audioManagerVolumeStore.stopSound(true);
        audioManagerFileStore.playAudio("bed.mp3", "https://example.com/", undefined, true);
        expect(get(audioManagerVolumeStore).stopped).toBe(false);
        expect(get(audioManagerSourceStore)).toMatchObject({ volume: 1, loop: true });
    });
});
