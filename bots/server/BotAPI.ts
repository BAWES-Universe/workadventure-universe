/**
 * BotAPI - REST API server for bot CRUD operations
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { BotManager } from './BotManager';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import type { BotConfiguration } from './AdminApiService';

export interface BotAPIRequest extends Request {
    userIdentifier?: string;
    isLogged?: boolean;
}

/**
 * Middleware to verify JWT token
 */
function authenticateToken(req: BotAPIRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        res.status(401).json({ error: 'Missing authorization token' });
        return;
    }

    try {
        // TODO: Verify JWT token using WorkAdventure's JWT verification
        // For now, we'll extract user identifier from token
        // In production, use proper JWT verification
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        const payload = JSON.parse(jsonPayload);
        
        req.userIdentifier = payload.identifier;
        req.isLogged = !!payload.accessToken;
        
        if (!req.isLogged) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        next();
    } catch (error) {
        console.error('[BotAPI] Token verification error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
}

export class BotAPI {
    private app: express.Application;
    private botManager: BotManager;
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private server: any = null;

    constructor(botManager: BotManager, adminApiService: AdminApiService, botRegistry: BotRegistry) {
        this.app = express();
        this.botManager = botManager;
        this.adminApiService = adminApiService;
        this.botRegistry = botRegistry;

        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
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

        // Room enter/leave endpoints (no auth required - safe public endpoints for bot spawning)
        // These are safe because they only trigger spawning/despawning based on player count
        this.app.post('/api/bots/room-enter', async (req: Request, res: Response) => {
            try {
                const { roomId } = req.body;

                if (!roomId) {
                    res.status(400).json({ error: 'Missing roomId' });
                    return;
                }

                // Ensure bots are spawned for this room
                await this.botManager.ensureBotsForRoom(roomId);

                const roomState = this.botManager.getRoomState(roomId);
                res.json({
                    roomId,
                    botsSpawned: roomState?.botIds.size || 0,
                    playerCount: roomState?.playerCount || 0,
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

                // Handle player leaving (will despawn bots if room becomes empty)
                await this.botManager.handlePlayerLeaveRoom(roomId);

                const roomState = this.botManager.getRoomState(roomId);
                res.json({
                    roomId,
                    botsActive: roomState?.botIds.size || 0,
                    playerCount: roomState?.playerCount || 0,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error handling room leave:', error);
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

                // Check if room has active players (only spawn if players are present)
                const roomState = this.botManager.getRoomState(roomId);
                if (!roomState || roomState.playerCount === 0) {
                    res.json({
                        botId,
                        roomId,
                        spawned: false,
                        reason: 'No players in room - bot will spawn when a player enters',
                    });
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

        // All other routes require authentication
        this.app.use(authenticateToken);

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
                const includeSensitive = req.query.includeSensitive === 'true';

                const config = await this.adminApiService.getBotConfiguration(botId, includeSensitive);
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
                const fullConfig: BotConfiguration = {
                    botId,
                    name: config.name || `Bot ${botId}`,
                    roomUrl: config.roomUrl,
                    worldUrl: config.worldUrl || '',
                    universeUrl: config.universeUrl,
                    userId: req.userIdentifier,
                    behaviorType: config.behaviorType,
                    behaviorConfig: config.behaviorConfig || { type: config.behaviorType },
                    aiProvider: config.aiProvider,
                    aiConfig: config.aiConfig,
                    chatInstructions: config.chatInstructions,
                    movementInstructions: config.movementInstructions,
                    assignedSpace: config.assignedSpace,
                };

                await this.adminApiService.saveBotConfiguration(fullConfig);

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
                const existingConfig = await this.adminApiService.getBotConfiguration(botId, true);
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

                // Update running bot if it exists
                if (this.botManager.getBot(botId)) {
                    await this.botManager.updateBot(botId, updates);
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
                const config = await this.adminApiService.getBotConfiguration(botId, true);
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

