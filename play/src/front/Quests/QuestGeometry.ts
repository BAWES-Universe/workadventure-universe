/**
 * Screen geometry shared by the stamp fly-in, the edge arrow and the Show me description. Pure: the callers read the
 * camera and the page.
 */
export interface Point {
    x: number;
    y: number;
}

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The part of the camera the callers need: the world rectangle in view and its zoom. */
export interface CameraView {
    worldViewX: number;
    worldViewY: number;
    zoom: number;
}

/**
 * Where a world point is drawn, in CSS pixels relative to `section`. Phaser zooms around the view's centre, so the
 * offset is taken from the world rectangle in view (worldView), not from the scroll position.
 */
export function worldToSectionPoint(
    world: Point,
    camera: CameraView,
    canvas: Box,
    gameSize: { width: number; height: number },
    section: Pick<Box, "left" | "top">
): Point {
    const scaleX = gameSize.width > 0 ? canvas.width / gameSize.width : 1;
    const scaleY = gameSize.height > 0 ? canvas.height / gameSize.height : 1;
    return {
        x: canvas.left + (world.x - camera.worldViewX) * camera.zoom * scaleX - section.left,
        y: canvas.top + (world.y - camera.worldViewY) * camera.zoom * scaleY - section.top,
    };
}

export interface EdgeArrow {
    /** False when the target is inside the view: no arrow. */
    visible: boolean;
    x: number;
    y: number;
    /** Radians, 0 pointing right, clockwise (screen y grows downwards). */
    angle: number;
}

/**
 * Where to put an arrow pointing at `target` from the edge of `view` (both in the same coordinates). The arrow sits
 * where the line from the view's centre to the target leaves the view. Geometry only: it is never mirrored for RTL.
 */
export function edgeArrowPlacement(target: Point, view: Box): EdgeArrow {
    const right = view.left + view.width;
    const bottom = view.top + view.height;
    const inside = target.x >= view.left && target.x <= right && target.y >= view.top && target.y <= bottom;
    const centre = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const dx = target.x - centre.x;
    const dy = target.y - centre.y;
    const angle = Math.atan2(dy, dx);
    if (inside || (dx === 0 && dy === 0) || view.width <= 0 || view.height <= 0) {
        return { visible: false, x: centre.x, y: centre.y, angle };
    }
    // The smallest scale that reaches a vertical or a horizontal edge.
    const scaleX = dx !== 0 ? view.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const scaleY = dy !== 0 ? view.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const scale = Math.min(scaleX, scaleY, 1);
    return { visible: true, x: centre.x + dx * scale, y: centre.y + dy * scale, angle };
}

export type CompassDirection =
    | "north"
    | "northEast"
    | "east"
    | "southEast"
    | "south"
    | "southWest"
    | "west"
    | "northWest";

const COMPASS: readonly CompassDirection[] = [
    "east",
    "southEast",
    "south",
    "southWest",
    "west",
    "northWest",
    "north",
    "northEast",
];

/** The 8-way direction from `from` to `to` on the map (north is up the screen). */
export function compassDirection(from: Point, to: Point): CompassDirection {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const index = Math.round(angle / (Math.PI / 4));
    return COMPASS[((index % 8) + 8) % 8];
}

/** The map's tile size: one tile is one step. */
export const QUEST_TILE_PX = 32;

export function stepsBetween(from: Point, to: Point): number {
    return Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / QUEST_TILE_PX));
}
