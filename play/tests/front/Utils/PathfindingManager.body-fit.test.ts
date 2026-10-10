import { afterEach, describe, expect, it, vi } from "vitest";

// Avoid constructing Phaser entities, but retain Character's real collider contract.
// EasyStar and the path manager are not mocked.
vi.mock("../../../src/front/Phaser/Entity/Character", () => ({
    CHARACTER_BODY_HEIGHT: 16,
    CHARACTER_BODY_OFFSET_X: 0,
    CHARACTER_BODY_OFFSET_Y: 8,
}));

import { PathfindingManager } from "../../../src/front/Utils/PathfindingManager";

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };

const dimensions: Dimensions[] = [
    { width: 16, height: 16 },
    { width: 32, height: 32 },
    { width: 64, height: 64 },
    { width: 16, height: 32 },
    { width: 32, height: 16 },
    { width: 32, height: 64 },
    { width: 64, height: 32 },
];

// Player subtracts body.height / 2 + body.offset.y from path coordinates.
const playerPosition = (point: Point): Point => ({ x: point.x, y: point.y - 16 });

function expectBodyClear(grid: number[][], tile: Dimensions, position: Point): void {
    const epsilon = 1e-7;
    for (
        let y = Math.floor((position.y + epsilon) / tile.height);
        y <= Math.floor((position.y + 16 - epsilon) / tile.height);
        y++
    ) {
        for (
            let x = Math.floor((position.x - 8 + epsilon) / tile.width);
            x <= Math.floor((position.x + 8 - epsilon) / tile.width);
            x++
        ) {
            expect(grid[y]?.[x], `Body at (${position.x}, ${position.y}) overlaps tile (${x}, ${y})`).toBe(0);
        }
    }
}

function expectPathBodyClear(grid: number[][], tile: Dimensions, path: Point[]): void {
    const positions = path.map(playerPosition);
    expect(positions.length).toBeGreaterThan(1);
    for (let index = 1; index < positions.length; index++) {
        const start = positions[index - 1];
        const end = positions[index];
        const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) * 2));
        for (let step = 0; step <= steps; step++) {
            expectBodyClear(grid, tile, {
                x: start.x + ((end.x - start.x) * step) / steps,
                y: start.y + ((end.y - start.y) * step) / steps,
            });
        }
    }
}

describe("PathfindingManager player body alignment", () => {
    const managers: PathfindingManager[] = [];
    const createManager = (grid: number[][], tile: Dimensions): PathfindingManager => {
        const manager = new PathfindingManager(grid, tile);
        managers.push(manager);
        return manager;
    };
    const createGrid = (): number[][] => {
        const grid = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
        grid[4][4] = 1;
        return grid;
    };

    afterEach(() => {
        managers.forEach((manager) => manager.cleanup());
        managers.length = 0;
    });

    it.each(dimensions)("starts at the actual player position on $width×$height tiles", async (tile) => {
        const grid = createGrid();
        const manager = createManager(grid, tile);
        const start = { x: tile.width * 2.5, y: tile.height * 5 };
        const path = await manager.findPathFromGameCoordinates(start, { x: tile.width * 7.5, y: tile.height * 5 });

        expect(playerPosition(path[0])).toEqual(start);
        expectPathBodyClear(grid, tile, path);
    });

    it("leaves furniture contact without moving the body north into the furniture", async () => {
        const grid = createGrid();
        const tile = { width: 16, height: 16 };
        const manager = createManager(grid, tile);
        const start = { x: 72, y: 80 };
        const path = await manager.findPathFromGameCoordinates(start, { x: 104, y: 96 });

        expect(playerPosition(path[0])).toEqual(start);
        expectPathBodyClear(grid, tile, path);
    });

    it("keeps intermediate16px waypoints below a blocked tile's lower edge", async () => {
        const grid = createGrid();
        const tile = { width: 16, height: 16 };
        const manager = createManager(grid, tile);
        const path = await manager.findPathFromGameCoordinates({ x: 40, y: 80 }, { x: 104, y: 80 });

        expectPathBodyClear(grid, tile, path);
    });

    it.each(dimensions)("fits the nearest available blocked-target route on $width×$height tiles", async (tile) => {
        const grid = createGrid();
        const manager = createManager(grid, tile);
        const path = await manager.findPathFromGameCoordinates(
            { x: tile.width * 2.5, y: tile.height * 3 },
            { x: tile.width * 4.5, y: tile.height * 4.5 },
            true
        );

        expectPathBodyClear(grid, tile, path);
        expectBodyClear(grid, tile, playerPosition(path[path.length - 1]));
    });

    it.each(dimensions)(
        "preserves public tile centers for named-layer destinations on $width×$height tiles",
        (tile) => {
            const manager = createManager(createGrid(), tile);
            const point = manager.mapTileUnitToPixels({ x: 4, y: 5 });

            // GameScene's #moveTo layer branch passes this world point back to pathfinding.
            expect(point).toEqual({ x: tile.width * 4.5, y: tile.height * 5.5 });
            expect({ x: Math.floor(point.x / tile.width), y: Math.floor(point.y / tile.height) }).toEqual({
                x: 4,
                y: 5,
            });
        }
    );

    it.each(dimensions)("preserves empty start=end and blocked-exact paths on $width×$height tiles", async (tile) => {
        const manager = createManager(createGrid(), tile);
        const start = { x: tile.width * 2.5, y: tile.height * 3 };

        expect(await manager.findPathFromGameCoordinates(start, start)).toEqual([]);
        expect(await manager.findPathFromGameCoordinates(start, { x: tile.width * 4.5, y: tile.height * 4.5 })).toEqual(
            []
        );
    });

    it("preserves the existing32px waypoint coordinates", async () => {
        const manager = createManager(createGrid(), { width: 32, height: 32 });

        expect(await manager.findPathFromGameCoordinates({ x: 48, y: 96 }, { x: 176, y: 96 })).toEqual([
            { x: 48, y: 112 },
            { x: 80, y: 112 },
            { x: 112, y: 112 },
            { x: 144, y: 112 },
            { x: 176, y: 112 },
        ]);
    });
});
