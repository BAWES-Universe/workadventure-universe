import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import { GameMapProperties } from "@workadventure/map-editor";
import type { PropertyChangeCallback } from "../../../../src/front/Phaser/Game/GameMap/GameMapFrontWrapper";
vi.mock("../../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: {
        getAudioPlayerMuted: () => false,
        getAudioPlayerVolume: () => 0.7,
        getBubbleSound: () => "ding",
        getBlockAudio: vi.fn(() => false),
    },
}));
vi.mock("../../../../src/front/Stores/PeerStore", () => ({ videoStreamElementsStore: writable([]) }));
vi.mock("../../../../src/front/Stores/MenuStore", () => ({ activeSecondaryZoneActionBarStore: writable(undefined) }));
import { localUserStore } from "../../../../src/front/Connection/LocalUserStore";
import { registerNativeSoundscapeProperties } from "../../../../src/front/Components/AudioManager/NativeSoundscapeProperties";
import {
    audioManagerFileStore,
    audioManagerSourceStore,
    audioManagerVolumeStore,
    audioManagerVisibilityStore,
} from "../../../../src/front/Stores/AudioManagerStore";

const descriptor = JSON.stringify({ url: "water.mp3", volume: 0.3, x: 10, y: 20, innerRadius: 1, outerRadius: 100 });
const mapUrl = "https://example.com/map.json";

describe("native soundscape effective-property transitions", () => {
    let callbacks: Map<string, PropertyChangeCallback>;
    let props: Map<string, string | number | boolean>;
    function change(key: string, value: string | number | boolean | undefined) {
        const old = props.get(key);
        if (value === undefined) props.delete(key);
        else props.set(key, value);
        callbacks.get(key)?.(value, old, props);
    }
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(localUserStore, "getBlockAudio").mockReturnValue(false);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        audioManagerFileStore.unloadAudio();
        audioManagerVolumeStore.stopSound(false);
        audioManagerVolumeStore.setMuted(false);
        audioManagerVolumeStore.setVolume(0.7);
        if (get(audioManagerVolumeStore).paused) audioManagerVolumeStore.togglePause();
        callbacks = new Map();
        props = new Map<string, string | number | boolean>([
            [GameMapProperties.AUDIO_VOLUME, 0.4],
            [GameMapProperties.AUDIO_LOOP, true],
        ]);
        registerNativeSoundscapeProperties(
            {
                onPropertyChange: (key, callback) => {
                    callbacks.set(key, callback);
                },
            },
            mapUrl
        );
    });
    it.each([descriptor, undefined])("recovers continuous music after malformed area changes to %s", (next) => {
        change(GameMapProperties.PLAY_AUDIO, "music.mp3");
        change("nativeSoundscape", "{bad");
        expect(get(audioManagerSourceStore)).toBeUndefined();
        expect(get(audioManagerVisibilityStore)).toBe("error");
        change("nativeSoundscape", next);
        expect(get(audioManagerSourceStore)).toMatchObject({
            url: "https://example.com/music.mp3",
            volume: 0.4,
            loop: true,
        });
        expect(Boolean(get(audioManagerSourceStore)?.soundscape)).toBe(next !== undefined);
        expect(get(audioManagerVisibilityStore)).toBe("visible");
    });
    it("preserves Stop, pause, mute and master volume across rejection and editor repair", () => {
        props.set("nativeSoundscape", descriptor);
        change(GameMapProperties.PLAY_AUDIO, "music.mp3");
        audioManagerVolumeStore.stopSound(true);
        audioManagerVolumeStore.togglePause();
        audioManagerVolumeStore.setMuted(true);
        audioManagerVolumeStore.setVolume(0.2);
        const controls = { ...get(audioManagerVolumeStore) };
        change("nativeSoundscape", "bad");
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerSourceStore)?.soundscape).toBeDefined();
        expect(get(audioManagerVolumeStore)).toEqual(controls);
    });
    it("recovers initial invalid opt-in and repeated invalid edits only when repaired", () => {
        props.set("nativeSoundscape", "bad");
        change(GameMapProperties.PLAY_AUDIO, "music.mp3");
        change("nativeSoundscape", "still bad");
        expect(get(audioManagerSourceStore)).toBeUndefined();
        props.set(GameMapProperties.AUDIO_VOLUME, 0.1);
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerSourceStore)?.volume).toBe(0.1);
    });
    it("clears navigation Stop for a new rejected selection but preserves a later user Stop on repair", () => {
        change(GameMapProperties.PLAY_AUDIO, "first.mp3");
        change(GameMapProperties.PLAY_AUDIO, undefined);
        expect(get(audioManagerVolumeStore).stopped).toBe(true);
        props.set("nativeSoundscape", "bad");
        change(GameMapProperties.PLAY_AUDIO, "next.mp3");
        expect(get(audioManagerSourceStore)).toBeUndefined();
        expect(get(audioManagerVolumeStore).stopped).toBe(false);
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerFileStore)).toBe("https://example.com/next.mp3");
        expect(get(audioManagerVolumeStore).stopped).toBe(false);
        change("nativeSoundscape", "bad again");
        audioManagerVolumeStore.stopSound(true);
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerVolumeStore).stopped).toBe(true);
    });

    it("does not revive a rejected source after leaving its music area", () => {
        change(GameMapProperties.PLAY_AUDIO, "music.mp3");
        change("nativeSoundscape", "bad");
        change(GameMapProperties.PLAY_AUDIO, undefined);
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerSourceStore)).toBeUndefined();
        expect(get(audioManagerVisibilityStore)).toBe("hidden");
    });
    it("does not overwrite an independently selected source or bypass block-audio", () => {
        change(GameMapProperties.PLAY_AUDIO, "music.mp3");
        change("nativeSoundscape", "bad");
        audioManagerFileStore.playAudio("other.mp3", mapUrl, 1);
        change("nativeSoundscape", descriptor);
        expect(get(audioManagerFileStore)).toBe("https://example.com/other.mp3");
        audioManagerFileStore.unloadAudio();
        vi.spyOn(localUserStore, "getBlockAudio").mockReturnValue(true);
        change("nativeSoundscape", undefined);
        expect(get(audioManagerSourceStore)).toBeUndefined();
    });
    it.each([true, false])(
        "handles simultaneous music and descriptor changes, descriptor first=%s",
        (descriptorFirst) => {
            change(GameMapProperties.PLAY_AUDIO, "music.mp3");
            change("nativeSoundscape", "bad");
            props.set(GameMapProperties.PLAY_AUDIO, "next.mp3");
            props.set("nativeSoundscape", descriptor);
            const source = () => callbacks.get(GameMapProperties.PLAY_AUDIO)?.("next.mp3", "music.mp3", props);
            const water = () => callbacks.get("nativeSoundscape")?.(descriptor, "bad", props);
            if (descriptorFirst) {
                water();
                source();
            } else {
                source();
                water();
            }
            expect(get(audioManagerSourceStore)).toMatchObject({
                url: "https://example.com/next.mp3",
                soundscape: { url: "https://example.com/water.mp3" },
            });
        }
    );
});
