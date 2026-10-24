import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForPinch } from "../pinchGesture";

/** Fingers at `points` on the screen; inside a page drawn `frameScale` times as big, the page's own coordinates are smaller. */
function touch(type: string, points: Array<[number, number]>, frameScale = 1): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", {
        value: points.map(([x, y]) => ({ screenX: x, screenY: y, clientX: x / frameScale, clientY: y / frameScale })),
    });
    return event;
}

describe("listenForPinch", () => {
    let stop: (() => void) | undefined;
    const element = document.createElement("div");

    afterEach(() => {
        stop?.();
        stop = undefined;
    });

    it("tells how much two fingers moved apart or together, and where they are", () => {
        const onPinch = vi.fn();
        stop = listenForPinch(element, onPinch);

        element.dispatchEvent(
            touch("touchstart", [
                [100, 200],
                [200, 200],
            ])
        );
        const move = touch("touchmove", [
            [50, 200],
            [250, 200],
        ]);
        element.dispatchEvent(move);

        expect(onPinch).toHaveBeenCalledWith(2, { x: 150, y: 200 });
        // The browser must not take the gesture for its own page zoom or scroll.
        expect(move.defaultPrevented).toBe(true);

        // The next step is measured from the last one.
        element.dispatchEvent(
            touch("touchmove", [
                [75, 200],
                [225, 200],
            ])
        );
        expect(onPinch).toHaveBeenLastCalledWith(0.75, { x: 150, y: 200 });
    });

    it("reads the distance on the screen, so a page drawn bigger or smaller does not swing the factor", () => {
        const onPinch = vi.fn();
        stop = listenForPinch(element, onPinch);

        element.dispatchEvent(
            touch(
                "touchstart",
                [
                    [100, 200],
                    [200, 200],
                ],
                2
            )
        );
        // The page was zoomed by the last step: the same fingers read at another scale in its own coordinates.
        element.dispatchEvent(
            touch(
                "touchmove",
                [
                    [75, 200],
                    [225, 200],
                ],
                0.5
            )
        );

        expect(onPinch).toHaveBeenCalledWith(1.5, expect.anything());
    });

    it("leaves one finger alone: it scrolls", () => {
        const onPinch = vi.fn();
        stop = listenForPinch(element, onPinch);

        element.dispatchEvent(touch("touchstart", [[100, 200]]));
        const move = touch("touchmove", [[100, 300]]);
        element.dispatchEvent(move);

        expect(onPinch).not.toHaveBeenCalled();
        expect(move.defaultPrevented).toBe(false);
    });

    it("needs both fingers down together: a second finger that arrives after a move starts a new pinch", () => {
        const onPinch = vi.fn();
        stop = listenForPinch(element, onPinch);

        element.dispatchEvent(touch("touchstart", [[100, 200]]));
        element.dispatchEvent(
            touch("touchstart", [
                [100, 200],
                [200, 200],
            ])
        );
        element.dispatchEvent(
            touch("touchmove", [
                [100, 200],
                [300, 200],
            ])
        );

        expect(onPinch).toHaveBeenCalledWith(2, { x: 200, y: 200 });
    });

    it("stops when a finger lifts, and when told to stop listening", () => {
        const onPinch = vi.fn();
        stop = listenForPinch(element, onPinch);
        element.dispatchEvent(
            touch("touchstart", [
                [100, 200],
                [200, 200],
            ])
        );
        element.dispatchEvent(touch("touchend", [[100, 200]]));
        element.dispatchEvent(
            touch("touchmove", [
                [100, 200],
                [300, 200],
            ])
        );
        expect(onPinch).not.toHaveBeenCalled();

        element.dispatchEvent(
            touch("touchstart", [
                [100, 200],
                [200, 200],
            ])
        );
        stop();
        stop = undefined;
        element.dispatchEvent(
            touch("touchmove", [
                [100, 200],
                [300, 200],
            ])
        );
        expect(onPinch).not.toHaveBeenCalled();
    });
});
