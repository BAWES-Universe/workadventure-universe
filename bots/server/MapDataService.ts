/**
 * MapDataService - Fetches and caches collision grids from map-storage
 */

import { PathTileType } from '../utils/BotPathfindingManager';

export interface MapArea {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    properties?: Record<string, any>;
}

interface MapData {
    collisionGrid: number[][];
    tileDimensions: { width: number; height: number };
    areas: MapArea[];
}

interface CachedMapData extends MapData {
    cachedAt: number;
}

export class MapDataService {
    private cache: Map<string, CachedMapData> = new Map();
    private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
    private readonly DEFAULT_TILE_SIZE = 32; // Default tile size in pixels

    constructor(private mapStorageUrl: string = process.env.MAP_STORAGE_URL || 'http://map-storage:3000') {}

    /**
     * Get collision grid and tile dimensions for a room
     * Returns null if unavailable (graceful degradation)
     */
    async getMapData(roomUrl: string): Promise<MapData | null> {
        // Check cache first
        const cached = this.cache.get(roomUrl);
        if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
            console.log(`[MapDataService] Using cached collision grid for ${roomUrl} (cached ${Math.round((Date.now() - cached.cachedAt) / 1000)}s ago)`);
            return {
                collisionGrid: cached.collisionGrid,
                tileDimensions: cached.tileDimensions,
            };
        }
        
        // Cache expired or missing - clear it
        if (cached) {
            console.log(`[MapDataService] Cache expired for ${roomUrl}, refreshing...`);
            this.cache.delete(roomUrl);
        }

        try {
            // Fetch from map-storage
            const mapData = await this.fetchMapData(roomUrl);
            if (!mapData) {
                return null;
            }

            // Cache the result
            this.cache.set(roomUrl, {
                ...mapData,
                cachedAt: Date.now(),
            });

            return mapData;
        } catch (error) {
            console.error(`[MapDataService] Failed to load map data for ${roomUrl}:`, error);
            return null;
        }
    }

    /**
     * Fetch map data from map-storage
     * 1. Convert roomUrl to WAM path format
     * 2. Fetch WAM file from map-storage
     * 3. Extract mapUrl from WAM
     * 4. Fetch TMJ file from mapUrl
     * 5. Extract collision layer from TMJ
     */
    private async fetchMapData(roomUrl: string): Promise<MapData | null> {
        try {
            // Step 1: Parse roomUrl and convert to WAM path
            // Format: http://play.workadventure.localhost/@/universe/world/room
            // WAM path: {domain}/{universe}/{world}/{room}/map.wam
            const urlObj = new URL(roomUrl);
            const domain = urlObj.hostname;
            
            // Extract path parts: @/universe/world/room -> universe/world/room
            const pathMatch = /^\/@\/(.+)/.exec(urlObj.pathname);
            if (!pathMatch) {
                console.warn(`[MapDataService] Invalid roomUrl format: ${roomUrl}`);
                return null;
            }
            
            const pathParts = pathMatch[1].split('/').filter(p => p);
            if (pathParts.length < 3) {
                console.warn(`[MapDataService] Invalid roomUrl path: expected universe/world/room, got: ${pathMatch[1]}`);
                return null;
            }
            
            // Construct WAM path: {domain}/{universe}/{world}/{room}/map.wam
            const wamPath = `${domain}/${pathParts.join('/')}/map.wam`;
            const wamUrl = `${this.mapStorageUrl}/${wamPath}`;
            
            console.log(`[MapDataService] Attempting to fetch WAM from: ${wamUrl}`);
            
            // Step 2: Fetch WAM file
            const wamResponse = await fetch(wamUrl);
            if (!wamResponse.ok) {
                console.warn(`[MapDataService] WAM file not found: ${wamUrl} (${wamResponse.status})`);
                // Try alternative path format without domain (if USE_DOMAIN_NAME_IN_PATH is false)
                const altWamPath = `${pathParts.join('/')}/map.wam`;
                const altWamUrl = `${this.mapStorageUrl}/${altWamPath}`;
                console.log(`[MapDataService] Trying alternative path: ${altWamUrl}`);
                const altWamResponse = await fetch(altWamUrl);
                if (!altWamResponse.ok) {
                    console.warn(`[MapDataService] Alternative WAM path also failed: ${altWamUrl} (${altWamResponse.status})`);
                    return null;
                }
                // Use alternative path
                const wamData: any = await altWamResponse.json();
                return await this.processWamData(wamData, altWamUrl);
            }
            
            const wamData: any = await wamResponse.json();
            return await this.processWamData(wamData, wamUrl);
        } catch (error) {
            console.error(`[MapDataService] Error fetching map data for ${roomUrl}:`, error);
            return null;
        }
    }

    /**
     * Process WAM data to extract collision grid from TMJ
     * WorkAdventure uses tile properties (collides) rather than a separate collision layer
     */
    private async processWamData(wamData: any, wamUrl: string): Promise<MapData | null> {
        if (!wamData.mapUrl) {
            console.warn(`[MapDataService] WAM file missing mapUrl: ${wamUrl}`);
            return null;
        }
        
        // Step 3: Fetch TMJ file from mapUrl
        // mapUrl might be relative or absolute
        let tmjUrl: string;
        if (wamData.mapUrl.startsWith('http://') || wamData.mapUrl.startsWith('https://')) {
            tmjUrl = wamData.mapUrl;
        } else {
            // Relative URL - resolve against WAM file location
            const baseUrl = new URL(wamUrl);
            tmjUrl = new URL(wamData.mapUrl, baseUrl).toString();
        }
        
        console.log(`[MapDataService] Fetching TMJ from: ${tmjUrl}`);
        const tmjResponse = await fetch(tmjUrl);
        if (!tmjResponse.ok) {
            console.warn(`[MapDataService] TMJ file not found: ${tmjUrl} (${tmjResponse.status})`);
            return null;
        }
        
        const tmjData: any = await tmjResponse.json();
        
        // Get tile dimensions from map metadata or use default
        const tileWidth = tmjData.tilewidth || this.DEFAULT_TILE_SIZE;
        const tileHeight = tmjData.tileheight || this.DEFAULT_TILE_SIZE;
        const mapWidth = tmjData.width || 0;
        const mapHeight = tmjData.height || 0;

        if (mapWidth === 0 || mapHeight === 0) {
            console.warn(`[MapDataService] Invalid map dimensions: ${mapWidth}x${mapHeight}`);
            return null;
        }

        // Step 4: Try to find a dedicated collision layer first
        // Check for common collision layer names: "collision", "collisions", "collides"
        const allLayers = this.extractAllLayers(tmjData.layers || []);
        const layerNameLower = (name: string) => (name || '').toLowerCase();
        
        console.log(`[MapDataService] Searching for collision layer among ${allLayers.length} layers`);
        const tileLayers = allLayers.filter((l: any) => l.type === 'tilelayer');
        console.log(`[MapDataService] Found ${tileLayers.length} tile layers:`, tileLayers.map((l: any) => l.name || 'unnamed').join(', '));
        
        const collisionLayer = allLayers.find((l: any) => {
            if (l.type !== 'tilelayer' && l.type !== 'collision') return false;
            const name = layerNameLower(l.name || '');
            return name === 'collision' || name === 'collisions' || name === 'collides';
        });
        
        if (collisionLayer) {
            console.log(`[MapDataService] Found collision layer: "${collisionLayer.name}" (type: ${collisionLayer.type}, hasData: ${!!collisionLayer.data})`);
        } else {
            console.warn(`[MapDataService] No collision layer found. Searched for: collision, collisions, collides`);
        }

        let collisionGrid: number[][];
        let collidesMap: Map<number, boolean> | null = null;

        if (collisionLayer && collisionLayer.data) {
            // Use dedicated collision layer
            console.log(`[MapDataService] Using dedicated collision layer: ${collisionLayer.name || 'unnamed'}`);
            
            // Sample first few values to understand data format
            const sampleData = Array.isArray(collisionLayer.data[0]) 
                ? collisionLayer.data[0].slice(0, 10)
                : collisionLayer.data.slice(0, 10);
            console.log(`[MapDataService] Sample collision data (first 10 values):`, sampleData);
            
            if (Array.isArray(collisionLayer.data[0])) {
                // Already 2D array
                // Convert: non-zero = collider (1), zero = walkable (0)
                collisionGrid = collisionLayer.data.map((row: number[]) => 
                    row.map((val: number) => val !== 0 ? PathTileType.Collider : PathTileType.Walkable)
                );
            } else {
                // 1D array - convert to 2D
                const width = collisionLayer.width || mapWidth;
                const height = collisionLayer.height || mapHeight;
                const layerData = this.convert1DTo2D(collisionLayer.data, width, height);
                // Convert: non-zero = collider (1), zero = walkable (0)
                collisionGrid = layerData.map((row: number[]) => 
                    row.map((val: number) => val !== 0 ? PathTileType.Collider : PathTileType.Walkable)
                );
            }
        } else {
            // Fall back to building collision grid from tile properties
            console.log(`[MapDataService] No collision layer found, building from tile properties`);
            
            // Build collision map from tilesets (GID -> collides)
            collidesMap = new Map<number, boolean>();
            if (tmjData.tilesets) {
                for (const tileset of tmjData.tilesets) {
                    const firstGid = tileset.firstgid || 0;
                    if (tileset.tiles) {
                        for (const tile of tileset.tiles) {
                            if (tile.properties) {
                                const collidesProp = tile.properties.find((p: any) => p.name === 'collides' && p.value === true);
                                if (collidesProp) {
                                    const gid = firstGid + tile.id;
                                    collidesMap.set(gid, true);
                                }
                            }
                        }
                    }
                }
            }

            if (collidesMap.size === 0) {
                console.warn(`[MapDataService] No tiles with collides property found in TMJ: ${tmjUrl}`);
                return null;
            }

            // Extract all tile layers (including nested in groups) and build collision grid
            const allTileLayers = this.extractTileLayers(tmjData.layers || []);
            
            if (allTileLayers.length === 0) {
                console.warn(`[MapDataService] No tile layers found in TMJ: ${tmjUrl}`);
                return null;
            }

            // Initialize collision grid (0 = walkable, 1 = collides)
            collisionGrid = [];
            for (let y = 0; y < mapHeight; y++) {
                const row: number[] = [];
                for (let x = 0; x < mapWidth; x++) {
                    row.push(PathTileType.Walkable); // Default to walkable
                }
                collisionGrid.push(row);
            }

            // Process each tile layer and mark colliding tiles
            // IMPORTANT: Process layers in order, later layers can override earlier ones
            for (const layer of allTileLayers) {
                if (!layer.data || !layer.width || !layer.height) continue;
                
                const layerData = Array.isArray(layer.data[0]) ? layer.data : this.convert1DTo2D(layer.data, layer.width, layer.height);
                
                for (let y = 0; y < layer.height && y < mapHeight; y++) {
                    for (let x = 0; x < layer.width && x < mapWidth; x++) {
                        const tileGid = layerData[y][x];
                        if (tileGid && tileGid !== 0 && collidesMap.has(tileGid)) {
                            collisionGrid[y][x] = PathTileType.Collider; // Mark as collidable
                        }
                    }
                }
            }
        }

        const logInfo = collidesMap 
            ? `${mapWidth}x${mapHeight} tiles (${collidesMap.size} colliding tile types)`
            : `${mapWidth}x${mapHeight} tiles`;
        
        // Count colliding vs walkable tiles for validation
        let colliderCount = 0;
        let walkableCount = 0;
        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                if (collisionGrid[y][x] === PathTileType.Collider) {
                    colliderCount++;
                } else {
                    walkableCount++;
                }
            }
        }
        
        console.log(`[MapDataService] Successfully loaded collision grid: ${logInfo}`);
        console.log(`[MapDataService] Collision grid stats: ${colliderCount} colliders, ${walkableCount} walkable tiles`);
        
        // Validate grid has reasonable distribution (not all colliders or all walkable)
        if (colliderCount === 0) {
            console.warn(`[MapDataService] WARNING: No collider tiles found in grid! Bots may walk through walls.`);
        } else if (walkableCount === 0) {
            console.warn(`[MapDataService] WARNING: No walkable tiles found in grid! Bots cannot move.`);
        }
        
        // Extract areas from object layers
        const areas = this.extractAreas(tmjData.layers || []);

        return {
            collisionGrid,
            tileDimensions: { width: tileWidth, height: tileHeight },
            areas,
        };
    }

    /**
     * Extract areas from object layers in TMJ data
     * Areas are defined as objects in object layers with names
     */
    private extractAreas(layers: any[]): MapArea[] {
        const areas: MapArea[] = [];
        
        // Recursively extract all layers
        const allLayers = this.extractAllLayers(layers);
        
        for (const layer of allLayers) {
            if (layer.type === 'objectgroup' && layer.objects) {
                for (const obj of layer.objects) {
                    // Only include objects with names (these are areas)
                    if (obj.name && (obj.width > 0 || obj.height > 0)) {
                        const properties = this.parseProperties(obj.properties || []);
                        areas.push({
                            name: obj.name,
                            x: obj.x || 0,
                            y: obj.y || 0,
                            width: obj.width || 0,
                            height: obj.height || 0,
                            properties,
                        });
                    }
                }
            }
        }
        
        return areas;
    }

    /**
     * Parse Tiled properties array into key-value object
     */
    private parseProperties(properties: any[]): Record<string, any> {
        const result: Record<string, any> = {};
        for (const prop of properties) {
            if (prop.name && prop.value !== undefined) {
                result[prop.name] = prop.value;
            }
        }
        return result;
    }

    /**
     * Get areas for a room (cached)
     */
    async getAreas(roomUrl: string): Promise<MapArea[]> {
        const mapData = await this.getMapData(roomUrl);
        return mapData?.areas || [];
    }

    /**
     * Recursively extract all tile layers from layer structure (including nested in groups)
     */
    private extractTileLayers(layers: any[]): any[] {
        const tileLayers: any[] = [];
        
        for (const layer of layers) {
            if (layer.type === 'tilelayer') {
                tileLayers.push(layer);
            } else if (layer.type === 'group' && layer.layers) {
                // Recursively extract from nested layers
                tileLayers.push(...this.extractTileLayers(layer.layers));
            }
        }
        
        return tileLayers;
    }

    /**
     * Recursively extract all layers (any type) from layer structure (including nested in groups)
     */
    private extractAllLayers(layers: any[]): any[] {
        const allLayers: any[] = [];
        
        for (const layer of layers) {
            allLayers.push(layer);
            if (layer.type === 'group' && layer.layers) {
                // Recursively extract from nested layers
                allLayers.push(...this.extractAllLayers(layer.layers));
            }
        }
        
        return allLayers;
    }

    /**
     * Convert 1D array to 2D grid
     */
    private convert1DTo2D(data: number[], width: number, height: number): number[][] {
        const grid: number[][] = [];
        for (let y = 0; y < height; y++) {
            const row: number[] = [];
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                row.push(data[index] || 0);
            }
            grid.push(row);
        }
        return grid;
    }

    /**
     * Clear cache for a specific room (useful when map is updated)
     */
    clearCache(roomUrl: string): void {
        this.cache.delete(roomUrl);
    }

    /**
     * Clear all cache
     */
    clearAllCache(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics (for debugging)
     */
    getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys()),
        };
    }
}
