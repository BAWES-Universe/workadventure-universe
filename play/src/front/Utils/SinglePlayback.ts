/**
 * One thing plays at a time: starting a voice note, an audio file, a video or a music player pauses whatever
 * else was playing, so nobody has to pause one to hear another.
 *
 * Opt in with `use:singlePlayback` on an `<audio>` or `<video>`. Only opted-in elements are touched: the game's own
 * sound, calls and broadcasts are never paused by it.
 */
let playing: HTMLMediaElement | undefined;

export function singlePlayback(element: HTMLMediaElement): { destroy: () => void } {
    const started = () => {
        if (playing && playing !== element) playing.pause();
        playing = element;
    };
    const stopped = () => {
        if (playing === element) playing = undefined;
    };
    element.addEventListener("play", started);
    element.addEventListener("pause", stopped);
    element.addEventListener("ended", stopped);
    return {
        destroy() {
            element.removeEventListener("play", started);
            element.removeEventListener("pause", stopped);
            element.removeEventListener("ended", stopped);
            // An element that goes away must not keep playing, nor hold the turn.
            if (playing === element) {
                element.pause();
                playing = undefined;
            }
        },
    };
}
