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
import { brickChangedEverywhere, listenForBrickChanges } from './brickChanges';
import { BrickRunner } from './BrickRunner';
import { movementLogger } from '../utils/MovementLogger';
import { DmReplyService, type DmRoomLink } from './DmReplyService';
import { botMatrixId, readMatrixConfig } from '../matrix/MatrixConfig';
import { OrbitActions } from '../mcp/OrbitActions';
import { askOrbitAboutAppUse } from '../mcp/AppUse';
import { ToolApprovals, type CardSurface } from '../mcp/ToolApprovals';
import { NearbyAsks } from '../mcp/NearbyAsks';
import { QuestionCards } from '../mcp/QuestionCards';
import { verifyMatrixRegistration } from '../matrix/verifyMatrixRegistration';
import { MatrixAppServiceClient } from '../matrix/MatrixAppServiceClient';
import { MatrixDmBridge, type CarriedPart, type DirectChatAnswer, type GuestChatNote } from '../matrix/MatrixDmBridge';
import { createComputerModelRelay, relayOrbitFor } from './ComputerModelRelay';
import { createComputerRunner, relayUrlFromEnv, runnerOrbitFor, type ComputerRunner } from './ComputerRunner';
import { createScreenGateway, screenOrbitFor, type ScreenGateway } from './ComputerScreenGateway';
import { pretendRunnerOn } from '../ai/ComputerPretendRunner';
import { createMatrixAppServiceRouter, type MatrixAppServiceRouter } from '../matrix/MatrixAppServiceRouter';
import { uploadAttachment } from '../matrix/uploadAttachment';
import { botWokaPicture } from '../matrix/wokaPicture';
import type { BotAvailability } from '../matrix/BotStatusNotes';
import type { Router } from 'express';
import * as path from 'path';
import * as Sentry from '@sentry/node';
import { VoiceLoadWatch, readWorkerLoad, voiceLoadSettings, workerStatsUrl } from '../voice/VoiceLoad';
import { voiceWorkerSettings } from '../voice/settings';
import { sharedNoteHearing, type NoteHearingService } from '../voice/NoteHearingWiring';
import { captureServerEvent } from '../ai/PostHogClient';

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
let noteHearing: NoteHearingService | null = null;
let dmStatus: ((botIds: string[]) => Promise<Record<string, BotAvailability | 'unknown'>>) | undefined;
let dmReplies: DmReplyService | undefined;
let dmCards: CardSurface | undefined;

// The card a bot shows before a tool that asks first runs, saved in Orbit: in the person's direct message (#1657), or in a
// bubble to the person who asked alone, with one plain line for everyone (#1658). Built before direct messages, so a bubble
// has its cards with or without them.
const aiService = botManager.getAIService();
// The address a Brick's computer calls for its AI (OpenAI format, /v1): Orbit checks the key and the room, the provider's key stays here
preRouters.push(createComputerModelRelay({ orbit: relayOrbitFor(adminApiService), routeFor: (botId) => aiService.relayRoute(botId) }));
// Every bot hears voice notes (plan v3): what a bot's reply would run on decides whether the note is checked against the person's
// replies before it is heard, and what the hearing provider still holds is deleted until it confirms
{
    const hearing = sharedNoteHearing(adminApiService);
    hearing?.useReplySource(async (botId) => {
        const config = botManager.getBot(botId)?.getFullConfig() ?? (await adminApiService.getBotConfiguration(botId, 5000, { bricks: true }).catch(() => null));
        return config?.aiProviderRef ? aiService.replySource(config.aiProviderRef, botId) : null;
    });
    hearing?.startCleaning();
}
const nearbyAsks = new NearbyAsks({
    bot: (botId) => botManager.getBot(botId),
    quick: async (botId, system, prompt, timeoutMs) => {
        const provider = botManager.getBot(botId)?.getFullConfig()?.aiProviderRef;
        if (!provider) return '';
        return aiService.quickGenerate(provider, system, prompt, botId, timeoutMs);
    },
    approvals: () => approvals,
});
const orbitActions = new OrbitActions(() => {
    const serviceToken = process.env.BOT_SERVICE_TOKEN;
    return ADMIN_API_URL && ADMIN_API_TOKEN && serviceToken ? { adminApiUrl: ADMIN_API_URL, adminApiToken: ADMIN_API_TOKEN, serviceToken } : null;
});
// Before every use of an App on a connection (a person's own, lent to a universe, or a universe's own), Orbit is asked (#2001)
aiService.useAppUse(
    askOrbitAboutAppUse(() => {
        const serviceToken = process.env.BOT_SERVICE_TOKEN;
        return ADMIN_API_URL && serviceToken ? { adminApiUrl: ADMIN_API_URL, serviceToken } : null;
    })
);
const cardSurface: CardSurface = {
    send: (botId, roomId, content) => (dmCards ? dmCards.send(botId, roomId, content) : Promise.reject(new Error('Direct messages are off'))),
    say: (botId, roomId, text) => (dmCards ? dmCards.say(botId, roomId, text) : Promise.reject(new Error('Direct messages are off'))),
};
// The question cards a bot shows before a big job (#1661): kept here, and a pick goes back to the bot as what the person said
const questions = new QuestionCards({
    cards: cardSurface,
    nearby: nearbyAsks,
    waitMinutes: async (botId) => (await orbitActions.cardSettings(botId)).cardWaitMinutes,
    // The bot goes on with the pick in the background: the tap that brought it is not held until the job is done
    picked: async ({ botId, roomId, person, nearby, text }) => {
        if (nearby) {
            if (person.playerId === undefined) return false;
            // Whether the bot took it on: false when the person left the bubble or chat is closed to them now
            return (await botManager.getBot(botId)?.answerFromCard(roomId, person.playerId, text).catch(() => false)) ?? false;
        }
        void matrixBridge?.carryOnWith(roomId, person, text);
    },
});
const approvals = new ToolApprovals({
    orbit: orbitActions,
    cards: cardSurface,
    nearby: nearbyAsks,
    questions,
    gate: aiService.gate,
    tools: {
        find: (botId, toolName) => aiService.findToolEntry(botId, toolName),
        run: async (botId, entry, toolName, args, playerUuid, use) => {
            const config = botManager.getBot(botId)?.getFullConfig() ?? (await dmReplies?.getBotConfig(botId).catch(() => null));
            return aiService.runApprovedTool(botId, entry, toolName, args, playerUuid, config?.toolTimeoutSeconds, use);
        },
    },
    followUp: (outcome) => matrixBridge?.sayHowItEnded(outcome) ?? Promise.resolve(),
});
aiService.useApprovals(approvals);
aiService.useNearbyAsks(nearbyAsks);
let dmRoom: ((botId: string) => Promise<DmRoomLink | undefined>) | undefined;
let directChat: ((botId: string, chatId: string) => Promise<DirectChatAnswer>) | undefined;
let brickChanged: ((botId: string, ownerId: string) => boolean) | undefined;
let carryGuestChat: ((botId: string, chatId: string, carryId: string, lines: GuestChatNote[], part?: CarriedPart | null) => Promise<'sent' | 'already' | 'wait' | 'not_brick'>) | undefined;
let carryBrick: ((botId: string) => Promise<boolean>) | undefined;
/** How often Orbit is asked to remove deleted Bricks whose days are over (#1996). Nothing depends on when it runs. */
const BRICK_SWEEP_EVERY_MS = 60 * 60 * 1000;
// A job that stopped renewing its room is stopped safely and jobs in line are tried again (#2000)
const COMPUTER_SWEEP_EVERY_MS = 60 * 1000;
const COMPUTER_RUNNER_EVERY_MS = 10 * 1000;
let brickSweepInterval: NodeJS.Timeout | undefined;
let computerSweepInterval: NodeJS.Timeout | undefined;
let computerRunner: ComputerRunner | undefined;
/** Ends the retries of listening for Brick changes from other bot servers, at shutdown. */
let stopBrickListening: (() => void) | undefined;
/** How often Orbit is asked for the goals and tasks that fell due (#2002). Nothing depends on exactly when: Orbit is the scheduler. */
const BRICK_DUE_EVERY_MS = 60 * 1000;
let brickRunner: BrickRunner | undefined;

/** Turns direct messages on once Synapse accepts this bot server's registration; leaves them off otherwise. */
/** Real computers: Orbit's sweep, and the runner that works the jobs Orbit says are running. They need no Matrix, so they start whether or not direct messages are set up. */
function startComputers(): void {
    computerSweepInterval = setInterval(() => void adminApiService.sweepComputers(), COMPUTER_SWEEP_EVERY_MS);
    computerSweepInterval.unref?.();
    // A development server that pretends (COMPUTER_PRETEND_RUNNER=yes) has no runner
    if (pretendRunnerOn()) return;
    const relayUrl = relayUrlFromEnv();
    // The host only: never a path, a token or anything after it
    console.log(`[BotServer] Computer model address for machines: ${relayUrl ? new URL(relayUrl).host : 'none (a job will end with a clear line)'}`);
    computerRunner = createComputerRunner({ orbit: runnerOrbitFor(adminApiService), relayUrl });
    computerRunner.start(COMPUTER_RUNNER_EVERY_MS);
}

async function setupMatrix(): Promise<void> {
    const matrixConfig = readMatrixConfig();
    if (!matrixConfig) return;
    const matrixClient = new MatrixAppServiceClient(matrixConfig);
    if (!(await verifyMatrixRegistration(matrixClient, matrixConfig))) return;
    const dmReplyService = new DmReplyService(botManager);
    dmReplies = dmReplyService;
    // The card a bot shows in the person's direct message (#1657) goes through the Matrix account of the bot
    const botUser = (botId: string) => botMatrixId(matrixConfig.domain, botId) ?? '';
    dmCards = {
        send: (botId, roomId, content) => matrixClient.sendMessage(botUser(botId), roomId, content),
        say: async (botId, roomId, text) => void (await matrixClient.sendText(botUser(botId), roomId, text)),
    };
    matrixBridge = new MatrixDmBridge(matrixConfig, matrixClient, {
        approvals,
        getBotConfig: (botId, fresh) => dmReplyService.getBotConfig(botId, fresh),
        checkAccess: (botId, chatId) => adminApiService.checkDmAccess(botId, chatId),
        reply: (botId, person, text, attachments, hooks) => dmReplyService.reply(botId, person, text, attachments, hooks),
        rooms: botRegistry,
        uploadAttachment,
        noteHearing: (noteHearing = sharedNoteHearing(adminApiService)) ?? undefined,
        restingLine: (config, text) => dmReplyService.restingLine(config, text),
        waiting: botRegistry,
        wokaPicture: (config) => botWokaPicture(config, { wokaList: (roomUrl, botId) => adminApiService.getBotWokaList(roomUrl, botId) }),
    });
    // An answer one person got in nearby chat, with others around, is found again in their direct messages (#1993)
    const answersBridge = matrixBridge;
    aiService.keepPrivateAnswersIn({
        keep: (botId, chatId, text) => void answersBridge.keepNearbyAnswer(botId, chatId, text),
        opened: (botId, chatId, roomId) => void answersBridge.openedFromNearby(botId, chatId, roomId),
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
    // One chat for a person and a bot across their devices (#1995)
    directChat = (botId, chatId) => bridge.directChatFor(botId, chatId);
    // A Brick that was just deleted, or taken back with Undo, is read again before its next message (#1996)
    // On every bot server, not only this one
    brickChanged = brickChangedEverywhere(botRegistry, (botId, ownerId) => dmReplyService.forgetBrickOf(botId, ownerId));
    // A guest's chat is brought into the Brick they now have (#1997), and only into the one Brick everyone gets
    carryBrick = async (botId) => {
        const config = await dmReplyService.getBotConfig(botId);
        return Boolean(config?.brick?.isDefault && !config.brick.deleted);
    };
    carryGuestChat = async (botId, chatId, carryId, lines, part) => {
        if (!(await carryBrick!(botId))) return 'not_brick';
        return bridge.carryGuestChat(botId, chatId, carryId, lines, part);
    };
    brickSweepInterval = setInterval(() => void adminApiService.sweepBricks(), BRICK_SWEEP_EVERY_MS);
    brickSweepInterval.unref?.();
    // Reminders (#2002): what Orbit says is due is said in the owner's own chat with their Brick
    brickRunner = new BrickRunner(
        {
            claimDue: () => adminApiService.claimDueItems(),
            checkRun: (runId, attempt) => adminApiService.checkItemRun(runId, attempt),
            keepDelivered: (runId, eventId) => adminApiService.keepItemDelivered(runId, eventId),
            report: (runId, report) => adminApiService.reportItemRun(runId, report),
        },
        { say: (brickId, matrixUserId, text, transactionId) => bridge.speakInDirectChat(brickId, matrixUserId, text, transactionId) }
    );
    brickRunner.start(BRICK_DUE_EVERY_MS);
    console.log(`[BotServer] Matrix direct messages on for ${matrixConfig.domain}`);
}
// Made in start(), once direct messages are settled: their routes are part of the API.
let botAPI: BotAPI | undefined;
let screenGateway: ScreenGateway | undefined;

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
        // No more tries at hearing Brick changes, even when the game loop never started
        stopBrickListening?.();
        brickRunner?.stop();
        
        // Stop movement analysis
        stopMovementAnalysis();

        voiceLoadWatch?.stop();
        
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
        botAPI = new BotAPI(botManager, adminApiService, botRegistry, preRouters, { dmStatus, dmRoom, directChat, brickChanged, carryGuestChat, carryBrick, noteHearing: noteHearing ?? undefined });

        // Initialize bot manager
        await botManager.initialize();
        // A Brick deleted through another bot server stops here at once too (#1996). Without it, within the minute.
        const replies = dmReplies;
        if (replies) {
            // The stop is kept before the first try ends, so a shutdown meanwhile ends the retries too
            const listening = listenForBrickChanges(botRegistry, (botId, ownerId) => void replies.forgetBrickOf(botId, ownerId));
            stopBrickListening = listening.stop;
            await listening.firstTry;
        }

        // Start API server
        botAPI.start(BOT_SERVER_PORT);
        // The screen of a Brick's computer: the socket lives here, every decision is Orbit's
        screenGateway = createScreenGateway({ orbit: screenOrbitFor(adminApiService) });
        botAPI.addUpgradeHandler((request, socket, head) => screenGateway?.handleUpgrade(request, socket, head) ?? false);
        startComputers();
        matrixBridge?.start();

        console.log(`[BotServer] Bot server started on port ${BOT_SERVER_PORT}`);

        // Start game loop to update bots
        startGameLoop(botManager);

        // Start periodic movement analysis
        startMovementAnalysis(botManager);

        startVoiceLoadWatch();

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

// How full the voice worker is (#1751). Only where a voice worker is set up: a server without one has nothing to read.
let voiceLoadWatch: VoiceLoadWatch | null = null;

function startVoiceLoadWatch(): void {
    if (!process.env.VOICE_WORKER_URL) return;
    const worker = voiceWorkerSettings();
    const settings = voiceLoadSettings();
    let statsUrl: string;
    try {
        statsUrl = workerStatsUrl(worker.url);
    } catch {
        console.warn('[BotServer] VOICE_WORKER_URL is not a valid address: voice load is not watched');
        return;
    }
    voiceLoadWatch = new VoiceLoadWatch(
        {
            read: () => readWorkerLoad(statsUrl, worker.secret, settings.timeoutMs),
            capture: (event, properties) => captureServerEvent(`voice-worker:${BOT_SERVER_ID}`, event, { ...properties, bot_server: BOT_SERVER_ID }),
            warn: (message, details) => Sentry.captureMessage(message, { level: 'warning', tags: { area: 'voice' }, extra: details }),
            log: (message) => console.warn(`[BotServer] ${message}`),
        },
        settings
    );
    voiceLoadWatch.start();
    console.log(`[BotServer] Voice load watch started (every ${settings.intervalMs / 1000}s)`);
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
        if (brickSweepInterval) clearInterval(brickSweepInterval);
        if (computerSweepInterval) clearInterval(computerSweepInterval);
        computerRunner?.stop();
        screenGateway?.close();
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
