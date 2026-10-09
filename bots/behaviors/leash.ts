/**
 * Leash geometry: where a bot belongs and how it gets back there.
 *
 * A bot's leash is its spot (stays put), its circle (wanders) or its route (walks stops). Whenever the bot
 * finds itself off its leash, after a chat or a summon, it walks back to the nearest place on it.
 * Pure functions only, so they can be unit tested.
 */

export type Point = { x: number; y: number };

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The point inside a circle closest to `pos`: `pos` itself when it is inside, else a point just inside the
 * edge on the line to the centre. `inset` keeps the bot a little inside so it doesn't stand on the edge.
 */
export function nearestPointInCircle(pos: Point, center: Point, radius: number, inset = 16): Point {
    const d = distance(pos, center);
    if (d <= radius) return { x: pos.x, y: pos.y };
    const r = Math.max(0, radius - inset);
    if (d === 0) return { x: center.x, y: center.y };
    return { x: center.x + ((pos.x - center.x) / d) * r, y: center.y + ((pos.y - center.y) / d) * r };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return distance(p, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * How far `pos` is from a route: the shortest distance to any leg between consecutive stops, including the
 * leg from the last stop back to the first when the route loops. Infinity for a route with no stops.
 */
export function distanceToRoute(pos: Point, stops: Point[], loop: boolean): number {
    if (stops.length === 0) return Infinity;
    if (stops.length === 1) return distance(pos, stops[0]);
    let best = Infinity;
    for (let i = 0; i < stops.length - 1; i++) {
        best = Math.min(best, distanceToSegment(pos, stops[i], stops[i + 1]));
    }
    if (loop && stops.length > 2) {
        best = Math.min(best, distanceToSegment(pos, stops[stops.length - 1], stops[0]));
    }
    return best;
}

/** Index of the stop closest to `pos`, or -1 for a route with no stops. */
export function nearestStopIndex(pos: Point, stops: Point[]): number {
    let bestIndex = -1;
    let best = Infinity;
    stops.forEach((stop, index) => {
        const d = distance(pos, stop);
        if (d < best) {
            best = d;
            bestIndex = index;
        }
    });
    return bestIndex;
}

/**
 * The stop after `index`. A looping route goes 1, 2, 3, 1, 2, 3; a back-and-forth route goes
 * 1, 2, 3, 2, 1, 2. `direction` is +1 or -1 and only matters for back and forth.
 */
export function nextStop(index: number, direction: 1 | -1, count: number, loop: boolean): { index: number; direction: 1 | -1 } {
    if (count <= 1) return { index: 0, direction: 1 };
    if (loop) return { index: (index + 1) % count, direction: 1 };
    let dir = direction;
    let next = index + dir;
    if (next >= count || next < 0) {
        dir = dir === 1 ? -1 : 1;
        next = index + dir;
    }
    return { index: next, direction: dir };
}
