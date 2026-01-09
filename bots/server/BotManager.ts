/**
 * BotManager - Core service to spawn, manage, and coordinate bot instances
 */

import { BotClient } from '../client/BotClient';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import { MapDataService } from './MapDataService';
import type { BotConfiguration } from './AdminApiService';

export interface BotInstance {
    botId: string;
    client: BotClient;
    config: BotConfiguration;
    status: 'connecting' | 'connected' | 'disconnected' | 'error';
    lastHeartbeat: number;
}

interface RoomState {
    botIds: Set<string>;
    lastActivity: number;
    // playerCount removed - verification system queries WA /rooms API for actual count
}

// Store botId mapping since BotClient doesn't expose it directly
const botIdMap = new WeakMap<BotClient, string>();

export class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private mapDataService: MapDataService;
    private isInitialized = false;
    private roomsWithBots: Map<string, RoomState> = new Map();
    private roomSyncLocks: Map<string, Promise<void>> = new Map(); // Prevent concurrent spawning
    private verificationInterval: NodeJS.Timeout | null = null;
    private readonly VERIFICATION_INTERVAL_MS = 60 * 1000; // 1 minute

    constructor(adminApiService: AdminApiService, botRegistry: BotRegistry) {
        this.adminApiService = adminApiService;
        this.botRegistry = botRegistry;
        this.mapDataService = new MapDataService();
    }
    
    /**
     * Get bot ID from client instance
     */
    private getBotIdFromClient(client: BotClient): string | null {
        return botIdMap.get(client) || null;
    }

    /**
     * Initialize bot manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        // Initialize bot registry
        await this.botRegistry.connect();
        
        // Register this server with capacity
        const capacity = parseInt(process.env.BOT_SERVER_CAPACITY || '100', 10);
        await this.botRegistry.registerServer(capacity);

        // Start room occupancy verification
        this.startRoomVerification();

        // TODO: Load bots from storage (WAM files + Admin API)
        // This will be called on server startup

        this.isInitialized = true;
        console.log('[BotManager] Initialized');
    }

    /**
     * Spawn a bot instance
     * If bot already exists and is connected, returns existing instance
     * If bot exists but is disconnected, despawns it first and spawns a new one
     */
    async spawnBot(botId: string, config: BotConfiguration): Promise<BotClient> {
        // Check if bot already exists
        const existingInstance = this.bots.get(botId);
        if (existingInstance) {
            // Bot exists - check if it's connected
            if (existingInstance.client.isConnected()) {
                console.log(`[BotManager] Bot ${botId} already exists and is connected, returning existing instance`);
                return existingInstance.client;
            } else {
                // Bot exists but is disconnected - despawn it first
                console.log(`[BotManager] Bot ${botId} exists but is disconnected, despawning before respawn`);
                try {
                    await this.despawnBot(botId);
                } catch (error) {
                    console.warn(`[BotManager] Error despawning disconnected bot ${botId}:`, error);
                    // Continue anyway - try to remove from map manually
                    this.bots.delete(botId);
                }
            }
        }

        console.log(`[BotManager] Spawning bot: ${botId}`);

        // Create bot client config
        // BotClient requires: botId, name, roomUrl, pusherUrl, position, viewport, characterTextureIds
        const pusherUrl = process.env.PUSHER_URL || process.env.WORKADVENTURE_URL || 'http://localhost:8080';
        
        // Get position from assignedSpace.center (required field)
        const position = config.assignedSpace?.center || { x: 0, y: 0 };
        
        const botConfig = {
            botId,
            name: config.name || `Bot ${botId}`,
            roomUrl: config.roomUrl,
            pusherUrl: pusherUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
            position,
            viewport: { top: 0, bottom: 1000, left: 0, right: 1000 }, // TODO: Get from config
            characterTextureIds: config.characterTextureIds || [], // TODO: Get from config or WAM file
        };
        
        const client = new BotClient(botConfig);
        
        // Store botId mapping
        botIdMap.set(client, botId);
        
        // Set behavior based on config
        const { IdleBehavior, PatrolBehavior, SocialBehavior } = await import('../behaviors');
        
        let behavior;
        const behaviorConfig = config.behaviorConfig || { type: config.behaviorType };
        
        // Transform Admin API config format to behavior format
        const transformBehaviorConfig = (type: string, cfg: Record<string, any>): Record<string, any> => {
            const transformed = { ...cfg, type };
            
            // Transform patrol config: patrolWaypoints → waypoints
            if (type === 'patrol') {
                // Convert patrolWaypoints to waypoints (Admin API uses patrolWaypoints)
                console.log(`[BotManager] Transforming patrol config, patrolWaypoints:`, cfg.patrolWaypoints, `waypoints:`, cfg.waypoints);
                if (cfg.patrolWaypoints && Array.isArray(cfg.patrolWaypoints)) {
                    transformed.waypoints = cfg.patrolWaypoints;
                    console.log(`[BotManager] Set waypoints from patrolWaypoints:`, transformed.waypoints);
                } else if (cfg.waypoints && Array.isArray(cfg.waypoints)) {
                    // Already has waypoints, use it
                    transformed.waypoints = cfg.waypoints;
                    console.log(`[BotManager] Set waypoints from existing waypoints:`, transformed.waypoints);
                } else {
                    // No waypoints provided, use empty array
                    transformed.waypoints = [];
                    console.log(`[BotManager] No waypoints found, using empty array`);
                }
                // Ensure waypoints is always an array (safety check)
                if (!Array.isArray(transformed.waypoints)) {
                    console.warn(`[BotManager] Invalid waypoints for patrol bot, using empty array`);
                    transformed.waypoints = [];
                }
                console.log(`[BotManager] Final transformed waypoints:`, transformed.waypoints);
                // Ensure required fields have defaults
                if (typeof transformed.loop === 'undefined') transformed.loop = true;
                if (typeof transformed.pauseAtWaypoints === 'undefined') transformed.pauseAtWaypoints = 0;
                    if (typeof transformed.speed === 'undefined') transformed.speed = 50; // Match original bots branch default
                // Default to true for patrol bots - they should respond to players by default
                if (typeof transformed.respondToPlayers === 'undefined') transformed.respondToPlayers = true;
            }
            
            // Transform social config: ensure required fields
            if (type === 'social') {
                if (typeof transformed.conversationRadius === 'undefined') {
                    transformed.conversationRadius = cfg.conversationRadius || 200;
                }
                if (typeof transformed.minTimeBetweenConversations === 'undefined') {
                    transformed.minTimeBetweenConversations = cfg.minTimeBetweenConversations || 300000;
                }
                if (typeof transformed.maxConversationDuration === 'undefined') {
                    transformed.maxConversationDuration = 300000; // 5 minutes
                }
                if (typeof transformed.conversationHistorySize === 'undefined') {
                    transformed.conversationHistorySize = 50;
                }
                if (typeof transformed.respectPlayerStatus === 'undefined') {
                    transformed.respectPlayerStatus = true;
                }
                if (typeof transformed.maxConcurrentConversations === 'undefined') {
                    transformed.maxConcurrentConversations = 1;
                }
                if (!transformed.conversationTopics) transformed.conversationTopics = [];
                // Use assignedSpace for wander area
                if (config.assignedSpace) {
                    transformed.wanderRadius = config.assignedSpace.radius || 200;
                    transformed.wanderCenter = config.assignedSpace.center || { x: 0, y: 0 };
                } else {
                    transformed.wanderRadius = 200;
                    transformed.wanderCenter = { x: 0, y: 0 };
                }
                if (typeof transformed.wanderSpeed === 'undefined') transformed.wanderSpeed = 50;
                if (typeof transformed.approachDistance === 'undefined') transformed.approachDistance = 50;
            }
            
            // Ensure assignedSpace exists for all behaviors
            if (!transformed.assignedSpace && config.assignedSpace) {
                transformed.assignedSpace = config.assignedSpace;
            }
            
            return transformed;
        };
        
        // Helper to safely cast behavior config (comes from Admin API, may not match exact interface)
        const createBehavior = (type: string, cfg: Record<string, any>) => {
            console.log(`[BotManager] createBehavior called for type: ${type}, cfg keys:`, Object.keys(cfg));
            const transformedConfig = transformBehaviorConfig(type, cfg);
            console.log(`[BotManager] After transformation, waypoints:`, transformedConfig.waypoints);
            
            switch (type) {
                case 'idle':
                    return new IdleBehavior(transformedConfig as Parameters<typeof IdleBehavior>[0]);
                case 'patrol':
                    console.log(`[BotManager] Creating PatrolBehavior with config:`, JSON.stringify(transformedConfig, null, 2));
                    // Final safety check - ensure waypoints exists
                    if (!transformedConfig.waypoints || !Array.isArray(transformedConfig.waypoints)) {
                        console.error(`[BotManager] ERROR: waypoints is missing or invalid in transformed config!`, transformedConfig);
                        transformedConfig.waypoints = [];
                    }
                    console.log(`[BotManager] Final waypoints before constructor:`, transformedConfig.waypoints);
                    return new PatrolBehavior(transformedConfig as Parameters<typeof PatrolBehavior>[0]);
                case 'social':
                    return new SocialBehavior(transformedConfig as Parameters<typeof SocialBehavior>[0]);
                default:
                    throw new Error(`Unknown behavior type: ${type}`);
            }
        };
        
        behavior = createBehavior(config.behaviorType, behaviorConfig);

        client.setBehavior(behavior);

        // Connect bot
        try {
            await client.connect();
            
            // Initialize pathfinding after connection (non-blocking)
            this.initializePathfinding(client, config.roomUrl).catch(error => {
                console.warn(`[BotManager] Failed to initialize pathfinding for bot ${botId}:`, error);
                // Continue without pathfinding - graceful degradation
            });
            
            const instance: BotInstance = {
                botId,
                client,
                config,
                status: 'connected',
                lastHeartbeat: Date.now(),
            };

            this.bots.set(botId, instance);

            // Register in bot registry
            await this.botRegistry.assignBot(botId);

            console.log(`[BotManager] Bot ${botId} spawned successfully`);
            return client;
        } catch (error) {
            console.error(`[BotManager] Failed to spawn bot ${botId}:`, error);
            throw error;
        }
    }

    /**
     * Despawn a bot instance
     */
    async despawnBot(botId: string): Promise<void> {
        const instance = this.bots.get(botId);
        if (!instance) {
            console.warn(`[BotManager] Bot ${botId} not found`);
            return;
        }

        console.log(`[BotManager] Despawning bot: ${botId}`);

        try {
            // Disconnect bot
            await instance.client.disconnect();

            // Unregister from bot registry
            await this.botRegistry.unassignBot(botId);

            // Remove from map
            this.bots.delete(botId);

            // Remove from room tracking
            for (const [roomId, roomState] of this.roomsWithBots.entries()) {
                if (roomState.botIds.has(botId)) {
                    roomState.botIds.delete(botId);
                    // If room has no bots left, clean up room state
                    if (roomState.botIds.size === 0) {
                        this.roomsWithBots.delete(roomId);
                    }
                }
            }

            console.log(`[BotManager] Bot ${botId} despawned successfully`);
        } catch (error) {
            console.error(`[BotManager] Error despawning bot ${botId}:`, error);
            throw error;
        }
    }

    /**
     * Get bot instance
     */
    getBot(botId: string): BotClient | null {
        const instance = this.bots.get(botId);
        return instance?.client || null;
    }

    /**
     * Get all bot instances
     */
    getAllBots(): BotClient[] {
        return Array.from(this.bots.values()).map(instance => instance.client);
    }

    /**
     * Get all bot instances with metadata
     */
    getAllBotInstances(): BotInstance[] {
        return Array.from(this.bots.values());
    }

    /**
     * Update bot configuration (live update for running bot)
     */
    async updateBot(
        botId: string,
        updates: {
            position?: { x: number; y: number };
            behaviorConfig?: Record<string, unknown>;
            behaviorType?: string;
        }
    ): Promise<{ updated: boolean; reason?: string; changes?: string[] }> {
        const instance = this.bots.get(botId);
        if (!instance) {
            return { updated: false, reason: 'Bot not found or not running' };
        }

        const changes: string[] = [];

        // Handle position update (teleport)
        if (updates.position) {
            console.log(`[BotManager] Teleporting bot ${botId} to (${updates.position.x}, ${updates.position.y})`);
            instance.client.updateConfig({ position: updates.position });
            
            // Update stored config
            if (instance.config.assignedSpace) {
                instance.config.assignedSpace.center = updates.position;
            }
            changes.push('position');
        }

        // Handle behavior config or type change
        if (updates.behaviorConfig || updates.behaviorType) {
            const { IdleBehavior, PatrolBehavior, SocialBehavior } = await import('../behaviors');
            
            const newBehaviorType = updates.behaviorType || instance.config.behaviorType;
            const newBehaviorConfig = updates.behaviorConfig || instance.config.behaviorConfig || {};
            
            // Update stored config
            if (updates.behaviorType) {
                instance.config.behaviorType = updates.behaviorType as 'idle' | 'patrol' | 'social';
            }
            if (updates.behaviorConfig) {
                instance.config.behaviorConfig = { ...instance.config.behaviorConfig, ...updates.behaviorConfig };
            }
            
            // Transform config for behavior (similar to spawnBot)
            const transformBehaviorConfig = (type: string, cfg: Record<string, unknown>): Record<string, unknown> => {
                const transformed: Record<string, unknown> = { ...cfg };
                
                // Transform patrol waypoints
                if (type === 'patrol') {
                    if (cfg.patrolWaypoints && !cfg.waypoints) {
                        transformed.waypoints = cfg.patrolWaypoints;
                    }
                    if (typeof transformed.loop === 'undefined') transformed.loop = true;
                    if (typeof transformed.pauseAtWaypoints === 'undefined') transformed.pauseAtWaypoints = 0;
                    if (typeof transformed.speed === 'undefined') transformed.speed = 50; // Match original bots branch default
                    if (typeof transformed.respondToPlayers === 'undefined') transformed.respondToPlayers = false;
                }
                
                // Transform social config
                if (type === 'social') {
                    if (typeof transformed.conversationRadius === 'undefined') {
                        transformed.conversationRadius = (cfg.conversationRadius as number) || 200;
                    }
                    if (typeof transformed.minTimeBetweenConversations === 'undefined') {
                        transformed.minTimeBetweenConversations = 300000;
                    }
                    if (typeof transformed.maxConversationDuration === 'undefined') {
                        transformed.maxConversationDuration = 300000;
                    }
                    if (typeof transformed.conversationHistorySize === 'undefined') {
                        transformed.conversationHistorySize = 50;
                    }
                    if (typeof transformed.respectPlayerStatus === 'undefined') {
                        transformed.respectPlayerStatus = true;
                    }
                    if (typeof transformed.maxConcurrentConversations === 'undefined') {
                        transformed.maxConcurrentConversations = 1;
                    }
                    if (!transformed.conversationTopics) transformed.conversationTopics = [];
                    
                    // Use assignedSpace for wander area
                    const assignedSpace = (cfg.assignedSpace || instance.config.assignedSpace) as { center: { x: number; y: number }; radius: number } | undefined;
                    if (assignedSpace) {
                        transformed.wanderRadius = assignedSpace.radius || 200;
                        transformed.wanderCenter = assignedSpace.center || { x: 0, y: 0 };
                    } else {
                        transformed.wanderRadius = 200;
                        transformed.wanderCenter = { x: 0, y: 0 };
                    }
                    if (typeof transformed.wanderSpeed === 'undefined') transformed.wanderSpeed = 50;
                    if (typeof transformed.approachDistance === 'undefined') transformed.approachDistance = 50;
                }
                
                // Ensure assignedSpace exists for all behaviors
                if (!transformed.assignedSpace && instance.config.assignedSpace) {
                    transformed.assignedSpace = instance.config.assignedSpace;
                }
                
                return transformed;
            };
            
            const createBehavior = (type: string, cfg: Record<string, unknown>) => {
                const transformedConfig = transformBehaviorConfig(type, cfg);
                console.log(`[BotManager] Creating new ${type} behavior with config:`, JSON.stringify(transformedConfig, null, 2));
                
                switch (type) {
                    case 'idle':
                        return new IdleBehavior(transformedConfig as Parameters<typeof IdleBehavior>[0]);
                    case 'patrol':
                        // Final safety check for waypoints
                        if (!transformedConfig.waypoints || !Array.isArray(transformedConfig.waypoints)) {
                            transformedConfig.waypoints = [];
                        }
                        return new PatrolBehavior(transformedConfig as Parameters<typeof PatrolBehavior>[0]);
                    case 'social':
                        return new SocialBehavior(transformedConfig as Parameters<typeof SocialBehavior>[0]);
                    default:
                        throw new Error(`Unknown behavior type: ${type}`);
                }
            };
            
            const behavior = createBehavior(newBehaviorType, newBehaviorConfig);
            instance.client.setBehavior(behavior);
            
            if (updates.behaviorType) {
                changes.push('behaviorType');
            }
            if (updates.behaviorConfig) {
                changes.push('behaviorConfig');
            }
        }

        console.log(`[BotManager] Bot ${botId} updated: ${changes.join(', ')}`);
        return { updated: true, changes };
    }

    /**
     * Get bot status
     */
    getBotStatus(botId: string): BotInstance['status'] | null {
        const instance = this.bots.get(botId);
        return instance?.status || null;
    }

    /**
     * Summon a bot to a player's position
     * The bot will pathfind to the player, stop at their position, and initiate a bubble
     * When the player leaves, the bot will return to its assigned space center
     */
    async summonBot(
        botId: string,
        options: {
            playerUuid: string;
            targetPosition: { x: number; y: number };
        }
    ): Promise<void> {
        const instance = this.bots.get(botId);
        if (!instance) {
            throw new Error(`Bot ${botId} not found or not spawned`);
        }

        const bot = instance.client;
        if (!bot.isConnected()) {
            throw new Error(`Bot ${botId} is not connected`);
        }

        // Call summon on the bot client
        await bot.summonToPlayer(options.playerUuid, options.targetPosition);
        
        console.log(`[BotManager] Bot ${botId} summoned to player ${options.playerUuid} at (${options.targetPosition.x}, ${options.targetPosition.y})`);
    }

    /**
     * Handle a player entering a room
     * Initializes room if needed and ensures bots are spawned
     * Player count is tracked by verification system querying WA /rooms API
     */
    async handlePlayerEnterRoom(roomId: string): Promise<void> {
        let room = this.roomsWithBots.get(roomId);
        
        if (!room) {
            // Room doesn't exist - initialize it
            room = {
                botIds: new Set(),
                lastActivity: Date.now(),
            };
            this.roomsWithBots.set(roomId, room);
            console.log(`[BotManager] Room ${roomId} initialized`);
        } else {
            // Room exists - just update activity timestamp
            room.lastActivity = Date.now();
        }
        
        // Ensure bots are spawned
        await this.ensureBotsForRoom(roomId);
    }

    /**
     * Ensure bots are spawned for a room when players enter
     * This is called when a player enters a room to spawn all enabled bots for that room
     * Also syncs with Admin API to spawn new bots and despawn deleted ones
     * NOTE: This does NOT increment playerCount - use handlePlayerEnterRoom for that
     */
    async ensureBotsForRoom(roomId: string): Promise<void> {
        // Wait for any existing sync to complete (prevent race conditions)
        const existingLock = this.roomSyncLocks.get(roomId);
        if (existingLock) {
            console.log(`[BotManager] Waiting for existing sync for room: ${roomId}`);
            await existingLock;
        }

        // Create a new lock for this sync operation
        let releaseLock: () => void;
        const lockPromise = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        this.roomSyncLocks.set(roomId, lockPromise);

        try {
            await this._doEnsureBotsForRoom(roomId);
        } finally {
            releaseLock!();
            this.roomSyncLocks.delete(roomId);
        }
    }

    /**
     * Internal implementation of ensureBotsForRoom (called with lock held)
     */
    private async _doEnsureBotsForRoom(roomId: string): Promise<void> {
        const room = this.roomsWithBots.get(roomId);
        
        // Room should already exist (created by handlePlayerEnterRoom)
        // If it doesn't, something went wrong, but we'll continue anyway
        if (!room) {
            console.warn(`[BotManager] Room ${roomId} doesn't exist in ensureBotsForRoom - this shouldn't happen`);
        } else {
            // Update activity timestamp
            room.lastActivity = Date.now();
        }

        console.log(`[BotManager] Syncing bots for room: ${roomId}`);

        try {
            // Always load bot configs from Admin API to catch new/deleted bots
            const bots = await this.adminApiService.getBotConfigurations({ roomUrl: roomId });
            
            // Filter to only enabled bots (if enabled field exists)
            const enabledBots = bots.filter(bot => {
                // Check if bot has enabled field (may not be in BotConfiguration interface yet)
                const botAny = bot as any;
                return botAny.enabled !== false; // Default to enabled if field doesn't exist
            });

            // Ensure room exists (fallback - should already exist)
            if (!room) {
                const newRoom = {
                    botIds: new Set(),
                    lastActivity: Date.now(),
                };
                this.roomsWithBots.set(roomId, newRoom);
                console.warn(`[BotManager] Created room ${roomId} as fallback in ensureBotsForRoom`);
            }
            
            const targetRoom = room || this.roomsWithBots.get(roomId)!;

            // Get set of enabled bot IDs from Admin API
            const enabledBotIds = new Set(enabledBots.map(b => b.botId));
            
            // Despawn bots that are no longer in Admin API (deleted)
            for (const botId of targetRoom.botIds) {
                if (!enabledBotIds.has(botId)) {
                    console.log(`[BotManager] Despawning deleted bot ${botId}`);
                    await this.despawnBot(botId);
                    targetRoom.botIds.delete(botId);
                }
            }

            // Spawn new bots that aren't already running
            let newBotsSpawned = 0;
            for (const bot of enabledBots) {
                try {
                    // Check if bot is already spawned
                    if (this.bots.has(bot.botId)) {
                        targetRoom.botIds.add(bot.botId);
                        continue;
                    }

                    await this.spawnBot(bot.botId, bot);
                    targetRoom.botIds.add(bot.botId);
                    newBotsSpawned++;
                    console.log(`[BotManager] Spawned bot ${bot.botId} for room ${roomId}`);
                } catch (error) {
                    console.error(`[BotManager] Failed to spawn bot ${bot.botId} for room ${roomId}:`, error);
                    // Continue spawning other bots even if one fails
                }
            }

            if (newBotsSpawned > 0) {
                console.log(`[BotManager] Spawned ${newBotsSpawned} new bots for room ${roomId}`);
            }
            console.log(`[BotManager] Room ${roomId} has ${targetRoom.botIds.size} bots total`);
        } catch (error) {
            console.error(`[BotManager] Error ensuring bots for room ${roomId}:`, error);
            throw error;
        }
    }

    /**
     * Handle player leaving a room
     * When player count reaches 0, despawn all bots for that room
     */
    async handlePlayerLeaveRoom(roomId: string): Promise<void> {
        const room = this.roomsWithBots.get(roomId);
        if (!room) {
            return;
        }

        // Just update activity - verification system will check actual WA room count and despawn if empty
        room.lastActivity = Date.now();
        console.log(`[BotManager] Room ${roomId} activity updated (verification will check if room is empty)`);
    }

    /**
     * Get room state
     */
    getRoomState(roomId: string): RoomState | null {
        return this.roomsWithBots.get(roomId) || null;
    }

    /**
     * Update all bots (called from game loop)
     */
    update(deltaTime: number): void {
        this.bots.forEach((instance) => {
            if (instance.status === 'connected' && instance.client) {
                try {
                    instance.client.update(deltaTime);
                    instance.lastHeartbeat = Date.now();
                } catch (error) {
                    console.error(`[BotManager] Error updating bot ${instance.botId}:`, error);
                    instance.status = 'error';
                }
            }
        });
    }

    /**
     * Query WorkAdventure /rooms endpoint to get actual room occupancy
     * Returns a map of roomUrl -> userCount (includes bots)
     */
    private async queryWorkAdventureRooms(): Promise<Map<string, number>> {
        const pusherUrl = process.env.PUSHER_URL || process.env.WORKADVENTURE_URL || 'http://localhost:8080';
        const adminToken = process.env.ADMIN_API_TOKEN || '';
        
        if (!adminToken) {
            console.warn('[BotManager] ADMIN_API_TOKEN not set, skipping room verification');
            return new Map();
        }

        try {
            const url = `${pusherUrl}/rooms`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'admin-token': adminToken,
                },
            });

            if (!response.ok) {
                console.warn(`[BotManager] Failed to query WA rooms: ${response.status} ${response.statusText}`);
                return new Map();
            }

            const rooms: Record<string, number> = await response.json();
            const roomMap = new Map<string, number>();
            
            for (const [roomUrl, userCount] of Object.entries(rooms)) {
                roomMap.set(roomUrl, userCount);
            }

            return roomMap;
        } catch (error) {
            console.error('[BotManager] Error querying WA rooms:', error);
            return new Map();
        }
    }

    /**
     * Respawn bots for all rooms that have players (called on server startup after hot reload)
     */
    async respawnBotsForActiveRooms(): Promise<void> {
        console.log('[BotManager] Respawning bots for active rooms after server restart...');
        
        const waRooms = await this.queryWorkAdventureRooms();
        if (waRooms.size === 0) {
            console.log('[BotManager] No active rooms found - bots will spawn when players enter');
            return;
        }

        let respawnedCount = 0;
        for (const [roomId, userCount] of waRooms.entries()) {
            // Only respawn for rooms that have players (userCount > 0)
            // Note: userCount includes bots, so we need to check if there are real players
            if (userCount > 0) {
                try {
                    // Initialize room if needed
                    await this.handlePlayerEnterRoom(roomId);
                    respawnedCount++;
                    console.log(`[BotManager] Respawning bots for room ${roomId} (${userCount} users)`);
                } catch (error) {
                    console.error(`[BotManager] Failed to respawn bots for room ${roomId}:`, error);
                }
            }
        }

        if (respawnedCount > 0) {
            console.log(`[BotManager] Respawned bots for ${respawnedCount} active rooms`);
        } else {
            console.log('[BotManager] No rooms with players found - bots will spawn when players enter');
        }
    }

    /**
     * Verify room occupancy by comparing WA room counts with our bot counts
     * If WA says room has N users but we have N bots, the room is empty -> despawn
     */
    async verifyRoomOccupancy(): Promise<void> {
        console.log(`[BotManager] Verification running - checking ${this.roomsWithBots.size} rooms`);
        
        if (this.roomsWithBots.size === 0) {
            console.log('[BotManager] No rooms to verify');
            return; // No rooms to verify
        }

        const waRooms = await this.queryWorkAdventureRooms();
        console.log(`[BotManager] WA rooms query returned ${waRooms.size} rooms`);
        
        if (waRooms.size === 0) {
            console.warn('[BotManager] WA rooms query failed or returned no rooms');
            return; // Query failed or no rooms
        }

        for (const [roomId, roomState] of this.roomsWithBots.entries()) {
            const waUserCount = waRooms.get(roomId) || 0;
            const ourBotCount = roomState.botIds.size;

            // If WA reports exactly our bot count (or less), room is empty
            // WA user count includes bots, so if waUserCount <= ourBotCount, there are no real players
            // Add a small buffer (1) to account for timing/connection delays
            if (waUserCount <= ourBotCount) {
                // Double-check: are any bots actually connected?
                let connectedBots = 0;
                for (const botId of roomState.botIds) {
                    const instance = this.bots.get(botId);
                    if (instance && instance.status === 'connected') {
                        connectedBots++;
                    }
                }
                
                // Only despawn if WA count is significantly less than our connected bots
                // This prevents despawning when bots are still connecting or WA count is slightly off
                if (waUserCount < connectedBots - 1) {
                    console.log(
                        `[BotManager] Room ${roomId} appears empty: WA reports ${waUserCount} users, we have ${connectedBots} connected bots. Despawning bots.`
                    );
                    
                    // Despawn all bots for this room
                    const despawnPromises = Array.from(roomState.botIds).map(botId => 
                        this.despawnBot(botId).catch(error => {
                            console.error(`[BotManager] Error despawning bot ${botId} during verification:`, error);
                        })
                    );
                    
                    await Promise.all(despawnPromises);
                    this.roomsWithBots.delete(roomId);
                } else {
                    // WA count is close to our bot count, might be timing issue - keep bots
                    console.log(
                        `[BotManager] Room ${roomId} verification: WA reports ${waUserCount} users, we have ${connectedBots} connected bots. Keeping bots (possible timing issue).`
                    );
                }
            } else {
                // Room has real players (waUserCount > ourBotCount)
                const realPlayerCount = waUserCount - ourBotCount;
                console.log(
                    `[BotManager] Room ${roomId} has ${realPlayerCount} real player(s) (WA: ${waUserCount} total, bots: ${ourBotCount})`
                );
            }
        }
    }

    /**
     * Start periodic room occupancy verification
     */
    private startRoomVerification(): void {
        if (this.verificationInterval) {
            clearInterval(this.verificationInterval);
        }

        this.verificationInterval = setInterval(() => {
            void this.verifyRoomOccupancy();
        }, this.VERIFICATION_INTERVAL_MS);

        console.log(`[BotManager] Room verification started (every ${this.VERIFICATION_INTERVAL_MS / 1000}s)`);
    }

    /**
     * Stop periodic room occupancy verification
     */
    private stopRoomVerification(): void {
        if (this.verificationInterval) {
            clearInterval(this.verificationInterval);
            this.verificationInterval = null;
            console.log('[BotManager] Room verification stopped');
        }
    }

    /**
     * Initialize pathfinding for a bot
     */
    private async initializePathfinding(client: BotClient, roomUrl: string): Promise<void> {
        try {
            const mapData = await this.mapDataService.getMapData(roomUrl);
            if (mapData && mapData.collisionGrid && mapData.tileDimensions) {
                client.initializePathfinding(mapData.collisionGrid, mapData.tileDimensions);
                console.log(`[BotManager] Pathfinding initialized for room ${roomUrl}`);
            } else {
                console.log(`[BotManager] No collision data available for room ${roomUrl}, pathfinding disabled`);
            }
        } catch (error) {
            console.error(`[BotManager] Error initializing pathfinding for room ${roomUrl}:`, error);
            throw error;
        }
    }

    /**
     * Shutdown all bots gracefully
     */
    async shutdown(): Promise<void> {
        console.log('[BotManager] Shutting down all bots...');

        // Stop verification interval
        this.stopRoomVerification();

        const shutdownPromises = Array.from(this.bots.keys()).map(botId => this.despawnBot(botId));
        await Promise.all(shutdownPromises);

        // Clear room tracking
        this.roomsWithBots.clear();

        // Disconnect bot registry
        await this.botRegistry.disconnect();

        this.isInitialized = false;
        console.log('[BotManager] Shutdown complete');
    }
}

