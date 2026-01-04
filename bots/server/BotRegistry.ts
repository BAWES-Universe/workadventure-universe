/**
 * BotRegistry - Redis-based registry for horizontal scaling
 * 
 * Tracks bot instances across multiple bot server instances.
 * Uses Redis for shared state coordination.
 */

import { createClient, type RedisClientType, commandOptions } from 'redis';

export interface BotServerInfo {
    serverId: string;
    capacity: number;
    currentBots: number;
    status: 'active' | 'inactive' | 'shutting_down';
    lastHeartbeat: number;
}

export interface ConversationState {
    botId: string;
    playerId: number;
    spaceName: string;
    startTime: number;
    lastMessageTime: number;
}

export interface BotAssignment {
    botId: string;
    serverId: string;
    assignedAt: number;
}

export class BotRegistry {
    private redis: RedisClientType | null = null;
    private serverId: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
    private readonly CONVERSATION_TTL = 300; // 5 minutes

    constructor(
        serverId: string,
        redisConfig?: {
            host?: string;
            port?: number;
            password?: string;
            db?: number;
        }
    ) {
        this.serverId = serverId;
        
        const host = redisConfig?.host || process.env.REDIS_HOST || 'redis';
        const port = redisConfig?.port || parseInt(process.env.REDIS_PORT || '6379');
        const password = redisConfig?.password || process.env.REDIS_PASSWORD;
        const db = redisConfig?.db || parseInt(process.env.REDIS_DB_NUMBER || '1'); // Default to DB 1 for bots

        if (host) {
            const config: any = {
                socket: {
                    host,
                    port,
                },
            };

            if (password) {
                config.password = password;
            }

            this.redis = createClient(config);

            this.redis.on('error', (err) => {
                console.error('[BotRegistry] Redis error:', err);
            });

            this.redis.on('connect', () => {
                console.log('[BotRegistry] Connected to Redis');
            });

            this.redis.on('ready', async () => {
                // Select database
                try {
                    await this.redis!.select(db);
                    console.log(`[BotRegistry] Selected Redis database ${db}`);
                } catch (err) {
                    console.error(`[BotRegistry] Failed to select database ${db}:`, err);
                }
                
                // Start heartbeat
                this.startHeartbeat();
            });
        }
    }

    async connect(): Promise<void> {
        if (this.redis && !this.redis.isOpen) {
            await this.redis.connect();
        }
    }

    async disconnect(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.redis && this.redis.isOpen) {
            // Mark server as shutting down
            await this.markServerShuttingDown();
            
            // Unassign all bots from this server
            await this.unassignAllBotsFromServer();
            
            await this.redis.quit();
        }
    }

    /**
     * Register this bot server with its capacity
     */
    async registerServer(capacity: number): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            throw new Error('Redis not connected');
        }

        const serverInfo: BotServerInfo = {
            serverId: this.serverId,
            capacity,
            currentBots: 0,
            status: 'active',
            lastHeartbeat: Date.now(),
        };

        await this.redis.hSet(
            `bot:server:${this.serverId}`,
            {
                capacity: capacity.toString(),
                currentBots: '0',
                status: 'active',
                lastHeartbeat: Date.now().toString(),
            }
        );

        // Set expiration (if server doesn't heartbeat in 30 seconds, consider it dead)
        await this.redis.expire(`bot:server:${this.serverId}`, 30);
    }

    /**
     * Start heartbeat to keep server registration alive
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            return;
        }

        this.heartbeatInterval = setInterval(async () => {
            if (this.redis && this.redis.isOpen) {
                try {
                    await this.redis.hSet(
                        `bot:server:${this.serverId}`,
                        'lastHeartbeat',
                        Date.now().toString()
                    );
                    await this.redis.expire(`bot:server:${this.serverId}`, 30);
                } catch (err) {
                    console.error('[BotRegistry] Heartbeat error:', err);
                }
            }
        }, this.HEARTBEAT_INTERVAL);
    }

    /**
     * Assign a bot to this server
     */
    async assignBot(botId: string): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            throw new Error('Redis not connected');
        }

        // Store bot assignment
        await this.redis.set(
            `bot:assignment:${botId}`,
            this.serverId,
            { EX: 3600 } // Expire after 1 hour if not updated
        );

        // Increment bot count for this server
        await this.redis.hIncrBy(`bot:server:${this.serverId}`, 'currentBots', 1);
    }

    /**
     * Unassign a bot from this server
     */
    async unassignBot(botId: string): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        const serverId = await this.redis.get(`bot:assignment:${botId}`);
        
        if (serverId) {
            await this.redis.del(`bot:assignment:${botId}`);
            await this.redis.hIncrBy(`bot:server:${serverId}`, 'currentBots', -1);
        }
    }

    /**
     * Unassign all bots from this server (on shutdown)
     */
    private async unassignAllBotsFromServer(): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        // Find all bot assignments for this server
        const keys = await this.redis.keys('bot:assignment:*');
        
        for (const key of keys) {
            const serverId = await this.redis.get(key);
            if (serverId === this.serverId) {
                await this.redis.del(key);
            }
        }
    }

    /**
     * Mark server as shutting down
     */
    private async markServerShuttingDown(): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        await this.redis.hSet(`bot:server:${this.serverId}`, 'status', 'shutting_down');
    }

    /**
     * Find a server with available capacity
     */
    async findServerWithCapacity(): Promise<string | null> {
        if (!this.redis || !this.redis.isOpen) {
            return null;
        }

        const serverKeys = await this.redis.keys('bot:server:*');
        const now = Date.now();

        for (const serverKey of serverKeys) {
            const serverData = await this.redis.hGetAll(serverKey);
            
            if (!serverData || Object.keys(serverData).length === 0) {
                continue;
            }

            const status = serverData.status;
            const lastHeartbeat = parseInt(serverData.lastHeartbeat || '0');
            const capacity = parseInt(serverData.capacity || '0');
            const currentBots = parseInt(serverData.currentBots || '0');

            // Skip inactive or dead servers
            if (status !== 'active' || now - lastHeartbeat > 30000) {
                continue;
            }

            // Check if server has capacity
            if (currentBots < capacity) {
                const serverId = serverKey.replace('bot:server:', '');
                return serverId;
            }
        }

        return null;
    }

    /**
     * Get server info
     */
    async getServerInfo(serverId: string): Promise<BotServerInfo | null> {
        if (!this.redis || !this.redis.isOpen) {
            return null;
        }

        const serverData = await this.redis.hGetAll(`bot:server:${serverId}`);
        
        if (!serverData || Object.keys(serverData).length === 0) {
            return null;
        }

        return {
            serverId,
            capacity: parseInt(serverData.capacity || '0'),
            currentBots: parseInt(serverData.currentBots || '0'),
            status: (serverData.status || 'inactive') as BotServerInfo['status'],
            lastHeartbeat: parseInt(serverData.lastHeartbeat || '0'),
        };
    }

    /**
     * Get which server a bot is assigned to
     */
    async getBotServer(botId: string): Promise<string | null> {
        if (!this.redis || !this.redis.isOpen) {
            return null;
        }

        return await this.redis.get(`bot:assignment:${botId}`);
    }

    /**
     * Track an active conversation
     */
    async trackConversation(
        playerId: number,
        botId: string,
        spaceName: string
    ): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        const conversation: ConversationState = {
            botId,
            playerId,
            spaceName,
            startTime: Date.now(),
            lastMessageTime: Date.now(),
        };

        await this.redis.setEx(
            `bot:conversation:${playerId}`,
            this.CONVERSATION_TTL,
            JSON.stringify(conversation)
        );
    }

    /**
     * Update conversation last message time
     */
    async updateConversation(playerId: number): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        const conversationStr = await this.redis.get(`bot:conversation:${playerId}`);
        if (conversationStr) {
            const conversation: ConversationState = JSON.parse(conversationStr);
            conversation.lastMessageTime = Date.now();
            
            await this.redis.setEx(
                `bot:conversation:${playerId}`,
                this.CONVERSATION_TTL,
                JSON.stringify(conversation)
            );
        }
    }

    /**
     * End a conversation
     */
    async endConversation(playerId: number): Promise<void> {
        if (!this.redis || !this.redis.isOpen) {
            return;
        }

        await this.redis.del(`bot:conversation:${playerId}`);
    }

    /**
     * Check if a player is in a conversation
     */
    async isPlayerInConversation(playerId: number): Promise<boolean> {
        if (!this.redis || !this.redis.isOpen) {
            return false;
        }

        return (await this.redis.exists(`bot:conversation:${playerId}`)) === 1;
    }

    /**
     * Get conversation state for a player
     */
    async getConversation(playerId: number): Promise<ConversationState | null> {
        if (!this.redis || !this.redis.isOpen) {
            return null;
        }

        const conversationStr = await this.redis.get(`bot:conversation:${playerId}`);
        if (!conversationStr) {
            return null;
        }

        return JSON.parse(conversationStr) as ConversationState;
    }

    /**
     * Check if a bot can start a conversation with a player
     */
    async canBotStartConversation(botId: string, playerId: number): Promise<boolean> {
        if (!this.redis || !this.redis.isOpen) {
            return false;
        }

        // Check if player is already in a conversation
        const inConversation = await this.isPlayerInConversation(playerId);
        if (inConversation) {
            const conversation = await this.getConversation(playerId);
            // Allow if it's the same bot continuing the conversation
            return conversation?.botId === botId;
        }

        return true;
    }

    /**
     * Get all active servers
     */
    async getActiveServers(): Promise<BotServerInfo[]> {
        if (!this.redis || !this.redis.isOpen) {
            return [];
        }

        const serverKeys = await this.redis.keys('bot:server:*');
        const servers: BotServerInfo[] = [];
        const now = Date.now();

        for (const serverKey of serverKeys) {
            const serverData = await this.redis.hGetAll(serverKey);
            
            if (!serverData || Object.keys(serverData).length === 0) {
                continue;
            }

            const lastHeartbeat = parseInt(serverData.lastHeartbeat || '0');
            
            // Only include servers that have heartbeated in the last 30 seconds
            if (now - lastHeartbeat < 30000) {
                const serverId = serverKey.replace('bot:server:', '');
                servers.push({
                    serverId,
                    capacity: parseInt(serverData.capacity || '0'),
                    currentBots: parseInt(serverData.currentBots || '0'),
                    status: (serverData.status || 'inactive') as BotServerInfo['status'],
                    lastHeartbeat,
                });
            }
        }

        return servers;
    }

    /**
     * Get total bot count across all servers
     */
    async getTotalBotCount(): Promise<number> {
        if (!this.redis || !this.redis.isOpen) {
            return 0;
        }

        const servers = await this.getActiveServers();
        return servers.reduce((sum, server) => sum + server.currentBots, 0);
    }
}

