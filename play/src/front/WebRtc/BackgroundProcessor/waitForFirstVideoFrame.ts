/**
 * Resolves once the video track of `stream` shows its first frame, or after `timeoutMs` (it never rejects).
 *
 * A transformer hands back its output stream before the model has produced anything, so swapping it in at once
 * shows a black camera to everyone for a few seconds. Callers keep the previous stream until this resolves.
 */
export function waitForFirstVideoFrame(stream: MediaStream, signal: AbortSignal, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;

        let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;
        const done = () => {
            clearTimeout(timeoutId);
            signal.removeEventListener("abort", done);
            video.removeEventListener("loadeddata", onLoadedData);
            video.pause();
            video.srcObject = null;
            resolve();
        };
        const onLoadedData = () => {
            if (video.videoWidth > 0) {
                done();
            }
        };

        if (signal.aborted) {
            resolve();
            return;
        }
        signal.addEventListener("abort", done);
        timeoutId = setTimeout(done, timeoutMs);
        video.addEventListener("loadeddata", onLoadedData);
        video.srcObject = stream;
        video.play().catch(() => {
            // Autoplay can be refused before any user gesture; the timeout still resolves.
        });
    });
}
