/**
 * How the game camera maps to the CSS pixels of the edit mode overlay. The camera's zoom alone is not the scale: the
 * canvas itself is drawn at a different size from its CSS box (the scale manager picks the game resolution, and a
 * phone draws at a fraction of its CSS pixels), so a point converted with the zoom only lands in the wrong place.
 */
export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScreenSpace {
    /** CSS pixels per world unit. */
    scale: number;
    toScreen(worldX: number, worldY: number): { x: number; y: number };
    rect(worldX: number, worldY: number, worldWidth: number, worldHeight: number): ScreenRect;
}

const OVERLAY_ID = "map-editor-container";

/** The mapping right now, relative to the edit mode overlay (or to the canvas when the overlay is not mounted). */
export function screenSpace(scene: Phaser.Scene): ScreenSpace {
    const camera = scene.cameras.main;
    const view = camera.worldView;
    const canvas = scene.game.canvas.getBoundingClientRect();
    const overlay = document.getElementById(OVERLAY_ID)?.getBoundingClientRect();
    const scale = view.width > 0 && canvas.width > 0 ? canvas.width / view.width : camera.zoom;
    const offsetX = canvas.left - (overlay?.left ?? canvas.left);
    const offsetY = canvas.top - (overlay?.top ?? canvas.top);
    const toScreen = (worldX: number, worldY: number) => ({
        x: (worldX - view.x) * scale + offsetX,
        y: (worldY - view.y) * scale + offsetY,
    });
    return {
        scale,
        toScreen,
        rect: (worldX, worldY, worldWidth, worldHeight) => {
            const { x, y } = toScreen(worldX, worldY);
            return { x, y, width: worldWidth * scale, height: worldHeight * scale };
        },
    };
}

/**
 * How many CSS pixels the bar covers at the top of the canvas (the bar floats over the map on a computer; on a phone
 * it sits under it and covers nothing at the top).
 */
export function barCoverAtTopOfCanvas(canvas: HTMLCanvasElement): number {
    const bar = document.querySelector(".bp-menu");
    if (!bar) return 0;
    const canvasRect = canvas.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    if (barRect.height <= 0 || barRect.top > canvasRect.top + canvasRect.height / 2) return 0;
    return Math.max(0, barRect.bottom - canvasRect.top);
}

/**
 * The camera centre (world y) that keeps the map's top edge out from under a bar covering the top `coverCss` CSS
 * pixels of a `viewHeightCss` tall canvas, drawn at `scale` CSS pixels per world unit. The map's top edge is world
 * y 0. Only a top edge that would be on screen moves down: looking at the middle of a tall map, the bar covers the
 * map like anything else, and the centre stays where it is.
 */
export function centerYClearOfTopCover(
    centerY: number,
    viewHeightCss: number,
    scale: number,
    coverCss: number
): number {
    if (coverCss <= 0 || scale <= 0 || !Number.isFinite(scale)) return centerY;
    const mapTopOnScreen = viewHeightCss / 2 - centerY * scale;
    if (mapTopOnScreen < -1 || mapTopOnScreen >= coverCss) return centerY;
    return centerY - (coverCss - mapTopOnScreen) / scale;
}
