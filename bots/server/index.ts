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
import { movementLogger } from '../utils/MovementLogger';

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

// Start improvement scheduler (development only)
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_IMPROVEMENT === 'true') {
    import('../services/ImprovementScheduler').then(({ ImprovementScheduler }) => {
        const scheduler = new ImprovementScheduler(botManager, {
            enabled: true,
            intervalMs: parseInt(process.env.IMPROVEMENT_INTERVAL_MS || '3600000', 10), // Default: 1 hour
            autoApply: process.env.IMPROVEMENT_AUTO_APPLY === 'true',
        });
        scheduler.start();
        console.log('[BotServer] Improvement scheduler started');
    }).catch(error => {
        console.error('[BotServer] Failed to start improvement scheduler:', error);
    });
}

// Graceful shutdown handler
async function shutdown(signal: string) {
    console.log(`[BotServer] Received ${signal}, shutting down gracefully...`);
    
    try {
        // Stop game loop
        stopGameLoop();
        
        // Stop movement analysis
        stopMovementAnalysis();
        
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

        // Start periodic movement analysis
        startMovementAnalysis(botManager);

        // Respawn bots for rooms that have players (after hot reload)
        // Wait a bit for server to be fully ready, then respawn
        setTimeout(async () => {
            try {
                await botManager.respawnBotsForActiveRooms();
            } catch (error) {
                console.error('[BotServer] Failed to respawn bots for active rooms:', error);
            }
        }, 2000); // Wait 2 seconds for server to be ready

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

// Periodic movement analysis (DEV ONLY)
let movementAnalysisInterval: NodeJS.Timeout | null = null;

function startMovementAnalysis(botManager: BotManager): void {
    // Only enable in development
    const isDevMode = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';
    
    console.log(`[BotServer] Movement logging check: ENABLE_MOVEMENT_LOGGING=${process.env.ENABLE_MOVEMENT_LOGGING}, NODE_ENV=${process.env.NODE_ENV}, isDevMode=${isDevMode}`);
    
    if (!isDevMode) {
        console.log('[BotServer] Movement analysis disabled (production mode)');
        return;
    }

    const ANALYSIS_INTERVAL = 30000; // Analyze every 30 seconds

    movementAnalysisInterval = setInterval(() => {
        const instances = botManager.getAllBotInstances();
        
        for (const instance of instances) {
            const analysis = movementLogger.analyzeMovement(instance.botId, 10000);
            
            if (analysis.oscillationDetected) {
                console.warn(`[MovementAnalysis] Bot ${instance.botId.substring(0, 8)}: OSCILLATION DETECTED! avgSpeed=${analysis.averageSpeed.toFixed(1)}, waypointChanges=${analysis.waypointChanges}, pathFailures=${analysis.pathFailures}`);
            }
            
            // Log summary every 30 seconds
            if (Math.random() < 0.1) { // 10% chance to log (avoid spam)
                console.log(`[MovementAnalysis] Bot ${instance.botId.substring(0, 8)}: avgSpeed=${analysis.averageSpeed.toFixed(1)}, totalDist=${analysis.totalDistance.toFixed(1)}, waypoints=${analysis.waypointChanges}, pathFails=${analysis.pathFailures}`);
            }
        }
        
        const summary = movementLogger.getSummary();
        if (summary.totalEvents > 0 && Math.random() < 0.05) { // 5% chance
            console.log(`[MovementAnalysis] Summary: ${summary.totalEvents} events, ${summary.botsTracked} bots, types:`, summary.eventTypes);
        }
    }, ANALYSIS_INTERVAL);

    console.log(`[BotServer] Movement analysis started (DEV MODE - every ${ANALYSIS_INTERVAL / 1000}s)`);
}

function stopMovementAnalysis(): void {
    if (movementAnalysisInterval) {
        clearInterval(movementAnalysisInterval);
        movementAnalysisInterval = null;
    }
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

// RESPAWN FIX - 01:16:41
