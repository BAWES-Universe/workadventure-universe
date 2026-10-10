import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNativeSoundscape } from "../../../../src/front/Components/AudioManager/NativeSoundscapeConfig";
import { distanceGain } from "../../../../src/front/Components/AudioManager/NativeSoundscape";

const fixturePath = resolve("../maps/tests/NativeSoundscape/map.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const carrier = fixture.layers.find((layer) => layer.name === "soundscape");
const properties = Object.fromEntries(carrier.properties.map((entry) => [entry.name, entry.value]));

describe("documented native soundscape map fixture", () => {
    it("opts in on a full-coverage tile layer at spawn, not root map properties", () => {
        expect(carrier.type).toBe("tilelayer");
        expect(carrier.data).toHaveLength(fixture.width * fixture.height);
        expect(carrier.data.every((tile) => tile !== 0)).toBe(true);
        expect(fixture.properties).toBeUndefined();
        expect(properties.audioLoop).toBe(true);
        expect(fixture.layers.find((layer) => layer.name === "start").data[5 * fixture.width + 1]).not.toBe(0);
    });
    it("uses two existing distinct same-origin fixture assets and an existing tileset", () => {
        const descriptor = JSON.parse(properties.nativeSoundscape);
        expect(properties.playAudio).not.toBe(descriptor.url);
        for (const asset of [properties.playAudio, descriptor.url, fixture.tilesets[0].image]) {
            expect(existsSync(resolve(dirname(fixturePath), asset))).toBe(true);
        }
    });
    it("matches documented far/half/near positions and gains", () => {
        const emitter = parseNativeSoundscape(
            properties.nativeSoundscape,
            "https://maps.example/tests/NativeSoundscape/map.json"
        );
        expect(distanceGain(emitter, 48, 176)).toBe(0);
        expect(distanceGain(emitter, 248, 176)).toBe(0.5);
        expect(distanceGain(emitter, 400, 176)).toBe(1);
        expect(properties.audioVolume).toBe(0.2);
        expect(emitter.volume).toBe(0.35);
    });
    it("provides a legacy reference differing in opt-in, not basic audio capability", () => {
        const legacy = JSON.parse(readFileSync(resolve(dirname(fixturePath), "legacy.json"), "utf8"));
        const legacyProperties = Object.fromEntries(
            legacy.layers[0].properties.map((entry) => [entry.name, entry.value])
        );
        expect(legacyProperties).toEqual({ playAudio: properties.playAudio, audioLoop: true, audioVolume: 0.2 });
        expect(legacy.layers[0].data).toEqual(carrier.data);
    });
});
