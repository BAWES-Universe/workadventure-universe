import { describe, it, expect } from "vitest";
import {
    clamp,
    doubleTapScaleFor,
    maxScaleFor,
    panBounds,
    realSizeScale,
    rubberBand,
    settleView,
    shouldCloseByDrag,
    zoomAround,
} from "../../../src/front/Chat/Components/Room/Message/lightboxGestures";

const stage = { width: 390, height: 844 };

describe("lightboxGestures", () => {
    describe("panBounds", () => {
        it("gives no room at normal size when the picture fits the viewer", () => {
            expect(panBounds({ width: 358, height: 300 }, stage, 1)).toEqual({ x: 0, y: 0 });
        });

        it("keeps a thin strip centred up and down but lets it slide sideways", () => {
            // 358 x 9 on screen, zoomed to 5.4x: 1933 wide, 48 tall
            const b = panBounds({ width: 358, height: 9 }, stage, 5.4);
            expect(b.x).toBeCloseTo((358 * 5.4 - 390) / 2);
            expect(b.y).toBe(0);
        });

        it("lets a zoomed picture move until its edge meets the screen edge", () => {
            const b = panBounds({ width: 358, height: 477 }, stage, 3);
            expect(b.x).toBeCloseTo((358 * 3 - 390) / 2);
            expect(b.y).toBeCloseTo((477 * 3 - 844) / 2);
        });
    });

    describe("rubberBand", () => {
        it("leaves values inside the limit alone", () => {
            expect(rubberBand(40, 50)).toBe(40);
            expect(rubberBand(-50, 50)).toBe(-50);
        });

        it("shows only a part of a pull past the limit, on both sides", () => {
            expect(rubberBand(100, 50)).toBeCloseTo(50 + 50 * 0.35);
            expect(rubberBand(-100, 50)).toBeCloseTo(-50 - 50 * 0.35);
        });
    });

    describe("zoom limits", () => {
        it("keeps 5x for a small picture and caps a huge one at 12x", () => {
            expect(maxScaleFor(1.2)).toBe(5);
            expect(maxScaleFor(3.5)).toBe(7);
            expect(maxScaleFor(8.4)).toBe(12);
        });

        it("measures the real size as picture pixels per screen point", () => {
            expect(realSizeScale({ width: 358, height: 9 }, { width: 1920, height: 48 })).toBeCloseTo(5.36, 1);
            expect(realSizeScale({ width: 0, height: 0 }, { width: 1920, height: 48 })).toBe(1);
            expect(realSizeScale({ width: 358, height: 9 }, { width: 0, height: 0 })).toBe(1);
        });

        it("zooms a very wide picture to its real size on double tap", () => {
            const natural = { width: 1920, height: 48 };
            const real = 1920 / 358;
            expect(doubleTapScaleFor(natural, real, maxScaleFor(real))).toBeCloseTo(real);
        });

        it("zooms a very tall picture to its real size on double tap", () => {
            const natural = { width: 600, height: 4000 };
            const real = 600 / 200;
            expect(doubleTapScaleFor(natural, real, maxScaleFor(real))).toBeCloseTo(3);
        });

        it("keeps 2.5x for an ordinary picture, even a huge one", () => {
            const natural = { width: 3024, height: 4032 };
            const real = 3024 / 292;
            expect(doubleTapScaleFor(natural, real, maxScaleFor(real))).toBe(2.5);
        });

        it("never goes below 2.5x or above the limit for a wide picture", () => {
            expect(doubleTapScaleFor({ width: 600, height: 150 }, 1.5, 5)).toBe(2.5);
            expect(doubleTapScaleFor({ width: 6000, height: 100 }, 20, 12)).toBe(12);
        });
    });

    describe("zoomAround", () => {
        it("keeps the spot under the fingers where it was", () => {
            const point = { x: 300, y: 600 };
            const before = { scale: 1, tx: 0, ty: 0 };
            const after = zoomAround(before, point, 3, stage);
            // The picture spot under the point, in picture coordinates from the centre
            const spotBefore = {
                x: (point.x - 195 - before.tx) / before.scale,
                y: (point.y - 422 - before.ty) / before.scale,
            };
            const spotAfter = {
                x: (point.x - 195 - after.tx) / after.scale,
                y: (point.y - 422 - after.ty) / after.scale,
            };
            expect(spotAfter.x).toBeCloseTo(spotBefore.x);
            expect(spotAfter.y).toBeCloseTo(spotBefore.y);
        });

        it("does not move the picture when zooming around the centre", () => {
            const after = zoomAround({ scale: 1, tx: 0, ty: 0 }, { x: 195, y: 422 }, 4, stage);
            expect(after.tx).toBeCloseTo(0);
            expect(after.ty).toBeCloseTo(0);
        });
    });

    describe("settleView", () => {
        const fit = { width: 358, height: 477 };

        it("centres the picture again at normal size, whatever the offset was", () => {
            expect(settleView({ scale: 1, tx: -300, ty: 80 }, fit, stage, 5)).toEqual({ scale: 1, tx: 0, ty: 0 });
            expect(settleView({ scale: 0.8, tx: 40, ty: 40 }, fit, stage, 5)).toEqual({ scale: 1, tx: 0, ty: 0 });
        });

        it("puts the picture's edge back on the screen edge after a pull past it", () => {
            const bounds = panBounds(fit, stage, 3);
            const view = settleView({ scale: 3, tx: -900, ty: 900 }, fit, stage, 5);
            expect(view.tx).toBeCloseTo(-bounds.x);
            expect(view.ty).toBeCloseTo(bounds.y);
        });

        it("caps the zoom at the limit", () => {
            expect(settleView({ scale: 7, tx: 0, ty: 0 }, fit, stage, 5).scale).toBe(5);
        });

        it("centres a thin strip up and down however it was pushed", () => {
            const strip = { width: 358, height: 9 };
            expect(settleView({ scale: 5, tx: 0, ty: 300 }, strip, stage, 10).ty).toBe(0);
        });
    });

    describe("shouldCloseByDrag", () => {
        it("closes after about a quarter of the screen", () => {
            expect(shouldCloseByDrag(220, 0, 844)).toBe(true);
            expect(shouldCloseByDrag(-220, 0, 844)).toBe(true);
        });

        it("springs back after a short slow drag", () => {
            expect(shouldCloseByDrag(100, 0.1, 844)).toBe(false);
        });

        it("closes on a quick flick the way it moved, after a real move", () => {
            expect(shouldCloseByDrag(80, 0.9, 844)).toBe(true);
            expect(shouldCloseByDrag(-80, -0.9, 844)).toBe(true);
        });

        it("ignores a flick the other way, or a flick after a tiny move", () => {
            expect(shouldCloseByDrag(80, -0.9, 844)).toBe(false);
            expect(shouldCloseByDrag(20, 1.5, 844)).toBe(false);
        });
    });

    it("clamp limits both sides", () => {
        expect(clamp(30, 10)).toBe(10);
        expect(clamp(-30, 10)).toBe(-10);
        expect(clamp(5, 10)).toBe(5);
    });
});
