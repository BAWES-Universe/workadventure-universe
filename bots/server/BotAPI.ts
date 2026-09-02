/**
 * BotAPI - REST API server for bot CRUD operations
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { BotManager } from './BotManager';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import type { BotConfiguration } from './AdminApiService';
import { movementLogger } from '../utils/MovementLogger';
import { MCPConnector } from '../mcp/MCPConnector';

export interface BotAPIRequest extends Request {
    userIdentifier?: string;
    isLogged?: boolean;
}

/**
 * Middleware to verify authentication token
 * Accepts only a v2 opaque Orbit session in the Authorization header.
 */
async function authenticateToken(
    req: BotAPIRequest,
    res: Response,
    next: NextFunction,
    adminApiService: AdminApiService
): Promise<void> {
    const path = req.path || req.originalUrl?.split('?')[0] || '';
    
    // Skip auth for movement endpoints (dev only) - safety check
    if (path.startsWith('/dev/movement/')) {
        const isDevMode = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';
        if (isDevMode) {
            next();
            return;
        }
    }
    
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (!/^orb_sess_v2_[0-9a-f]{64}$/.test(bearerToken)) {
        res.status(401).json({ error: 'Missing or invalid Orbit session' });
        return;
    }

    try {
        const userInfo = await adminApiService.validateSessionToken(bearerToken);
        if (!userInfo) {
            res.status(401).json({ error: 'Invalid or expired Orbit session' });
            return;
        }
        req.userIdentifier = userInfo.email || userInfo.uuid;
        req.isLogged = true;
        next();
    } catch (error) {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.error('[BotAPI] Orbit session validation failed:', error);
        }
        res.status(401).json({ error: 'Orbit session validation failed' });
    }
}

export class BotAPI {
    private app: express.Application;
    private botManager: BotManager;
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private server: any = null;

    constructor(botManager: BotManager, adminApiService: AdminApiService, botRegistry: BotRegistry) {
        console.log('[BotAPI] Constructor called');
        this.app = express();
        this.botManager = botManager;
        this.adminApiService = adminApiService;
        this.botRegistry = botRegistry;

        // Keep constructor simple - no route registration here
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        console.log('[BotAPI] setupMiddleware() called');
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS (if needed)
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });
        
    }

    private setupRoutes(): void {
        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        
        // Debug endpoint to check environment variables
        this.app.get('/api/debug/env', (req, res) => {
            res.json({
                ENABLE_MOVEMENT_LOGGING: process.env.ENABLE_MOVEMENT_LOGGING,
                NODE_ENV: process.env.NODE_ENV,
                isDevMode: process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development',
            });
        });

        // Room enter/leave endpoints (no auth required - safe public endpoints for bot spawning)
        // These are safe because they only trigger spawning/despawning based on player count
        this.app.post('/api/bots/room-enter', async (req: Request, res: Response) => {
            try {
                const { roomId } = req.body;

                if (!roomId) {
                    res.status(400).json({ error: 'Missing roomId' });
                    return;
                }

                // Handle player entering room (spawns bots)
                await this.botManager.handlePlayerEnterRoom(roomId);

                const roomState = this.botManager.getRoomState(roomId);
                res.json({
                    roomId,
                    botsSpawned: roomState?.botIds.size || 0,
                    // playerCount removed - verification system queries WA /rooms API for actual count
                });
            } catch (error: any) {
                console.error('[BotAPI] Error handling room enter:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Room leave - handle player leaving (may despawn bots if room is empty)
        this.app.post('/api/bots/room-leave', async (req: Request, res: Response) => {
            try {
                const { roomId } = req.body;

                if (!roomId) {
                    res.status(400).json({ error: 'Missing roomId' });
                    return;
                }

                // Handle player leaving (verification will despawn bots if room becomes empty)
                await this.botManager.handlePlayerLeaveRoom(roomId);

                const roomState = this.botManager.getRoomState(roomId);
                res.json({
                    roomId,
                    botsActive: roomState?.botIds.size || 0,
                    // playerCount removed - verification system queries WA /rooms API for actual count
                });
            } catch (error: any) {
                console.error('[BotAPI] Error handling room leave:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Summon bot to player position (no auth required - public endpoint for any player/guest)
        // This is safe because it only moves a bot to a player's position, doesn't modify configuration
        this.app.post('/api/bots/:botId/summon', async (req: Request, res: Response) => {
            try {
                const { botId } = req.params;
                const { playerUuid, playerX, playerY } = req.body;

                if (!playerUuid || playerX === undefined || playerY === undefined) {
                    res.status(400).json({ error: 'Missing required fields: playerUuid, playerX, playerY' });
                    return;
                }

                const bot = this.botManager.getBot(botId);
                if (!bot) {
                    res.status(404).json({ error: 'Bot not found or not spawned' });
                    return;
                }

                // Summon the bot to the player's position
                await this.botManager.summonBot(botId, {
                    playerUuid,
                    targetPosition: { x: playerX, y: playerY },
                });

                res.json({
                    botId,
                    summoned: true,
                    targetPosition: { x: playerX, y: playerY },
                });
            } catch (error: any) {
                console.error('[BotAPI] Error summoning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get bot emotions for a specific player (no auth required - public endpoint)
        // This allows players to see how a bot feels about them
        this.app.get('/api/bots/:botId/emotions/:userUuid', async (req: Request, res: Response) => {
            try {
                const { botId, userUuid } = req.params;

                if (!botId || !userUuid) {
                    res.status(400).json({ error: 'Missing botId or userUuid' });
                    return;
                }

                // Get bot instance
                const botInstance = this.botManager.getBotInstance(botId);
                if (!botInstance) {
                    // Bot not found - return default emotions
                    res.json({
                        botId,
                        userUuid,
                        emotions: {
                            botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                            personEmotion: { anger: 0, happiness: 50, trust: 50 },
                            lastEmotionUpdate: Date.now(),
                        },
                    });
                    return;
                }

                // Get conversation memory from bot
                const conversationMemory = botInstance.getConversationMemory?.();
                if (!conversationMemory) {
                    // Memory not available - return default emotions
                    res.json({
                        botId,
                        userUuid,
                        emotions: {
                            botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                            personEmotion: { anger: 0, happiness: 50, trust: 50 },
                            lastEmotionUpdate: Date.now(),
                        },
                    });
                    return;
                }

                // Find memory by userUuid - check both active and pre-loaded memories
                let emotions = null;

                // First try the optimized method that checks both active and pre-loaded memories
                if ('getMemoryByUserUuid' in conversationMemory && typeof (conversationMemory as any).getMemoryByUserUuid === 'function') {
                    const memory = (conversationMemory as any).getMemoryByUserUuid(botId, userUuid);
                    if (memory) {
                        emotions = memory.emotions;
                    }
                } else {
                    // Fallback: search active memories only - MUST filter by botId
                    const memories = conversationMemory.getAllMemories?.();
                    if (memories) {
                        for (const [key, memory] of memories.entries()) {
                            // CRITICAL: Check that this memory belongs to the correct bot
                            if (key.startsWith(`${botId}_`) && memory.userUuid === userUuid) {
                                emotions = memory.emotions;
                                break;
                            }
                        }
                    }
                }

                if (!emotions) {
                    // No memory exists yet - return default
                    emotions = {
                        botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                        personEmotion: { anger: 0, happiness: 50, trust: 50 },
                        lastEmotionUpdate: Date.now(),
                    };
                }

                res.json({ botId, userUuid, emotions });
            } catch (error: any) {
                console.error('[BotAPI] Error fetching emotions:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Spawn a specific bot immediately (called when bot is created in editor)
        this.app.post('/api/bots/spawn', async (req: Request, res: Response) => {
            try {
                const { botId, roomId } = req.body;

                if (!botId || !roomId) {
                    res.status(400).json({ error: 'Missing botId or roomId' });
                    return;
                }

                // Check if bot is already spawned
                if (this.botManager.getBot(botId)) {
                    res.json({
                        botId,
                        roomId,
                        spawned: true,
                        reason: 'Bot already spawned',
                    });
                    return;
                }

                // Get or create room state
                // If room state doesn't exist (e.g., last bot was despawned), create it
                // This assumes that if someone is using the UI to spawn bots, they must be in the room
                let roomState = this.botManager.getRoomState(roomId);
                if (!roomState) {
                    // Room state was deleted (likely because last bot was despawned)
                    // Recreate it since a player is using the UI (must be in the room)
                    console.log(`[BotAPI] Room state for ${roomId} doesn't exist, recreating it`);
                    await this.botManager.handlePlayerEnterRoom(roomId);
                    roomState = this.botManager.getRoomState(roomId);
                    if (!roomState) {
                        res.json({
                            botId,
                            roomId,
                            spawned: false,
                            reason: 'Failed to initialize room state',
                        });
                        return;
                    }
                }

                // Fetch bot config from Admin API
                const bots = await this.adminApiService.getBotConfigurations({ roomUrl: roomId });
                const botConfig = bots.find(b => b.botId === botId);

                if (!botConfig) {
                    res.status(404).json({ error: 'Bot not found in Admin API' });
                    return;
                }

                // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                MCPConnector.clearCache(botId);

                // Spawn the bot
                await this.botManager.spawnBot(botId, botConfig);
                roomState.botIds.add(botId);

                console.log(`[BotAPI] Spawned bot ${botId} for room ${roomId}`);
                res.json({
                    botId,
                    roomId,
                    spawned: true,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error spawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Despawn a specific bot immediately (called when bot is deleted in editor)
        this.app.post('/api/bots/despawn', async (req: Request, res: Response) => {
            try {
                const { botId, roomId } = req.body;

                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                // Check if bot exists
                if (!this.botManager.getBot(botId)) {
                    res.json({
                        botId,
                        despawned: false,
                        reason: 'Bot not currently spawned',
                    });
                    return;
                }

                // Despawn the bot
                await this.botManager.despawnBot(botId);

                // Remove from room tracking if roomId provided
                if (roomId) {
                    const roomState = this.botManager.getRoomState(roomId);
                    if (roomState) {
                        roomState.botIds.delete(botId);
                    }
                }

                console.log(`[BotAPI] Despawned bot ${botId}`);
                res.json({
                    botId,
                    despawned: true,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error despawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Update a running bot's config (live update)
        this.app.post('/api/bots/:botId/update', async (req: Request, res: Response) => {
            try {
                const { botId } = req.params;
                const { position, behaviorConfig, behaviorType } = req.body;

                console.log(`[BotAPI] Received update request for bot ${botId}:`, {
                    position,
                    behaviorType,
                    hasConfig: !!behaviorConfig,
                });

                const result = await this.botManager.updateBot(botId, {
                    position,
                    behaviorConfig,
                    behaviorType,
                } as Partial<BotConfiguration>);

                if (!result.updated) {
                    res.status(404).json({
                        botId,
                        updated: false,
                        reason: result.reason || 'Bot not found or not running',
                    });
                    return;
                }

                console.log(`[BotAPI] Updated bot ${botId}`);
                res.json({
                    botId,
                    updated: true,
                    changes: result.changes,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error updating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get available AI providers (for bot editor UI) - Public endpoint (only returns metadata, no credentials)
        this.app.get('/api/bots/ai-providers', async (req: Request, res: Response) => {
            try {
                const enabled = req.query.enabled === 'true' || req.query.enabled === undefined;
                const providers = await this.adminApiService.getAvailableAIProviders(enabled);
                res.json(providers);
            } catch (error: any) {
                console.error('[BotAPI] Error getting AI providers:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Apply authentication ONLY to /api/bots routes (NOT /api/debug, /dev/movement, etc.)
        // Movement endpoints are registered at /dev/movement/* to bypass any /api/* middleware
        // Use async wrapper since authenticateToken is now async and needs adminApiService
        this.app.use('/api/bots', async (req: BotAPIRequest, res: Response, next: NextFunction) => {
            await authenticateToken(req, res, next, this.adminApiService);
        });

        // List all bots for a room/world
        this.app.get('/api/bots', async (req: BotAPIRequest, res: Response) => {
            try {
                const roomUrl = req.query.roomUrl as string | undefined;
                const worldUrl = req.query.worldUrl as string | undefined;

                // TODO: Filter by roomUrl/worldUrl
                const instances = this.botManager.getAllBotInstances();
                const bots = instances.map(instance => ({
                    botId: instance.botId,
                    name: instance.config.name,
                    roomUrl: instance.config.roomUrl,
                    behaviorType: instance.config.behaviorType,
                    status: instance.status,
                }));

                res.json(bots);
            } catch (error: any) {
                console.error('[BotAPI] Error listing bots:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get bot configuration
        this.app.get('/api/bots/:botId', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const config = await this.adminApiService.getBotConfiguration(botId);
                if (!config) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                res.json(config);
            } catch (error: any) {
                console.error('[BotAPI] Error getting bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Create new bot
        this.app.post('/api/bots', async (req: BotAPIRequest, res: Response) => {
            try {
                const config: Partial<BotConfiguration> = req.body;

                // Validate required fields
                if (!config.roomUrl || !config.behaviorType) {
                    res.status(400).json({ error: 'Missing required fields: roomUrl, behaviorType' });
                    return;
                }

                // Generate bot ID
                const botId = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Save configuration to Admin API
                const now = new Date();
                const fullConfig: BotConfiguration = {
                    botId,
                    name: config.name || `Bot ${botId}`,
                    roomUrl: config.roomUrl,
                    worldUrl: config.worldUrl || '',
                    universeUrl: config.universeUrl,
                    userId: req.userIdentifier,
                    behaviorType: config.behaviorType,
                    behaviorConfig: config.behaviorConfig || { type: config.behaviorType },
                    aiProviderRef: config.aiProviderRef,
                    chatInstructions: config.chatInstructions,
                    assignedSpace: config.assignedSpace,
                    createdAt: now,
                    updatedAt: now,
                };

                await this.adminApiService.saveBotConfiguration({
                    ...fullConfig,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                res.status(201).json({ botId, config: fullConfig });
            } catch (error: any) {
                console.error('[BotAPI] Error creating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Update bot configuration
        this.app.put('/api/bots/:botId', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const updates: Partial<BotConfiguration> = req.body;

                // ADD DEBUG LOGGING
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] PUT /api/bots/${botId} received:`, {
                        hasBehaviorType: 'behaviorType' in updates,
                        behaviorType: updates.behaviorType,
                        hasBehaviorConfig: 'behaviorConfig' in updates,
                        behaviorConfigKeys: updates.behaviorConfig ? Object.keys(updates.behaviorConfig) : [],
                        allUpdateKeys: Object.keys(updates),
                    });
                }

                // Get existing config
                const existingConfig = await this.adminApiService.getBotConfiguration(botId);
                if (!existingConfig) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                // ADD DEBUG LOGGING
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] Existing config for ${botId}:`, {
                        behaviorType: existingConfig.behaviorType,
                        behaviorConfigKeys: existingConfig.behaviorConfig ? Object.keys(existingConfig.behaviorConfig) : [],
                    });
                }

                // Merge updates - but only include fields that are actually provided (not undefined)
                // This prevents undefined values from overwriting existing correct values
                const updatesToApply: Partial<BotConfiguration> = {};
                for (const [key, value] of Object.entries(updates)) {
                    // Only include defined values (exclude undefined, but allow null if needed)
                    if (value !== undefined) {
                        (updatesToApply as any)[key] = value;
                    }
                }
                
                // Normalize characterTextureId → characterTextureIds for merge
                if ('characterTextureId' in updatesToApply && !('characterTextureIds' in updatesToApply)) {
                    (updatesToApply as any).characterTextureIds = updatesToApply.characterTextureId
                        ? [updatesToApply.characterTextureId]
                        : [];
                }

                const updatedConfig: BotConfiguration = {
                    ...existingConfig,
                    ...updatesToApply,  // Only defined values
                    botId, // Ensure botId doesn't change
                };

                // CRITICAL: Ensure behaviorType is always set (never undefined) for response
                // If updates didn't include behaviorType or it was undefined, preserve existing value
                if (!updatedConfig.behaviorType) {
                    console.warn(`[BotAPI] Bot ${botId} missing behaviorType after merge, preserving existing: ${existingConfig.behaviorType}`);
                    updatedConfig.behaviorType = existingConfig.behaviorType;
                }

                // CRITICAL FIX: Only save behaviorType to Admin API if it was explicitly provided in updates
                // This prevents stale Admin API data from overwriting the running bot's behavior
                // If behaviorType was not in updates, don't save it (preserve what's in Admin API without overwriting)
                const shouldSaveBehaviorType = 'behaviorType' in updates;
                
                // ADD DEBUG LOGGING BEFORE SAVE
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] Saving config for ${botId}:`, {
                        behaviorTypeInUpdates: 'behaviorType' in updates,
                        behaviorTypeValue: updates.behaviorType,
                        existingBehaviorType: existingConfig.behaviorType,
                        willSaveBehaviorType: shouldSaveBehaviorType,
                        updatedConfigBehaviorType: updatedConfig.behaviorType,
                    });
                }
                
                if (!shouldSaveBehaviorType) {
                    // behaviorType was not provided in updates - don't save it to Admin API
                    // This prevents accidental resets when other fields (like position) are updated
                    // The running bot keeps its current behavior, and Admin API keeps its stored value
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] behaviorType not in updates, skipping save to Admin API to prevent stale data overwrite`);
                    }
                }
                
                // Save to Admin API
                // Build config to save: merge existing with updates, but exclude behaviorType if it wasn't in updates
                const finalConfigToSave: BotConfiguration = {
                    ...existingConfig,
                    ...updatesToApply, // Only fields explicitly provided in updates
                    botId, // Ensure botId doesn't change
                };
                
                // CRITICAL: If behaviorType wasn't in updates, preserve existing Admin API value
                // This prevents stale Admin API data from being re-saved and potentially causing issues
                // The running bot's behavior is managed by BotManager, not by Admin API saves
                if (!shouldSaveBehaviorType) {
                    // Keep existing Admin API value - don't change it
                    finalConfigToSave.behaviorType = existingConfig.behaviorType;
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] Preserving existing behaviorType in Admin API: ${existingConfig.behaviorType} (not in updates)`);
                    }
                } else {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] Saving behaviorType to Admin API: ${finalConfigToSave.behaviorType} (was in updates)`);
                    }
                }
                
                await this.adminApiService.saveBotConfiguration(finalConfigToSave);

                // Check if name or texture changed (require respawn)
                const nameChanged = 'name' in updates && updates.name !== existingConfig.name;
                const textureChanged = 'characterTextureIds' in updates && 
                    JSON.stringify(updates.characterTextureIds) !== JSON.stringify(existingConfig.characterTextureIds);

                // If name or texture changed and bot is running, despawn and respawn immediately
                if ((nameChanged || textureChanged) && this.botManager.getBot(botId)) {
                    console.log(`[BotAPI] Bot ${botId} name or texture changed, respawning with new config`);
                    // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                    MCPConnector.clearCache(botId);
                    // Despawn first
                    await this.botManager.despawnBot(botId);
                    // Wait a brief moment
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Respawn with updated config
                    await this.botManager.spawnBot(botId, updatedConfig);
                } else if (this.botManager.getBot(botId)) {
                    // Update running bot for other changes (AI config, behavior, etc.)
                    console.log(`[BotAPI] Updating running bot ${botId} with:`, {
                        hasAiProviderRef: 'aiProviderRef' in updates,
                        hasChatInstructions: 'chatInstructions' in updates,
                        chatInstructions: updates.chatInstructions?.substring(0, 100) || '(none)',
                        chatInstructionsLength: updates.chatInstructions?.length || 0,
                    });
                    await this.botManager.updateBot(botId, updates);
                } else {
                    console.log(`[BotAPI] Bot ${botId} is not running, skipping live update`);
                }

                res.json(updatedConfig);
            } catch (error: any) {
                console.error('[BotAPI] Error updating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Delete bot
        this.app.delete('/api/bots/:botId', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                // Despawn if running
                if (this.botManager.getBot(botId)) {
                    await this.botManager.despawnBot(botId);
                }

                // Delete from Admin API
                await this.adminApiService.deleteBotConfiguration(botId);

                res.status(204).send();
            } catch (error: any) {
                console.error('[BotAPI] Error deleting bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Spawn bot instance
        this.app.post('/api/bots/:botId/spawn', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                // Check if already spawned
                if (this.botManager.getBot(botId)) {
                    res.status(400).json({ error: 'Bot already spawned' });
                    return;
                }

                // Load configuration
                const config = await this.adminApiService.getBotConfiguration(botId);
                if (!config) {
                    res.status(404).json({ error: 'Bot configuration not found' });
                    return;
                }

                // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                MCPConnector.clearCache(botId);

                // Spawn bot
                await this.botManager.spawnBot(botId, config);

                res.json({ botId, status: 'spawned' });
            } catch (error: any) {
                console.error('[BotAPI] Error spawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Despawn bot instance
        this.app.post('/api/bots/:botId/despawn', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                await this.botManager.despawnBot(botId);

                res.json({ botId, status: 'despawned' });
            } catch (error: any) {
                console.error('[BotAPI] Error despawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get bot status
        this.app.get('/api/bots/:botId/status', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const status = this.botManager.getBotStatus(botId);
                const instance = this.botManager.getAllBotInstances().find(i => i.botId === botId);

                if (!status && !instance) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                res.json({
                    botId,
                    status: status || 'not_spawned',
                    lastHeartbeat: instance?.lastHeartbeat,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error getting bot status:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Metrics endpoints
        // Get current metrics for a bot (from buffer)
        this.app.get('/api/bots/:botId/metrics/current', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const metricsCollector = this.botManager.getMetricsCollector();
                
                if (!metricsCollector) {
                    res.status(503).json({ error: 'Metrics collector not available' });
                    return;
                }

                const metrics = metricsCollector.getCurrentMetrics(botId);
                res.json({ botId, metrics, count: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting current metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get metrics with time range (from Admin API)
        this.app.get('/api/bots/:botId/metrics', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const metricType = req.query.metricType as string | undefined;
                const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
                const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;
                const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
                const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

                const metrics = await this.adminApiService.getBotMetrics(botId, {
                    metricType,
                    startTime,
                    endTime,
                    limit,
                    offset,
                });

                res.json({ botId, metrics, count: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Record metrics (internal endpoint, uses BOT_SERVICE_TOKEN)
        this.app.post('/api/bots/metrics', async (req: Request, res: Response) => {
            try {
                const { metrics } = req.body;

                if (!Array.isArray(metrics)) {
                    res.status(400).json({ error: 'Metrics must be an array' });
                    return;
                }

                await this.adminApiService.saveBotMetrics(metrics);
                res.json({ saved: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error recording metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Test endpoints
        // Run test suite
        this.app.post('/api/bots/test/run-suite', async (req: BotAPIRequest, res: Response) => {
            try {
                const { testSuite, botId } = req.body;

                if (!testSuite || !botId) {
                    res.status(400).json({ error: 'Missing testSuite or botId' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available' });
                    return;
                }

                const testRun = await testRunner.runTestSuite(testSuite, botId);
                res.json(testRun);
            } catch (error: any) {
                console.error('[BotAPI] Error running test suite:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get test results
        this.app.get('/api/bots/test/results/:testId', async (req: BotAPIRequest, res: Response) => {
            try {
                const { testId } = req.params;
                
                // This would fetch from Admin API in a real implementation
                // For now, return not implemented
                res.status(501).json({ error: 'Not implemented - test results stored in Admin API' });
            } catch (error: any) {
                console.error('[BotAPI] Error getting test results:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Replay conversation
        this.app.post('/api/bots/test/replay', async (req: BotAPIRequest, res: Response) => {
            try {
                const { conversationId, newChatInstructions } = req.body;

                if (!conversationId) {
                    res.status(400).json({ error: 'Missing conversationId' });
                    return;
                }

                const conversationReplay = this.botManager.getConversationReplay();
                if (!conversationReplay) {
                    res.status(503).json({ error: 'Conversation replay not available' });
                    return;
                }

                const result = await conversationReplay.replayConversation(conversationId, newChatInstructions);
                res.json(result);
            } catch (error: any) {
                console.error('[BotAPI] Error replaying conversation:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get problematic conversations
        this.app.get('/api/bots/:botId/conversations/problematic', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const criteria = req.query.criteria ? JSON.parse(req.query.criteria as string) : undefined;

                const conversationReplay = this.botManager.getConversationReplay();
                if (!conversationReplay) {
                    res.status(503).json({ error: 'Conversation replay not available' });
                    return;
                }

                const problematic = conversationReplay.identifyProblematicConversations(botId, criteria);
                res.json({ botId, conversations: problematic, count: problematic.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting problematic conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Conversation storage endpoints (production)
        // Get recent conversations for a bot
        this.app.get('/api/bots/:botId/conversations', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
                const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
                const userId = req.query.userId ? (req.query.userId as string) : undefined; // Changed from playerId (number) to userId (string)
                const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
                const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;

                const conversationStorage = this.botManager.getConversationStorage();
                if (!conversationStorage) {
                    res.status(503).json({ error: 'Conversation storage not available' });
                    return;
                }

                const conversations = await conversationStorage.getConversations({
                    botId,
                    limit,
                    offset,
                    userId,
                    startDate,
                    endDate,
                });

                res.json({ botId, conversations, count: conversations.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get specific conversation
        this.app.get('/api/bots/:botId/conversations/:conversationId', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId, conversationId } = req.params;
                
                // This would fetch from Admin API in a real implementation
                res.status(501).json({ error: 'Not implemented - fetch from Admin API' });
            } catch (error: any) {
                console.error('[BotAPI] Error getting conversation:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get conversation stats
        this.app.get('/api/bots/:botId/conversations/stats', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const conversationStorage = this.botManager.getConversationStorage();
                if (!conversationStorage) {
                    res.status(503).json({ error: 'Conversation storage not available' });
                    return;
                }

                const stats = await conversationStorage.getConversationStats(botId);
                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error getting conversation stats:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Manual cleanup for specific bot (admin only)
        this.app.delete('/api/bots/:botId/conversations/cleanup', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const olderThanDays = req.query.olderThanDays ? parseInt(req.query.olderThanDays as string, 10) : undefined;
                const keepRecent = req.query.keepRecent ? parseInt(req.query.keepRecent as string, 10) : undefined;

                const conversationCleanup = this.botManager.getConversationCleanup();
                if (!conversationCleanup) {
                    res.status(503).json({ error: 'Conversation cleanup not available' });
                    return;
                }

                let stats;
                if (keepRecent !== undefined) {
                    stats = await conversationCleanup.cleanupByBot(botId, keepRecent);
                } else if (olderThanDays !== undefined) {
                    stats = await conversationCleanup.cleanupOldConversations(botId, olderThanDays);
                } else {
                    res.status(400).json({ error: 'Must provide olderThanDays or keepRecent' });
                    return;
                }

                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error cleaning up conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Manual cleanup for all bots (admin only)
        this.app.delete('/api/bots/conversations/cleanup', async (req: BotAPIRequest, res: Response) => {
            try {
                const olderThanDays = req.query.olderThanDays ? parseInt(req.query.olderThanDays as string, 10) : undefined;
                const maxPerBot = req.query.maxPerBot ? parseInt(req.query.maxPerBot as string, 10) : undefined;
                const maxTotal = req.query.maxTotal ? parseInt(req.query.maxTotal as string, 10) : undefined;

                const conversationCleanup = this.botManager.getConversationCleanup();
                if (!conversationCleanup) {
                    res.status(503).json({ error: 'Conversation cleanup not available' });
                    return;
                }

                const stats = await conversationCleanup.cleanupAll({
                    olderThanDays,
                    maxPerBot,
                    maxTotal,
                });

                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error cleaning up all conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Improvement endpoints (DEVELOPMENT ONLY - disabled in production)
        // Get improvement recommendations
        this.app.get('/api/bots/improve/recommendations', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                const botId = req.query.botId as string;
                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const autoImprovement = this.botManager.getAutoImprovement();
                if (!autoImprovement) {
                    res.status(503).json({ error: 'Auto-improvement not available (development mode required)' });
                    return;
                }

                const recommendations = await autoImprovement.analyzeAndRecommend(botId);
                res.json({ botId, recommendations, count: recommendations.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting improvement recommendations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get pending improvement tasks (for AI analysis)
        this.app.get('/api/bots/improve/tasks', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                // Tasks are stored as files - read from directory
                const tasksDir = process.env.IMPROVEMENT_TASKS_DIR || 
                    require('path').join(process.cwd(), 'bots', 'improvement-tasks');
                const fs = require('fs/promises');
                const path = require('path');
                
                try {
                    const files = await fs.readdir(tasksDir);
                    const taskFiles = files.filter((f: string) => f.endsWith('.json'));
                    
                    const tasks: any[] = [];
                    for (const file of taskFiles) {
                        try {
                            const content = await fs.readFile(path.join(tasksDir, file), 'utf-8');
                            const task = JSON.parse(content);
                            tasks.push(task);
                        } catch (error) {
                            // Skip invalid files
                        }
                    }
                    
                    // Sort by priority
                    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                    tasks.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
                    
                    res.json({ tasks, count: tasks.length, directory: tasksDir });
                } catch (error: any) {
                    if (error.code === 'ENOENT') {
                        res.json({ tasks: [], count: 0, directory: tasksDir, message: 'Tasks directory does not exist yet' });
                    } else {
                        throw error;
                    }
                }
            } catch (error: any) {
                console.error('[BotAPI] Error getting improvement tasks:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Run improvement cycle
        this.app.post('/api/bots/improve/cycle', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                const { botId } = req.body;
                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const improvementLoop = this.botManager.getSelfImprovementLoop();
                if (!improvementLoop) {
                    res.status(503).json({ error: 'Self-improvement loop not available (development mode required)' });
                    return;
                }

                const cycle = await improvementLoop.runImprovementCycle(botId);
                res.json(cycle);
            } catch (error: any) {
                console.error('[BotAPI] Error running improvement cycle:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Improvement tasks endpoint
        this.app.get('/api/bots/improve/tasks', async (req: BotAPIRequest, res: Response) => {
            await authenticateToken(req, res, async () => {
                try {
                    const autoPilot = this.botManager.getAutoPilot();
                    if (!autoPilot) {
                        res.status(503).json({ error: 'AutoPilot not available' });
                        return;
                    }

                    const status = req.query.status as string | undefined;
                    const tasks = await autoPilot.getPendingTasks();

                    const filtered = status
                        ? tasks.filter(t => t.status === status)
                        : tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

                    res.json({ tasks: filtered, total: filtered.length });
                } catch (error: any) {
                    console.error('[BotAPI] Error getting improvement tasks:', error);
                    res.status(500).json({ error: error.message });
                }
            }, this.adminApiService);
        });

        // Analytics endpoints
        // Get conversation analytics
        this.app.get('/api/bots/:botId/analytics', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
                const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;

                const analytics = (this.botManager as any).getConversationAnalytics?.();
                if (!analytics) {
                    res.status(503).json({ error: 'Conversation analytics not available' });
                    return;
                }

                const result = await analytics.getAnalytics(botId, startTime, endTime);
                res.json(result);
            } catch (error: any) {
                console.error('[BotAPI] Error getting analytics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get purpose distribution
        this.app.get('/api/bots/:botId/purposes', async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const analytics = (this.botManager as any).getConversationAnalytics?.();
                if (!analytics) {
                    res.status(503).json({ error: 'Conversation analytics not available' });
                    return;
                }

                const result = await analytics.getAnalytics(botId);
                res.json({ botId, purposeDistribution: result.purposeDistribution });
            } catch (error: any) {
                console.error('[BotAPI] Error getting purpose distribution:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // ========================================
        // ON-DEMAND TEST API (DEVELOPMENT ONLY)
        // These endpoints allow the AI assistant to run tests directly
        // ========================================

        // Run specific test cases on demand
        this.app.post('/api/test/run', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const { botId, testCases } = req.body;

                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available (only in development mode)' });
                    return;
                }

                // If no test cases provided, run default tests
                const cases = testCases && testCases.length > 0 ? testCases : [
                    { id: 'greeting', input: 'Hello!', expectedBehavior: { shouldContain: ['hello', 'hi', 'hey', 'greetings'] } },
                    { id: 'location', input: 'Where are we?', expectedBehavior: { shouldContain: ['universe', 'world', 'room', 'area'] } },
                    { id: 'memory', input: "I'm hungry", expectedBehavior: { shouldNotContain: ['[', ']', '<', '>'] } },
                ];

                // Create test suite object
                const testSuiteId = `ondemand-${Date.now()}`;
                const testSuite = {
                    id: testSuiteId,
                    name: `On-demand Test Suite`,
                    testCases: cases,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };

                // Run the tests
                const results = await testRunner.runTestSuite(testSuite, botId);

                res.json({
                    botId,
                    testSuiteId: results.id,
                    status: results.status,
                    summary: results.summary,
                    results: results.results,
                    duration: results.duration,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error running tests:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Simulate a full conversation (multi-turn)
        this.app.post('/api/test/conversation', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const { botId, messages, userName = 'Test User' } = req.body;

                if (!botId || !messages || !Array.isArray(messages) || messages.length === 0) {
                    res.status(400).json({ error: 'Missing botId or messages array' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available (only in development mode)' });
                    return;
                }

                // Convert messages to test cases with context preservation
                // Mark all conversation turns as preserveContext to maintain context across turns
                const testCases = messages.map((msg: string, index: number) => ({
                    id: `turn-${index + 1}`,
                    name: `Turn ${index + 1}`,
                    botId: botId as string,
                    chatInstructions: '',
                    input: msg,
                    expectedBehavior: {
                        shouldNotContain: ['[', ']', '<think>', '</think>', 'END_TOOL'],
                    },
                    metadata: {
                        preserveContext: true, // Don't clear memory between turns
                    },
                }));

                // Create test suite object
                const testSuiteId = `conversation-${Date.now()}`;
                const testSuite = {
                    id: testSuiteId,
                    name: `Conversation Test with ${userName}`,
                    testCases: testCases,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };

                // Run as a single conversation (preserves context)
                const results = await testRunner.runTestSuite(testSuite, botId);

                // Extract the conversation flow
                // Safety: Remove emotion blocks in case they leaked through (handle both complete and incomplete blocks)
                const conversationFlow = results.results.map((r: any) => {
                    let botResponse = r.response || '';
                    // Remove complete emotion blocks
                    botResponse = botResponse.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*?\[\/EMOTION_UPDATE\]/gi, '');
                    // Remove incomplete emotion blocks (missing closing tag)
                    botResponse = botResponse.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*$/gi, '');
                    botResponse = botResponse.trim();
                    return {
                        turn: r.testCaseId,
                        userMessage: r.input || testSuite.testCases.find((tc: any) => tc.id === r.testCaseId)?.input,
                        botResponse,
                        passed: r.passed,
                        responseTime: r.responseTime,
                        emotions: r.emotions, // Include emotions separately
                    };
                });

                res.json({
                    botId,
                    testSuiteId: results.id,
                    status: results.status,
                    summary: results.summary,
                    conversationFlow,
                    duration: results.duration,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error running conversation test:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get test runner status and capabilities
        this.app.get('/api/test/status', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const testRunner = this.botManager.getTestRunner();
                const autoPilot = this.botManager.getAutoPilot();

                res.json({
                    testRunnerAvailable: !!testRunner,
                    autoPilotAvailable: !!autoPilot,
                    autoPilotRunning: autoPilot?.isRunning() ?? false,
                    environment: process.env.NODE_ENV,
                    capabilities: {
                        runTests: !!testRunner,
                        runConversation: !!testRunner,
                        replayConversation: !!this.botManager.getConversationReplay(),
                    },
                });
            } catch (error: any) {
                console.error('[BotAPI] Error getting test status:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }

    /**
     * Start the API server
     */
    start(port: number = 3001): void {
        const isDevMode = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';
        
        if (isDevMode) {
            console.log('[BotAPI] Registering movement endpoints in start() (dev mode)');
            
            // Register movement endpoints - simple, no conditions
            this.app.get('/dev/movement/test', (req: Request, res: Response) => {
                res.json({ status: 'ok', message: 'Movement API is accessible', timestamp: new Date().toISOString() });
            });
            
            this.app.get('/dev/movement/logs', (req: Request, res: Response) => {
                try {
                    const botId = req.query.botId as string | undefined;
                    const count = parseInt(req.query.count as string || '100', 10);
                    if (botId) {
                        const events = movementLogger.getRecentEvents(botId, count);
                        res.json({ botId, events, count: events.length });
                    } else {
                        const allEvents = movementLogger.getAllEvents();
                        res.json({ events: allEvents.slice(-count), count: allEvents.length, total: allEvents.length });
                    }
                } catch (error: any) {
                    console.error('[BotAPI] Error getting movement logs:', error);
                    res.status(500).json({ error: error.message, events: [], count: 0 });
                }
            });
            
            this.app.get('/dev/movement/analyze/:botId', (req: Request, res: Response) => {
                try {
                    const { botId } = req.params;
                    const timeWindow = parseInt(req.query.timeWindow as string || '10000', 10);
                    const analysis = movementLogger.analyzeMovement(botId, timeWindow);
                    res.json({ botId, timeWindow, ...analysis });
                } catch (error: any) {
                    console.error('[BotAPI] Error analyzing movement:', error);
                    res.status(500).json({ error: error.message });
                }
            });
            
            this.app.get('/dev/movement/summary', (req: Request, res: Response) => {
                try {
                    const summary = movementLogger.getSummary();
                    res.json(summary);
                } catch (error: any) {
                    console.error('[BotAPI] Error getting movement summary:', error);
                    res.status(500).json({ error: error.message });
                }
            });
            
            console.log('[BotAPI] Movement endpoints registered at /dev/movement/*');
        }
        
        this.server = this.app.listen(port, () => {
            console.log(`[BotAPI] Server running on port ${port}`);
        });
    }
    
    /**
     * Stop the API server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('[BotAPI] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get Express app (for testing or custom server setup)
     */
    getApp(): express.Application {
        return this.app;
    }
}
