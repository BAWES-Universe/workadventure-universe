import { readable } from "svelte/store";

/**
 * How far down from the top of the game the strip of camera tiles reaches, in CSS pixels (0 when no tiles show, or
 * when they sit in a column at the side). The room editor and "Look around the map" start their top controls below
 * it, so a call's tiles stay visible while you edit or look around, as they did beside the old editor's sidebar.
 * Measured while someone listens: the strip changes size as people come and go.
 * The silent-zone notice under the microphone and camera counts too, so the top controls do not stack on it.
 */
export const cameraTilesClearStore = readable(0, (set) => {
    let last = -1;
    const measure = () => {
        const strip = document.getElementById("cameras-container");
        const game = document.getElementById("main-layout-main");
        let clear = 0;
        if (strip && game && strip.querySelector(".camera-box")) {
            const tiles = strip.getBoundingClientRect();
            const top = game.getBoundingClientRect().top;
            // A row along the top (wider than tall, starting near the top), not a column down one side.
            if (tiles.width > tiles.height && tiles.height > 0 && tiles.top < top + 80) {
                clear = Math.max(0, Math.round(tiles.bottom - top));
            }
        }
        const notice = document.querySelector(".silent-block");
        if (notice && game) {
            const box = notice.getBoundingClientRect();
            const top = game.getBoundingClientRect().top;
            // Only the notice at the top of the screen (computers); on phones it sits above the bar at the bottom.
            if (box.height > 0 && box.top < top + 160) {
                clear = Math.max(clear, Math.round(box.bottom - top));
            }
        }
        if (clear !== last) {
            last = clear;
            set(clear);
        }
    };
    measure();
    const timer = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
        clearInterval(timer);
        window.removeEventListener("resize", measure);
    };
});
