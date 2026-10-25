import { afterEach, describe, expect, it } from "vitest";
import { measureBiggestAvailableArea } from "../BiggestAvailableAreaStore";

function rect(x: number, y: number, width: number, height: number): DOMRect {
    return {
        x,
        y,
        width,
        height,
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
    } as DOMRect;
}

describe("measureBiggestAvailableArea", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function setUp(gameRect: DOMRect, blockerRect: DOMRect): void {
        document.body.innerHTML = '<div id="game"><canvas></canvas></div><div class="screen-blocker"></div>';
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        Object.defineProperty(canvas, "offsetWidth", { value: gameRect.width });
        Object.defineProperty(canvas, "offsetHeight", { value: gameRect.height });
        canvas.getBoundingClientRect = () => gameRect;
        (document.querySelector(".screen-blocker") as HTMLElement).getBoundingClientRect = () => blockerRect;
    }

    it("measures a card against the game, not against the window", () => {
        // A 40px title bar sits above the game; the card covers the top 200px of the game.
        setUp(rect(0, 40, 800, 600), rect(0, 40, 800, 200));
        const area = measureBiggestAvailableArea();
        expect(area.yStart).toBe(200);
        expect(area.yEnd).toBe(600);
    });
});
