import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: {
        getNoiseFilter: () => localStorage.getItem("noiseFilter"),
        setNoiseFilter: (value: string) => localStorage.setItem("noiseFilter", value),
    },
}));
vi.mock("../../../src/front/WebRtc/DeviceUtils", () => ({ isFirefox: () => false }));

async function loadStore() {
    vi.resetModules();
    return import("../../../src/front/Stores/NoiseFilterStore");
}

describe("NoiseFilterStore", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("starts on Standard, also when the saved value is unknown", async () => {
        localStorage.setItem("noiseFilter", "browser");
        const { noiseFilterStore } = await loadStore();

        expect(get(noiseFilterStore)).toBe("standard");
    });

    it("remembers the choice for next time", async () => {
        const { noiseFilterStore } = await loadStore();
        noiseFilterStore.set("voiceOnly");

        expect(localStorage.getItem("noiseFilter")).toBe("voiceOnly");
        const reloaded = await loadStore();
        expect(get(reloaded.noiseFilterStore)).toBe("voiceOnly");
    });

    it("shows Standard for Voice only until the browser says it supports it", async () => {
        const { noiseFilterStore, shownNoiseFilterStore, voiceIsolationSupportedStore } = await loadStore();
        noiseFilterStore.set("voiceOnly");

        expect(get(shownNoiseFilterStore)).toBe("standard");
        voiceIsolationSupportedStore.set(true);
        expect(get(shownNoiseFilterStore)).toBe("voiceOnly");
    });

    it("shows Standard for Strong where AudioWorklet is missing", async () => {
        vi.stubGlobal("AudioContext", undefined);
        const { noiseFilterStore, shownNoiseFilterStore, strongNoiseFilterSupported } = await loadStore();
        noiseFilterStore.set("strong");

        expect(strongNoiseFilterSupported).toBe(false);
        expect(get(shownNoiseFilterStore)).toBe("standard");
    });

    it("offers Strong where AudioWorklet exists", async () => {
        class FakeAudioContext {}
        Object.defineProperty(FakeAudioContext.prototype, "audioWorklet", { value: {} });
        vi.stubGlobal("AudioContext", FakeAudioContext);
        vi.stubGlobal("AudioWorkletNode", class {});
        const { noiseFilterStore, shownNoiseFilterStore, strongNoiseFilterSupported } = await loadStore();
        noiseFilterStore.set("strong");

        expect(strongNoiseFilterSupported).toBe(true);
        expect(get(shownNoiseFilterStore)).toBe("strong");
    });
});
