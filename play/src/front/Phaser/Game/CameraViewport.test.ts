import type * as PhaserTypes from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getCameraViewport } from "./CameraViewport";

// A real Phaser camera, so the expected rectangle is Phaser's own worldView.
beforeAll(async () => {
    const { default: Phaser } = await vi.importActual<{ default: typeof PhaserTypes }>("phaser/dist/phaser.js");
    vi.stubGlobal("Phaser", Phaser);
});

function camera(zoom: number, scroll: { x: number; y: number }) {
    const cam = new Phaser.Cameras.Scene2D.Camera(0, 0, 554, 994);
    cam.setZoom(zoom);
    cam.setScroll(scroll.x, scroll.y);
    // The game does this once per frame; without a renderer, do it by hand so worldView is up to date.
    (cam as unknown as { preRender(): void }).preRender();
    return cam;
}

describe("getCameraViewport", () => {
    it.each([0.4, 0.75, 1, 2])("covers exactly what the camera shows at zoom %s", (zoom) => {
        const cam = camera(zoom, { x: 1200, y: 900 });
        const viewport = getCameraViewport(cam);
        const view = cam.worldView;
        // worldView rounds its corner and size to whole pixels.
        expect(Math.abs(viewport.left - view.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(viewport.top - view.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(viewport.right - view.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(viewport.bottom - view.bottom)).toBeLessThanOrEqual(1);
    });

    it("reaches the screen edges when zoomed out, so Wokas there stay on screen", () => {
        const cam = camera(0.5, { x: 1000, y: 1000 });
        const viewport = getCameraViewport(cam);
        // The camera shows twice its width of map, centred on the same point as at zoom 1.
        expect(viewport.left).toBe(1000 + 554 / 2 - 554);
        expect(viewport.right).toBe(1000 + 554 / 2 + 554);
        expect(viewport.top).toBe(1000 + 994 / 2 - 994);
        expect(viewport.bottom).toBe(1000 + 994 / 2 + 994);
    });

    it("adds the margin on every side and never goes left of or above the map", () => {
        const cam = camera(1, { x: 100, y: 50 });
        expect(getCameraViewport(cam, 300)).toEqual({
            left: 0,
            top: 0,
            right: 100 + 554 + 300,
            bottom: 50 + 994 + 300,
        });
    });
});
