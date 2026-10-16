// Where the Look around label layer sits against the game canvas, and where the "You" tab goes.
// The layer used to start at the bottom of the top bar and clip everything above it (#998). It now reaches up to the
// top of the game canvas, so frames, names and tags draw behind the bar like the map does. Everything that decides
// what is "on screen" still counts from the bar's bottom edge: that is the part of the map you can see clearly.

/** How far the game canvas reaches above the layer's parent (0 when they start at the same place, as on a phone). */
export function labelLayerLift(parentTop: number, canvasTop: number): number {
    return Math.max(0, Math.round(parentTop - canvasTop));
}

export type YouTabSide = "left" | "right" | "top" | "bottom";

export interface YouTabPlacement {
    side: YouTabSide;
    x: number;
    y: number;
}

const EDGE_MARGIN = 24;

/**
 * The "You" tab, or undefined while you are on screen. `centre` is you in the layer's own pixels, `lift` how far the
 * layer reaches above the part below the bar, `visibleHeight` the height of the part below the bar that is not
 * covered by a sheet. Returned `y` is for a left or right tab and counts from the top of the layer (it is already
 * below the bar); `x` is for a top or bottom tab.
 */
export function youTabPlacement(
    centre: { x: number; y: number },
    width: number,
    visibleHeight: number,
    lift: number
): YouTabPlacement | undefined {
    const y = centre.y - lift;
    const offScreen =
        centre.x < -EDGE_MARGIN ||
        centre.x > width + EDGE_MARGIN ||
        y < -EDGE_MARGIN ||
        y > visibleHeight + EDGE_MARGIN;
    if (!offScreen) return undefined;
    const clampedX = Math.min(Math.max(centre.x, 80), width - 80);
    const clampedY = Math.min(Math.max(y, 120), visibleHeight - 160);
    // Off-screen in two directions at once (far above, a little to the left): the tab goes on the edge you are
    // furthest beyond, which is the direction the tab's arrow should point.
    const beyond = {
        left: -centre.x,
        right: centre.x - width,
        top: -y,
        bottom: y - visibleHeight,
    };
    const side = (Object.keys(beyond) as YouTabSide[]).reduce((best, each) =>
        beyond[each] > beyond[best] ? each : best
    );
    return side === "left" || side === "right" ? { side, x: 0, y: clampedY + lift } : { side, x: clampedX, y: 0 };
}
