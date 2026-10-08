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
