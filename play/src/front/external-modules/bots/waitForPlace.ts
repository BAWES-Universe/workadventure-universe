/** How often the game is asked where the person stands, and how many times before the wait ends (15 s in all). */
export const PLACE_LOOK_EVERY_MS = 500;
export const PLACE_LOOK_TRIES = 30;
/** The player's sprite is made a moment after the room loads; the first look is after this. */
export const PLACE_FIRST_LOOK_MS = 1500;

/**
 * Waits for the game to know where the person stands, then says so once (game #2005). A Brick put on the map before that
 * has no place beside its person to start from, and the bot server does not put it on the map without one. When the tries
 * run out nothing is said: the Brick is put on the map when the person taps Bring along, which sends its own place, or
 * when they enter the next room. Returns a function that stops the wait.
 */
export function waitForPlace(
    getPlace: () => { x: number; y: number } | undefined,
    done: (place: { x: number; y: number }) => void,
    options: { firstLookMs?: number; everyMs?: number; tries?: number } = {}
): () => void {
    const { firstLookMs = PLACE_FIRST_LOOK_MS, everyMs = PLACE_LOOK_EVERY_MS, tries = PLACE_LOOK_TRIES } = options;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let looked = 0;
    const look = (): void => {
        if (stopped) return;
        looked++;
        const place = getPlace();
        if (place) {
            stopped = true;
            done(place);
            return;
        }
        if (looked >= tries) {
            stopped = true;
            return;
        }
        timer = setTimeout(look, everyMs);
    };
    timer = setTimeout(look, firstLookMs);
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
