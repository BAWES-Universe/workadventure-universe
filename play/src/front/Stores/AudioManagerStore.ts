import type { Writable } from "svelte/store";
import { derived, writable } from "svelte/store";
import { Subject } from "rxjs";
import type { AudioSource } from "../Components/AudioManager/AudioPlayback";
import { clampAudioVolume } from "../Components/AudioManager/AudioPlayback";
import { localUserStore } from "../Connection/LocalUserStore";
import { videoStreamElementsStore } from "./PeerStore";
import { activeSecondaryZoneActionBarStore } from "./MenuStore";

export interface AudioManagerVolume {
    muted: boolean;
    volume: number;
    decreaseWhileTalking: boolean;
    talking: boolean;
    paused: boolean;
    stopped: boolean;
}

function createAudioManagerVolumeStore() {
    const { subscribe, update } = writable<AudioManagerVolume>({
        muted: localUserStore.getAudioPlayerMuted(),
        volume: clampAudioVolume(localUserStore.getAudioPlayerVolume()),
        decreaseWhileTalking: true,
        talking: false,
        paused: false,
        stopped: false,
    });

    return {
        subscribe,
        setMuted: (newMute: boolean): void => {
            update((audioPlayerVolume: AudioManagerVolume) => {
                audioPlayerVolume.muted = newMute;
                return audioPlayerVolume;
            });
        },
        setVolume: (newVolume: number): void => {
            update((audioPlayerVolume: AudioManagerVolume) => {
                audioPlayerVolume.volume = clampAudioVolume(newVolume);
                return audioPlayerVolume;
            });
        },
        setDecreaseWhileTalking: (newDecrease: boolean): void => {
            update((audioManagerVolume: AudioManagerVolume) => {
                audioManagerVolume.decreaseWhileTalking = newDecrease;
                return audioManagerVolume;
            });
        },
        setTalking: (newTalk: boolean): void => {
            update((audioManagerVolume: AudioManagerVolume) => {
                audioManagerVolume.talking = newTalk;
                return audioManagerVolume;
            });
        },
        // Function to pause the sound
        togglePause: (): void => {
            update((audioManagerVolume: AudioManagerVolume) => {
                audioManagerVolume.paused = !audioManagerVolume.paused;
                return audioManagerVolume;
            });
        },

        // Function to stop the sound
        stopSound: (newStopped: boolean): void => {
            update((audioManagerVolume: AudioManagerVolume) => {
                audioManagerVolume.stopped = newStopped;
                return audioManagerVolume;
            });
        },
    };
}

// Source metadata is atomic and separate from the user's persisted master controls.
const audioSource = writable<AudioSource | undefined>(undefined);
export const audioManagerSourceStore = { subscribe: audioSource.subscribe };

function createAudioManagerFileStore() {
    const file = derived(audioSource, (source) => source?.url ?? "");
    return {
        subscribe: file.subscribe,
        playAudio: (url: string | number | boolean, mapUrl: string, volume: number | undefined, loop = false): void => {
            audioSource.set({ url: new URL(String(url), mapUrl).toString(), volume: clampAudioVolume(volume), loop });
            // Stop is a one-shot action: a new explicit source may start, as before. Pause and mute persist.
            audioManagerVolumeStore.stopSound(false);
        },
        setVolume: (volume: number | undefined): void => {
            audioSource.update((source) => source && { ...source, volume: clampAudioVolume(volume) });
        },
        setLoop: (loop: boolean): void => {
            audioSource.update((source) => source && { ...source, loop });
        },
        unloadAudio: (): void => {
            audioSource.set(undefined);
            activeSecondaryZoneActionBarStore.set(undefined);
        },
    };
}

// Store deciding the visibility of the music icon in the action bar and its status
export const audioManagerVisibilityStore: Writable<"hidden" | "visible" | "disabledBySettings" | "error"> =
    writable("hidden");

export const audioManagerVolumeStore = createAudioManagerVolumeStore();
export const audioManagerFileStore = createAudioManagerFileStore();
export const audioManagerPlayerState: Writable<"loading" | "playing" | "not_allowed" | "error" | undefined> =
    writable(undefined);
// Store solely used to trigger a retry of the audio player (in case the browser blocked it the first time)
export const audioManagerRetryPlaySubject = new Subject<void>();

// Store for bubble sound preference
export const bubbleSoundStore = writable<"ding" | "wobble">(localUserStore.getBubbleSound());

// Not unsubscribing is ok, this is a singleton.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
videoStreamElementsStore.subscribe((peerElements) => {
    audioManagerVolumeStore.setTalking(peerElements.length > 0);
});
