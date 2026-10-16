import { get } from "svelte/store";
import { GameMapProperties } from "@workadventure/map-editor";
import { localUserStore } from "../../Connection/LocalUserStore";
import {
    audioManagerFileStore,
    audioManagerVisibilityStore,
    audioManagerVolumeStore,
} from "../../Stores/AudioManagerStore";
import type { GameMapFrontWrapper } from "../../Phaser/Game/GameMap/GameMapFrontWrapper";
import { clampAudioVolume } from "./AudioPlayback";
import { parseNativeSoundscape } from "./NativeSoundscapeConfig";

/** Register source selection and opt-in descriptor updates as one recovery scope per map. */
export function registerNativeSoundscapeProperties(
    properties: Pick<GameMapFrontWrapper, "onPropertyChange">,
    mapUrl: string
): void {
    let rejectedUrl: string | undefined;
    properties.onPropertyChange(GameMapProperties.PLAY_AUDIO, (newValue, oldValue, allProps) => {
        rejectedUrl = undefined;
        if (localUserStore.getBlockAudio()) {
            if (newValue !== undefined) {
                audioManagerVisibilityStore.set("disabledBySettings");
            } else {
                audioManagerVisibilityStore.set("hidden");
            }
            return;
        }
        const volume = allProps.get(GameMapProperties.AUDIO_VOLUME) as number | undefined;
        const loop = allProps.get(GameMapProperties.AUDIO_LOOP) as boolean | undefined;

        if (newValue !== undefined) {
            try {
                const soundscape = parseNativeSoundscape(allProps.get("nativeSoundscape"), mapUrl);
                audioManagerFileStore.playAudio(newValue, mapUrl, volume, loop, soundscape);
            } catch (error) {
                // Invalid explicit opt-in must not silently start an uncontrolled fallback.
                console.warn("Invalid nativeSoundscape map property", error);
                rejectedUrl = new URL(String(newValue), mapUrl).toString();
                audioManagerFileStore.unloadAudio();
                // A new explicit selection resets Stop, after unloading to avoid resuming the old source.
                // Descriptor-only recovery below still preserves a subsequent user Stop.
                audioManagerVolumeStore.stopSound(false);
                audioManagerVisibilityStore.set("error");
                return;
            }
            // FIXME: maybe we can switch to "visible" only when the sound actually starts playing?
            audioManagerVisibilityStore.set("visible");
        } else {
            // Stop the audio if it is playing
            if (get(audioManagerFileStore) != "") audioManagerVolumeStore.stopSound(true);
            if (get(audioManagerFileStore) != "") audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("hidden");
        }
    });

    properties.onPropertyChange("nativeSoundscape", (newValue, oldValue, allProps) => {
        const url = allProps.get(GameMapProperties.PLAY_AUDIO);
        if (localUserStore.getBlockAudio() || url === undefined) return;
        const resolvedUrl = new URL(String(url), mapUrl).toString();
        const selectedUrl = get(audioManagerFileStore);
        if (selectedUrl !== resolvedUrl && !(selectedUrl === "" && rejectedUrl === resolvedUrl)) return;
        try {
            const soundscape = parseNativeSoundscape(newValue, mapUrl);
            if (selectedUrl === "") {
                // Descriptor repair restores the rejected selection, not a new user/source play action.
                audioManagerFileStore.restoreAudio({
                    url: resolvedUrl,
                    volume: clampAudioVolume(allProps.get(GameMapProperties.AUDIO_VOLUME) as number | undefined),
                    loop: allProps.get(GameMapProperties.AUDIO_LOOP) === true,
                    ...(soundscape ? { soundscape } : {}),
                });
            } else {
                audioManagerFileStore.setSoundscape(soundscape);
            }
            rejectedUrl = undefined;
            audioManagerVisibilityStore.set("visible");
        } catch (error) {
            console.warn("Invalid nativeSoundscape map property", error);
            rejectedUrl = resolvedUrl;
            audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("error");
        }
    });
}
