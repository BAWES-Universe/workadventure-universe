/**
 * Bot Server Entry Point
 * 
 * Main server process that:
 * - Starts HTTP server (Express)
 * - Initializes BotManager
 * - Connects to Redis (for BotRegistry)
 * - Loads bots from storage on startup
 * - Handles graceful shutdown
 */

import { BotManager } from './BotManager';
import { BotAPI } from './BotAPI';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';

// Environment variables
const BOT_SERVER_PORT = parseInt(process.env.BOT_SERVER_PORT || '3001', 10);
const ADMIN_API_URL = process.env.ADMIN_API_URL || '';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
const REDIS_DB_NUMBER = parseInt(process.env.REDIS_DB_NUMBER || '1', 10);
const BOT_SERVER_ID = process.env.BOT_SERVER_ID || 'server-1';

// Initialize services
const adminApiService = new AdminApiService(ADMIN_API_URL, ADMIN_API_TOKEN);

const botRegistry = new BotRegistry(BOT_SERVER_ID, {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD || undefined,
    db: REDIS_DB_NUMBER,
});

const botManager = new BotManager(adminApiService, botRegistry);
const botAPI = new BotAPI(botManager, adminApiService, botRegistry);

// Graceful shutdown handler
async function shutdown(signal: string) {
    console.log(`[BotServer] Received ${signal}, shutting down gracefully...`);
    
    try {
        // Stop game loop
        stopGameLoop();
        
        // Stop API server
        await botAPI.stop();
        
        // Shutdown bot manager (disconnects all bots)
        await botManager.shutdown();
        
        process.exit(0);
    } catch (error) {
        console.error('[BotServer] Error during shutdown:', error);
        process.exit(1);
    }
}

// Initialize and start server
async function start() {
    try {
        console.log('[BotServer] Starting bot server...');
        console.log(`[BotServer] Server ID: ${BOT_SERVER_ID}`);
        console.log(`[BotServer] Admin API URL: ${ADMIN_API_URL || 'Not configured'}`);
        console.log(`[BotServer] Redis: ${REDIS_HOST}:${REDIS_PORT} (DB ${REDIS_DB_NUMBER})`);

        // Initialize bot manager
        await botManager.initialize();

        // Start API server
        botAPI.start(BOT_SERVER_PORT);

        console.log(`[BotServer] Bot server started on port ${BOT_SERVER_PORT}`);

        // Start game loop to update bots
        startGameLoop(botManager);

        // TODO: Load bots from storage on startup
        // This would involve:
        // 1. Reading WAM files to find bot entities
        // 2. Loading sensitive config from Admin API
        // 3. Spawning bots

    } catch (error) {
        console.error('[BotServer] Failed to start:', error);
        process.exit(1);
    }
}

// Game loop to update all bots
let gameLoopInterval: NodeJS.Timeout | null = null;
let lastUpdateTime = Date.now();

function startGameLoop(botManager: BotManager): void {
    const TARGET_FPS = 30; // 30 updates per second
    const UPDATE_INTERVAL = 1000 / TARGET_FPS; // ~33ms

    gameLoopInterval = setInterval(() => {
        const currentTime = Date.now();
        const deltaTime = currentTime - lastUpdateTime;
        lastUpdateTime = currentTime;

        // Update all bots
        botManager.update(deltaTime);
    }, UPDATE_INTERVAL);

    console.log(`[BotServer] Game loop started (${TARGET_FPS} FPS)`);
}

function stopGameLoop(): void {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        console.log('[BotServer] Game loop stopped');
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[BotServer] Uncaught exception:', error);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[BotServer] Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server
start();

