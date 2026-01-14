/**
 * BotAPI - REST API server for bot CRUD operations
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { BotManager } from './BotManager';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import type { BotConfiguration } from './AdminApiService';
import { movementLogger } from '../utils/MovementLogger';

export interface BotAPIRequest extends Request {
    userIdentifier?: string;
    isLogged?: boolean;
}

/**
 * Middleware to verify authentication token
 * Accepts Admin API session tokens (preferred) or WorkAdventure JWTs (fallback)
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
    
    // Try to get session token from query parameter (Admin API style)
    const sessionToken = req.query._token as string | undefined;
    
    // Try to get token from Authorization header
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Priority 1: Admin API session token (from query param or Authorization header)
    if (sessionToken || (bearerToken && !bearerToken.includes('.'))) {
        const token = sessionToken || bearerToken;
        if (!token) {
            res.status(401).json({ error: 'Missing session token' });
            return;
        }

        try {
            // Validate session token with Admin API
            const userInfo = await adminApiService.validateSessionToken(token);
            if (!userInfo) {
                res.status(401).json({ error: 'Invalid or expired session token' });
                return;
            }

            req.userIdentifier = userInfo.email || userInfo.uuid;
            req.isLogged = true;
            next();
            return;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[BotAPI] Session token validation error:', error);
            }
            res.status(401).json({ error: 'Session token validation failed' });
            return;
        }
    }

    // Priority 2: WorkAdventure JWT (fallback for backward compatibility)
    if (bearerToken && bearerToken.includes('.')) {
        try {
            // Extract user identifier from JWT (no signature verification for now)
            // This is a fallback - session tokens are preferred
            const base64Url = bearerToken.split('.')[1];
            if (!base64Url) {
                res.status(401).json({ error: 'Invalid JWT token' });
                return;
            }
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64)
                    .split('')
                    .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                    .join('')
            );
            const payload = JSON.parse(jsonPayload);
            
            req.userIdentifier = payload.identifier;
            req.isLogged = !!(payload.accessToken || payload.identifier);
            
            if (!req.isLogged) {
                res.status(401).json({ error: 'User not authenticated' });
                return;
            }

            next();
            return;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[BotAPI] JWT token verification error:', error);
            }
            res.status(401).json({ error: 'Invalid JWT token' });
            return;
        }
    }

    // No valid token found
    res.status(401).json({ error: 'Missing authorization token' });
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
                });

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
                    movementInstructions: config.movementInstructions,
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

                // Get existing config
                const existingConfig = await this.adminApiService.getBotConfiguration(botId);
                if (!existingConfig) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                // Merge updates
                const updatedConfig: BotConfiguration = {
                    ...existingConfig,
                    ...updates,
                    botId, // Ensure botId doesn't change
                };

                // Save to Admin API
                await this.adminApiService.saveBotConfiguration(updatedConfig);

                // Check if name or texture changed (require respawn)
                const nameChanged = 'name' in updates && updates.name !== existingConfig.name;
                const textureChanged = 'characterTextureIds' in updates && 
                    JSON.stringify(updates.characterTextureIds) !== JSON.stringify(existingConfig.characterTextureIds);

                // If name or texture changed and bot is running, despawn and respawn immediately
                if ((nameChanged || textureChanged) && this.botManager.getBot(botId)) {
                    console.log(`[BotAPI] Bot ${botId} name or texture changed, respawning with new config`);
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
                        hasMovementInstructions: 'movementInstructions' in updates,
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

