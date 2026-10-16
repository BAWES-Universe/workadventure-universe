import { describe, expect, it } from "vitest";
import { labelLayerLift, youTabPlacement } from "../../../../src/front/Components/LookAround/labelLayer";

describe("labelLayerLift (#998)", () => {
    it("reaches up to the top of the canvas when the layer starts under the top bar", () => {
        // Desktop: the layer starts at y 96, the canvas at y 0.
        expect(labelLayerLift(96, 0)).toBe(96);
    });
    it("is 0 when the layer and the canvas start together (a phone, the bar is at the bottom)", () => {
        expect(labelLayerLift(0, 0)).toBe(0);
    });
    it("never goes below 0 and rounds to whole pixels", () => {
        expect(labelLayerLift(0, 12)).toBe(0);
        expect(labelLayerLift(95.6, 0.2)).toBe(95);
    });
});

describe("youTabPlacement (#998)", () => {
    const width = 1440;
    const height = 804; // 900 - the 96 px bar
    const lift = 96;
    // `centre` is in the layer's own pixels: the layer starts `lift` above the part below the bar.
    const at = (x: number, yBelowBar: number) => ({ x, y: yBelowBar + lift });

    it("shows no tab while you are on screen", () => {
        expect(youTabPlacement(at(700, 400), width, height, lift)).toBeUndefined();
    });
    it("keeps the tab for someone hidden behind the bar, as before the layer reached up", () => {
        // 56 px above the bar's bottom edge: off the part you see clearly, so the tab shows, and below the bar.
        expect(youTabPlacement({ x: 700, y: 40 }, width, height, lift)).toEqual({ side: "top", x: 700, y: 0 });
        // Inside the 24 px margin it does not.
        expect(youTabPlacement(at(700, -20), width, height, lift)).toBeUndefined();
    });
    it("puts the tab on the top edge once you are further above the bar than the margin", () => {
        const tab = youTabPlacement(at(700, -200), width, height, lift);
        expect(tab).toEqual({ side: "top", x: 700, y: 0 });
    });
    it("keeps a side tab below the bar so it can be tapped", () => {
        // Far to the right, a little below the top of the part under the bar.
        const tab = youTabPlacement(at(2000, 10), width, height, lift);
        expect(tab?.side).toBe("right");
        // Clamped to 120 px below the bar, then moved down by the reach: never under the bar (y < lift).
        expect(tab?.y).toBe(120 + lift);
    });
    it("behaves as before when the layer does not reach above the bar", () => {
        expect(youTabPlacement({ x: 700, y: -200 }, width, height, 0)).toEqual({ side: "top", x: 700, y: 0 });
        expect(youTabPlacement({ x: 2000, y: 10 }, width, height, 0)).toEqual({ side: "right", x: 0, y: 120 });
        expect(youTabPlacement({ x: 700, y: height + 200 }, width, height, 0)?.side).toBe("bottom");
        expect(youTabPlacement({ x: -300, y: 400 }, width, height, 0)).toEqual({ side: "left", x: 0, y: 400 });
    });
});
