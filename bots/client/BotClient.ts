/**
 * BotClient - Headless WebSocket client for WorkAdventure bots
 * 
 * This client connects to WorkAdventure using the same protocol as browser clients,
 * allowing bots to fully participate in the game world.
 */

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
    ClientToServerMessage,
    ServerToClientMessage,
    UserMovesMessage,
    PositionMessage_Direction,
    JoinSpaceRequestMessage,
    LeaveSpaceRequestMessage,
    FilterType,
    UpdateSpaceUserMessage,
    SpaceUser,
    apiVersionHash,
    FollowRequestMessage,
    FollowAbortMessage,
} from '@workadventure/messages';
import type { PositionInterface, ViewportInterface } from '../../play/src/front/Connection/ConnexionModels';
import { BotState } from './BotState';
import type { BaseBehavior } from '../behaviors/BaseBehavior';
import { BotPathfindingManager } from '../utils/BotPathfindingManager';
import { PathSmoother } from '../utils/PathSmoother';
import { movementLogger } from '../utils/MovementLogger';
import type { BotConfiguration } from '../server/AdminApiService';
import { resolve4, resolve6 } from 'dns/promises';

// Get the secret key from environment - must match pusher's SECRET_KEY
const SECRET_KEY = process.env.SECRET_KEY || 'default-secret-key';

export interface BotConfig {
    botId: string;
    name: string;
    roomUrl: string;
    pusherUrl: string;
    position: PositionInterface;
    viewport: ViewportInterface;
    characterTextureIds: string[];
    companionTextureId?: string;
    token?: string;
    uploaderUrl?: string;
}

export class BotClient {
    // Static set of all bot user IDs - shared across all bot instances
    private static botUserIds: Set<number> = new Set();
    
    private ws: WebSocket | null = null;
    private state: BotState;
    private behavior: BaseBehavior | null = null;
    private userId: number | null = null;
    private connected: boolean = false;
    private spaces: Map<string, SpaceUser['spaceUserId']> = new Map();
    private players: Map<number, PlayerInfo> = new Map();
    private queryId: number = 0;
    private pendingQueries: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
    private lastSentDirection: PositionMessage_Direction = PositionMessage_Direction.DOWN;
    private lastSentMoving: boolean = false;
    private lastSentPosition: PositionInterface | null = null;
    private lastSentTime: number = 0;
    private readonly POSITION_UPDATE_THROTTLE = 200; // Match WorkAdventure's 200ms update interval
    private readonly POSITION_UPDATE_THRESHOLD = 5; // Only send if moved >5 pixels

    // Pathfinding support
    private pathfindingManager?: BotPathfindingManager;
    private currentPath: PositionInterface[] = [];
    private pathIndex: number = 0;
    private isFollowingPath: boolean = false;
    
    // Advanced movement system
    private pathSmoother: PathSmoother = new PathSmoother();
    private lastPathRecalcTime: number = 0;
    private lastPathEndTime: number = 0; // Track when path ended to prevent immediate recalculation
    private readonly PATH_RECALC_COOLDOWN = 500; // Minimum 500ms between recalculations
    private readonly PATH_END_COOLDOWN = 1000; // Minimum 1 second before creating new path after one ends/cancels
    private stuckDetectionTime: number = 0;
    private lastPosition: PositionInterface | null = null;
    private readonly STUCK_THRESHOLD = 10; // Pixels - increased to account for slow movement
    private readonly STUCK_TIME = 4000; // 4 seconds - give bots more time to start moving
    private debugFrameCount: number = 0; // For debug logging
    
    // Full bot configuration (stored at spawn to avoid HTTP requests)
    private fullConfig: BotConfiguration | null = null;

    // Callback invoked when WebSocket unexpectedly disconnects (not during initial connection)
    public onDisconnect?: () => void;

    constructor(private config: BotConfig) {
        this.state = new BotState(config.position);
    }
    
    /**
     * Check if a user ID belongs to a bot
     */
    static isBot(userId: number): boolean {
        return BotClient.botUserIds.has(userId);
    }
    
    /**
     * Get all bot user IDs (for debugging)
     */
    static getBotUserIds(): number[] {
        return Array.from(BotClient.botUserIds);
    }

    /**
     * Generate a JWT token for this bot
     */
    private generateBotToken(): string {
        // Generate a unique identifier for this bot
        const botIdentifier = `bot-${this.config.botId}`;
        
        // Create a JWT token matching the AuthTokenData schema
        const tokenData = {
            identifier: botIdentifier,
            username: this.config.name,
            tags: ['bot'],
        };
        
        return jwt.sign(tokenData, SECRET_KEY, { expiresIn: '30d' });
    }

    /**
     * Connect to WorkAdventure server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL('ws/room', this.config.pusherUrl);
            url.protocol = url.protocol.replace('http', 'ws');

            const params = url.searchParams;
            params.set('roomId', this.config.roomUrl);
            params.set('name', this.config.name);
            for (const textureId of this.config.characterTextureIds) {
                params.append('characterTextureIds', textureId);
            }
            params.set('x', Math.floor(this.config.position.x).toString());
            params.set('y', Math.floor(this.config.position.y).toString());
            // Viewport should be centered on bot position with large radius to see all nearby players
            const viewportRadius = 2000; // Large radius to see players even when they move around
            const botX = this.config.position.x;
            const botY = this.config.position.y;
            params.set('top', Math.floor(Math.max(0, botY - viewportRadius)).toString());
            params.set('bottom', Math.floor(botY + viewportRadius).toString());
            params.set('left', Math.floor(Math.max(0, botX - viewportRadius)).toString());
            params.set('right', Math.floor(botX + viewportRadius).toString());
            if (this.config.companionTextureId) {
                params.set('companionTextureId', this.config.companionTextureId);
            }
            params.set('availabilityStatus', '0'); // ONLINE
            params.set('version', apiVersionHash); // Imported from @workadventure/messages
            params.set('chatID', '');
            params.set('roomName', '');
            params.set('cameraState', 'false');
            params.set('microphoneState', 'false');
            params.set('screenSharingState', 'false');

            // Generate bot token for authentication
            const token = this.config.token || this.generateBotToken();
            const subProtocols = [token];

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Connecting to: ${url.toString()}`);
                console.log(`[Bot ${this.config.botId}] Using token: ${token.substring(0, 50)}...`);
            }
            this.ws = new WebSocket(url.toString(), subProtocols);
            this.ws.binaryType = 'arraybuffer';

            this.ws.on('open', () => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Connected successfully`);
                }
                this.connected = true;
                resolve();
            });

            this.ws.on('error', (error) => {
                console.error(`[Bot ${this.config.botId}] WebSocket error:`, error);
                reject(error);
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                const reasonStr = reason ? reason.toString() : 'No reason provided';
                // Always log disconnections in debug mode, or if it's an error code
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] 🔌 WebSocket closed - Code: ${code}, Reason: ${reasonStr}, wasConnected: ${this.connected}`);
                } else if (code !== 1000) {
                    // In production, only log non-normal closes
                    console.warn(`[Bot ${this.config.botId}] Disconnected - Code: ${code}, Reason: ${reasonStr}`);
                }
                // Notify on unexpected disconnect (was previously connected, not during initial handshake)
                if (this.connected) {
                    this.onDisconnect?.();
                }
                this.connected = false;
            });

            this.ws.on('message', (data: ArrayBuffer) => {
                this.handleMessage(data);
            });

            // Handle ping/pong for keepalive
            this.ws.on('ping', (data: Buffer) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.pong(data);
                }
            });
        });
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        // Unregister this bot's userId
        if (this.userId !== null) {
            BotClient.botUserIds.delete(this.userId);
        }
        
        if (this.ws) {
            // Send proper close frame with code 1000 (normal closure)
            // This prevents code 1005 (No Status Received) when the connection closes
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Normal closure');
            } else {
                // Already closing or closed, just clean up
                this.ws = null;
            }
        }
        this.connected = false;
    }
    
    /**
     * Check if a player ID is another bot (instance method for convenience)
     */
    isOtherBot(playerId: number): boolean {
        // It's another bot if it's in the bot set AND it's not ourselves
        return playerId !== this.userId && BotClient.isBot(playerId);
    }

    /**
     * Set behavior for this bot
     */
    setBehavior(behavior: BaseBehavior): void {
        this.behavior = behavior;
        behavior.setBot(this);
    }

    /**
     * Update bot (called every frame/tick)
     */
    update(deltaTime: number): void {
        if (!this.connected || !this.behavior) {
            return;
        }

        // CRITICAL: Call behavior.update FIRST (like original bots branch)
        // The behavior checks nearbyPlayers.size and calls stop() if needed
        // Bots should "ghost through" idle players (nearbyPlayers.size === 0)
        this.behavior.update(deltaTime);

        // If bot is summoned, always allow movement (override normal stopping logic)
        const isSummoned = (this.behavior as any)?.isSummoned || false;

        // Update path following if active (this handles movement)
        // CRITICAL: Only do this if bot is actually moving (not stopped)
        // If stop() was called, isMoving() will be false - respect that!
        // Ghost mode: bot continues moving even if players are nearby
        // BUT: For patrol bots, default to responding unless explicitly disabled
        const behaviorType = (this.behavior as any)?.config?.type;
        const respondToPlayers = (this.behavior as any)?.config?.respondToPlayers;
        // Default to true for patrol bots unless explicitly set to false
        const shouldRespond = behaviorType === 'patrol' && respondToPlayers !== false;
        
        // Check if bot is in a conversation space (not just nearby players)
        // This allows ghost mode: continue moving if players are idle nearby
        const isInSpace = (this.behavior as any)?.currentSpaceName || (this.behavior as any)?.engagedWithUsers?.size > 0;
        
        if (this.isFollowingPath) {
            const isMoving = this.state.isMoving();
            
            // If summoned, always allow movement (don't stop for spaces)
            if (isSummoned) {
                if (isMoving) {
                    this.updatePathFollowing(deltaTime);
                } else {
                    // Summoned but not moving - ensure we start moving
                    this.state.setMoving(true);
                    this.updatePathFollowing(deltaTime);
                }
            } else if (shouldRespond && isInSpace) {
                // For patrol bots that should respond, only stop if in a conversation space
                // Don't stop just because players are nearby (ghost mode for idle players)
                // BUT: Don't stop if bot is leading - it needs to continue to destination
                const isLeading = this.behavior && (this.behavior as any).isLeading;
                if (!isLeading) {
                    if (isMoving) {
                        // Bot should be stopped but is still moving - force stop
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] 🛑 Patrol bot in space - stopping and canceling pathfinding`);
                        }
                        this.stop();
                        this.cancelPathfinding();
                    } else {
                        // Already stopped - just cancel pathfinding
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] 🛑 Patrol bot in space and stopped - canceling pathfinding`);
                        }
                        this.cancelPathfinding();
                    }
                } else {
                    // Bot is leading - allow movement to continue
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] ✅ Patrol bot in space but leading - allowing movement to continue`);
                    }
                    if (isMoving) {
                        this.updatePathFollowing(deltaTime);
                    }
                }
            } else if (isMoving) {
                this.updatePathFollowing(deltaTime);
            } else {
                // Path following is active but bot is stopped - cancel pathfinding
                // BUT: If bot is leading, don't cancel - let it continue to target
                const isLeading = this.behavior && (this.behavior as any).isLeading;
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🔍 Path following active but bot stopped - isLeading=${isLeading}, behavior=${!!this.behavior}`);
                }
                if (!isLeading) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🛑 Path following active but bot stopped - canceling pathfinding`);
                }
                this.cancelPathfinding();
                } else {
                    // Bot is leading but stopped - keep path active and re-enable movement
                    // This handles cases where stop() was called temporarily but we should continue
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] ⚠️ Path following active but bot stopped while leading - re-enabling movement`);
                    }
                    // Re-enable movement to continue following the path
                    this.state.setMoving(true);
                    // Continue with path following
                    this.updatePathFollowing(deltaTime);
                }
            }
        }

        // Update position/direction if changed (with throttling)
        const newPosition = this.state.getPosition();
        const newDirection = this.state.getDirection();
        const newMoving = this.state.isMoving();
        const now = Date.now();
        
        // Calculate position change distance
        const positionChanged = this.lastSentPosition 
            ? Math.sqrt(
                Math.pow(newPosition.x - this.lastSentPosition.x, 2) + 
                Math.pow(newPosition.y - this.lastSentPosition.y, 2)
              ) > this.POSITION_UPDATE_THRESHOLD
            : true; // Always send first update
        
        const directionChanged = this.lastSentDirection !== newDirection;
        const movingChanged = this.lastSentMoving !== newMoving;
        const timeSinceLastUpdate = now - this.lastSentTime;
        
        // Send update if:
        // - Position changed significantly (>5 pixels)
        // - Direction changed
        // - Moving state changed
        // - Enough time has passed (throttle to 200ms)
        if ((positionChanged || directionChanged || movingChanged) && 
            timeSinceLastUpdate >= this.POSITION_UPDATE_THROTTLE) {
            this.sendPosition(newPosition, newDirection, newMoving);
            this.config.position = newPosition;
            this.lastSentPosition = { ...newPosition };
            this.lastSentDirection = newDirection;
            this.lastSentMoving = newMoving;
            this.lastSentTime = now;
        }
    }

    /**
     * Move bot to position
     */
    moveTo(x: number, y: number, direction: PositionMessage_Direction = PositionMessage_Direction.DOWN): void {
        // If bot is summoned or leading, always allow movement (override normal blocking logic)
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // CRITICAL: For patrol bots, only block movement if in a conversation space
        // This allows ghost mode: continue moving if players are idle nearby
        if (this.behavior && !isSummoned && !isLeading) {
            const behaviorType = (this.behavior as any)?.config?.type;
            const respondToPlayers = (this.behavior as any)?.config?.respondToPlayers;
            
            // Check if bot is in a conversation space (not just nearby players)
            // This allows ghost mode: continue moving if players are idle nearby
            const isInSpace = (this.behavior as any)?.currentSpaceName || (this.behavior as any)?.engagedWithUsers?.size > 0;
            
            // For patrol bots: only block movement if in a conversation space
            // Don't block just because players are nearby (ghost mode for idle players)
            if (behaviorType === 'patrol' && isInSpace && respondToPlayers !== false) {
                // Patrol bot is in a conversation space - don't move
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🛑 moveTo() BLOCKED - patrol bot is in space (respondToPlayers=${respondToPlayers}, isInSpace=${isInSpace})`);
                }
                return;
            }
        }
        
        const wasMoving = this.state.isMoving();
        this.state.setPosition({ x, y });
        this.state.setDirection(direction);
        this.state.setMoving(true);
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📍 moveTo() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, pos=(${Math.round(x)}, ${Math.round(y)})${isSummoned ? ' (SUMMONED)' : ''}`);
        }
    }

    /**
     * Stop moving
     */
    stop(): void {
        const wasMoving = this.state.isMoving();
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // Only log in development to avoid spam in production
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            const nearbyPlayers = this.getNearbyPlayers(100);
            if (nearbyPlayers.length > 0 && !isLeading) {
                console.warn(`[Bot ${this.config.botId}] ⚠️ Stopping with ${nearbyPlayers.length} players nearby`);
            }
        }
        if (wasMoving) {
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'stop',
                position: this.state.getPosition(),
            });
        }
        this.state.setMoving(false);
        
        // If bot was leading and we're stopping, abort the follow
        // BUT: Don't end leading if bot is summoned (summoning is not leading)
        // This handles cases where stop() is called directly (not through cancelPathfinding)
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        if (isLeading && this.isFollowingPath && !isSummoned) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 STOP() called while leading, canceling pathfinding and aborting follow`);
            }
            this.cancelPathfinding(true); // End leading when explicitly stopped
        }
        
        // Only log in development
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 STOP() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, isFollowingPath=${this.isFollowingPath}, isLeading=${isLeading}`);
        }
    }

    /**
     * Smooth direction changes to avoid instant 180-degree turns
     */
    private smoothDirectionChange(
        current: PositionMessage_Direction,
        target: PositionMessage_Direction
    ): PositionMessage_Direction {
        // If same direction, return immediately
        if (current === target) {
            return target;
        }

        // Check if it's a 180-degree turn (opposite directions)
        const isOpposite = 
            (current === PositionMessage_Direction.UP && target === PositionMessage_Direction.DOWN) ||
            (current === PositionMessage_Direction.DOWN && target === PositionMessage_Direction.UP) ||
            (current === PositionMessage_Direction.LEFT && target === PositionMessage_Direction.RIGHT) ||
            (current === PositionMessage_Direction.RIGHT && target === PositionMessage_Direction.LEFT);

        if (isOpposite) {
            // For 180-degree turns, allow immediate change (velocity controller handles smooth deceleration)
            return target;
        }

        // For other direction changes, allow immediate change
        // The velocity controller's acceleration will make it smooth
        return target;
    }
    
    /**
     * Stop immediately and send position update (for when engaged with players)
     */
    stopAndUpdate(): void {
        const isLeading = (this.behavior as any)?.isLeading || false;
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        
        // If bot was leading, abort the follow when stopping
        // BUT: Don't end leading if bot is summoned (summoning is not leading)
        if (isLeading && this.isFollowingPath && !isSummoned) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 stopAndUpdate() called while leading, canceling pathfinding and aborting follow`);
            }
            this.cancelPathfinding(true); // End leading when explicitly stopped
        }
        
        this.state.setMoving(false);
        const position = this.state.getPosition();
        const direction = this.state.getDirection();
        this.sendPosition(position, direction, false);
        this.config.position = position;
        this.lastSentDirection = direction;
        this.lastSentMoving = false;
    }

    /**
     * Initialize pathfinding with collision grid
     */
    initializePathfinding(collisionGrid: number[][], tileDimensions: { width: number; height: number }): void {
        this.pathfindingManager = new BotPathfindingManager(collisionGrid, tileDimensions);
        // Using simple movement matching original speed calculation
    }

    /**
     * Check if pathfinding is available
     */
    hasPathfinding(): boolean {
        return this.pathfindingManager !== undefined;
    }

    /**
     * Check if a position is walkable (no obstacles)
     */
    isWalkable(position: PositionInterface): boolean {
        if (!this.pathfindingManager) {
            return true; // Can't check without pathfinding, assume walkable
        }
        return this.pathfindingManager.isWalkable(position);
    }

    /**
     * Check if bot is currently following a path
     */
    getIsFollowingPath(): boolean {
        return this.isFollowingPath;
    }

    private lastPathTarget: { x: number; y: number } | null = null;
    private readonly PATH_RECALC_THRESHOLD = 200; // Only recalculate if target moved >200 pixels (reduced recalculations to prevent glitching)

    /**
     * Move to position using pathfinding
     * Returns true if pathfinding was used, false if fallback to direct movement
     */
    async moveToWithPathfinding(x: number, y: number): Promise<boolean> {
        if (!this.pathfindingManager) {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: No pathfindingManager`);
            return false;
        }

        const now = Date.now();
        
        // CRITICAL: If bot is summoned or leading, bypass ALL cooldown checks to allow immediate pathfinding
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        const isReturning = (this.behavior as any)?.isReturning || false;
        const bypassCooldowns = isSummoned || isLeading || isReturning; // Allow immediate pathfinding when summoned, leading, or returning
        const bypassCloseCheck = isSummoned || isLeading; // Also bypass close target check when summoned or leading

        // Cooldown check - don't recalculate too frequently
        // BUT: Skip this check if bot is summoned (needs immediate response)
        if (!bypassCooldowns && now - this.lastPathRecalcTime < this.PATH_RECALC_COOLDOWN && this.isFollowingPath) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Cooldown active (${now - this.lastPathRecalcTime}ms < ${this.PATH_RECALC_COOLDOWN}ms), keeping current path`);
            }
            return true; // Keep following current path
        }
        
        // Don't create new path too soon after previous path ended/canceled (prevents glitching)
        // BUT: Skip this check if bot is summoned (needs immediate response)
        if (!bypassCooldowns && !this.isFollowingPath && this.lastPathEndTime > 0) {
            const timeSincePathEnd = now - this.lastPathEndTime;
            if (timeSincePathEnd < this.PATH_END_COOLDOWN) {
                // Too soon after path ended, skip pathfinding - let behavior use direct movement
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Path end cooldown active (${timeSincePathEnd}ms < ${this.PATH_END_COOLDOWN}ms), skipping pathfinding`);
                }
                return false;
            }
        }

        // Don't recalculate if we're already following a path to a similar target
        // BUT: If summoned, always recalculate to new target (even if similar)
        if (!isSummoned && this.isFollowingPath && this.lastPathTarget) {
            const targetDx = x - this.lastPathTarget.x;
            const targetDy = y - this.lastPathTarget.y;
            const targetDistance = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
            
            if (targetDistance < this.PATH_RECALC_THRESHOLD) {
                // Target hasn't moved much, keep following current path
                return true;
            }
        }

        const botPos = this.state.getPosition();
        
        // Check if we're already close to the target
        const dx = x - botPos.x;
        const dy = y - botPos.y;
        const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
        
        // For very close targets (< 50px), skip pathfinding to avoid tiny paths that cause glitching
        // BUT: If summoned or leading, always use pathfinding even for close targets (player might have moved or we need to lead)
        if (!bypassCloseCheck && distanceToTarget < 50) {
            // Already close enough, no need for pathfinding - use direct movement instead
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Target too close (${distanceToTarget.toFixed(1)}px < 50px), skipping pathfinding`);
            }
            return false;
        }
        
        // If summoned or leading and target is close, log but still use pathfinding
        if (bypassCloseCheck && distanceToTarget < 50) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🎯 moveToWithPathfinding: Target close (${distanceToTarget.toFixed(1)}px) but ${isSummoned ? 'summoned' : 'leading'} - using pathfinding anyway`);
        }
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] 🔍 moveToWithPathfinding: Finding path from (${Math.round(botPos.x)}, ${Math.round(botPos.y)}) to (${Math.round(x)}, ${Math.round(y)})...`);
        }
        const rawPath = await this.pathfindingManager.findPath(botPos, { x, y }, true);
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] 🔍 moveToWithPathfinding: Pathfinding returned ${rawPath.length} waypoints`);
        }

        if (rawPath.length === 0) {
            // No path found, fall back to direct movement
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: No path found from pathfinding algorithm`);
            }
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'path_fail',
                position: botPos,
                targetPosition: { x, y },
                metadata: { reason: 'no_path_found' },
            });
            return false;
        }
        
        // Log path start
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.config.botId,
            eventType: 'path_start',
            position: botPos,
            targetPosition: { x, y },
            pathLength: rawPath.length,
            metadata: { rawPathLength: rawPath.length },
        });

        // Only update path if we have a valid path with at least 2 waypoints
        if (rawPath.length < 2) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: Path too short (${rawPath.length} waypoints < 2)`);
            }
            return false;
        }

        // CRITICAL: Validate path doesn't go through obstacles before using it
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] ✅ moveToWithPathfinding: Validating path with ${rawPath.length} waypoints...`);
        }
        if (!this.validatePath(rawPath)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.warn(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: Path validation failed - path goes through obstacles! Rejecting path.`);
            }
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'path_fail',
                position: botPos,
                targetPosition: { x, y },
                metadata: { reason: 'path_validation_failed', pathLength: rawPath.length },
            });
            return false;
        }
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] ✅ moveToWithPathfinding: Path validation passed`);
        }
        
        // Use raw path from pathfinding - it already avoids obstacles
        // Path smoothing was causing issues with obstacle avoidance
        // The pathfinding algorithm (EasyStar) already provides smooth paths
        if (rawPath.length >= 2) {
            this.currentPath = rawPath;
        } else {
            return false;
        }

        this.pathIndex = 0;
        this.isFollowingPath = true;
        this.lastPathTarget = { x, y };
        this.lastPathRecalcTime = now;
        
        // CRITICAL: Set bot to moving state when pathfinding starts
        // Otherwise updatePathFollowing() will immediately stop because isMoving() is false
        this.state.setMoving(true);
        
        return true;
    }

    /**
     * Cancel current pathfinding
     * @param endLeading If true, also end the leading state and abort follow (default: false to allow path recalculation while leading)
     */
    cancelPathfinding(endLeading: boolean = false): void {
        // If bot was leading and we're explicitly ending leading, abort the follow
        if (endLeading && this.behavior && (this.behavior as any).isLeading) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Path canceled while leading, aborting follow and ending leading`);
            }
            this.sendFollowAbort();
            if ((this.behavior as any).endLeading) {
                (this.behavior as any).endLeading();
            }
        } else if (this.behavior && (this.behavior as any).isLeading) {
            // Bot is leading but we're just canceling pathfinding (not ending leading)
            // This allows path recalculation while leading
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🔄 Path canceled while leading (keeping leading state for recalculation)`);
            }
        }
        
        this.isFollowingPath = false;
        this.currentPath = [];
        this.pathIndex = 0;
        this.lastPathTarget = null;
        this.lastPathEndTime = Date.now(); // Track when path was canceled
        this.stuckDetectionTime = 0; // Reset stuck detection
        this.lastPosition = null; // Reset position tracking
    }

    /**
     * Validate that a path doesn't go through obstacles
     * Checks intermediate points along path segments
     */
    private validatePath(path: PositionInterface[]): boolean {
        if (!this.pathfindingManager || path.length < 2) {
            return true; // Can't validate without pathfinding manager
        }

        // Check each segment of the path
        for (let i = 0; i < path.length - 1; i++) {
            const start = path[i];
            const end = path[i + 1];
            
            // Sample points along the segment to check for collisions
            const segmentLength = Math.sqrt(
                Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
            );
            // Sample every 16 pixels for tighter validation (was 32)
            const samples = Math.max(3, Math.floor(segmentLength / 16));
            
            for (let j = 0; j <= samples; j++) {
                const t = j / samples;
                const samplePoint = {
                    x: start.x + (end.x - start.x) * t,
                    y: start.y + (end.y - start.y) * t,
                };
                
                // Check if this point is walkable
                if (!this.pathfindingManager.isWalkable(samplePoint)) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.warn(`[Bot ${this.config.botId}] ⚠️ Path validation failed: segment ${i}->${i+1} goes through obstacle at (${samplePoint.x.toFixed(1)}, ${samplePoint.y.toFixed(1)})`);
                    }
                    return false; // Path goes through obstacle
                }
            }
        }
        
        return true; // Path is valid
    }

    /**
     * Update path following (call in update loop)
     * Uses simple movement matching original speed calculation
     */
    updatePathFollowing(deltaTime: number): void {
        if (!this.isFollowingPath || this.currentPath.length === 0) {
            return;
        }

        // CRITICAL: Ghost mode - bot should continue moving even if in a space
        // Only stop when actually interacted with (chat message), not just proximity
        // Don't check for spaces here - let the bot continue moving

        // CRITICAL: Check if bot should be stopped (either by stop() call)
        // If stop() was called, isMoving() will be false - respect that!
        // BUT: If bot is leading, don't cancel the path - let it continue to target
        if (!this.state.isMoving()) {
            const isLeading = this.behavior && (this.behavior as any).isLeading;
            if (!isLeading) {
            // Bot was stopped (likely by behavior.update() detecting we're in a space)
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Path following stopped - bot is not moving`);
            }
            this.cancelPathfinding();
            return;
            } else {
                // Bot is leading but stopped - keep path active and re-enable movement
                // This handles cases where stop() was called temporarily but we should continue
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] ⚠️ Path following: bot stopped while leading - re-enabling movement`);
                }
                // Re-enable movement to continue following the path
                this.state.setMoving(true);
                // Don't return - continue with path following
            }
        }

        const botPos = this.state.getPosition();
        
        // Stuck detection - DISABLED for now to allow movement to work
        // We'll re-enable with better logic once movement is confirmed working
        // Just initialize lastPosition if needed
        if (!this.lastPosition) {
            this.lastPosition = { ...botPos };
        }

        // Make sure we have a valid path index
        if (this.pathIndex >= this.currentPath.length) {
            this.isFollowingPath = false;
            this.currentPath = [];
            this.pathIndex = 0;
            this.lastPathTarget = null;
            this.lastPathEndTime = Date.now(); // Track when path ended
            
            // If bot is summoned and path ended, check if we're close to target
            // If close enough, stop and let bubble initiate (not ghost)
            const isSummoned = (this.behavior as any)?.isSummoned || false;
            if (isSummoned && this.lastPathTarget) {
                const botPos = this.state.getPosition();
                const dx = this.lastPathTarget.x - botPos.x;
                const dy = this.lastPathTarget.y - botPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If we're close to target (< 80px), stop and wait for bubble
                if (distance < 80) {
                    console.log(`[Bot ${this.config.botId}] ✅ Reached summon target (${distance.toFixed(1)}px away), stopping to initiate bubble`);
                    this.stop();
                    return;
                }
            }
            
            // GHOST MODE: Don't stop when path ends - let behavior handle it
            // Only stop if behavior explicitly wants to pause (and no players nearby)
            // this.stop(); // REMOVED - let behavior decide
            return;
        }

        // Get current waypoint
        const currentWaypoint = this.currentPath[this.pathIndex];
        
        // Calculate distance to current waypoint
        const dx = currentWaypoint.x - botPos.x;
        const dy = currentWaypoint.y - botPos.y;
        const distanceToWaypoint = Math.sqrt(dx * dx + dy * dy);

        // Waypoint advancement - strict threshold to prevent premature advancement
        // Based on debug data: 35+ waypoints were advanced at 29px (threshold violation)
        const waypointThreshold = 20; // Advance when within 20px
        
        // CRITICAL: Only advance if we're actually within threshold
        // Debug data showed 35+ waypoints advanced at 29px - the "closer to next" logic was the cause
        // For complex paths with tight spaces, we must strictly adhere to the threshold
        // Pathfinding already provides waypoints at appropriate distances
        const shouldAdvance = distanceToWaypoint < waypointThreshold;
        
        // REMOVED: "closer to next" fallback logic - it was causing premature advancement
        // If we overshoot slightly, the next frame will catch it when we're actually within threshold
        
        if (shouldAdvance) {
            const oldIndex = this.pathIndex;
            this.pathIndex++;
            
            // Log waypoint advancement with warning if distance exceeds threshold
            if (distanceToWaypoint > waypointThreshold) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] ⚠️ Waypoint advanced at ${distanceToWaypoint.toFixed(1)}px (threshold: ${waypointThreshold}px)`);
                }
            }
            
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'waypoint_advance',
                position: botPos,
                targetPosition: currentWaypoint,
                waypointIndex: this.pathIndex,
                pathLength: this.currentPath.length,
                distanceToTarget: distanceToWaypoint,
                metadata: {
                    threshold: waypointThreshold,
                    exceeded: distanceToWaypoint > waypointThreshold,
                },
            });
            
            if (this.pathIndex >= this.currentPath.length) {
                // All path waypoints reached - check if we're close to final target
                if (this.lastPathTarget) {
                    const finalDx = this.lastPathTarget.x - botPos.x;
                    const finalDy = this.lastPathTarget.y - botPos.y;
                    const finalDistance = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
                    
                    // If summoned, get closer (15px threshold), otherwise use 30px
                    const isSummoned = (this.behavior as any)?.isSummoned || false;
                    const isReturning = (this.behavior as any)?.isReturning || false;
                    const stopThreshold = isSummoned ? 15 : 30;
                    
                    // If we're close enough to target, consider path complete
                    // Otherwise, continue with direct movement to reach exact position
                    if (finalDistance < stopThreshold) {
                        movementLogger.log({
                            timestamp: Date.now(),
                            botId: this.config.botId,
                            eventType: 'path_end',
                            position: botPos,
                            targetPosition: { x: this.lastPathTarget.x, y: this.lastPathTarget.y },
                        });
                        
                        this.isFollowingPath = false;
                        this.currentPath = [];
                        this.pathIndex = 0;
                        this.lastPathTarget = null;
                        this.lastPathEndTime = Date.now();
                        
                        // If returning and reached original/start position, clear returning flag
                        if (isReturning) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached return position (${finalDistance.toFixed(1)}px away), clearing returning flag`);
                            if (this.behavior) {
                                (this.behavior as any).isReturning = false;
                                // Clear originalPosition (for summon return) or leadingStartPosition (for leading return)
                                if ((this.behavior as any).originalPosition) {
                                    (this.behavior as any).originalPosition = null;
                                }
                                if ((this.behavior as any).leadingStartPosition) {
                                    (this.behavior as any).leadingStartPosition = null;
                                }
                            }
                            this.stop();
                            return;
                        }
                        
                        // If summoned and close to target, stop to initiate bubble (not ghost)
                        if (isSummoned) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached summon target (${finalDistance.toFixed(1)}px away), stopping to initiate bubble`);
                            this.stop();
                        }
                        
                        // If leading and close to target, stop leading and send follow abort
                        if (this.behavior && (this.behavior as any).isLeading) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached destination while leading (${finalDistance.toFixed(1)}px away), stopping leading`);
                            this.cancelPathfinding(true); // End leading when destination is reached
                            this.stop();
                        }
                        
                        // GHOST MODE: Don't stop when path ends - let behavior handle it
                        // Behavior will check for nearby players and decide whether to pause
                        // this.stop(); // REMOVED - let behavior decide
                        return;
                    } else {
                        // Not close enough - continue with direct movement to exact target
                        // Add final target as last waypoint to continue movement
                        this.currentPath.push({ x: this.lastPathTarget.x, y: this.lastPathTarget.y });
                        // Continue path following with final target
                    }
                } else {
                    // No target - path complete
                    movementLogger.log({
                        timestamp: Date.now(),
                        botId: this.config.botId,
                        eventType: 'path_end',
                        position: botPos,
                    });
                    
                    // Check if bot was leading - if so, stop leading and send follow abort
                    if (this.behavior && (this.behavior as any).isLeading) {
                        console.log(`[Bot ${this.config.botId}] ✅ Reached destination while leading, stopping leading`);
                        this.cancelPathfinding(true); // End leading when destination is reached
                    }
                    
                    this.isFollowingPath = false;
                    this.currentPath = [];
                    this.pathIndex = 0;
                    this.lastPathTarget = null;
                    this.lastPathEndTime = Date.now();
                    // GHOST MODE: Don't stop when path ends - let behavior handle it
                    // Behavior will check for nearby players and decide whether to pause
                    // this.stop(); // REMOVED - let behavior decide
                    return;
                }
            }
        }

        // Get target waypoint (may have advanced)
        if (this.pathIndex >= this.currentPath.length) {
            return; // Path complete, will be handled above
        }

        const targetWaypoint = this.currentPath[this.pathIndex];
        
        // Calculate direction to target
        const targetDx = targetWaypoint.x - botPos.x;
        const targetDy = targetWaypoint.y - botPos.y;
        const distanceToTarget = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

        // Get speed from config
        const behaviorSpeed = (this.behavior as any)?.config?.speed || 
                            (this.behavior as any)?.config?.wanderSpeed || 50;
        
        // Check if bot is summoned, returning, or leading - apply different speed multipliers
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isReturning = (this.behavior as any)?.isReturning || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // CRITICAL FIX: Config has speed=100, but original bots branch used speed=50
        // Original: 50 * 0.016 = 0.8 pixels per frame
        // Current: 100 * 0.016 = 1.6 pixels per frame (2x faster!)
        // Solution: If speed > 75, halve it to match original behavior
        let effectiveSpeed = behaviorSpeed > 75 ? behaviorSpeed * 0.5 : behaviorSpeed;
        
        // Apply speed multipliers: summon = 3x, leading = 3x, return = 2x
        if (isSummoned) {
            effectiveSpeed = effectiveSpeed * 3; // Fast when summoned
        } else if (isLeading) {
            effectiveSpeed = effectiveSpeed * 5; // Fast when leading people (same as summon)
        } else if (isReturning) {
            effectiveSpeed = effectiveSpeed * 2; // Medium speed when returning
        }
        
        const angle = Math.atan2(targetDy, targetDx);
        const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
        const cappedDistance = Math.min(moveDistance, distanceToTarget);
        
        const newX = botPos.x + Math.cos(angle) * cappedDistance;
        const newY = botPos.y + Math.sin(angle) * cappedDistance;
        
        // CRITICAL: Validate new position is walkable before moving
        // Also check intermediate points for long movements to prevent cutting through walls
        const newPos = { x: newX, y: newY };
        if (this.pathfindingManager) {
            // Check the destination
            if (!this.pathfindingManager.isWalkable(newPos)) {
                // New position is in a wall - don't move, cancel pathfinding
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] 🚫 BLOCKED movement to non-walkable tile: (${newX.toFixed(1)}, ${newY.toFixed(1)}) from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)})`);
                }
                movementLogger.log({
                    timestamp: Date.now(),
                    botId: this.config.botId,
                    eventType: 'path_fail',
                    position: botPos,
                    targetPosition: targetWaypoint,
                    metadata: { reason: 'target_tile_not_walkable', attemptedPosition: newPos },
                });
                this.cancelPathfinding();
                return;
            }
            
            // For longer movements, check intermediate points to prevent cutting through walls
            if (cappedDistance > 10) {
                const steps = Math.ceil(cappedDistance / 10); // Check every 10 pixels
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const intermediateX = botPos.x + (newX - botPos.x) * t;
                    const intermediateY = botPos.y + (newY - botPos.y) * t;
                    const intermediatePos = { x: intermediateX, y: intermediateY };
                    
                    if (!this.pathfindingManager.isWalkable(intermediatePos)) {
                        // Intermediate point is in a wall - reduce movement distance
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[Bot ${this.config.botId}] ⚠️ Intermediate point blocked at (${intermediateX.toFixed(1)}, ${intermediateY.toFixed(1)}) - reducing movement`);
                        }
                        // Move only to the last safe position
                        const safeT = (i - 1) / steps;
                        const safeX = botPos.x + (newX - botPos.x) * safeT;
                        const safeY = botPos.y + (newY - botPos.y) * safeT;
                        // Determine direction for safe movement
                        const safeDx = safeX - botPos.x;
                        const safeDy = safeY - botPos.y;
                        let safeDirection = PositionMessage_Direction.DOWN;
                        if (Math.abs(safeDx) > Math.abs(safeDy)) {
                            safeDirection = safeDx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                        } else {
                            safeDirection = safeDy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                        }
                        this.moveTo(safeX, safeY, safeDirection);
                        return;
                    }
                }
            }
        }
        
        // Log movement for analysis
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.config.botId,
            eventType: 'move',
            position: { x: newX, y: newY },
            targetPosition: targetWaypoint,
            speed: behaviorSpeed,
            effectiveSpeed: effectiveSpeed,
            moveDistance: cappedDistance,
            deltaTime: deltaTime,
            waypointIndex: this.pathIndex,
            pathLength: this.currentPath.length,
            distanceToTarget: distanceToTarget,
            metadata: {
                angle: angle.toFixed(2),
                capped: cappedDistance < moveDistance,
                isWalkable: this.pathfindingManager ? this.pathfindingManager.isWalkable(newPos) : true,
            },
        });

        // CRITICAL: Check again if bot should be stopped before moving
        // This prevents moveTo() from overriding stop() calls from behavior
        if (!this.state.isMoving()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Movement blocked - bot is stopped`);
            }
            this.cancelPathfinding();
            return;
        }

        // Determine direction based on movement
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(targetDx) > Math.abs(targetDy)) {
            direction = targetDx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = targetDy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        // CRITICAL: Check one more time before calling moveTo() - behavior might have called stop() in the same frame
        if (!this.state.isMoving()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Movement blocked at moveTo() call - bot is stopped`);
            }
            this.cancelPathfinding();
            return;
        }

        this.moveTo(newX, newY, direction);
    }

    /**
     * Get all spaces the bot is currently in
     */
    getCurrentSpaces(): string[] {
        return Array.from(this.spaces.keys());
    }

    /**
     * Check if the bot is currently registered in the given space.
     * Used by flushPendingMedia to distinguish "not in space" (transient —
     * bot left or hasn't joined yet) from real send failures.
     */
    isInSpace(spaceName: string): boolean {
        return this.spaces.has(spaceName);
    }

    /**
     * Leave a conversation space
     */
    async leaveSpace(spaceName: string): Promise<void> {
        if (!this.spaces.has(spaceName)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Not in space ${spaceName}, nothing to leave`);
            }
            return;
        }

        try {
            await this.emitLeaveSpace(spaceName);
            this.spaces.delete(spaceName);
            if (this.behavior) {
                this.behavior.onSpaceLeft(spaceName);
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Left space: ${spaceName}`);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space ${spaceName}:`, error);
        }
    }

    /**
     * Leave all current conversation spaces
     */
    async leaveAllSpaces(): Promise<void> {
        const spacesToLeave = Array.from(this.spaces.keys());
        for (const spaceName of spacesToLeave) {
            await this.leaveSpace(spaceName);
        }
    }

    /**
     * Send chat message to space
     */
    sendChatMessage(spaceName: string, message: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName} (available spaces: ${Array.from(this.spaces.keys()).join(', ')})`);
            }
            return;
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Sending chat message to space ${spaceName}: "${message}"`);
        }

        // Chat messages are sent via PublicEvent with spaceMessage, not updateSpaceUserMessage
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessage',
                            spaceMessage: {
                                message,
                                characterTextures: [],
                                name: this.config.name,
                            },
                        },
                    },
                },
            },
        });
    }

    /** Return true when `ip` is a private/reserved address (both IPv4 and IPv6). */
    private isPrivateIp(ip: string): boolean {
        // IPv4 ranges
        if (/^127\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (ip === '0.0.0.0' || ip === '::1' || /^::$/.test(ip)) return true;
        if (/^10\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(ip)) return true;
        if (/^169\.254\.\d+\.\d+$/.test(ip) && ip !== '169.254.169.254') return true;
        // AWS metadata endpoint — still private
        if (ip === '169.254.169.254') return true;
        // IPv6 unique-local / link-local
        if (/^f[cd][0-9a-f]{0,3}:/i.test(ip)) return true;
        if (/^fe[89a-b][0-9a-f]:/i.test(ip)) return true;
        // IPv6-mapped IPv4 — handle both dot-decimal and hex forms
        if (/^::ffff:/i.test(ip)) {
            const embedded = ip.replace(/^::ffff:/i, '');
            // Dot-decimal: ::ffff:127.0.0.1
            if (/^\d+\.\d+\.\d+\.\d+$/.test(embedded) && this.isPrivateIp(embedded)) return true;
            // Hex form: ::ffff:7f00:1 — parse and recurse
            const parts = embedded.split(':');
            if (parts.length === 2) {
                const hexStr = parts.map(p => p.padStart(4, '0')).join('');
                const val = parseInt(hexStr, 16);
                if (!isNaN(val)) {
                    const decoded = [
                        (val >>> 24) & 0xff,
                        (val >>> 16) & 0xff,
                        (val >>> 8) & 0xff,
                        val & 0xff,
                    ].join('.');
                    if (this.isPrivateIp(decoded)) return true;
                }
            }
        }
        return false;
    }

    /**
     * Resolve a hostname via DNS and validate none of the resolved addresses
     * are private. Returns true when all resolved IPs are external.
     * Skips DNS for literal IP addresses (already validated by isPrivateHost).
     */
    private async resolveIsExternal(hostname: string): Promise<boolean> {
        if (/^[\d.]+$/.test(hostname) || (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) || hostname.startsWith('[')) {
            return true;
        }
        let safe = true;
        try {
            const v4 = await resolve4(hostname);
            if (v4.some(ip => this.isPrivateIp(ip))) safe = false;
        } catch { /* no A record — not a problem */ }
        try {
            const v6 = await resolve6(hostname);
            if (v6.some(ip => this.isPrivateIp(ip))) safe = false;
        } catch { /* no AAAA record — not a problem */ }
        return safe;
    }

    /** Follow HTTP redirects with SSRF validation on each hop (max 5 hops). */
    private async fetchWithRedirectFollow(
        url: string,
        init: RequestInit & { signal: AbortSignal },
        redirectCount = 0,
    ): Promise<Response> {
        if (redirectCount > 5) {
            throw new Error(`[BotClient] Too many redirects fetching: ${url}`);
        }

        // Validate each hop's hostname
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`[BotClient] Invalid redirect URL: ${url}`);
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`[BotClient] Unsupported redirect scheme: ${parsedUrl.protocol}`);
        }
        if (this.isPrivateHost(parsedUrl.hostname)) {
            throw new Error(`[BotClient] Redirect target is a private or reserved address: ${parsedUrl.hostname}`);
        }
        // DNS-level SSRF guard: resolve hostname and verify resolved IPs are not private
        const hostnameSafe = await this.resolveIsExternal(parsedUrl.hostname);
        if (!hostnameSafe) {
            throw new Error(`[BotClient] URL hostname '${parsedUrl.hostname}' resolves to a private/internal IP address`);
        }

        const response = await fetch(url, { ...init, redirect: 'manual' });

        // 3xx — manually follow with SSRF check on the redirect target
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
                throw new Error(`[BotClient] Redirect ${response.status} with no Location header: ${url}`);
            }
            // Resolve relative redirects against the current URL
            const redirectTarget = new URL(location, url).href;
            return this.fetchWithRedirectFollow(redirectTarget, init, redirectCount + 1);
        }

        return response;
    }

    /** Fetch a URL's body as a buffer with SSRF-safe redirect following, timeout, and size cap. */
    private async fetchMediaBuffer(url: string, mimeType?: string): Promise<{ buffer: Buffer; contentType: string }> {
        // Validate URL before fetching — SSRF prevention
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`[BotClient] Invalid URL: ${url}`);
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`[BotClient] Unsupported URL scheme: ${parsedUrl.protocol}`);
        }
        const hostname = parsedUrl.hostname;
        if (this.isPrivateHost(hostname)) {
            throw new Error(`[BotClient] URL points to a private or reserved address: ${hostname}`);
        }

        // Fetch with timeout, size limit, and SSRF-safe redirect following
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s timeout

        const MAX_SIZE = 25 * 1024 * 1024;

        try {
            const response = await this.fetchWithRedirectFollow(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`[BotClient] Failed to fetch media from ${url}: ${response.status} ${response.statusText}`);
            }

            // Stream the response body with a size cap (25 MB)
            // Timeout remains active throughout streaming to prevent hung connections
            const contentType = mimeType || response.headers.get('content-type') || 'application/octet-stream';
            const chunks: Buffer[] = [];
            let totalSize = 0;

            if (!response.body) {
                throw new Error('[BotClient] Response has no body stream');
            }
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    totalSize += value.length;
                    if (totalSize > MAX_SIZE) {
                        reader.cancel();
                        throw new Error(`[BotClient] Media exceeds maximum size of ${MAX_SIZE / 1024 / 1024} MB`);
                    }
                    chunks.push(Buffer.from(value));
                }
            } finally {
                reader.cancel().catch(() => {}); // Release the stream reader
            }
            const buffer = Buffer.concat(chunks);

            return { buffer, contentType };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Upload a file from a URL to the uploader service using bot service auth.
     * Fetches the content from the provided URL (e.g. MCP tool output) and POSTs it
     * to the uploader's /upload-file endpoint with the BOT_SERVICE_TOKEN header.
     * Returns the CDN location and inferred media type.
     */
    private async uploadMedia(url: string, mimeType?: string): Promise<{ location: string; mediaType: string; mimeType: string }> {
        const uploaderUrl = this.config.uploaderUrl || process.env.UPLOADER_URL;
        if (!uploaderUrl) {
            throw new Error('[BotClient] UPLOADER_URL not configured — cannot upload media');
        }

        // If the URL is already on our uploader/CDN, no need to re-upload
        if (url.startsWith(uploaderUrl) || url.includes('/upload-file/')) {
            // Infer media type from URL or mimeType
            const mediaType = this.inferMediaTypeFromUrl(url, mimeType);
            return { location: url, mediaType, mimeType: mimeType || 'application/octet-stream' };
        }
        // Fetch media content with SSRF-safe redirect following, timeout, and size limit
        const { buffer, contentType } = await this.fetchMediaBuffer(url, mimeType);

        // Extract filename from URL for the upload
        const urlPath = new URL(url).pathname;
        const filename = urlPath.split('/').pop() || `bot-media-${Date.now()}`;

        // Build multipart form data
        const formData = new FormData();
        const blob = new Blob([buffer], { type: contentType });
        formData.append('file', blob, filename);

        // Upload to uploader with bot service token
        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), 30_000);
        let uploadResponse: Response | undefined;
        try {
            uploadResponse = await fetch(`${uploaderUrl}/upload-file`, {
                method: 'POST',
                headers: {
                    'x-bot-service-token': process.env.BOT_SERVICE_TOKEN || '',
                },
                body: formData,
                signal: uploadController.signal,
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                throw new Error(`[BotClient] Upload failed: ${uploadResponse.status} — ${errorText}`);
            }
        } finally {
            clearTimeout(uploadTimeoutId);
        }

        const result = await uploadResponse!.json();
        if (!Array.isArray(result) || result.length === 0) {
            throw new Error('[BotClient] Upload response missing file data');
        }

        const uploadedFile = result[0];
        const location = uploadedFile.location || uploadedFile.url;
        const mediaType = this.inferMediaTypeFromUrl(location, contentType);

        return { location, mediaType, mimeType: contentType };
    }

    /**
     * Infer media type from URL extension or mime type
     */
    private inferMediaTypeFromUrl(url: string, mimeType?: string): string {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
        const mime = mimeType?.toLowerCase() || '';

        // Check mime type first
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('text/') || mime === 'application/pdf') return 'file';

        // Fallback to extension
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
        const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv'];

        if (imageExts.includes(ext)) return 'image';
        if (audioExts.includes(ext)) return 'audio';
        if (videoExts.includes(ext)) return 'video';
        return 'file';
    }

    /**
     * Send an image to a space.
     * Uploads the image from the provided URL to the CDN (if needed) and sends it to the chat.
     */
    async sendImage(spaceName: string, url: string, alt?: string): Promise<string> {
        const mimeHint = this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType, alt || '')) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send image`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent image to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send a file to a space.
     */
    async sendFile(spaceName: string, url: string, filename?: string): Promise<string> {
        const mimeHint = this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType, filename || '')) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send file`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent file to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send audio to a space.
     */
    async sendAudio(spaceName: string, url: string): Promise<string> {
        const mimeHint = this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send audio`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent audio to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send video to a space.
     */
    async sendVideo(spaceName: string, url: string): Promise<string> {
        const mimeHint = this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send video`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent video to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Upload a media file to the CDN and return the CDN URL.
     * Public wrapper around the private uploadMedia method.
     * Useful for callers that need the CDN URL before deciding to send.
     */
    async uploadToCDN(url: string, mimeType?: string): Promise<{ location: string; mediaType: string; mimeType: string }> {
        return this.uploadMedia(url, mimeType);
    }

    /**
     * Check if a hostname resolves to a private or link-local address.
     * Prevents SSRF attacks by rejecting internal network targets.
     */
    private isPrivateHost(hostname: string): boolean {
        // Strip brackets from IPv6 literals (Node.js URL normalizes [::ffff:127.0.0.1] to [::ffff:7f00:1])
        const raw = hostname.replace(/^\[|\]$/g, '');

        // Localhost / loopback (entire 127.0.0.0/8 range)
        if (raw === 'localhost' || raw === '::1' || /^127\.\d+\.\d+\.\d+$/.test(raw)) {
            return true;
        }
        // IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) — SSRF bypass vector
        if (/^::ffff:/i.test(raw)) {
            const embedded = raw.replace(/^::ffff:/i, '');
            // Dot-decimal form (unusual with brackets stripped, but handle it)
            if (/^\d+\.\d+\.\d+\.\d+$/.test(embedded)) {
                if (this.isPrivateIp(embedded)) return true;
            } else {
                // Hex form: "7f00:1", "a00:1", "c0a8:101" — normalize to dotted decimal
                const parts = embedded.split(':');
                if (parts.length === 2) {
                    const hexStr = parts.map(p => p.padStart(4, '0')).join('');
                    const val = parseInt(hexStr, 16);
                    if (!isNaN(val)) {
                        const ip = [
                            (val >>> 24) & 0xff,
                            (val >>> 16) & 0xff,
                            (val >>> 8) & 0xff,
                            val & 0xff,
                        ].join('.');
                        if (this.isPrivateIp(ip)) return true;
                    }
                }
            }
        }
        // IPv4 private ranges
        if (/^10\./.test(raw)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(raw)) return true;
        if (/^192\.168\./.test(raw)) return true;
        // IPv4 link-local
        if (/^169\.254\./.test(raw)) return true;
        // Reserved / zero address
        if (raw === '0.0.0.0') return true;
        // IPv6 documentation / private / unique-local
        if (raw === '::') return true;
        if (/^fc00:/i.test(raw) || /^fd00:/i.test(raw)) return true;
        if (/^fe80:/i.test(raw)) return true;
        // host.docker.internal or similar Docker/Kubernetes internal names
        if (raw.endsWith('.internal') || raw === 'host.docker.internal') return true;
        // Cloud metadata services
        if (raw === 'metadata.google.internal' || raw === 'metadata.internal') return true;
        // mDNS / link-local hostnames
        if (raw.endsWith('.local')) return true;
        return false;
    }

    /**
     * Send a media message to a space via publicEvent spaceMessage.
     */
    public sendMediaMessage(spaceName: string, url: string, mediaType: string, mimeType: string, caption?: string): boolean {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName} — cannot send media`);
            }
            return false;
        }

        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessage',
                            spaceMessage: {
                                message: caption || '',
                                characterTextures: [],
                                name: this.config.name,
                                url,
                                mediaType,
                                mimeType,
                            },
                        },
                    },
                },
            },
        });
        return true;
    }

    /**
     * Infer mime type from file extension
     */
    private inferMimeFromExt(url: string): string {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
            mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
            mp4: 'video/mp4', webm: 'video/webm',
            pdf: 'application/pdf', txt: 'text/plain',
            json: 'application/json', csv: 'text/csv',
        };
        return mimeMap[ext] || '';
    }

    /**
     * Send a streaming response chunk to the space.
     * Used by bot behaviors to stream AI-generated text token-by-token
     * to the frontend instead of waiting for the complete response.
     */
    sendStreamMessage(
        spaceName: string,
        responseId: string,
        token: string,
        isFinal: boolean,
        finalContent?: string,
        isError?: boolean,
        errorMessage?: string,
        reset?: boolean
    ): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Sending stream chunk to space ${spaceName}: token="${token.substring(0, 30)}", isFinal=${isFinal}`);
        }

        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceStreamMessage',
                            spaceStreamMessage: {
                                responseId,
                                token,
                                isFinal,
                                finalContent,
                                isError: isError ?? false,
                                errorMessage,
                                reset: reset ?? false,
                            },
                        },
                    },
                },
            },
        });
    }

    /**
     * Start typing indicator in space (shows bot is typing)
     */
    startTyping(spaceName: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Starting typing indicator in space ${spaceName}`);
        }

        // Send typing indicator via PublicEvent with SpaceIsTyping
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceIsTyping',
                            spaceIsTyping: {
                                isTyping: true,
                                characterTextures: [],
                            },
                        },
                    },
                },
            },
        });
    }

    /**
     * Stop typing indicator in space
     */
    stopTyping(spaceName: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Stopping typing indicator in space ${spaceName}`);
        }

        // Send stop typing indicator via PublicEvent with SpaceIsTyping
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceIsTyping',
                            spaceIsTyping: {
                                isTyping: false,
                                characterTextures: [],
                            },
                        },
                    },
                },
            },
        });
    }

    /**
     * Get player information
     */
    getPlayerInfo(playerId: number): PlayerInfo | undefined {
        return this.players.get(playerId);
    }

    /**
     * Get all nearby players
     */
    getNearbyPlayers(radius: number): PlayerInfo[] {
        const botPos = this.state.getPosition();
        const result: PlayerInfo[] = [];

        for (const player of this.players.values()) {
            // Skip bots
            if (BotClient.isBot(player.userId)) {
                continue;
            }
            // Skip players at (0, 0) - likely invalid position data
            if (player.position.x === 0 && player.position.y === 0) {
                continue;
            }
            
            const dx = player.position.x - botPos.x;
            const dy = player.position.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= radius) {
                result.push(player);
            }
        }
        
        // Debug: log when players are found (always log for debugging)
        if (result.length > 0) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] getNearbyPlayers: found ${result.length} player(s) within ${radius}px (checked ${this.players.size} total), bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)})`);
                }
                for (const player of result) {
                    const dx = player.position.x - botPos.x;
                    const dy = player.position.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    console.log(`[Bot ${this.config.botId}]   Player ${player.userId} at (${Math.round(player.position.x)}, ${Math.round(player.position.y)}) - distance: ${Math.round(distance)}px`);
                }
            }
        }
        
        return result;
    }
    
    /**
     * Get all players in the room (for debugging)
     * @deprecated Use getAllPeople() instead
     */
    getAllPlayers(): PlayerInfo[] {
        return Array.from(this.players.values());
    }

    /**
     * Get all people on the map (includes both players and bots)
     */
    getAllPeople(): PlayerInfo[] {
        return Array.from(this.players.values());
    }

    /**
     * Get the room URL this bot is connected to
     */
    getRoomUrl(): string {
        return this.config.roomUrl;
    }

    /**
     * Teleport bot to a new position instantly
     */
    teleportTo(x: number, y: number): void {
        this.state.setPosition({ x, y });
        this.config.position = { x, y };
        this.sendPosition(this.state.getPosition(), this.state.getDirection(), false);
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Teleported to (${x}, ${y})`);
        }
    }

    /**
     * Update bot configuration (position, behavior config, etc.)
     */
    updateConfig(updates: {
        position?: { x: number; y: number };
        behaviorConfig?: Record<string, unknown>;
    }): void {
        if (updates.position) {
            this.teleportTo(updates.position.x, updates.position.y);
        }

        // Behavior config updates are handled by BotManager which creates new behavior
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Config updated`);
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get bot ID
     */
    getBotId(): string {
        return this.config.botId;
    }

    /**
     * Set full bot configuration (called by BotManager on spawn)
     * This avoids HTTP requests to fetch config during conversations
     */
    setFullConfig(config: BotConfiguration): void {
        this.fullConfig = config;
    }

    /**
     * Get full bot configuration
     * Returns null if not set (should only happen if bot wasn't spawned via BotManager)
     */
    getFullConfig(): BotConfiguration | null {
        return this.fullConfig;
    }

    /**
     * Summon bot to a player's position
     * The bot will pathfind to the player, stop at their position, and initiate a bubble
     * When the player leaves, the bot will return to its original position
     * @param playerUuid Player UUID being summoned to
     * @param targetPosition Target position to move to
     */
    async summonToPlayer(playerUuid: string, targetPosition: PositionInterface): Promise<void> {
        console.log(`[Bot ${this.config.botId}] 🎯 SUMMON START - player ${playerUuid} at (${targetPosition.x}, ${targetPosition.y})`);
        
        if (!this.behavior) {
            console.error(`[Bot ${this.config.botId}] ❌ No behavior assigned`);
            throw new Error('Bot has no behavior assigned');
        }

        // Start summon in behavior (tracks original position)
        // This will throw an error if bot is engaged with someone else
        try {
            this.behavior.startSummon(playerUuid, targetPosition);
            console.log(`[Bot ${this.config.botId}] ✅ Behavior.startSummon() completed`);
        } catch (error: any) {
            console.error(`[Bot ${this.config.botId}] ❌ Behavior.startSummon() failed:`, error.message);
            // Re-throw the error so BotManager can handle it
            throw error;
        }

        // Cancel any existing pathfinding
        this.cancelPathfinding();
        // CRITICAL: Reset ALL pathfinding cooldowns so we can immediately start new pathfinding for summon
        // Otherwise the cooldown checks in moveToWithPathfinding() will block us
        this.lastPathEndTime = 0;
        this.lastPathRecalcTime = 0; // Reset recalculation cooldown too
        console.log(`[Bot ${this.config.botId}] ✅ Canceled existing pathfinding and reset all cooldowns`);

        // Check if pathfinding is available
        if (!this.hasPathfinding()) {
            console.error(`[Bot ${this.config.botId}] ❌ Cannot summon - pathfinding not initialized`);
            throw new Error('Pathfinding not initialized for bot');
        }
        console.log(`[Bot ${this.config.botId}] ✅ Pathfinding is available`);

        // Get bot position for logging
        const botPos = this.state.getPosition();
        const dx = targetPosition.x - botPos.x;
        const dy = targetPosition.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        console.log(`[Bot ${this.config.botId}] 📍 Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), target at (${Math.round(targetPosition.x)}, ${Math.round(targetPosition.y)}), distance: ${Math.round(distance)}px`);

        // Use pathfinding to move to target position
        // The bot will stop automatically when it reaches the position (within threshold)
        // The bubble will initiate automatically when the bot gets close enough
        console.log(`[Bot ${this.config.botId}] 🚀 Calling moveToWithPathfinding()...`);
        const pathfindingResult = await this.moveToWithPathfinding(targetPosition.x, targetPosition.y);

        console.log(`[Bot ${this.config.botId}] ✅ Summon pathfinding ${pathfindingResult ? 'STARTED' : 'FAILED'} to (${targetPosition.x}, ${targetPosition.y})`);
        console.log(`[Bot ${this.config.botId}] 📊 State: isFollowingPath=${this.isFollowingPath}, isMoving=${this.state.isMoving()}, pathLength=${this.currentPath.length}, pathIndex=${this.pathIndex}`);

        if (!pathfindingResult) {
            console.error(`[Bot ${this.config.botId}] ❌ Summon pathfinding failed - bot may be too close to target (<50px) or pathfinding unavailable`);
        }
    }

    /**
     * Send a follow request to make people follow the bot
     * @param forceFollow If true, automatically makes them follow without confirmation
     */
    sendFollowRequest(forceFollow: boolean = true): void {
        if (!this.userId) {
            console.error(`[Bot ${this.config.botId}] Cannot send follow request - not connected`);
            return;
        }

        this.send({
            message: {
                $case: 'followRequestMessage',
                followRequestMessage: {
                    leader: this.userId,
                    forceFollow,
                },
            },
        });

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📢 Sent follow request (forceFollow=${forceFollow})`);
        }
    }

    /**
     * Stop leading (send follow abort message)
     */
    sendFollowAbort(): void {
        if (!this.userId) {
            return;
        }

        this.send({
            message: {
                $case: 'followAbortMessage',
                followAbortMessage: {
                    leader: this.userId,
                    follower: 0, // 0 means all followers
                },
            },
        });

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 Sent follow abort`);
        }
    }

    /**
     * Lead a person (or group) to a target location
     * Sends follow request, then navigates to the destination
     * @param personUuid Person UUID (or 'group' for group leading)
     * @param target Target destination (person or area)
     */
    async leadPersonToTarget(
        personUuid: string,
        target: { type: 'person' | 'area'; name: string; position: PositionInterface }
    ): Promise<void> {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🎯 LEAD START - leading to ${target.type} "${target.name}" at (${target.position.x}, ${target.position.y})`);
        }

        if (!this.behavior) {
            console.error(`[Bot ${this.config.botId}] ❌ No behavior assigned`);
            throw new Error('Bot has no behavior assigned');
        }

        // Start leading in behavior
        try {
            this.behavior.startLeading(personUuid, target);
            console.log(`[Bot ${this.config.botId}] ✅ Behavior.startLeading() completed`);
        } catch (error: any) {
            console.error(`[Bot ${this.config.botId}] ❌ Behavior.startLeading() failed:`, error.message);
            throw error;
        }

        // Send follow request with forceFollow=true (makes people automatically follow)
        this.sendFollowRequest(true);

        // Cancel any existing pathfinding
        this.cancelPathfinding();
        // Reset pathfinding cooldowns
        this.lastPathEndTime = 0;
        this.lastPathRecalcTime = 0;
        console.log(`[Bot ${this.config.botId}] ✅ Canceled existing pathfinding and reset all cooldowns`);

        // Check if pathfinding is available
        if (!this.hasPathfinding()) {
            console.error(`[Bot ${this.config.botId}] ❌ Cannot lead - pathfinding not initialized`);
            throw new Error('Pathfinding not initialized for bot');
        }
        console.log(`[Bot ${this.config.botId}] ✅ Pathfinding is available`);

        // Get bot position for logging
        const botPos = this.state.getPosition();
        const dx = target.position.x - botPos.x;
        const dy = target.position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        console.log(`[Bot ${this.config.botId}] 📍 Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), target at (${Math.round(target.position.x)}, ${Math.round(target.position.y)}), distance: ${Math.round(distance)}px`);

        // Use pathfinding to move to target position
        console.log(`[Bot ${this.config.botId}] 🚀 Calling moveToWithPathfinding()...`);
        const pathfindingResult = await this.moveToWithPathfinding(target.position.x, target.position.y);

        console.log(`[Bot ${this.config.botId}] ✅ Lead pathfinding ${pathfindingResult ? 'STARTED' : 'FAILED'} to (${target.position.x}, ${target.position.y})`);
        console.log(`[Bot ${this.config.botId}] 📊 State: isFollowingPath=${this.isFollowingPath}, isMoving=${this.state.isMoving()}, pathLength=${this.currentPath.length}, pathIndex=${this.pathIndex}`);

        if (!pathfindingResult) {
            const errorMsg = `Lead pathfinding failed - bot may be too close to target (<50px) or pathfinding unavailable`;
            console.error(`[Bot ${this.config.botId}] ❌ ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    /**
     * Get user ID (assigned by server)
     */
    getUserId(): number | null {
        return this.userId;
    }

    /**
     * Get bot state
     */
    getState(): BotState {
        return this.state;
    }

    /**
     * Handle incoming WebSocket message
     */
    private async handleMessage(data: ArrayBuffer): Promise<void> {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📨 Received message, size: ${data.byteLength} bytes`);
        }
        
        try {
            const message = ServerToClientMessage.decode(new Uint8Array(data));
            const msg = message.message;
            if (!msg) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] ⚠️ Message has no content`);
                }
                return;
            }

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 📬 Message type: ${msg.$case}`);
            }

            switch (msg.$case) {
                case 'batchMessage':
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📦 Batch message with ${msg.batchMessage.payload.length} sub-messages`);
                    }
                    for (const subMessage of msg.batchMessage.payload) {
                        await this.handleSubMessage(subMessage.message);
                    }
                    break;
                default:
                    await this.handleSubMessage(msg);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] ❌ Error handling message:`, error);
        }
    }

    private async handleSubMessage(message: any): Promise<void> {
        if (!message) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] ⚠️ handleSubMessage called with null/undefined message`);
            }
            return;
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🔍 Processing sub-message type: ${message.$case}`);
        }

        switch (message.$case) {
            case 'roomJoinedMessage':
                this.userId = message.roomJoinedMessage.currentUserId;
                // Register this bot's userId so other bots can ignore it
                BotClient.botUserIds.add(this.userId);
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] ✅ Joined room, userId: ${this.userId}`);
                }
                
                // Automatically join the world space (allWorldUser) so bots appear in user list
                // This matches what regular users do in GameScene.ts
                const worldSpaceName = "allWorldUser";
                this.emitJoinSpace(worldSpaceName, FilterType.ALL_USERS, ["availabilityStatus", "chatID"])
                    .then((spaceUserId) => {
                        this.spaces.set(worldSpaceName, spaceUserId);
                        // Send initial user state update with availabilityStatus = ONLINE (1)
                        this.sendSpaceUserUpdate(worldSpaceName, {
                            cameraState: false,
                            microphoneState: false,
                            screenSharingState: false,
                            availabilityStatus: 1, // ONLINE
                        });
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Joined world space: ${worldSpaceName}`);
                        }
                    })
                    .catch((error) => {
                        console.error(`[Bot ${this.config.botId}] Failed to join world space:`, error);
                    });
                break;

            case 'userJoinedMessage':
                {
                    const userId = message.userJoinedMessage.userId;
                    const isBot = BotClient.isBot(userId);
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 userJoinedMessage received - userId=${userId}, isBot=${isBot}`);
                    }
                    if (!isBot) {
                        const playerPos = {
                            x: message.userJoinedMessage.position?.x ?? 0,
                            y: message.userJoinedMessage.position?.y ?? 0,
                        };
                        // Calculate distance for logging
                        const botPos = this.state.getPosition();
                        const dx = playerPos.x - botPos.x;
                        const dy = playerPos.y - botPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] ✅ Player ${userId} joined at (${Math.round(playerPos.x)}, ${Math.round(playerPos.y)}), distance: ${Math.round(distance)}px (now ${this.players.size + 1} players)`);
                        }
                        this.players.set(userId, {
                            userId: userId,
                            name: message.userJoinedMessage.name,
                            position: playerPos,
                            availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                        });
                        // CRITICAL: Notify behavior about the player so it can check if they're nearby
                        if (this.behavior && playerPos.x > 0 && playerPos.y > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[Bot ${this.config.botId}] 📤 Calling onPlayerMoved for joined player ${userId}`);
                            }
                            this.behavior.onPlayerMoved(userId, playerPos);
                        }
                    } else {
                        this.players.set(userId, {
                            userId: userId,
                            name: message.userJoinedMessage.name,
                            position: {
                                x: message.userJoinedMessage.position?.x ?? 0,
                                y: message.userJoinedMessage.position?.y ?? 0,
                            },
                            availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                        });
                    }
                }
                break;

            case 'userMovedMessage':
                {
                    const userId = message.userMovedMessage.userId;
                    const isBot = BotClient.isBot(userId);
                    const movedPlayer = this.players.get(userId);
                    if (movedPlayer && message.userMovedMessage.position) {
                        movedPlayer.position = {
                            x: message.userMovedMessage.position.x,
                            y: message.userMovedMessage.position.y,
                        };
                        if (this.behavior && !isBot) {
                            // Calculate distance for logging
                            const botPos = this.state.getPosition();
                            const dx = movedPlayer.position.x - botPos.x;
                            const dy = movedPlayer.position.y - botPos.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance < 150) { // Only log if within 150px
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] 📍 Player ${userId} moved to (${Math.round(movedPlayer.position.x)}, ${Math.round(movedPlayer.position.y)}), distance: ${Math.round(distance)}px`);
                                }
                            }
                            this.behavior.onPlayerMoved(userId, movedPlayer.position);
                        }
                    } else if (!movedPlayer && message.userMovedMessage.position && !isBot) {
                        // Player not in our list yet, add them
                        const botPos = this.state.getPosition();
                        const dx = message.userMovedMessage.position.x - botPos.x;
                        const dy = message.userMovedMessage.position.y - botPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] ✅ Player ${userId} moved (new) - adding to players map (now ${this.players.size + 1} players), distance: ${Math.round(distance)}px`);
                        }
                        this.players.set(userId, {
                            userId: userId,
                            name: 'Unknown',
                            position: {
                                x: message.userMovedMessage.position.x,
                                y: message.userMovedMessage.position.y,
                            },
                            availabilityStatus: 0,
                        });
                        if (this.behavior) {
                            this.behavior.onPlayerMoved(userId, {
                                x: message.userMovedMessage.position.x,
                                y: message.userMovedMessage.position.y,
                            });
                        }
                    }
                }
                break;

            case 'userLeftMessage':
                this.players.delete(message.userLeftMessage.userId);
                break;

            case 'groupUpdateMessage':
                if (this.behavior) {
                    this.behavior.onGroupJoined(message.groupUpdateMessage.groupId, message.groupUpdateMessage.userIds);
                }
                break;

            case 'joinSpaceRequestMessage':
                this.handleJoinSpaceRequest(message.joinSpaceRequestMessage);
                break;

            case 'leaveSpaceRequestMessage':
                this.handleLeaveSpaceRequest(message.leaveSpaceRequestMessage);
                break;

            case 'initSpaceUsersMessage':
                // When bot joins a space, backend sends all existing users with their UUIDs
                // This ensures we have UUID tracking before any chat messages arrive
                if (this.behavior && message.initSpaceUsersMessage) {
                    const spaceName = message.initSpaceUsersMessage.spaceName;
                    const spaceUsers = message.initSpaceUsersMessage.users || [];
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 initSpaceUsersMessage: ${spaceUsers.length} users in space ${spaceName}`);
                    }
                    
                    // Process each user to populate UUID tracking immediately
                    for (const spaceUser of spaceUsers) {
                        // Extract numeric userId from spaceUserId (format: "roomID_userID")
                        // The last part after the underscore is the numeric userId
                        let numericUserId: number | null = null;
                        if (spaceUser.spaceUserId) {
                            const lastUnderscoreIndex = spaceUser.spaceUserId.lastIndexOf('_');
                            if (lastUnderscoreIndex !== -1) {
                                const userIdStr = spaceUser.spaceUserId.substring(lastUnderscoreIndex + 1);
                                numericUserId = parseInt(userIdStr, 10);
                                if (isNaN(numericUserId)) {
                                    numericUserId = null;
                                }
                            }
                        }
                        
                        if (numericUserId) {
                            // Skip the bot itself
                            if (numericUserId === this.userId) {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] Skipping bot itself (userId: ${numericUserId})`);
                                }
                                continue;
                            }
                            
                            // Create a SpaceUser-like object with id field for onSpaceUserJoined
                            const userWithId = {
                                ...spaceUser,
                                id: numericUserId,
                            } as any;
                            
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[Bot ${this.config.botId}] 📝 Tracking UUID for user ${numericUserId} (${spaceUser.name}): ${spaceUser.uuid || 'NO UUID'}, isLogged: ${spaceUser.isLogged || false}`);
                            }
                            
                            // Call onSpaceUserJoined to track UUIDs and auth status
                            await this.behavior.onSpaceUserJoined(spaceName, userWithId);
                        } else {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[Bot ${this.config.botId}] Could not extract numeric userId from SpaceUser "${spaceUser.name}" (spaceUserId: ${spaceUser.spaceUserId || 'unknown'}, UUID: ${spaceUser.uuid || 'unknown'})`);
                            }
                        }
                    }
                }
                break;

            case 'addSpaceUserMessage':
                // When a user joins a space, we get their SpaceUser info
                // Extract numeric userId from spaceUserId to avoid name collisions
                if (this.behavior && message.addSpaceUserMessage) {
                    const spaceName = message.addSpaceUserMessage.spaceName;
                    const spaceUser = message.addSpaceUserMessage.user;
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 addSpaceUserMessage: ${spaceUser.name} (spaceUserId: ${spaceUser.spaceUserId}, UUID: ${spaceUser.uuid || 'NO UUID'}) in space ${spaceName}`);
                    }
                    
                    // Extract numeric userId from spaceUserId (format: "roomID_userID" or full URL)
                    let numericUserId: number | null = null;
                    if (spaceUser.spaceUserId) {
                        const lastUnderscoreIndex = spaceUser.spaceUserId.lastIndexOf('_');
                        if (lastUnderscoreIndex !== -1) {
                            const userIdStr = spaceUser.spaceUserId.substring(lastUnderscoreIndex + 1);
                            numericUserId = parseInt(userIdStr, 10);
                            if (isNaN(numericUserId)) {
                                numericUserId = null;
                            }
                        }
                    }
                    
                    if (!numericUserId) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[Bot ${this.config.botId}] Could not extract numeric userId from SpaceUser "${spaceUser.name}" (spaceUserId: ${spaceUser.spaceUserId || 'unknown'}, UUID: ${spaceUser.uuid || 'unknown'}) in space ${spaceName}`);
                        }
                        break;
                    }
                    
                    // Create a SpaceUser-like object with id field
                    const userWithId = {
                        ...spaceUser,
                        id: numericUserId,
                    } as any;
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📝 Tracking UUID from addSpaceUserMessage for user ${numericUserId} (${spaceUser.name}): ${spaceUser.uuid || 'NO UUID'}, isLogged: ${spaceUser.isLogged || false}`);
                    }
                    
                    await this.behavior.onSpaceUserJoined(spaceName, userWithId);
                }
                break;

            case 'updateSpaceUserMessage':
                if (message.updateSpaceUserMessage.message) {
                    const chatMessage = message.updateSpaceUserMessage.message.message;
                    if (chatMessage && this.behavior) {
                        console.log(`[Bot ${this.config.botId}] Received chat via updateSpaceUserMessage: "${chatMessage}" from user ${message.updateSpaceUserMessage.userId}`);
                        this.behavior.onChatMessage(
                            message.updateSpaceUserMessage.spaceName,
                            chatMessage,
                            message.updateSpaceUserMessage.userId ?? 0
                        ).catch(error => {
                            console.error(`[Bot ${this.config.botId}] onChatMessage error:`, error);
                        });
                    }
                }
                break;

            case 'publicEvent':
                // Handle incoming chat messages from players (sent via publicEvent with spaceMessage)
                if (message.publicEvent.spaceEvent?.event?.$case === 'spaceMessage') {
                    const spaceMessage = message.publicEvent.spaceEvent.event.spaceMessage;
                    const spaceName = message.publicEvent.spaceName;
                    const senderName = spaceMessage.name;
                    const senderUserId = message.publicEvent.senderUserId; // spaceUserId format: "roomID_userID"
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] publicEvent spaceMessage: "${spaceMessage.message}" from ${senderName}, senderUserId: ${senderUserId}, players map size: ${this.players.size}`);
                    }
                    
                    // Extract numeric userId from senderUserId (format: "roomID_userID")
                    // This is more reliable than matching by name and avoids name collisions
                    let senderId = 0;
                    if (senderUserId) {
                        const lastUnderscoreIndex = senderUserId.lastIndexOf('_');
                        if (lastUnderscoreIndex !== -1) {
                            const userIdStr = senderUserId.substring(lastUnderscoreIndex + 1);
                            senderId = parseInt(userIdStr, 10);
                            if (isNaN(senderId)) {
                                senderId = 0;
                            }
                        }
                    }
                    
                    // Fallback: if extraction failed, try to find by name
                    if (senderId === 0) {
                        for (const [userId, player] of this.players.entries()) {
                            if (player.name === senderName) {
                                senderId = userId;
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] Found player ${senderName} with userId ${userId} (fallback by name)`);
                                }
                                break;
                            }
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Extracted userId ${senderId} from senderUserId ${senderUserId}`);
                        }
                    }
                    
                    if (senderId === 0) {
                        console.warn(`[Bot ${this.config.botId}] Could not find userId for player "${senderName}" (senderUserId: ${senderUserId}). Available players:`, Array.from(this.players.entries()).map(([id, p]) => `${p.name} (${id})`));
                    }
                    
                    // If we have senderId but no UUID tracked yet, register it as pending
                    // This helps match addSpaceUserMessage when it arrives
                    if (senderId > 0 && this.behavior && senderUserId) {
                        const userUuid = (this.behavior as any).userIdToUuid?.get(senderId);
                        if (!userUuid) {
                            // Register pending spaceUserId -> userId mapping
                            if ((this.behavior as any).registerPendingSpaceUserId) {
                                (this.behavior as any).registerPendingSpaceUserId(senderUserId, senderId);
                            }
                            
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[Bot ${this.config.botId}] UUID not tracked for userId ${senderId} (${senderName}, senderUserId: ${senderUserId}). Registered as pending, waiting for addSpaceUserMessage...`);
                                const uuidMap = (this.behavior as any).userIdToUuid;
                                if (uuidMap) {
                                    console.log(`[Bot ${this.config.botId}] Current UUID tracking map (${uuidMap.size} entries):`, Array.from(uuidMap.entries()).map(([id, uuid]) => `${id} -> ${uuid}`));
                                } else {
                                    console.warn(`[Bot ${this.config.botId}] UUID tracking map is not available on behavior`);
                                }
                            }
                        }
                    }
                    
                    // Ignore messages from bots (including ourselves)
                    if (senderId > 0 && !BotClient.isBot(senderId)) {
                        if (!this.behavior) {
                            console.warn(`[Bot ${this.config.botId}] Behavior is null, cannot handle chat message`);
                            break;
                        }
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Calling behavior.onChatMessage: "${spaceMessage.message}" from ${senderName} (userId: ${senderId})`);
                        }
                        this.behavior.onChatMessage(
                            spaceName,
                            spaceMessage.message,
                            senderId,
                            spaceMessage.url,
                            spaceMessage.mediaType,
                            spaceMessage.mimeType
                        ).catch(error => {
                            console.error(`[Bot ${this.config.botId}] onChatMessage error:`, error);
                        });
                    } else {
                        if (senderId === 0) {
                            console.warn(`[Bot ${this.config.botId}] Skipping chat message: senderId is 0`);
                        } else if (BotClient.isBot(senderId) && (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true')) {
                            console.log(`[Bot ${this.config.botId}] Skipping chat message: sender is a bot (userId: ${senderId})`);
                        }
                    }
                }
                break;

            case 'removeSpaceUserMessage':
                if (this.behavior) {
                    this.behavior.onSpaceUserLeft(message.removeSpaceUserMessage.spaceName, message.removeSpaceUserMessage.userId);
                }
                break;

            case 'errorMessage':
                console.error(`[Bot ${this.config.botId}] Server error:`, message.errorMessage.message);
                break;

            case 'errorScreenMessage':
                console.error(`[Bot ${this.config.botId}] Server error screen:`, JSON.stringify(message.errorScreenMessage, null, 2));
                break;

            case 'answerMessage':
                this.handleAnswer(message.answerMessage);
                break;

            case 'pingMessage':
                // Respond to server ping to keep connection alive
                this.sendPong();
                break;
            default:
                // Unhandled message types — bots only process what they need
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Unhandled message type: ${message.$case}`);
                }
                break;
        }
    }

    /**
     * Send pong response to server ping
     */
    private sendPong(): void {
        this.send({
            message: {
                $case: 'pingMessage',
                pingMessage: {},
            },
        });
    }

    private async handleJoinSpaceRequest(request: JoinSpaceRequestMessage): Promise<void> {
        // Skip Jitsi spaces - bots don't do video conferences
        if (request.spaceName.includes('jitsi')) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Skipping jitsi space: ${request.spaceName}`);
            }
            return;
        }

        // Check with behavior if we should join this proximity space
        // This allows behaviors to decline bubbles (e.g., patrol bot walking over idle player)
        if (this.behavior && !this.behavior.shouldJoinProximitySpace(request.spaceName)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Behavior declined space: ${request.spaceName}`);
            }
            return;
        }

        try {
            // Default filterType to ALL_USERS (0) — field removed from protobuf
            const filterType = FilterType.ALL_USERS;
            const propertiesToSync = request.propertiesToSync || [];
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joining space: ${request.spaceName}`);
            }
            
            const spaceUserId = await this.emitJoinSpace(request.spaceName, filterType, propertiesToSync);
            this.spaces.set(request.spaceName, spaceUserId);
            
            // Register as a space watcher to receive initSpaceUsersMessage with user UUIDs
            // This is required for the pusher to send us the list of existing users in the space
            // (matches frontend behavior in Space.ts registerSpaceFilter)
            this.emitAddSpaceFilter(request.spaceName);
            
            // Immediately tell others we have NO camera/mic/screenshare
            // This prevents the "loading" indicator for our video
            this.sendSpaceUserUpdate(request.spaceName, {
                cameraState: false,
                microphoneState: false,
                screenSharingState: false,
            });
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joined space: ${request.spaceName}, registered filter, sent media state: off`);
            }
            
            if (this.behavior) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Calling behavior.onSpaceJoined with spaceName=${request.spaceName}, behavior type=${this.behavior.constructor.name}`);
                }
                try {
                    this.behavior.onSpaceJoined(request.spaceName);
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] behavior.onSpaceJoined completed successfully`);
                    }
                } catch (error) {
                    console.error(`[Bot ${this.config.botId}] ERROR in behavior.onSpaceJoined:`, error);
                }
            } else {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] No behavior to call onSpaceJoined on!`);
                }
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error joining space:`, error);
        }
    }
    
    /**
     * Send an update about this bot's user state in a space
     */
    private sendSpaceUserUpdate(spaceName: string, updates: Partial<{
        cameraState: boolean;
        microphoneState: boolean;
        screenSharingState: boolean;
        megaphoneState: boolean;
        availabilityStatus: number;
    }>): void {
        // Build the updateMask paths based on what we're updating
        const paths: string[] = [];
        if ('cameraState' in updates) paths.push('cameraState');
        if ('microphoneState' in updates) paths.push('microphoneState');
        if ('screenSharingState' in updates) paths.push('screenSharingState');
        if ('megaphoneState' in updates) paths.push('megaphoneState');
        if ('availabilityStatus' in updates) paths.push('availabilityStatus');
        
        // Get our spaceUserId for this space
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Cannot update space user - not in space: ${spaceName}`);
            }
            return;
        }
        
        this.send({
            message: {
                $case: 'updateSpaceUserMessage',
                updateSpaceUserMessage: {
                    spaceName,
                    user: {
                        spaceUserId: spaceUserId,
                        name: this.config.name,
                        playUri: this.config.roomUrl,
                        color: '',
                        characterTextures: [],
                        isLogged: false,
                        availabilityStatus: updates.availabilityStatus ?? 1, // Default to ONLINE (1) instead of UNCHANGED (0)
                        roomName: undefined,
                        visitCardUrl: undefined,
                        tags: ['bot'],
                        cameraState: updates.cameraState ?? false,
                        microphoneState: updates.microphoneState ?? false,
                        screenSharingState: updates.screenSharingState ?? false,
                        megaphoneState: updates.megaphoneState ?? false,
                        jitsiParticipantId: undefined,
                        uuid: this.config.botId,
                        chatID: undefined,
                        showVoiceIndicator: false,
                    },
                    updateMask: paths,
                },
            },
        });
    }

    private async handleLeaveSpaceRequest(request: LeaveSpaceRequestMessage): Promise<void> {
        try {
            // Unregister as a space watcher before leaving
            // This matches frontend behavior and ensures proper cleanup
            this.emitRemoveSpaceFilter(request.spaceName);
            
            await this.emitLeaveSpace(request.spaceName);
            this.spaces.delete(request.spaceName);
            if (this.behavior) {
                this.behavior.onSpaceLeft(request.spaceName);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space:`, error);
        }
    }
    
    /**
     * Register as a watcher for a space to receive user information (including UUIDs)
     * This triggers the pusher to send initSpaceUsersMessage with all existing users
     */
    private emitAddSpaceFilter(spaceName: string): void {
        this.send({
            message: {
                $case: 'addSpaceFilterMessage',
                addSpaceFilterMessage: {
                    spaceFilterMessage: {
                        spaceName,
                    },
                },
            },
        });
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📋 Sent AddSpaceFilterMessage for space: ${spaceName}`);
        }
    }
    
    /**
     * Unregister as a watcher for a space (cleanup before leaving)
     */
    private emitRemoveSpaceFilter(spaceName: string): void {
        this.send({
            message: {
                $case: 'removeSpaceFilterMessage',
                removeSpaceFilterMessage: {
                    spaceFilterMessage: {
                        spaceName,
                    },
                },
            },
        });
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📋 Sent RemoveSpaceFilterMessage for space: ${spaceName}`);
        }
    }

    private async emitJoinSpace(spaceName: string, filterType: FilterType, propertiesToSync: string[]): Promise<SpaceUser['spaceUserId']> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'joinSpaceQuery',
                            joinSpaceQuery: {
                                spaceName,
                                filterType,
                                propertiesToSync,
                            },
                        },
                    },
                },
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Join space timeout'));
                }
            }, 10000);
        });
    }

    private async emitLeaveSpace(spaceName: string): Promise<void> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'leaveSpaceQuery',
                            leaveSpaceQuery: {
                                spaceName,
                            },
                        },
                    },
                },
            });

            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Leave space timeout'));
                }
            }, 10000);
        });
    }

    private handleAnswer(answer: any): void {
        const query = this.pendingQueries.get(answer.id);
        if (query) {
            this.pendingQueries.delete(answer.id);
            if (answer.answer?.$case === 'joinSpaceAnswer') {
                query.resolve(answer.answer.joinSpaceAnswer.spaceUserId);
            } else if (answer.answer?.$case === 'leaveSpaceAnswer') {
                query.resolve(undefined);
            } else {
                query.reject(new Error('Unexpected answer type'));
            }
        }
    }

    public sendPosition(position: PositionInterface, direction: PositionMessage_Direction, moving: boolean): void {
        // Safety checks for undefined values
        const x = position?.x ?? 0;
        const y = position?.y ?? 0;
        // Update viewport to be centered on current position with large radius
        const viewportRadius = 2000;
        const top = Math.max(0, y - viewportRadius);
        const bottom = y + viewportRadius;
        const left = Math.max(0, x - viewportRadius);
        const right = x + viewportRadius;
        
        // Ensure direction is a valid enum value
        const safeDirection = typeof direction === 'number' ? direction : PositionMessage_Direction.DOWN;

        // Check for NaN values
        if (isNaN(x) || isNaN(y)) {
            // Keep this as error-level warning - invalid positions are serious
            console.warn(`[Bot ${this.config.botId}] Invalid position: x=${x}, y=${y}`);
            return;
        }

        this.send({
            message: {
                $case: 'userMovesMessage',
                userMovesMessage: {
                    position: {
                        x: Math.floor(x),
                        y: Math.floor(y),
                        direction: safeDirection,
                        moving: !!moving,
                    },
                    viewport: {
                        top: Math.floor(top),
                        bottom: Math.floor(bottom),
                        left: Math.floor(left),
                        right: Math.floor(right),
                    },
                },
            },
        });
    }

    private send(message: ClientToServerMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            const encoded = ClientToServerMessage.encode(message).finish();
            this.ws.send(encoded);
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error sending message:`, error);
        }
    }
}

interface PlayerInfo {
    userId: number;
    name: string;
    position: PositionInterface;
    availabilityStatus: number;
}

