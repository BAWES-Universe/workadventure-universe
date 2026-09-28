import { describe, expect, it } from "vitest";
import { compassDirection, edgeArrowPlacement, stepsBetween, targetMark, worldToSectionPoint } from "../QuestGeometry";

describe("worldToSectionPoint", () => {
    const canvas = { left: 0, top: 0, width: 800, height: 600 };
    const game = { width: 800, height: 600 };

    it("maps the world through the camera's view, zoom and the canvas' display scale", () => {
        const camera = { worldViewX: 100, worldViewY: 50, zoom: 1 };
        expect(worldToSectionPoint({ x: 150, y: 80 }, camera, canvas, game, { left: 0, top: 0 })).toEqual({
            x: 50,
            y: 30,
        });
        // Zoomed in twice, the canvas drawn at half size (a high-density screen).
        const zoomed = { worldViewX: 100, worldViewY: 50, zoom: 2 };
        const half = { left: 10, top: 20, width: 400, height: 300 };
        expect(worldToSectionPoint({ x: 150, y: 80 }, zoomed, half, game, { left: 0, top: 0 })).toEqual({
            x: 10 + 50 * 2 * 0.5,
            y: 20 + 30 * 2 * 0.5,
        });
    });

    it("is relative to the section (shifted right of the chat sidebar on desktop)", () => {
        const camera = { worldViewX: 0, worldViewY: 0, zoom: 1 };
        expect(worldToSectionPoint({ x: 400, y: 100 }, camera, canvas, game, { left: 335, top: 0 })).toEqual({
            x: 65,
            y: 100,
        });
    });
});

describe("edgeArrowPlacement", () => {
    const view = { left: 0, top: 0, width: 200, height: 100 };

    it("shows nothing while the target is in view", () => {
        expect(edgeArrowPlacement({ x: 50, y: 50 }, view).visible).toBe(false);
    });

    it("sits on the edge between the view's centre and the target, pointing at it", () => {
        const right = edgeArrowPlacement({ x: 500, y: 50 }, view);
        expect(right).toMatchObject({ visible: true, x: 200, y: 50 });
        expect(right.angle).toBeCloseTo(0);

        const above = edgeArrowPlacement({ x: 100, y: -300 }, view);
        expect(above).toMatchObject({ visible: true, x: 100, y: 0 });
        expect(above.angle).toBeCloseTo(-Math.PI / 2);

        const corner = edgeArrowPlacement({ x: -1000, y: 1000 }, view);
        expect(corner.visible).toBe(true);
        expect(corner.y).toBeCloseTo(100);
        expect(corner.x).toBeGreaterThanOrEqual(0);
    });
});

describe("targetMark", () => {
    const view = { left: 0, top: 0, width: 200, height: 100 };

    it("hovers a down arrow above a target in view, and switches to the edge arrow once it leaves", () => {
        const above = { x: 50, y: 20 };
        expect(targetMark({ x: 50, y: 60 }, above, view)).toEqual({ kind: "above", x: 50, y: 20 });
        const off = targetMark({ x: 500, y: 60 }, { x: 500, y: 20 }, view);
        expect(off).toMatchObject({ kind: "edge", x: 200 });
        // The arrow at the edge points at the feet, not at the point above them.
        if (off.kind === "edge") expect(off.angle).toBeCloseTo(Math.atan2(10, 400));
    });

    it("keeps the down arrow inside the view while the feet are in it, even if the point above them is not", () => {
        // Standing right under the cameras: the arrow is drawn at the top of the visible map, not over the videos.
        expect(targetMark({ x: 50, y: 5 }, { x: 50, y: -40 }, view, 28)).toEqual({ kind: "above", x: 50, y: 28 });
        // Beside the dock: kept in from the side.
        expect(targetMark({ x: 195, y: 60 }, { x: 195, y: 20 }, view, 28)).toEqual({ kind: "above", x: 186, y: 28 });
        expect(targetMark({ x: 50, y: 60 }, { x: 50, y: 40 }, view, 28)).toEqual({ kind: "above", x: 50, y: 40 });
    });
});

describe("compassDirection and stepsBetween", () => {
    it("names the eight directions with north up the screen", () => {
        const here = { x: 0, y: 0 };
        expect(compassDirection(here, { x: 0, y: -10 })).toBe("north");
        expect(compassDirection(here, { x: 10, y: -10 })).toBe("northEast");
        expect(compassDirection(here, { x: 10, y: 0 })).toBe("east");
        expect(compassDirection(here, { x: 10, y: 10 })).toBe("southEast");
        expect(compassDirection(here, { x: 0, y: 10 })).toBe("south");
        expect(compassDirection(here, { x: -10, y: 10 })).toBe("southWest");
        expect(compassDirection(here, { x: -10, y: 0 })).toBe("west");
        expect(compassDirection(here, { x: -10, y: -10 })).toBe("northWest");
    });

    it("counts tiles, at least one", () => {
        expect(stepsBetween({ x: 0, y: 0 }, { x: 320, y: 0 })).toBe(10);
        expect(stepsBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(1);
    });
});
