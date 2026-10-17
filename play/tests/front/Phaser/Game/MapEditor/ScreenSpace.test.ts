import { afterEach, describe, expect, it } from "vitest";
import { screenSpace } from "../../../../../src/front/Phaser/Game/MapEditor/ScreenSpace";

// A scene with just what screenSpace reads: the camera's view and the canvas box.
function fakeScene(canvas: { left: number; top: number; width: number }) {
    return {
        cameras: { main: { zoom: 1, worldView: { x: 0, y: 0, width: canvas.width } } },
        game: { canvas: { getBoundingClientRect: () => canvas } },
    } as unknown as Phaser.Scene;
}

function mountOverlay(box: { left: number; top: number }) {
    const overlay = document.createElement("div");
    overlay.id = "map-editor-container";
    overlay.getBoundingClientRect = () => ({ ...box, width: 0, height: 0 } as DOMRect);
    document.body.appendChild(overlay);
    return overlay;
}

describe("screenSpace lift (#1092)", () => {
    afterEach(() => {
        document.getElementById("map-editor-container")?.remove();
    });

    it("is how far the canvas reaches above the edit overlay when the overlay starts under the top bar", () => {
        // Desktop: the overlay starts at y 96, the canvas at y 0.
        mountOverlay({ left: 0, top: 96 });
        expect(screenSpace(fakeScene({ left: 0, top: 0, width: 1440 })).lift).toBe(96);
    });

    it("is 0 when the overlay and the canvas start together (a phone, the bar is at the bottom)", () => {
        mountOverlay({ left: 0, top: 0 });
        expect(screenSpace(fakeScene({ left: 0, top: 0, width: 390 })).lift).toBe(0);
    });

    it("is 0 without an overlay, and never negative", () => {
        expect(screenSpace(fakeScene({ left: 0, top: 10, width: 800 })).lift).toBe(0);
        mountOverlay({ left: 0, top: 0 });
        expect(screenSpace(fakeScene({ left: 0, top: 40, width: 800 })).lift).toBe(0);
    });

    it("keeps placing things relative to the overlay, so an area at the map top lands above the overlay's top", () => {
        mountOverlay({ left: 0, top: 96 });
        const rect = screenSpace(fakeScene({ left: 0, top: 0, width: 1440 })).rect(0, 10, 100, 100);
        expect(rect.y).toBe(-86);
    });
});
