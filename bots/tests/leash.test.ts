/**
 * Tests for the leash geometry: nearest point in a circle, distance to a route, nearest stop, next stop.
 */
import { describe, expect, it } from 'vitest';

import { distanceToRoute, nearestPointInCircle, nearestStopIndex, nextStop } from '../behaviors/leash';

describe('nearestPointInCircle', () => {
    it('leaves a point inside the circle where it is', () => {
        expect(nearestPointInCircle({ x: 10, y: 10 }, { x: 0, y: 0 }, 100)).toEqual({ x: 10, y: 10 });
    });

    it('brings a point outside back just inside the edge, towards the centre', () => {
        const p = nearestPointInCircle({ x: 300, y: 0 }, { x: 0, y: 0 }, 100);
        expect(p.x).toBeCloseTo(84);
        expect(p.y).toBeCloseTo(0);
    });
});

describe('distanceToRoute', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
    ];

    it('measures to the nearest leg, not the nearest stop', () => {
        expect(distanceToRoute({ x: 50, y: 10 }, square, true)).toBeCloseTo(10);
    });

    it('includes the closing leg only when the route loops', () => {
        expect(distanceToRoute({ x: -10, y: 50 }, square, true)).toBeCloseTo(10);
        expect(distanceToRoute({ x: -10, y: 50 }, square, false)).toBeCloseTo(Math.hypot(10, 50));
    });

    it('handles one stop and no stops', () => {
        expect(distanceToRoute({ x: 3, y: 4 }, [{ x: 0, y: 0 }], true)).toBeCloseTo(5);
        expect(distanceToRoute({ x: 3, y: 4 }, [], true)).toBe(Infinity);
    });
});

describe('nearestStopIndex', () => {
    it('finds the closest stop', () => {
        expect(nearestStopIndex({ x: 90, y: 90 }, [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])).toBe(1);
        expect(nearestStopIndex({ x: 0, y: 0 }, [])).toBe(-1);
    });
});

describe('nextStop', () => {
    it('loops back to the first stop', () => {
        expect(nextStop(2, 1, 3, true)).toEqual({ index: 0, direction: 1 });
    });

    it('turns around at both ends when going back and forth', () => {
        const seen: number[] = [];
        let state = { index: 0, direction: 1 as 1 | -1 };
        for (let i = 0; i < 6; i++) {
            state = nextStop(state.index, state.direction, 3, false);
            seen.push(state.index);
        }
        expect(seen).toEqual([1, 2, 1, 0, 1, 2]);
    });

    it('stays on the only stop', () => {
        expect(nextStop(0, 1, 1, true)).toEqual({ index: 0, direction: 1 });
    });
});
