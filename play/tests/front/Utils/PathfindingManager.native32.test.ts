import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real EasyStar implementation; only avoid loading the renderer for its constants.
vi.mock("../../../src/front/Phaser/Entity/Character", () => ({
    CHARACTER_BODY_HEIGHT: 16,
    CHARACTER_BODY_OFFSET_X: 0,
    CHARACTER_BODY_OFFSET_Y: 8,
}));

import { PathfindingManager, PathTileType } from "../../../src/front/Utils/PathfindingManager";

const createGrid = (): number[][] =>
    Array.from({ length: 8 }, (_, y) =>
        Array.from({ length: 8 }, (_, x) => (x === 0 || y === 0 || x === 7 || y === 7 ? 1 : 0))
    );

const dimensions = { width: 32, height: 32 };
const start = { x: 80, y: 141 };
const end = { x: 80, y: 144 };

describe("native 32px path destinations", () => {
    const managers: PathfindingManager[] = [];
    const createManager = (grid = createGrid()) => {
        const manager = new PathfindingManager(grid, dimensions);
        managers.push(manager);
        return manager;
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        managers.splice(0).forEach((manager) => manager.cleanup());
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it.each([false, true])("keeps a same-cell target exact (nearest=%s)", async (nearest) => {
        const pending = createManager().findPathFromGameCoordinates(start, end, nearest);
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([end]);
    });

    it("keeps the already reached endpoint stationary after Player's 16px offset", async () => {
        const pending = createManager().findPathFromGameCoordinates({ x: 80, y: 128 }, end, true);
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([end]);
    });

    it.each([
        [
            { x: 64, y: 128 },
            { x: 72, y: 144 },
        ],
        [
            { x: 95, y: 159 },
            { x: 88, y: 159 },
        ],
        [
            { x: 81, y: 151 },
            { x: 81, y: 151 },
        ],
    ])("fits same-cell edge clicks without discarding the requested endpoint: %j", async (click, fitted) => {
        const pending = createManager().findPathFromGameCoordinates(start, click, true);
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([fitted]);
    });

    it.each([PathTileType.Walkable, PathTileType.Exit, PathTileType.Start])(
        "accepts same-cell traversable tile type %s",
        async (tile) => {
            const grid = createGrid();
            grid[4][2] = tile;
            const pending = createManager(grid).findPathFromGameCoordinates(start, end, true);
            await vi.runAllTimersAsync();
            expect(await pending).toEqual([end]);
        }
    );

    it.each([
        [
            { x: 240, y: 80 },
            { x: 1000, y: 80 },
            { x: 248, y: 80 },
        ],
        [
            { x: 8, y: 80 },
            { x: -100, y: 80 },
            { x: 8, y: 80 },
        ],
        [
            { x: 80, y: 240 },
            { x: 80, y: 1000 },
            { x: 80, y: 255 },
        ],
        [
            { x: 80, y: 8 },
            { x: 80, y: -100 },
            { x: 80, y: 16 },
        ],
        [
            { x: 240, y: 80 },
            { x: 256, y: 80 },
            { x: 248, y: 80 },
        ],
        [
            { x: 80, y: 240 },
            { x: 80, y: 256 },
            { x: 80, y: 255 },
        ],
    ])("fits clamped same-cell map-edge targets: %j", async (origin, click, fitted) => {
        const grid = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
        const pending = createManager(grid).findPathFromGameCoordinates(origin, click, true);
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([fitted]);
    });

    it("does not accept a newly blocked same-cell destination", async () => {
        const manager = createManager();
        const grid = createGrid();
        grid[4][2] = PathTileType.Collider;
        manager.setCollisionGrid(grid);
        const pending = manager.findPathFromGameCoordinates(start, end);
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([]);
    });

    it("still falls back to a walkable neighbour for a blocked target", async () => {
        const grid = createGrid();
        grid[4][2] = PathTileType.Collider;
        const pending = createManager(grid).findPathFromGameCoordinates(start, end, true);
        await vi.runAllTimersAsync();
        const path = await pending;
        expect(path.length).toBeGreaterThan(0);
        expect(path[path.length - 1]).not.toEqual(end);
        const target = path[path.length - 1];
        expect(grid[Math.floor(target.y / 32)][Math.floor(target.x / 32)]).toBe(PathTileType.Walkable);
    });

    it("settles a superseded callback without starting stale nearest-neighbour fallbacks", async () => {
        const manager = createManager();
        const first = manager.findPathFromGameCoordinates({ x: 80, y: 192 }, { x: 0, y: 0 }, true);
        const latest = manager.findPathFromGameCoordinates(start, end, true);
        await vi.runAllTimersAsync();
        expect(await first).toEqual([]);
        expect(await latest).toEqual([end]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets the last of several queued real EasyStar callbacks win", async () => {
        const manager = createManager();
        const pending = [112, 144, 176].map((x) =>
            manager.findPathFromGameCoordinates({ x: 80, y: 192 }, { x, y: 144 }, true)
        );
        await vi.runAllTimersAsync();
        const paths = await Promise.all(pending);
        expect(paths[0]).toEqual([]);
        expect(paths[1]).toEqual([]);
        expect(paths[2][paths[2].length - 1]).toEqual({ x: 176, y: 144 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("settles cleanup and ignores callbacks already queued by EasyStar", async () => {
        const manager = createManager();
        const pending = manager.findPathFromGameCoordinates({ x: 80, y: 192 }, end, true);
        manager.cleanup();
        await vi.runAllTimersAsync();
        expect(await pending).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
