/**
 * BotPathfindingManager - Pathfinding wrapper for bots using EasyStar.js
 */

import * as EasyStar from 'easystarjs';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';

export enum PathTileType {
    Walkable = 0,
    Collider = 1,
    Exit = 2,
    Start = 3,
}

export class BotPathfindingManager {
    private easyStar: EasyStar.js;
    private grid: number[][];
    private tileDimensions: { width: number; height: number };
    private currentPathfindingInstanceId: number | null = null;
    
    // Path caching for performance
    private pathCache: Map<string, { path: PositionInterface[]; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5000; // Cache paths for 5 seconds
    private readonly CACHE_MAX_SIZE = 100; // Maximum cached paths

    constructor(collisionGrid: number[][], tileDimensions: { width: number; height: number }) {
        this.easyStar = new EasyStar.js();
        this.easyStar.enableDiagonals();
        this.easyStar.disableCornerCutting(); // Prevent cutting corners through walls
        this.easyStar.setTileCost(PathTileType.Exit, 100); // Make exits expensive but walkable
        this.easyStar.setIterationsPerCalculation(1000); // Process up to 1000 nodes per calculation

        this.grid = collisionGrid;
        this.tileDimensions = tileDimensions;
        this.setEasyStarGrid(collisionGrid);
    }

    private setEasyStarGrid(collisionGrid: number[][]): void {
        // Validate grid before setting
        if (!collisionGrid || collisionGrid.length === 0) {
            console.error(`[BotPathfindingManager] Invalid collision grid: empty or null`);
            return;
        }
        
        // Log grid stats for debugging
        let colliderCount = 0;
        let walkableCount = 0;
        for (let y = 0; y < collisionGrid.length; y++) {
            for (let x = 0; x < (collisionGrid[y]?.length || 0); x++) {
                const tileType = collisionGrid[y][x];
                if (tileType === PathTileType.Collider) {
                    colliderCount++;
                } else if (tileType === PathTileType.Walkable) {
                    walkableCount++;
                }
            }
        }
        console.log(`[BotPathfindingManager] Grid stats: ${colliderCount} colliders, ${walkableCount} walkable tiles (${collisionGrid.length}x${collisionGrid[0]?.length || 0})`);
        
        this.easyStar.setGrid(collisionGrid);
        // Only walkable tiles, exits, and start positions are acceptable
        this.easyStar.setAcceptableTiles([PathTileType.Walkable, PathTileType.Exit, PathTileType.Start]);
    }

    /**
     * Convert pixel coordinates to tile coordinates
     */
    private pixelsToTile(pixels: { x: number; y: number }): { x: number; y: number } {
        return {
            x: Math.floor(pixels.x / this.tileDimensions.width),
            y: Math.floor(pixels.y / this.tileDimensions.height),
        };
    }

    /**
     * Convert tile coordinates to pixel coordinates (center of tile)
     */
    private tileToPixels(tile: { x: number; y: number }): { x: number; y: number } {
        return {
            x: tile.x * this.tileDimensions.width + this.tileDimensions.width / 2,
            y: tile.y * this.tileDimensions.height + this.tileDimensions.height / 2,
        };
    }

    /**
     * Find path from start to end position (in pixel coordinates)
     * Returns empty array if no path found
     * @param tryFindingNearestAvailable If true, tries neighboring tiles if exact destination is blocked
     */
    async findPath(
        start: PositionInterface,
        end: PositionInterface,
        tryFindingNearestAvailable = false
    ): Promise<PositionInterface[]> {
        // Check cache first
        const cacheKey = this.getCacheKey(start, end);
        const cached = this.pathCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.path.map(p => ({ ...p })); // Return copy
        }

        const startTile = this.pixelsToTile(start);
        const endTile = this.pixelsToTile(end);

        // Clamp to grid bounds - ensure we never go outside the map
        const gridWidth = this.grid[0]?.length || 0;
        const gridHeight = this.grid.length || 0;

        if (gridWidth === 0 || gridHeight === 0) {
            console.warn(`[BotPathfindingManager] Invalid grid dimensions: ${gridWidth}x${gridHeight}`);
            return [];
        }

        startTile.x = Math.max(0, Math.min(startTile.x, gridWidth - 1));
        startTile.y = Math.max(0, Math.min(startTile.y, gridHeight - 1));
        endTile.x = Math.max(0, Math.min(endTile.x, gridWidth - 1));
        endTile.y = Math.max(0, Math.min(endTile.y, gridHeight - 1));
        
        // If end tile is outside bounds or in a wall, try to find nearest walkable tile
        if (endTile.x < 0 || endTile.x >= gridWidth || endTile.y < 0 || endTile.y >= gridHeight) {
            console.warn(`[BotPathfindingManager] End position outside grid bounds, clamping`);
            endTile.x = Math.max(0, Math.min(endTile.x, gridWidth - 1));
            endTile.y = Math.max(0, Math.min(endTile.y, gridHeight - 1));
        }

        // Check if start or end is in a wall
        if (this.grid[startTile.y]?.[startTile.x] === PathTileType.Collider) {
            console.warn(`[BotPathfindingManager] Start position (${startTile.x}, ${startTile.y}) is in a wall`);
            // Try to find nearest walkable tile
            const nearestStart = this.findNearestWalkableTile(startTile);
            if (nearestStart) {
                startTile.x = nearestStart.x;
                startTile.y = nearestStart.y;
            } else {
                console.error(`[BotPathfindingManager] No walkable tile near start position`);
                return [];
            }
        }

        let endPoints: { x: number; y: number }[] = [endTile];

        if (tryFindingNearestAvailable) {
            // If exact destination is blocked, try neighboring tiles
            if (this.grid[endTile.y]?.[endTile.x] === PathTileType.Collider) {
                const neighbors = this.getNeighbouringTiles(endTile);
                // Sort by distance from start (closest first)
                endPoints = neighbors.sort((a, b) => {
                    const aDist = Math.sqrt(Math.pow(a.x - startTile.x, 2) + Math.pow(a.y - startTile.y, 2));
                    const bDist = Math.sqrt(Math.pow(b.x - startTile.x, 2) + Math.pow(b.y - startTile.y, 2));
                    return aDist - bDist;
                });
            } else {
                // Exact destination is walkable, but also try neighbors for better path
                endPoints = [endTile, ...this.getNeighbouringTiles(endTile)];
            }
        }

        // Try each endpoint until we find a valid path
        for (const endPoint of endPoints) {
            const path = await this.getPath(startTile, endPoint);
            if (path && path.length > 0) {
                // CRITICAL: Validate path doesn't go through colliders
                let pathValid = true;
                for (const tile of path) {
                    const tileType = this.grid[tile.y]?.[tile.x];
                    if (tileType === PathTileType.Collider) {
                        console.warn(`[BotPathfindingManager] ⚠️ Path includes collider tile (${tile.x}, ${tile.y}) - rejecting path`);
                        pathValid = false;
                        break;
                    }
                }
                
                if (!pathValid) {
                    continue; // Try next endpoint
                }
                
                // Convert tile path to pixel path
                const pixelPath = path.map(tile => this.tileToPixels(tile));
                
                // CRITICAL: Replace the first waypoint with the actual start position
                // EasyStar returns the start tile center, but we need the exact pixel position
                // This matches WorkAdventure's PathfindingManager behavior (line 53-54)
                // This ensures the bot starts from its exact current position, not the tile center
                if (pixelPath.length > 0) {
                    pixelPath[0] = { x: start.x, y: start.y };
                }
                
                // Cache the path
                this.cachePath(cacheKey, pixelPath);
                
                // Path smoothing will be handled by PathSmoother in BotClient
                // This keeps pathfinding manager focused on path calculation
                return pixelPath;
            }
        }

        return [];
    }

    /**
     * Generate cache key for path
     */
    private getCacheKey(start: PositionInterface, end: PositionInterface): string {
        // Round to tile coordinates for cache key (paths to same tiles are similar)
        const startTile = this.pixelsToTile(start);
        const endTile = this.pixelsToTile(end);
        return `${startTile.x},${startTile.y}:${endTile.x},${endTile.y}`;
    }

    /**
     * Cache a path
     */
    private cachePath(key: string, path: PositionInterface[]): void {
        // Limit cache size
        if (this.pathCache.size >= this.CACHE_MAX_SIZE) {
            // Remove oldest entry
            const oldestKey = this.pathCache.keys().next().value;
            this.pathCache.delete(oldestKey);
        }

        this.pathCache.set(key, {
            path: path.map(p => ({ ...p })), // Store copy
            timestamp: Date.now(),
        });
    }

    /**
     * Clear path cache (useful when map changes)
     */
    clearCache(): void {
        this.pathCache.clear();
    }

    /**
     * Find nearest walkable tile to a given tile
     */
    private findNearestWalkableTile(tile: { x: number; y: number }): { x: number; y: number } | null {
        const maxRadius = 5; // Search up to 5 tiles away
        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                        const checkTile = { x: tile.x + dx, y: tile.y + dy };
                        if (
                            checkTile.x >= 0 &&
                            checkTile.x < (this.grid[0]?.length || 0) &&
                            checkTile.y >= 0 &&
                            checkTile.y < this.grid.length
                        ) {
                            if (this.grid[checkTile.y]?.[checkTile.x] !== PathTileType.Collider) {
                                return checkTile;
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Get neighboring tiles (4-directional)
     */
    private getNeighbouringTiles(tile: { x: number; y: number }): { x: number; y: number }[] {
        const neighbors: { x: number; y: number }[] = [];
        const directions = [
            { x: 0, y: -1 }, // Up
            { x: 1, y: 0 },  // Right
            { x: 0, y: 1 },  // Down
            { x: -1, y: 0 }, // Left
        ];

        const gridWidth = this.grid[0]?.length || 0;
        const gridHeight = this.grid.length || 0;

        for (const dir of directions) {
            const neighbor = { x: tile.x + dir.x, y: tile.y + dir.y };
            if (
                neighbor.x >= 0 &&
                neighbor.x < gridWidth &&
                neighbor.y >= 0 &&
                neighbor.y < gridHeight
            ) {
                neighbors.push(neighbor);
            }
        }

        return neighbors;
    }

    /**
     * Calculate path between two tiles
     */
    private async getPath(
        start: { x: number; y: number },
        end: { x: number; y: number }
    ): Promise<{ x: number; y: number }[]> {
        return new Promise((resolve) => {
            // Cancel any ongoing pathfinding
            if (this.currentPathfindingInstanceId !== null) {
                this.easyStar.cancelPath(this.currentPathfindingInstanceId);
            }

            this.currentPathfindingInstanceId = this.easyStar.findPath(
                start.x,
                start.y,
                end.x,
                end.y,
                (path) => {
                    this.currentPathfindingInstanceId = null;
                    resolve(path || []);
                }
            );

            this.easyStar.calculate();
        });
    }

    /**
     * Update collision grid (if map changes)
     */
    setCollisionGrid(collisionGrid: number[][]): void {
        this.grid = collisionGrid;
        this.setEasyStarGrid(collisionGrid);
    }

    /**
     * Check if a position is walkable
     */
    isWalkable(position: PositionInterface): boolean {
        const tile = this.pixelsToTile(position);
        const gridWidth = this.grid[0]?.length || 0;
        const gridHeight = this.grid.length || 0;

        if (tile.x < 0 || tile.x >= gridWidth || tile.y < 0 || tile.y >= gridHeight) {
            return false; // Out of bounds
        }

        const tileType = this.grid[tile.y]?.[tile.x];
        const isWalkable = tileType !== PathTileType.Collider;
        
        // Debug log if position is not walkable (always log for debugging)
        if (!isWalkable) {
            console.warn(`[BotPathfindingManager] ⚠️ Position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}) -> tile (${tile.x}, ${tile.y}) is NOT walkable (tileType=${tileType}, expected Collider=${PathTileType.Collider})`);
        }
        
        return isWalkable;
    }
}
