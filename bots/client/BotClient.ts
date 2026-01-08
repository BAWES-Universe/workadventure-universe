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
    private readonly PATH_END_COOLDOWN = 300; // Minimum 300ms before creating new path after one ends
    private stuckDetectionTime: number = 0;
    private lastPosition: PositionInterface | null = null;
    private readonly STUCK_THRESHOLD = 5; // Pixels
    private readonly STUCK_TIME = 2000; // 2 seconds (increased from 1s to prevent false positives)
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

            console.log(`[Bot ${this.config.botId}] Connecting to: ${url.toString()}`);
            console.log(`[Bot ${this.config.botId}] Using token: ${token.substring(0, 50)}...`);
            this.ws = new WebSocket(url.toString(), subProtocols);
            this.ws.binaryType = 'arraybuffer';

            this.ws.on('open', () => {
                console.log(`[Bot ${this.config.botId}] Connected successfully`);
                this.connected = true;
                resolve();
            });

            this.ws.on('error', (error) => {
                console.error(`[Bot ${this.config.botId}] WebSocket error:`, error);
                reject(error);
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                const reasonStr = reason ? reason.toString() : 'No reason provided';
                console.log(`[Bot ${this.config.botId}] Disconnected - Code: ${code}, Reason: ${reasonStr}`);
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
            this.ws.close();
            this.ws = null;
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

        // Update path following if active (this handles movement)
        if (this.isFollowingPath) {
            this.updatePathFollowing(deltaTime);
        }

        // Update behavior (behavior can still control movement if not following path)
        // IMPORTANT: If following path, behavior.update should NOT move (it just checks path status)
        this.behavior.update(deltaTime);

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
        this.state.setPosition({ x, y });
        this.state.setDirection(direction);
        this.state.setMoving(true);
    }

    /**
     * Stop moving
     */
    stop(): void {
        if (this.state.isMoving()) {
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'stop',
                position: this.state.getPosition(),
            });
        }
        this.state.setMoving(false);
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
        
        // Don't create new path too soon after previous path ended (prevents glitching)
        if (!this.isFollowingPath && now - this.lastPathEndTime < this.PATH_END_COOLDOWN) {
            return false; // Too soon after path ended, skip pathfinding
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

        // Smooth and optimize the path
        const smoothedPath = this.pathSmoother.smoothPath(rawPath);

        // Only use smoothed path if it's still valid (has at least 2 points)
        if (smoothedPath.length < 2) {
            this.currentPath = rawPath;
        } else {
            this.currentPath = smoothedPath;
        }

        this.pathIndex = 0;
        this.isFollowingPath = true;
        this.lastPathTarget = { x, y };
        this.lastPathRecalcTime = now;
        
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
    }

    /**
     * Update path following (call in update loop)
     * Uses simple movement matching original speed calculation
     */
    updatePathFollowing(deltaTime: number): void {
        if (!this.isFollowingPath || this.currentPath.length === 0) {
            return;
        }

        const botPos = this.state.getPosition();
        
        // Stuck detection - if not moving for >3 seconds, cancel pathfinding
        // BUT: Only check after we've actually tried to move (give it time to start)
        if (this.lastPosition) {
            const movedDistance = Math.sqrt(
                Math.pow(botPos.x - this.lastPosition.x, 2) + 
                Math.pow(botPos.y - this.lastPosition.y, 2)
            );
            
            if (movedDistance < this.STUCK_THRESHOLD) {
                // Only start stuck timer if we've been following path for at least 2 seconds
                // This prevents false positives when path just started or bot is moving slowly
                const pathAge = Date.now() - this.lastPathRecalcTime;
                if (pathAge > 2000) {
                    if (this.stuckDetectionTime === 0) {
                        this.stuckDetectionTime = Date.now();
                    } else if (Date.now() - this.stuckDetectionTime > this.STUCK_TIME) {
                        // Stuck for too long, cancel pathfinding and let behavior handle it
                        console.warn(`[Bot ${this.config.botId}] Stuck detected after ${pathAge}ms, canceling pathfinding`);
                        this.cancelPathfinding();
                        return;
                    }
                }
            } else {
                this.stuckDetectionTime = 0; // Reset stuck detection
            }
        } else {
            // First time, initialize lastPosition
            this.lastPosition = { ...botPos };
        }
        
        // Update lastPosition AFTER checking (so we compare previous frame to current)
        if (!this.lastPosition) {
            this.lastPosition = { ...botPos };
        } else {
            this.lastPosition = { ...botPos };
        }

        // Make sure we have a valid path index
        if (this.pathIndex >= this.currentPath.length) {
            this.isFollowingPath = false;
            this.currentPath = [];
            this.pathIndex = 0;
            this.lastPathTarget = null;
            this.lastPathEndTime = Date.now(); // Track when path ended
            this.stop();
            return;
        }

        // Get current waypoint
        const currentWaypoint = this.currentPath[this.pathIndex];
        
        // Calculate distance to current waypoint
        const dx = currentWaypoint.x - botPos.x;
        const dy = currentWaypoint.y - botPos.y;
        const distanceToWaypoint = Math.sqrt(dx * dx + dy * dy);

        // Simple waypoint advancement - only advance when very close
        // Use a single threshold to prevent oscillation
        const waypointThreshold = 30; // Advance when within 30px (increased from 20px to prevent glitching)
        
        if (distanceToWaypoint < waypointThreshold) {
            const oldIndex = this.pathIndex;
            this.pathIndex++;
            
            // Log waypoint advancement
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'waypoint_advance',
                position: botPos,
                targetPosition: currentWaypoint,
                waypointIndex: this.pathIndex,
                pathLength: this.currentPath.length,
                distanceToTarget: distanceToWaypoint,
            });
            
            if (this.pathIndex >= this.currentPath.length) {
                // Reached destination
                movementLogger.log({
                    timestamp: Date.now(),
                    botId: this.config.botId,
                    eventType: 'path_end',
                    position: botPos,
                    targetPosition: this.lastPathTarget ? { x: this.lastPathTarget.x, y: this.lastPathTarget.y } : undefined,
                });
                
                this.isFollowingPath = false;
                this.currentPath = [];
                this.pathIndex = 0;
                this.lastPathTarget = null;
                this.lastPathEndTime = Date.now(); // Track when path ended
                this.stop();
                return;
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
            },
        });

        // Determine direction based on movement
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(targetDx) > Math.abs(targetDy)) {
            direction = targetDx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = targetDy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.moveTo(newX, newY, direction);
    }

    /**
     * Send chat message to space
     */
    sendChatMessage(spaceName: string, message: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName}`);
            return;
        }

        this.send({
            message: {
                $case: 'updateSpaceUserMessage',
                updateSpaceUserMessage: {
                    spaceName,
                    message: {
                        message,
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
            // Skip bots - but log if we're skipping
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
        console.log(`[Bot ${this.config.botId}] Teleported to (${x}, ${y})`);
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
        console.log(`[Bot ${this.config.botId}] Config updated`);
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
                console.log(`[Bot ${this.config.botId}] Joined room, userId: ${this.userId}`);
                break;

            case 'userJoinedMessage':
                this.players.set(message.userJoinedMessage.userId, {
                    userId: message.userJoinedMessage.userId,
                    name: message.userJoinedMessage.name,
                    position: {
                        x: message.userJoinedMessage.position?.x ?? 0,
                        y: message.userJoinedMessage.position?.y ?? 0,
                    },
                    availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                });
                break;

            case 'userMovedMessage':
                {
                    const movedPlayer = this.players.get(message.userMovedMessage.userId);
                    if (movedPlayer && message.userMovedMessage.position) {
                        movedPlayer.position = {
                            x: message.userMovedMessage.position.x,
                            y: message.userMovedMessage.position.y,
                        };
                        if (this.behavior) {
                            this.behavior.onPlayerMoved(message.userMovedMessage.userId, movedPlayer.position);
                        }
                    } else if (!movedPlayer && message.userMovedMessage.position) {
                        // Player not in our list yet, add them
                        this.players.set(message.userMovedMessage.userId, {
                            userId: message.userMovedMessage.userId,
                            name: 'Unknown',
                            position: {
                                x: message.userMovedMessage.position.x,
                                y: message.userMovedMessage.position.y,
                            },
                            availabilityStatus: 0,
                        });
                        if (this.behavior) {
                            this.behavior.onPlayerMoved(message.userMovedMessage.userId, {
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
            console.log(`[Bot ${this.config.botId}] Skipping jitsi space: ${request.spaceName}`);
            return;
        }

        // Check with behavior if we should join this proximity space
        // This allows behaviors to decline bubbles (e.g., patrol bot walking over idle player)
        if (this.behavior && !this.behavior.shouldJoinProximitySpace(request.spaceName)) {
            console.log(`[Bot ${this.config.botId}] Behavior declined space: ${request.spaceName}`);
            return;
        }

        try {
            // Default filterType to ALL_USERS (0) if not provided
            const filterType = request.filterType ?? FilterType.ALL_USERS;
            const propertiesToSync = request.propertiesToSync || [];
            
            console.log(`[Bot ${this.config.botId}] Joining space: ${request.spaceName}`);
            
            const spaceUserId = await this.emitJoinSpace(request.spaceName, filterType, propertiesToSync);
            this.spaces.set(request.spaceName, spaceUserId);
            
            // Immediately tell others we have NO camera/mic/screenshare
            // This prevents the "loading" indicator for our video
            this.sendSpaceUserUpdate(request.spaceName, {
                cameraState: false,
                microphoneState: false,
                screenSharingState: false,
            });
            
            console.log(`[Bot ${this.config.botId}] Joined space: ${request.spaceName}, sent media state: off`);
            
            if (this.behavior) {
                console.log(`[Bot ${this.config.botId}] Calling behavior.onSpaceJoined...`);
                this.behavior.onSpaceJoined(request.spaceName);
                console.log(`[Bot ${this.config.botId}] behavior.onSpaceJoined completed`);
            } else {
                console.log(`[Bot ${this.config.botId}] No behavior to call onSpaceJoined on!`);
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
            console.warn(`[Bot ${this.config.botId}] Cannot update space user - not in space: ${spaceName}`);
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

