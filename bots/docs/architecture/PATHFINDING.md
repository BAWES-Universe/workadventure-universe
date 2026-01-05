# Bot Pathfinding

## Overview

Bots need pathfinding to navigate around obstacles in WorkAdventure maps. Unlike human players who can visually see obstacles and navigate around them, bots must calculate paths programmatically to avoid walls, colliders, and other obstacles.

## Why Pathfinding is Needed

### The Problem

**Current Implementation (Without Pathfinding):**
- Bots use straight-line movement: `newX = botPos.x + Math.cos(angle) * speed`
- This causes bots to:
  - Walk through walls
  - Get stuck on obstacles
  - Look unnatural and glitchy
  - Fail to reach destinations when obstacles block the path

**Example:**
```typescript
// Current PatrolBehavior - will hit obstacles!
const angle = Math.atan2(dy, dx);
const newX = botPos.x + Math.cos(angle) * config.speed * 0.016;
const newY = botPos.y + Math.sin(angle) * config.speed * 0.016;
this.bot.moveTo(newX, newY, direction);
```

### The Solution

WorkAdventure uses **EasyStar.js** for pathfinding, which calculates optimal paths around obstacles. Bots should use the same system to:
- Navigate around walls and colliders
- Find optimal paths to destinations
- Move naturally like human players
- Handle complex map layouts

## How WorkAdventure's Pathfinding Works

### Client-Side Pathfinding

WorkAdventure clients use `PathfindingManager` which:
1. Takes a collision grid from the map (walkable vs. obstacles)
2. Uses EasyStar.js A* algorithm to find paths
3. Returns a path as an array of waypoints
4. Player follows the path step-by-step

**Key Components:**
- `PathfindingManager` (`play/src/front/Utils/PathfindingManager.ts`)
- EasyStar.js library
- Collision grid from map WAM file
- Tile dimensions (usually 32x32 pixels)

### Collision Grid

The collision grid is a 2D array where:
- `0` = Walkable
- `1` = Collider (obstacle)
- `2` = Exit
- `3` = Start position

```typescript
// Example collision grid
[
  [0, 0, 0, 1, 1, 1],  // Row 0: walkable, walkable, walkable, wall, wall, wall
  [0, 0, 0, 1, 0, 1],  // Row 1: walkable, walkable, walkable, wall, walkable, wall
  [1, 1, 1, 1, 0, 1],  // Row 2: wall, wall, wall, wall, walkable, wall
]
```

## Implementation for Bots

### Step 1: Get Collision Grid

Bots need access to the map's collision grid. Options:

**Option A: Load from WAM File**
```typescript
// In BotManager or BotClient
async loadMapData(roomUrl: string) {
    // Fetch WAM file from map-storage
    const wamFile = await fetch(`${MAP_STORAGE_URL}/maps/${roomUrl}.wam`);
    const mapData = await wamFile.json();
    
    // Extract collision grid
    const collisionGrid = mapData.layers.find(l => l.type === 'collision')?.data;
    const tileDimensions = { width: 32, height: 32 }; // Usually 32x32
    
    return { collisionGrid, tileDimensions };
}
```

**Option B: Request from Map Storage API**
```typescript
// Map storage might expose collision data via API
const response = await fetch(`${MAP_STORAGE_URL}/api/maps/${roomUrl}/collision`);
const { collisionGrid, tileDimensions } = await response.json();
```

**Option C: Cache from Bot Server**
```typescript
// Bot server can cache collision grids per map
class MapDataCache {
    private cache = new Map<string, { collisionGrid: number[][], tileDimensions: { width: number, height: number } }>();
    
    async getMapData(roomUrl: string) {
        if (this.cache.has(roomUrl)) {
            return this.cache.get(roomUrl)!;
        }
        
        // Load and cache
        const data = await this.loadMapData(roomUrl);
        this.cache.set(roomUrl, data);
        return data;
    }
}
```

### Step 2: Create Pathfinding Manager

Create a pathfinding manager for bots (reuse WorkAdventure's logic):

```typescript
// bots/utils/BotPathfindingManager.ts
import EasyStar from 'easystarjs';
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

    constructor(collisionGrid: number[][], tileDimensions: { width: number; height: number }) {
        this.easyStar = new EasyStar.js();
        this.easyStar.enableDiagonals();
        this.easyStar.disableCornerCutting();
        this.easyStar.setTileCost(PathTileType.Exit, 100);
        this.easyStar.setIterationsPerCalculation(1000);

        this.grid = collisionGrid;
        this.tileDimensions = tileDimensions;
        this.setEasyStarGrid(collisionGrid);
    }

    private setEasyStarGrid(collisionGrid: number[][]): void {
        this.easyStar.setGrid(collisionGrid);
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
     */
    async findPath(
        start: PositionInterface,
        end: PositionInterface,
        tryFindingNearestAvailable = false
    ): Promise<PositionInterface[]> {
        const startTile = this.pixelsToTile(start);
        const endTile = this.pixelsToTile(end);

        // Clamp to grid bounds
        startTile.x = Math.max(0, Math.min(startTile.x, this.grid[0].length - 1));
        startTile.y = Math.max(0, Math.min(startTile.y, this.grid.length - 1));
        endTile.x = Math.max(0, Math.min(endTile.x, this.grid[0].length - 1));
        endTile.y = Math.max(0, Math.min(endTile.y, this.grid.length - 1));

        let endPoints: { x: number; y: number }[] = [endTile];
        
        if (tryFindingNearestAvailable) {
            // Try neighboring tiles if exact destination is blocked
            endPoints = [
                endTile,
                ...this.getNeighbouringTiles(endTile).sort((a, b) => {
                    const aDist = Math.sqrt(Math.pow(a.x - startTile.x, 2) + Math.pow(a.y - startTile.y, 2));
                    const bDist = Math.sqrt(Math.pow(b.x - startTile.x, 2) + Math.pow(b.y - startTile.y, 2));
                    return aDist - bDist;
                }),
            ];
        }

        for (const endPoint of endPoints) {
            const path = await this.getPath(startTile, endPoint);
            if (path && path.length > 0) {
                // Convert tile path to pixel path
                return path.map(tile => this.tileToPixels(tile));
            }
        }

        return [];
    }

    private getNeighbouringTiles(tile: { x: number; y: number }): { x: number; y: number }[] {
        const neighbors: { x: number; y: number }[] = [];
        const directions = [
            { x: 0, y: -1 }, // Up
            { x: 1, y: 0 },  // Right
            { x: 0, y: 1 },  // Down
            { x: -1, y: 0 }, // Left
        ];

        for (const dir of directions) {
            const neighbor = { x: tile.x + dir.x, y: tile.y + dir.y };
            if (
                neighbor.x >= 0 &&
                neighbor.x < this.grid[0].length &&
                neighbor.y >= 0 &&
                neighbor.y < this.grid.length
            ) {
                neighbors.push(neighbor);
            }
        }

        return neighbors;
    }

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
}
```

### Step 3: Integrate with BotClient

Add pathfinding support to `BotClient`:

```typescript
// bots/client/BotClient.ts (additions)

import { BotPathfindingManager } from '../utils/BotPathfindingManager';

export class BotClient {
    private pathfindingManager?: BotPathfindingManager;
    private currentPath: PositionInterface[] = [];
    private pathIndex: number = 0;
    private isFollowingPath: boolean = false;

    /**
     * Initialize pathfinding with collision grid
     */
    initializePathfinding(collisionGrid: number[][], tileDimensions: { width: number; height: number }): void {
        this.pathfindingManager = new BotPathfindingManager(collisionGrid, tileDimensions);
    }

    /**
     * Move to position using pathfinding
     */
    async moveToWithPathfinding(x: number, y: number): Promise<boolean> {
        if (!this.pathfindingManager) {
            console.warn('[Bot] Pathfinding not initialized, using direct movement');
            this.moveTo(x, y);
            return false;
        }

        const botPos = this.state.getPosition();
        const path = await this.pathfindingManager.findPath(botPos, { x, y }, true);

        if (path.length === 0) {
            console.warn(`[Bot ${this.config.botId}] No path found to ${x}, ${y}`);
            return false;
        }

        this.currentPath = path;
        this.pathIndex = 0;
        this.isFollowingPath = true;
        return true;
    }

    /**
     * Update path following (call in update loop)
     */
    updatePathFollowing(deltaTime: number): void {
        if (!this.isFollowingPath || this.currentPath.length === 0) {
            return;
        }

        const botPos = this.state.getPosition();
        const targetPos = this.currentPath[this.pathIndex];

        // Check if reached current waypoint
        const dx = targetPos.x - botPos.x;
        const dy = targetPos.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5) { // Reached waypoint (5 pixel threshold)
            this.pathIndex++;
            if (this.pathIndex >= this.currentPath.length) {
                // Reached destination
                this.isFollowingPath = false;
                this.currentPath = [];
                this.pathIndex = 0;
                this.stop();
                return;
            }
        }

        // Move towards current waypoint
        const nextTarget = this.currentPath[this.pathIndex];
        const angle = Math.atan2(nextTarget.y - botPos.y, nextTarget.x - botPos.x);
        const speed = 100; // pixels per second (adjust as needed)
        const newX = botPos.x + Math.cos(angle) * speed * (deltaTime / 1000);
        const newY = botPos.y + Math.sin(angle) * speed * (deltaTime / 1000);

        // Determine direction
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.moveTo(newX, newY, direction);
    }
}
```

### Step 4: Update Behaviors

**Update PatrolBehavior:**

```typescript
// bots/behaviors/PatrolBehavior.ts (updated)

export class PatrolBehavior extends BaseBehavior {
    private currentPath: PositionInterface[] = [];
    private pathIndex: number = 0;
    private isFollowingPath: boolean = false;

    private async moveToWaypoint(waypoint: { x: number; y: number }): Promise<void> {
        if (!this.bot) return;

        const botPos = this.bot.getState().getPosition();
        
        // Use pathfinding if available
        if (this.bot.hasPathfinding()) {
            const success = await this.bot.moveToWithPathfinding(waypoint.x, waypoint.y);
            if (success) {
                this.isFollowingPath = true;
                return;
            }
        }

        // Fallback to direct movement if pathfinding fails
        const dx = waypoint.x - botPos.x;
        const dy = waypoint.y - botPos.y;
        const angle = Math.atan2(dy, dx);
        const newX = botPos.x + Math.cos(angle) * config.speed * 0.016;
        const newY = botPos.y + Math.sin(angle) * config.speed * 0.016;

        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.bot.moveTo(newX, newY, direction);
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        // Update path following if active
        if (this.isFollowingPath) {
            this.bot.updatePathFollowing(deltaTime);
            
            // Check if path completed
            if (!this.bot.isFollowingPath()) {
                this.isFollowingPath = false;
                // Reached waypoint, pause
                this.isPaused = true;
                this.pauseStartTime = Date.now();
            }
            return;
        }

        // ... rest of existing update logic
    }
}
```

**Update SocialBehavior:**

```typescript
// bots/behaviors/SocialBehavior.ts (updated approachPlayer method)

private async approachPlayer(playerId: number, config: SocialBehaviorConfig): Promise<void> {
    if (!this.bot) return;

    const player = this.bot.getPlayerInfo(playerId);
    if (!player) {
        this.targetPlayerId = null;
        return;
    }

    const botPos = this.bot.getState().getPosition();
    const dx = player.position.x - botPos.x;
    const dy = player.position.y - botPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If close enough, stop and wait for space join
    if (distance <= config.approachDistance) {
        this.bot.stop();
        return;
    }

    // Use pathfinding to approach player
    if (this.bot.hasPathfinding()) {
        const success = await this.bot.moveToWithPathfinding(player.position.x, player.position.y);
        if (success) {
            return; // Pathfinding will handle movement
        }
    }

    // Fallback to direct movement
    const angle = Math.atan2(dy, dx);
    const newX = botPos.x + Math.cos(angle) * config.wanderSpeed * 0.016;
    const newY = botPos.y + Math.sin(angle) * config.wanderSpeed * 0.016;

    let direction = PositionMessage_Direction.DOWN;
    if (Math.abs(dx) > Math.abs(dy)) {
        direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
    } else {
        direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
    }

    this.bot.moveTo(newX, newY, direction);
}
```

## Integration with BotManager

Initialize pathfinding when spawning bots:

```typescript
// bots/server/BotManager.ts (additions)

async spawnBot(botId: string, config: BotConfiguration): Promise<BotClient> {
    // ... existing spawn logic ...

    const client = new BotClient(botConfig);

    // Initialize pathfinding
    const mapData = await this.loadMapData(config.roomUrl);
    if (mapData.collisionGrid && mapData.tileDimensions) {
        client.initializePathfinding(mapData.collisionGrid, mapData.tileDimensions);
    }

    // ... rest of spawn logic ...
}

private async loadMapData(roomUrl: string): Promise<{
    collisionGrid?: number[][];
    tileDimensions?: { width: number; height: number };
}> {
    try {
        // Load from map-storage or cache
        const mapStorageUrl = process.env.MAP_STORAGE_URL || 'http://map-storage:3000';
        const response = await fetch(`${mapStorageUrl}/maps/${roomUrl}`);
        const mapData = await response.json();

        // Extract collision layer
        const collisionLayer = mapData.layers?.find((l: any) => l.type === 'collision');
        if (!collisionLayer) {
            return {};
        }

        return {
            collisionGrid: collisionLayer.data,
            tileDimensions: { width: 32, height: 32 }, // Default, should come from map
        };
    } catch (error) {
        console.error(`[BotManager] Failed to load map data for ${roomUrl}:`, error);
        return {};
    }
}
```

## Performance Considerations

### Pathfinding Cost

- **CPU**: Pathfinding calculations are relatively expensive
- **Frequency**: Only calculate paths when:
  - Bot needs to move to a new destination
  - Current path is blocked (recalculate)
  - Waypoint reached (calculate next segment)

### Optimization Strategies

1. **Cache Paths**: Cache common paths (e.g., waypoint routes)
2. **Path Reuse**: If multiple bots go to same destination, share path
3. **Lazy Calculation**: Only calculate when needed
4. **Path Simplification**: Remove intermediate waypoints if path is clear

```typescript
// Example: Cache waypoint paths for patrol bots
class PatrolPathCache {
    private cache = new Map<string, PositionInterface[]>();

    getPath(waypoint1: PositionInterface, waypoint2: PositionInterface): PositionInterface[] | null {
        const key = `${waypoint1.x},${waypoint1.y}-${waypoint2.x},${waypoint2.y}`;
        return this.cache.get(key) || null;
    }

    setPath(waypoint1: PositionInterface, waypoint2: PositionInterface, path: PositionInterface[]): void {
        const key = `${waypoint1.x},${waypoint1.y}-${waypoint2.x},${waypoint2.y}`;
        this.cache.set(key, path);
    }
}
```

## Troubleshooting

### No Path Found

**Causes:**
- Destination is inside a wall
- Start position is inside a wall
- No walkable path exists

**Solutions:**
- Use `tryFindingNearestAvailable = true` to find nearest walkable tile
- Validate waypoints are on walkable tiles
- Check collision grid is correct

### Bots Getting Stuck

**Causes:**
- Path calculation fails silently
- Path following logic has bugs
- Collision grid doesn't match actual map

**Solutions:**
- Add logging for pathfinding failures
- Validate path before following
- Test with simple maps first

### Performance Issues

**Causes:**
- Too many pathfinding calculations
- Large collision grids
- Complex map layouts

**Solutions:**
- Cache paths
- Reduce pathfinding frequency
- Optimize collision grid size

## Summary

Pathfinding is essential for bots to navigate naturally around obstacles. By reusing WorkAdventure's `PathfindingManager` logic:

1. ✅ Bots avoid obstacles automatically
2. ✅ Movement looks natural
3. ✅ Works with complex map layouts
4. ✅ Consistent with player movement

**Key Steps:**
1. Get collision grid from map
2. Initialize `BotPathfindingManager`
3. Calculate paths before moving
4. Follow paths step-by-step
5. Update behaviors to use pathfinding

**Next Steps:**
- Implement `BotPathfindingManager`
- Integrate with `BotClient`
- Update `PatrolBehavior` and `SocialBehavior`
- Test with various map layouts

