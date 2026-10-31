/** How long we wait to learn a sound's length before giving up on it */
const SOUND_LENGTH_TIMEOUT_MS = 5000;

/**
 * How long a sound lasts, in seconds, read from its metadata only (#1627). 0 when it can't be told: the file can't be
 * read, its metadata is too slow, or it has no end (a live stream).
 */
export function soundLength(url: string): Promise<number> {
    return new Promise((resolve) => {
        const audio = new Audio();
        const done = (seconds: number) => {
            clearTimeout(timer);
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.removeAttribute("src");
            resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
        };
        const timer = setTimeout(() => done(0), SOUND_LENGTH_TIMEOUT_MS);
        audio.preload = "metadata";
        audio.onloadedmetadata = () => done(audio.duration);
        audio.onerror = () => done(0);
        audio.src = url;
    });
}
