/**
 * Every pathfinding search settles: a long one (more nodes than one EasyStar calculation expands) still resolves,
 * and one that cannot finish resolves with no path instead of hanging its caller forever.
 */
import { describe, expect, it } from 'vitest';

import { BotPathfindingManager, PathTileType } from '../utils/BotPathfindingManager';

const TILE = { width: 32, height: 32 };

function openGrid(size: number): number[][] {
    return Array.from({ length: size }, () => Array<number>(size).fill(PathTileType.Walkable));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timed out'> {
    return Promise.race([promise, new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), ms))]);
}

describe('BotPathfindingManager', () => {
    it('finds a path that needs more than one calculation round', async () => {
        const manager = new BotPathfindingManager(openGrid(120), TILE);
        const path = await withTimeout(
            manager.findPath({ x: 16, y: 16 }, { x: 119 * 32 + 16, y: 119 * 32 + 16 }),
            2000
        );
        expect(path).not.toBe('timed out');
        expect((path as unknown[]).length).toBeGreaterThan(100);
    });

    it('settles with no path when the search cannot finish within its rounds', async () => {
        const manager = new BotPathfindingManager(openGrid(120), TILE);
        // A calculate() that never progresses stands in for a search too long for the rounds allowed
        const easyStar = (manager as unknown as { easyStar: { calculate: () => void } }).easyStar;
        easyStar.calculate = () => undefined;
        const path = await withTimeout(
            manager.findPath({ x: 16, y: 16 }, { x: 100 * 32 + 16, y: 100 * 32 + 16 }),
            2000
        );
        expect(path).toEqual([]);
    });
});
