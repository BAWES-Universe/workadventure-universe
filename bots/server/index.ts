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

import "./instrument";
import { installAxiosErrorRedaction } from "./redactAxiosErrors";

import { BotManager } from './BotManager';
import { BotAPI } from './BotAPI';
import { AdminApiService } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import { movementLogger } from '../utils/MovementLogger';
import { DmReplyService, type DmRoomLink } from './DmReplyService';
import { readMatrixConfig } from '../matrix/MatrixConfig';
import { verifyMatrixRegistration } from '../matrix/verifyMatrixRegistration';
import { MatrixAppServiceClient } from '../matrix/MatrixAppServiceClient';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { createMatrixAppServiceRouter, type MatrixAppServiceRouter } from '../matrix/MatrixAppServiceRouter';
import { uploadAttachment } from '../matrix/uploadAttachment';
import type { BotAvailability } from '../matrix/BotStatusNotes';
import type { Router } from 'express';
import * as path from 'path';

// Before anything calls Orbit or an MCP server: a failed call must never put a token or a transcript in the logs
installAxiosErrorRedaction();

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

// Direct messages to bots over Matrix (off unless MATRIX_* is set). Synapse pushes events here; no socket per bot.
const preRouters: Router[] = [];
let matrixBridge: MatrixDmBridge | null = null;
let matrixRouter: MatrixAppServiceRouter | null = null;
let dmStatus: ((botIds: string[]) => Promise<Record<string, BotAvailability | 'unknown'>>) | undefined;
let dmRoom: ((botId: string) => Promise<DmRoomLink | undefined>) | undefined;

/** Turns direct messages on once Synapse accepts this bot server's registration; leaves them off otherwise. */
async function setupMatrix(): Promise<void> {
    const matrixConfig = readMatrixConfig();
    if (!matrixConfig) return;
    const matrixClient = new MatrixAppServiceClient(matrixConfig);
    if (!(await verifyMatrixRegistration(matrixClient, matrixConfig))) return;
    const dmReplyService = new DmReplyService(botManager);
    matrixBridge = new MatrixDmBridge(matrixConfig, matrixClient, {
        getBotConfig: (botId, fresh) => dmReplyService.getBotConfig(botId, fresh),
        checkAccess: (botId, chatId) => adminApiService.checkDmAccess(botId, chatId),
        reply: (botId, person, text, attachments, hooks) => dmReplyService.reply(botId, person, text, attachments, hooks),
        rooms: botRegistry,
        uploadAttachment,
        restingLine: (config, text) => dmReplyService.restingLine(config, text),
        waiting: botRegistry,
    });
    matrixRouter = createMatrixAppServiceRouter(matrixConfig, matrixBridge);
    preRouters.push(matrixRouter);
    // The game shows a bot's state in its chat header and the People list. Same cached lookup the replies use.
    const bridge = matrixBridge;
    dmStatus = async (botIds) =>
        Object.fromEntries(
            await Promise.all(
                botIds.map(async (botId) => {
                    try {
                        return [botId, bridge.availability(botId, await dmReplyService.getBotConfig(botId))] as const;
                    } catch {
                        return [botId, 'unknown'] as const;
                    }
                })
            )
        );
    dmRoom = (botId) => dmReplyService.roomOf(botId);
    console.log(`[BotServer] Matrix direct messages on for ${matrixConfig.domain}`);
}
// Made in start(), once direct messages are settled: their routes are part of the API.
let botAPI: BotAPI | undefined;

// Start autopilot improvement system (DEVELOPMENT ONLY - fully autonomous)
// This system runs tests every 30 seconds and creates improvement task files for AI analysis
const isDevelopment = process.env.NODE_ENV === 'development';
if (isDevelopment) {
    import('../services/AutoPilotImprovement').then(({ AutoPilotImprovement }) => {
        const autopilot = new AutoPilotImprovement(botManager, {
            enabled: true,
            testIntervalMs: parseInt(process.env.AUTOPILOT_TEST_INTERVAL_MS || '30000', 10), // Default: 30 seconds (FAST)
            improvementIntervalMs: parseInt(process.env.AUTOPILOT_IMPROVEMENT_INTERVAL_MS || '60000', 10), // Default: 1 minute
            autoApplyImprovements: process.env.AUTOPILOT_AUTO_APPLY !== 'false', // Default: true
            maxIterationsPerBot: parseInt(process.env.AUTOPILOT_MAX_ITERATIONS || '50', 10), // Higher for continuous iteration
            tasksDirectory: process.env.IMPROVEMENT_TASKS_DIR || path.join(process.cwd(), 'bots', 'improvement-tasks'),
        });
        // Register with BotManager so API can access it
        botManager.setAutoPilot(autopilot);
        autopilot.start();
        console.log('[BotServer] 🚀 AutoPilot improvement system started (FAST CONTINUOUS ITERATION)');
        console.log('[BotServer]    Tests run every 30 seconds');
        console.log('[BotServer]    Improvement tasks created in: bots/improvement-tasks/');
    }).catch(error => {
        console.error('[BotServer] Failed to start autopilot:', error);
    });
} else {
    console.log('[BotServer] AutoPilot disabled (production mode)');
}

/** How long shutdown waits for direct messages being answered. */
const DM_SHUTDOWN_GRACE_MS = 8000;

// Graceful shutdown handler
async function shutdown(signal: string) {
    console.log(`[BotServer] Received ${signal}, shutting down gracefully...`);
    
    try {
        // Stop game loop
        stopGameLoop();
        
        // Stop movement analysis
        stopMovementAnalysis();
        
        // Stop API server
        // Direct messages already taken in get their answer first; new ones go back to Synapse for the next bot server.
        // Waiting messages a drain took but hasn't started on go back in line (before the shared store closes), and the
        // ones being answered get the same time. Kept under the container's stop grace, so nothing is killed mid-way.
        const [settled, drained] = await Promise.all([
            matrixRouter ? matrixRouter.settle(DM_SHUTDOWN_GRACE_MS) : true,
            matrixBridge ? matrixBridge.stop(DM_SHUTDOWN_GRACE_MS) : true,
        ]);
        if (!settled || !drained) {
            console.warn('[BotServer] Some direct messages were still being answered at shutdown');
        }
        await botAPI?.stop();
        
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

        // Before any bot connects: a bot shows Message only when Synapse accepted the registration
        await setupMatrix();
        botAPI = new BotAPI(botManager, adminApiService, botRegistry, preRouters, { dmStatus, dmRoom });

        // Initialize bot manager
        await botManager.initialize();

        // Start API server
        botAPI.start(BOT_SERVER_PORT);
        matrixBridge?.start();

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
