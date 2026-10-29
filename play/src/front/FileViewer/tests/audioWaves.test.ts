import { describe, expect, it } from "vitest";
import { bandLevel, bandsOf, bandsSettled, easeBands, QUIET_BANDS, ribbonsOf } from "../audioWaves";

// An analyser reading of 1024 bins at 48 kHz: each bin is about 23 Hz wide.
const SAMPLE_RATE = 48000;
function reading(loudFrom: number, loudTo: number): Uint8Array {
    const bins = new Uint8Array(1024);
    const width = SAMPLE_RATE / 2 / bins.length;
    for (let i = 0; i < bins.length; i++) if (i * width >= loudFrom && i * width < loudTo) bins[i] = 255;
    return bins;
}

describe("the music stage's waves", () => {
    it("reads how loud a stretch of frequencies is", () => {
        expect(bandLevel(reading(0, 24000), SAMPLE_RATE, 35, 160)).toBe(1);
        expect(bandLevel(new Uint8Array(1024), SAMPLE_RATE, 35, 160)).toBe(0);
        expect(bandLevel(new Uint8Array(0), SAMPLE_RATE, 35, 160)).toBe(0);
    });

    it("moves the bass ribbon with a bass line and the high one with cymbals", () => {
        const bassLine = bandsOf(reading(30, 170), SAMPLE_RATE);
        expect(bassLine.bass).toBeGreaterThan(0.5);
        expect(bassLine.highs).toBe(0);
        const cymbals = bandsOf(reading(3000, 9000), SAMPLE_RATE);
        expect(cymbals.highs).toBe(1);
        expect(cymbals.bass).toBe(0);
        expect(ribbonsOf(bassLine)[0].amplitude).toBeGreaterThan(ribbonsOf(cymbals)[0].amplitude);
    });

    it("jumps up on a beat and falls back slowly", () => {
        const beat = { bass: 1, mids: 1, highs: 1 };
        const up = easeBands(QUIET_BANDS, beat);
        expect(up.bass).toBeGreaterThan(0.5);
        const down = easeBands(beat, QUIET_BANDS);
        expect(down.bass).toBeGreaterThan(0.85);
    });

    it("comes to rest when paused, so the stage can stop drawing", () => {
        let shown = { bass: 1, mids: 1, highs: 1 };
        let frames = 0;
        while (!bandsSettled(shown, QUIET_BANDS) && frames < 1000) {
            shown = easeBands(shown, QUIET_BANDS);
            frames++;
        }
        expect(frames).toBeLessThan(120);
        expect(bandsSettled(shown, QUIET_BANDS)).toBe(true);
    });
});
