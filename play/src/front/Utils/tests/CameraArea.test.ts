import { afterEach, describe, expect, it } from "vitest";
import { CAMERA_AREA_MARGIN_PX, cameraAreaContains, eventClientPoint, isInCameraArea } from "../CameraArea";

// Two tiles stacked in the middle of a 400px-wide screen, the resize bar under them (as on a phone in a bubble).
const you = { left: 100, top: 20, right: 300, bottom: 130 };
const mona = { left: 100, top: 150, right: 300, bottom: 260 };
const bar = { left: 120, top: 272, right: 280, bottom: 276 };

describe("cameraAreaContains", () => {
    it("owns the gap between two tiles", () => {
        expect(cameraAreaContains(200, 140, [you, mona], bar)).toBe(true);
    });

    it("owns the space between the tiles and the resize bar, and around the bar", () => {
        expect(cameraAreaContains(200, 266, [you, mona], bar)).toBe(true);
        expect(cameraAreaContains(290, 280, [you, mona], bar)).toBe(true);
    });

    it("leaves the map beside and below the cameras alone", () => {
        expect(cameraAreaContains(40, 140, [you, mona], bar)).toBe(false);
        expect(cameraAreaContains(360, 200, [you, mona], bar)).toBe(false);
        expect(cameraAreaContains(200, 276 + CAMERA_AREA_MARGIN_PX + 1, [you, mona], bar)).toBe(false);
    });

    it("owns nothing while the cameras are folded into one row (no resize bar)", () => {
        expect(cameraAreaContains(200, 140, [you, mona], undefined)).toBe(false);
    });
});

describe("isInCameraArea on the page", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function place(element: Element, rect: { left: number; top: number; right: number; bottom: number }) {
        element.getBoundingClientRect = () =>
            ({
                ...rect,
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                toJSON: () => rect,
            } as DOMRect);
    }

    function render(withBar: boolean) {
        document.body.innerHTML = `
            <div data-camera-block>
                <div id="cameras-container">
                    <div class="camera-box" id="you"></div>
                    <div class="camera-box" id="mona"></div>
                </div>
                ${withBar ? '<div data-testid="resize-handle"></div>' : ""}
            </div>`;
        place(document.getElementById("you")!, you);
        place(document.getElementById("mona")!, mona);
        const handle = document.querySelector('[data-testid="resize-handle"]');
        if (handle) place(handle, bar);
    }

    it("finds the camera block and its outline", () => {
        render(true);
        expect(isInCameraArea(200, 140)).toBe(true);
        expect(isInCameraArea(40, 140)).toBe(false);
    });

    it("is off without the resize bar, and without cameras at all", () => {
        render(false);
        expect(isInCameraArea(200, 140)).toBe(false);
        document.body.innerHTML = "";
        expect(isInCameraArea(200, 140)).toBe(false);
    });
});

describe("eventClientPoint", () => {
    it("reads a touch and a mouse position", () => {
        const touch = new TouchEvent("touchstart", {
            touches: [{ clientX: 12, clientY: 34 } as Touch],
            changedTouches: [{ clientX: 12, clientY: 34 } as Touch],
        });
        expect(eventClientPoint(touch)).toEqual({ x: 12, y: 34 });
        expect(eventClientPoint(new MouseEvent("mousedown", { clientX: 5, clientY: 6 }))).toEqual({ x: 5, y: 6 });
        expect(eventClientPoint(undefined)).toBeUndefined();
    });
});
