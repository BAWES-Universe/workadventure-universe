/** The widths the Open here window snaps to, as a share of the screen: a third (as wide as Orbit), a half and two thirds. */
export const OPEN_HERE_WIDTH_STOPS = [0.33, 1 / 2, 2 / 3] as const;

/** The first width, when the map does not ask for one. */
export const OPEN_HERE_START_RATIO = OPEN_HERE_WIDTH_STOPS[0];

/** A page a map opens with its own width (openWebsiteWidth) starts there, within what fits beside the screen's edge. */
const OPEN_HERE_MIN_RATIO = 0.25;
const OPEN_HERE_MAX_RATIO = 0.9;

export function clampOpenHereRatio(ratio: number): number {
    return Math.min(Math.max(ratio, OPEN_HERE_MIN_RATIO), OPEN_HERE_MAX_RATIO);
}

/** The stop closest to where the grip was let go. */
export function nearestWidthStop(ratio: number): number {
    return OPEN_HERE_WIDTH_STOPS.reduce((best, stop) =>
        Math.abs(stop - ratio) < Math.abs(best - ratio) ? stop : best
    );
}

/** One stop wider (1) or narrower (-1) than the current width, for the grip's arrow keys. It stays on the last stop. */
export function stepWidthStop(ratio: number, direction: 1 | -1): number {
    const stops = OPEN_HERE_WIDTH_STOPS;
    if (direction === 1) {
        return stops.find((stop) => stop > ratio + 0.001) ?? stops[stops.length - 1];
    }
    return [...stops].reverse().find((stop) => stop < ratio - 0.001) ?? stops[0];
}
