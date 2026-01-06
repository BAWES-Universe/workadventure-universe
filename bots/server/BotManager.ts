/**
 * BotManager - Core service to spawn, manage, and coordinate bot instances
 */

import { BotClient } from '../client/BotClient';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
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
    playerCount: number;
    lastActivity: number;
}

// Store botId mapping since BotClient doesn't expose it directly
const botIdMap = new WeakMap<BotClient, string>();

export class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private isInitialized = false;
    private roomsWithBots: Map<string, RoomState> = new Map();

    constructor(adminApiService: AdminApiService, botRegistry: BotRegistry) {
        this.adminApiService = adminApiService;
        this.botRegistry = botRegistry;
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

        // TODO: Load bots from storage (WAM files + Admin API)
        // This will be called on server startup

        this.isInitialized = true;
        console.log('[BotManager] Initialized');
    }

    /**
     * Spawn a bot instance
     */
    async spawnBot(botId: string, config: BotConfiguration): Promise<BotClient> {
        if (this.bots.has(botId)) {
            throw new Error(`Bot ${botId} already exists`);
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
                if (typeof transformed.speed === 'undefined') transformed.speed = 100;
                if (typeof transformed.respondToPlayers === 'undefined') transformed.respondToPlayers = false;
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
     * Update bot configuration
     */
    async updateBot(botId: string, config: Partial<BotConfiguration>): Promise<void> {
        const instance = this.bots.get(botId);
        if (!instance) {
            throw new Error(`Bot ${botId} not found`);
        }

        // Update config
        const updatedConfig = { ...instance.config, ...config };
        instance.config = updatedConfig;

        // Update behavior if behavior config changed
        if (config.behaviorConfig || config.behaviorType) {
            const { IdleBehavior, PatrolBehavior, SocialBehavior } = await import('../behaviors');
            
            let behavior;
            const behaviorType = config.behaviorType || updatedConfig.behaviorType;
            const behaviorConfig = config.behaviorConfig || updatedConfig.behaviorConfig || { type: behaviorType };
            
            // Helper to safely cast behavior config (comes from Admin API, may not match exact interface)
            const createBehavior = (type: string, cfg: Record<string, any>) => {
                switch (type) {
                    case 'idle':
                        return new IdleBehavior(cfg as Parameters<typeof IdleBehavior>[0]);
                    case 'patrol':
                        return new PatrolBehavior(cfg as Parameters<typeof PatrolBehavior>[0]);
                    case 'social':
                        return new SocialBehavior(cfg as Parameters<typeof SocialBehavior>[0]);
                    default:
                        throw new Error(`Unknown behavior type: ${type}`);
                }
            };
            
            behavior = createBehavior(behaviorType, behaviorConfig);

            instance.client.setBehavior(behavior);
        }

        console.log(`[BotManager] Bot ${botId} configuration updated`);
    }

    /**
     * Get bot status
     */
    getBotStatus(botId: string): BotInstance['status'] | null {
        const instance = this.bots.get(botId);
        return instance?.status || null;
    }

    /**
     * Ensure bots are spawned for a room when players enter
     * This is called when a player enters a room to spawn all enabled bots for that room
     */
    async ensureBotsForRoom(roomId: string): Promise<void> {
        const room = this.roomsWithBots.get(roomId);
        
        // If bots already spawned for this room, just update activity timestamp
        if (room && room.botIds.size > 0) {
            room.lastActivity = Date.now();
            room.playerCount++;
            console.log(`[BotManager] Room ${roomId} already has ${room.botIds.size} bots, player count: ${room.playerCount}`);
            return;
        }

        console.log(`[BotManager] Ensuring bots for room: ${roomId}`);

        try {
            // Load all enabled bots for this room from Admin API
            const bots = await this.adminApiService.getBotConfigurations({ roomUrl: roomId });
            
            // Filter to only enabled bots (if enabled field exists)
            const enabledBots = bots.filter(bot => {
                // Check if bot has enabled field (may not be in BotConfiguration interface yet)
                const botAny = bot as any;
                return botAny.enabled !== false; // Default to enabled if field doesn't exist
            });

            if (enabledBots.length === 0) {
                console.log(`[BotManager] No enabled bots found for room: ${roomId}`);
                return;
            }

            // Initialize room state
            const roomState: RoomState = {
                botIds: new Set(),
                playerCount: 1,
                lastActivity: Date.now(),
            };

            // Spawn each enabled bot
            for (const bot of enabledBots) {
                try {
                    // Check if bot is already spawned (might be from a previous room entry)
                    if (this.bots.has(bot.botId)) {
                        console.log(`[BotManager] Bot ${bot.botId} already spawned, adding to room tracking`);
                        roomState.botIds.add(bot.botId);
                        continue;
                    }

                    await this.spawnBot(bot.botId, bot);
                    roomState.botIds.add(bot.botId);
                    console.log(`[BotManager] Spawned bot ${bot.botId} for room ${roomId}`);
                } catch (error) {
                    console.error(`[BotManager] Failed to spawn bot ${bot.botId} for room ${roomId}:`, error);
                    // Continue spawning other bots even if one fails
                }
            }

            // Store room state
            this.roomsWithBots.set(roomId, roomState);
            console.log(`[BotManager] Spawned ${roomState.botIds.size} bots for room ${roomId}`);
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

        room.playerCount--;
        room.lastActivity = Date.now();

        // If no players left, despawn all bots for this room
        if (room.playerCount <= 0) {
            console.log(`[BotManager] No players left in room ${roomId}, despawning ${room.botIds.size} bots`);
            
            const despawnPromises = Array.from(room.botIds).map(botId => 
                this.despawnBot(botId).catch(error => {
                    console.error(`[BotManager] Error despawning bot ${botId}:`, error);
                })
            );

            await Promise.all(despawnPromises);
            this.roomsWithBots.delete(roomId);
            console.log(`[BotManager] Despawned all bots for room ${roomId}`);
        } else {
            console.log(`[BotManager] Room ${roomId} still has ${room.playerCount} players, keeping bots active`);
        }
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
     * Shutdown all bots gracefully
     */
    async shutdown(): Promise<void> {
        console.log('[BotManager] Shutting down all bots...');

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

