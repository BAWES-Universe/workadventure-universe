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
} from '@workadventure/messages';
import type { PositionInterface, ViewportInterface } from '../../play/src/front/Connection/ConnexionModels';
import { BotState } from './BotState';
import type { BaseBehavior } from '../behaviors/BaseBehavior';
import { BotPathfindingManager } from '../utils/BotPathfindingManager';
import { PathSmoother } from '../utils/PathSmoother';
import { movementLogger } from '../utils/MovementLogger';

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
                // Only log disconnections in dev or if it's an error code (not normal close)
                if (code !== 1000 && (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true')) {
                    console.warn(`[Bot ${this.config.botId}] Disconnected - Code: ${code}, Reason: ${reasonStr}`);
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
            
            // For patrol bots that should respond, only stop if in a conversation space
            // Don't stop just because players are nearby (ghost mode for idle players)
            if (shouldRespond && isInSpace) {
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
            } else if (isMoving) {
                this.updatePathFollowing(deltaTime);
            } else {
                // Path following is active but bot is stopped - cancel pathfinding
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🛑 Path following active but bot stopped - canceling pathfinding`);
                }
                this.cancelPathfinding();
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
        // CRITICAL: For patrol bots, only block movement if in a conversation space
        // This allows ghost mode: continue moving if players are idle nearby
        if (this.behavior) {
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
            console.log(`[Bot ${this.config.botId}] 📍 moveTo() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, pos=(${Math.round(x)}, ${Math.round(y)})`);
        }
    }

    /**
     * Stop moving
     */
    stop(): void {
        const wasMoving = this.state.isMoving();
        // Only log in development to avoid spam in production
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            const nearbyPlayers = this.getNearbyPlayers(100);
            if (nearbyPlayers.length > 0) {
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
        // Only log in development
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 STOP() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, isFollowingPath=${this.isFollowingPath}`);
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
            return false;
        }

        const now = Date.now();

        // Cooldown check - don't recalculate too frequently
        if (now - this.lastPathRecalcTime < this.PATH_RECALC_COOLDOWN && this.isFollowingPath) {
            return true; // Keep following current path
        }
        
        // Don't create new path too soon after previous path ended/canceled (prevents glitching)
        if (!this.isFollowingPath && this.lastPathEndTime > 0) {
            const timeSincePathEnd = now - this.lastPathEndTime;
            if (timeSincePathEnd < this.PATH_END_COOLDOWN) {
                // Too soon after path ended, skip pathfinding - let behavior use direct movement
                return false;
            }
        }

        // Don't recalculate if we're already following a path to a similar target
        if (this.isFollowingPath && this.lastPathTarget) {
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
        if (distanceToTarget < 50) {
            // Already close enough, no need for pathfinding - use direct movement instead
            return false;
        }

        const rawPath = await this.pathfindingManager.findPath(botPos, { x, y }, true);

        if (rawPath.length === 0) {
            // No path found, fall back to direct movement
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
            return false;
        }

        // CRITICAL: Validate path doesn't go through obstacles before using it
        if (!this.validatePath(rawPath)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] ⚠️ Path validation failed - path goes through obstacles! Rejecting path.`);
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
     */
    cancelPathfinding(): void {
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
        if (!this.state.isMoving()) {
            // Bot was stopped (likely by behavior.update() detecting we're in a space)
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Path following stopped - bot is not moving`);
            }
            this.cancelPathfinding();
            return;
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
                    
                    // If we're close enough to target (< 30px), consider path complete
                    // Otherwise, continue with direct movement to reach exact position
                    if (finalDistance < 30) {
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
        
        // CRITICAL FIX: Config has speed=100, but original bots branch used speed=50
        // Original: 50 * 0.016 = 0.8 pixels per frame
        // Current: 100 * 0.016 = 1.6 pixels per frame (2x faster!)
        // Solution: If speed > 75, halve it to match original behavior
        const effectiveSpeed = behaviorSpeed > 75 ? behaviorSpeed * 0.5 : behaviorSpeed;
        
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
                console.log(`[Bot ${this.config.botId}] getNearbyPlayers: found ${result.length} player(s) within ${radius}px (checked ${this.players.size} total), bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)})`);
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
     */
    getAllPlayers(): PlayerInfo[] {
        return Array.from(this.players.values());
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
    private handleMessage(data: ArrayBuffer): void {
        try {
            const message = ServerToClientMessage.decode(new Uint8Array(data));
            const msg = message.message;
            if (!msg) return;

            switch (msg.$case) {
                case 'batchMessage':
                    for (const subMessage of msg.batchMessage.payload) {
                        this.handleSubMessage(subMessage.message);
                    }
                    break;
                default:
                    this.handleSubMessage(msg);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error handling message:`, error);
        }
    }

    private handleSubMessage(message: ServerToClientMessage['message']): void {
        if (!message) return;

        switch (message.$case) {
            case 'roomJoinedMessage':
                this.userId = message.roomJoinedMessage.currentUserId;
                // Register this bot's userId so other bots can ignore it
                BotClient.botUserIds.add(this.userId);
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Joined room, userId: ${this.userId}`);
                }
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

            case 'addSpaceUserMessage':
                if (this.behavior) {
                    this.behavior.onSpaceUserJoined(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user);
                }
                break;

            case 'updateSpaceUserMessage':
                if (message.updateSpaceUserMessage.message) {
                    const chatMessage = message.updateSpaceUserMessage.message.message;
                    if (chatMessage && this.behavior) {
                        this.behavior.onChatMessage(
                            message.updateSpaceUserMessage.spaceName,
                            chatMessage,
                            message.updateSpaceUserMessage.userId ?? 0
                        );
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
            // Default filterType to ALL_USERS (0) if not provided
            const filterType = request.filterType ?? FilterType.ALL_USERS;
            const propertiesToSync = request.propertiesToSync || [];
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joining space: ${request.spaceName}`);
            }
            
            const spaceUserId = await this.emitJoinSpace(request.spaceName, filterType, propertiesToSync);
            this.spaces.set(request.spaceName, spaceUserId);
            
            // Immediately tell others we have NO camera/mic/screenshare
            // This prevents the "loading" indicator for our video
            this.sendSpaceUserUpdate(request.spaceName, {
                cameraState: false,
                microphoneState: false,
                screenSharingState: false,
            });
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joined space: ${request.spaceName}, sent media state: off`);
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
    }>): void {
        // Build the updateMask paths based on what we're updating
        const paths: string[] = [];
        if ('cameraState' in updates) paths.push('cameraState');
        if ('microphoneState' in updates) paths.push('microphoneState');
        if ('screenSharingState' in updates) paths.push('screenSharingState');
        if ('megaphoneState' in updates) paths.push('megaphoneState');
        
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
                        availabilityStatus: 0,
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
            await this.emitLeaveSpace(request.spaceName);
            this.spaces.delete(request.spaceName);
            if (this.behavior) {
                this.behavior.onSpaceLeft(request.spaceName);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space:`, error);
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

    private sendPosition(position: PositionInterface, direction: PositionMessage_Direction, moving: boolean): void {
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

