/**
 * Waits for the game to know where the person stands, then says so once (game #2005). The player's sprite is made a moment
 * after the room loads; a Brick put on the map before that has no place beside its person to start from. After `maxMs` it
 * goes ahead without a place, as it did before. Returns a function that stops the wait.
 */
export function waitForPlace(
    getPlace: () => { x: number; y: number } | undefined,
    done: (place: { x: number; y: number } | undefined) => void,
    options: { startAfterMs?: number; everyMs?: number; maxMs?: number } = {}
): () => void {
    const { startAfterMs = 1500, everyMs = 300, maxMs = 15000 } = options;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const look = (): void => {
        if (stopped) return;
        const place = getPlace();
        if (place || Date.now() - startedAt >= maxMs) {
            stopped = true;
            done(place);
            return;
        }
        timer = setTimeout(look, everyMs);
    };
    timer = setTimeout(look, startAfterMs);
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
