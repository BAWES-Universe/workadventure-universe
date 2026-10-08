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
} from "../../../../src/front/Stores/AudioManagerStore";

const flush = async () => {
    await tick();
    await Promise.resolve();
    await tick();
};
const play = (url: string) => audioManagerFileStore.playAudio(url, "https://maps.example/map.json", 0.5, true);

describe("native audio panel integration", () => {
    let component: AudioPlayer;
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
        component.$destroy();
        audioManagerFileStore.unloadAudio();
        vi.restoreAllMocks();
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

    it("forgets a pending panel-open request when the map unloads", async () => {
        audioManagerVolumeStore.togglePause();
        play("a.ogg");
        audioManagerFileStore.unloadAudio();
        audioManagerVolumeStore.togglePause();
        await flush();
        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
    });
});
