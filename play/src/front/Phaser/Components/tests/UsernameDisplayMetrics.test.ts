import { describe, expect, it } from "vitest";
import { getDisplayScale, getShownName } from "../UsernameDisplayMetrics";

describe("getDisplayScale", () => {
    it("keeps the base size at the default zoom", () => {
        // One game pixel is 1.25 screen pixels: the name is 12.5 px, under the 13 px limit.
        expect(getDisplayScale(1, 1.25)).toBe(1);
    });

    it("stops shrinking when zoomed far out", () => {
        // Past 65% zoom the name keeps its screen size: the scale grows to cancel the zoom.
        expect(getDisplayScale(0.65, 0.8)).toBe(1);
        expect(getDisplayScale(0.5, 0.625)).toBeCloseTo(1.3);
        expect(getDisplayScale(0.25, 0.3)).toBeCloseTo(2.6);
    });

    it("stops growing at 13 px on screen when zoomed in", () => {
        const fontSizeOnScreen = (zoomModifier: number, ancestorScale: number): number =>
            10 * getDisplayScale(zoomModifier, ancestorScale) * ancestorScale;
        expect(fontSizeOnScreen(2, 2.5)).toBeCloseTo(13);
        expect(fontSizeOnScreen(3, 4)).toBeCloseTo(13);
    });

    it("never goes above 13 px on screen at any zoom", () => {
        for (const zoom of [0.1, 0.3, 0.65, 1, 1.5, 2, 4]) {
            expect(10 * getDisplayScale(zoom, zoom * 1.25) * zoom * 1.25).toBeLessThanOrEqual(13 + 1e-9);
        }
    });

    it("on a big screen, shrinks from 13 px down to 65% of 13 px (8.45 px) and stops", () => {
        // A desktop: the uncapped default size is 25 px, shown at the 13 px cap. Ancestor scale = zoom * 2.5.
        const fontSizeOnScreen = (zoom: number): number => 10 * getDisplayScale(zoom, zoom * 2.5) * zoom * 2.5;
        expect(fontSizeOnScreen(1)).toBeCloseTo(13);
        expect(fontSizeOnScreen(0.7)).toBeCloseTo(13); // still capped: 17.5 px on the map, 13 px shown
        expect(fontSizeOnScreen(0.4)).toBeCloseTo(10);
        expect(fontSizeOnScreen(0.3)).toBeCloseTo(8.45);
        expect(fontSizeOnScreen(0.1)).toBeCloseTo(8.45);
    });

    it("gives the same scale as before whenever the name is not over 13 px at the default zoom (phones)", () => {
        const before = (zoom: number, ancestorScale: number): number =>
            Math.min(Math.max(0.65 / zoom, 1), 13 / (10 * ancestorScale));
        for (const k of [0.8, 1, 1.25, 1.3]) {
            for (const zoom of [0.05, 0.1, 0.25, 0.4, 0.5, 0.65, 0.8, 1, 1.5, 2, 3, 4]) {
                expect(getDisplayScale(zoom, zoom * k)).toBeCloseTo(before(zoom, zoom * k), 10);
            }
        }
    });

    it("falls back to upstream's rule while the layer has not been measured", () => {
        expect(getDisplayScale(0.5, 0)).toBeCloseTo(1.3);
        expect(getDisplayScale(2, 0)).toBe(1);
    });
});

describe("getShownName", () => {
    it("keeps whole names of up to 32 letters", () => {
        expect(getShownName("Khalid", false)).toBe("Khalid");
        expect(getShownName("GitHub [Student Pack]", false)).toBe("GitHub [Student Pack]");
        expect(getShownName("Juanma Gaviria Restrepo", false)).toBe("Juanma Gaviria Restrepo");
        expect(getShownName("A".repeat(32), false)).toBe("A".repeat(32));
    });

    it("cuts longer names to 31 letters and an ellipsis", () => {
        expect(getShownName("A".repeat(33), false)).toBe("A".repeat(31) + "…");
    });

    it("shows the whole name when highlighted", () => {
        expect(getShownName("Juanma Gaviria Restrepo", true)).toBe("Juanma Gaviria Restrepo");
    });

    it("never cuts an emoji in two", () => {
        const name = "😀".repeat(40);
        expect(getShownName(name, false)).toBe("😀".repeat(31) + "…");
    });
});
