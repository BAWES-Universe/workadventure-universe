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

// Store botId mapping since BotClient doesn't expose it directly
const botIdMap = new WeakMap<BotClient, string>();

export class BotManager {
    private bots: Map<string, BotInstance> = new Map();
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private isInitialized = false;

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
        const botConfig = {
            botId,
            name: config.name || `Bot ${botId}`,
            roomUrl: config.roomUrl,
            pusherUrl: pusherUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
            position: { x: 0, y: 0 }, // TODO: Get from config or WAM file
            viewport: { top: 0, bottom: 1000, left: 0, right: 1000 }, // TODO: Get from config
            characterTextureIds: [], // TODO: Get from config or WAM file
        };
        
        const client = new BotClient(botConfig);
        
        // Store botId mapping
        botIdMap.set(client, botId);
        
        // Set behavior based on config
        const { IdleBehavior, PatrolBehavior, SocialBehavior } = await import('../behaviors');
        
        let behavior;
        const behaviorConfig = config.behaviorConfig || { type: config.behaviorType };
        
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
     * Shutdown all bots gracefully
     */
    async shutdown(): Promise<void> {
        console.log('[BotManager] Shutting down all bots...');

        const shutdownPromises = Array.from(this.bots.keys()).map(botId => this.despawnBot(botId));
        await Promise.all(shutdownPromises);

        // Disconnect bot registry
        await this.botRegistry.disconnect();

        this.isInitialized = false;
        console.log('[BotManager] Shutdown complete');
    }
}

