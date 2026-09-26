/**
 * Where the camera block sits over the map, so touches meant for it don't move the player.
 *
 * The cameras let taps through to the map around them on purpose. But the gaps between two tiles, and the edges
 * around them and the resize bar, are where fingers land when reaching for a tile or the bar. A touch starting there
 * started the joystick or a walk, and walking folds the cameras into one row (hiding the bar). The camera block now
 * owns its outline: the tiles, the gaps between them and a small margin around, down to the resize bar. The map
 * beside and below it takes taps as before.
 *
 * Only while the resize bar is shown (the cameras are laid out as a grid, not folded into one row).
 */

/** Margin around the tiles and the bar that still belongs to the camera block (CSS px). */
export const CAMERA_AREA_MARGIN_PX = 12;

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Whether a point is inside the outline of the tiles and the resize bar, with a margin. */
export function cameraAreaContains(
    x: number,
    y: number,
    tiles: Rect[],
    resizeBar: Rect | undefined,
    margin = CAMERA_AREA_MARGIN_PX
): boolean {
    if (!resizeBar || tiles.length === 0) return false;
    const outline = [...tiles, resizeBar].reduce((box, rect) => ({
        left: Math.min(box.left, rect.left),
        top: Math.min(box.top, rect.top),
        right: Math.max(box.right, rect.right),
        bottom: Math.max(box.bottom, rect.bottom),
    }));
    return (
        x >= outline.left - margin &&
        x <= outline.right + margin &&
        y >= outline.top - margin &&
        y <= outline.bottom + margin
    );
}

/** The camera block on the page right now (see CamerasContainer.svelte). */
export function isInCameraArea(x: number, y: number, doc: Document = document): boolean {
    const block = doc.querySelector("[data-camera-block]");
    if (!block) return false;
    const resizeBar = block.querySelector('[data-testid="resize-handle"]')?.getBoundingClientRect();
    const tiles = Array.from(block.querySelectorAll("#cameras-container .camera-box"))
        .map((tile) => tile.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
    return cameraAreaContains(x, y, tiles, resizeBar);
}

/** Where on the page a pointer or touch event happened, if it says. */
export function eventClientPoint(event: Event | undefined): { x: number; y: number } | undefined {
    if (!event) return undefined;
    if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
        const touch = event.changedTouches[0] ?? event.touches[0];
        return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    }
    if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
    return undefined;
}
