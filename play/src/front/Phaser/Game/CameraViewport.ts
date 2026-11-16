import type { ViewportInterface } from "../../Connection/ConnexionModels";

/**
 * The part of the map the camera shows, in world pixels, plus `margin` on each side. The server only sends the
 * Wokas inside it.
 *
 * When zoomed out past the screen's own size, the zoom goes through the camera (see WaScaleManager), and the camera
 * then shows more than `camera.width` pixels of map. Sending only `scrollX` to `scrollX + camera.width` told the
 * server about the middle of the screen alone, so Wokas near the edges of the screen disappeared.
 *
 * Same rectangle as Phaser's `camera.worldView`, computed from the current scroll and zoom so it is never a frame
 * behind (worldView is only refreshed when the camera renders).
 */
export function getCameraViewport(camera: Phaser.Cameras.Scene2D.Camera, margin = 0): ViewportInterface {
    const visibleWidth = camera.width / (camera.zoomX || 1);
    const visibleHeight = camera.height / (camera.zoomY || 1);
    const left = camera.scrollX + camera.width / 2 - visibleWidth / 2;
    const top = camera.scrollY + camera.height / 2 - visibleHeight / 2;
    return {
        left: Math.max(0, left - margin),
        top: Math.max(0, top - margin),
        right: left + visibleWidth + margin,
        bottom: top + visibleHeight + margin,
    };
}
