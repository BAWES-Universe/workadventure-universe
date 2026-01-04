/**
 * BotServerCoordinator - Coordinates bot distribution across multiple servers
 * 
 * Handles bot assignment, load balancing, and coordination between
 * multiple bot server instances for horizontal scaling.
 */

import { BotRegistry, type BotServerInfo } from './BotRegistry';
import type { BotClient } from '../client/BotClient';

export interface BotConfig {
    botId: string;
    name: string;
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    userId?: string;
    behaviorType: 'idle' | 'patrol' | 'social';
    behaviorConfig: Record<string, any>;
    position: { x: number; y: number };
    [key: string]: any;
}

export interface BotServerCoordinatorConfig {
    serverId: string;
    maxBotsPerServer: number;
    redisConfig?: {
        host?: string;
        port?: number;
        password?: string;
        db?: number;
    };
}

export class BotServerCoordinator {
    private registry: BotRegistry;
    private serverId: string;
    private maxBotsPerServer: number;
    private localBots: Map<string, BotClient> = new Map();

    constructor(config: BotServerCoordinatorConfig) {
        this.serverId = config.serverId;
        this.maxBotsPerServer = config.maxBotsPerServer;
        
        this.registry = new BotRegistry(config.serverId, config.redisConfig);
    }

    /**
     * Initialize the coordinator (connect to Redis, register server)
     */
    async initialize(): Promise<void> {
        await this.registry.connect();
        await this.registry.registerServer(this.maxBotsPerServer);
        console.log(`[BotServerCoordinator] Server ${this.serverId} registered with capacity ${this.maxBotsPerServer}`);
    }

    /**
     * Shutdown the coordinator (cleanup, unregister)
     */
    async shutdown(): Promise<void> {
        // Unassign all local bots
        for (const [botId] of this.localBots) {
            await this.registry.unassignBot(botId);
        }
        
        await this.registry.disconnect();
        console.log(`[BotServerCoordinator] Server ${this.serverId} shutdown complete`);
    }

    /**
     * Assign a bot to this server or find another server with capacity
     */
    async assignBot(botConfig: BotConfig): Promise<{ serverId: string; shouldSpawn: boolean }> {
        // Check if bot is already assigned
        const existingServer = await this.registry.getBotServer(botConfig.botId);
        if (existingServer) {
            return {
                serverId: existingServer,
                shouldSpawn: existingServer === this.serverId,
            };
        }

        // Check if this server has capacity
        const serverInfo = await this.registry.getServerInfo(this.serverId);
        if (serverInfo && serverInfo.currentBots < serverInfo.capacity) {
            await this.registry.assignBot(botConfig.botId);
            return {
                serverId: this.serverId,
                shouldSpawn: true,
            };
        }

        // Find another server with capacity
        const availableServer = await this.registry.findServerWithCapacity();
        if (availableServer) {
            // Assign to that server (they will spawn it)
            await this.registry.assignBot(botConfig.botId);
            // Note: In a real implementation, you'd publish a message to a queue
            // for the target server to pick up. For now, we'll just assign it.
            return {
                serverId: availableServer,
                shouldSpawn: false,
            };
        }

        // No capacity available
        throw new Error(`No server capacity available for bot ${botConfig.botId}`);
    }

    /**
     * Register a locally spawned bot
     */
    async registerLocalBot(botId: string, bot: BotClient): Promise<void> {
        this.localBots.set(botId, bot);
        await this.registry.assignBot(botId);
    }

    /**
     * Unregister a local bot
     */
    async unregisterLocalBot(botId: string): Promise<void> {
        this.localBots.delete(botId);
        await this.registry.unassignBot(botId);
    }

    /**
     * Check if a bot can start a conversation
     */
    async canBotStartConversation(botId: string, playerId: number): Promise<boolean> {
        return await this.registry.canBotStartConversation(botId, playerId);
    }

    /**
     * Track a conversation
     */
    async trackConversation(
        playerId: number,
        botId: string,
        spaceName: string
    ): Promise<void> {
        await this.registry.trackConversation(playerId, botId, spaceName);
    }

    /**
     * Update conversation activity
     */
    async updateConversation(playerId: number): Promise<void> {
        await this.registry.updateConversation(playerId);
    }

    /**
     * End a conversation
     */
    async endConversation(playerId: number): Promise<void> {
        await this.registry.endConversation(playerId);
    }

    /**
     * Get registry instance (for direct access if needed)
     */
    getRegistry(): BotRegistry {
        return this.registry;
    }

    /**
     * Get local bot count
     */
    getLocalBotCount(): number {
        return this.localBots.size;
    }

    /**
     * Get total bot count across all servers
     */
    async getTotalBotCount(): Promise<number> {
        return await this.registry.getTotalBotCount();
    }

    /**
     * Get cluster status
     */
    async getClusterStatus(): Promise<{
        serverId: string;
        localBots: number;
        totalBots: number;
        servers: BotServerInfo[];
    }> {
        const servers = await this.registry.getActiveServers();
        const totalBots = await this.registry.getTotalBotCount();

        return {
            serverId: this.serverId,
            localBots: this.localBots.size,
            totalBots,
            servers,
        };
    }

    /**
     * Check if this server should accept a bot assignment
     */
    async shouldAcceptBot(): Promise<boolean> {
        const serverInfo = await this.registry.getServerInfo(this.serverId);
        if (!serverInfo) {
            return false;
        }

        return serverInfo.currentBots < serverInfo.capacity;
    }
}

