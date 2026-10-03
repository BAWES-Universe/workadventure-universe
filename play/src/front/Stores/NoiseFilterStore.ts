import { derived, writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";
import { isFirefox } from "../WebRtc/DeviceUtils";

/**
 * "standard": the browser's own noise filter (what everyone had before).
 * "strong": WorkAdventure's on-device DTLN model, downloaded the first time it is picked.
 * "voiceOnly": the browser's and operating system's voice isolation, only where the browser offers it.
 */
export const NOISE_FILTERS = ["standard", "strong", "voiceOnly"] as const;
export type NoiseFilter = (typeof NOISE_FILTERS)[number];

function isNoiseFilter(value: unknown): value is NoiseFilter {
    return (NOISE_FILTERS as readonly unknown[]).includes(value);
}

/**
 * "starting": downloading and starting the model; the browser's filter stays on meanwhile.
 * "failed": it could not start; the choice went back to Standard and the device list says so.
 */
export type StrongNoiseFilterState = "off" | "starting" | "on" | "failed";

/**
 * Strong runs in an AudioWorklet in a 16 kHz AudioContext. Firefox cannot connect a 48 kHz microphone to a
 * context with another sample rate, so it is not offered there.
 */
export const strongNoiseFilterSupported =
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    "audioWorklet" in AudioContext.prototype &&
    !isFirefox();

/** Set from the microphone track once we have one: the browser both knows and applies voiceIsolation. */
export const voiceIsolationSupportedStore = writable(false);

export const strongNoiseFilterStateStore = writable<StrongNoiseFilterState>("off");

function createNoiseFilterStore() {
    const stored = localUserStore.getNoiseFilter();
    const { subscribe, set } = writable<NoiseFilter>(isNoiseFilter(stored) ? stored : "standard");

    return {
        subscribe,
        set(value: NoiseFilter) {
            localUserStore.setNoiseFilter(value);
            set(value);
        },
    };
}

export const noiseFilterStore = createNoiseFilterStore();

/** What the device list shows as picked: a choice this browser cannot run shows as Standard. */
export const shownNoiseFilterStore = derived(
    [noiseFilterStore, voiceIsolationSupportedStore],
    ([$noiseFilter, $voiceIsolationSupported]): NoiseFilter => {
        if ($noiseFilter === "strong" && !strongNoiseFilterSupported) {
            return "standard";
        }
        if ($noiseFilter === "voiceOnly" && !$voiceIsolationSupported) {
            return "standard";
        }
        return $noiseFilter;
    }
);
