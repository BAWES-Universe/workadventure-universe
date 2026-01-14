/**
 * PatrolBehavior - Bot follows a predefined route
 * 
 * Like SocialBehavior: always accepts spaces, but only engages when
 * nearbyPlayers > 0 (player moved into proximity).
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';
import { movementLogger } from '../utils/MovementLogger';
import { ConversationMemory } from '../memory/ConversationMemory';

export interface PatrolBehaviorConfig extends BehaviorConfig {
    type: 'patrol';
    waypoints: Array<{ x: number; y: number }>;
    loop: boolean;
    pauseAtWaypoints: number;
    speed: number;
    respondToPlayers: boolean;
    responseRadius?: number;
    greetingMessages?: string[]; // Random greetings (optional, defaults to "Hello! How can I help you?")
    conversationHistorySize?: number; // Size of conversation history to keep
}

export class PatrolBehavior extends BaseBehavior {
    private currentWaypointIndex: number = 0;
    private isPaused: boolean = false;
    private pauseStartTime: number = 0;
    private targetWaypoint: PositionInterface | null = null;
    private currentSpaceName: string | null = null;
    private spaceLeftTime: number = 0;
    private conversationMemory: ConversationMemory;
    private readonly RESUME_DELAY = 500;
    private lastPathfindingLog: number = 0; // Rate limit pathfinding logs
    private lastMoveAttemptLog: number = 0; // Rate limit move attempt logs
    private waypointAttemptStartTime: number = 0; // Track when we started trying to reach current waypoint
    private lastWaypointPosition: PositionInterface | null = null; // Track last position to detect if stuck
    private playerLastMoveTime: Map<number, number> = new Map(); // Track when each player last moved
    private readonly IDLE_RESUME_DELAY = 2000; // Resume if player idle for 2 seconds

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.conversationMemory = new ConversationMemory(
            config.conversationHistorySize || 50,
            1000 // Max 1000 player memories per bot
        );
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // If bot is summoned, allow movement to player (don't stop for normal behavior logic)
        // The bot will stop when it reaches the player position
        if (this.isSummoned) {
            // During summon, only stop if we've reached the target and are in a conversation space
            // Otherwise, continue moving towards the summoned player
            if (this.bot.getIsFollowingPath()) {
                // Bot is moving to summoned player - allow it
                this.onBotPositionUpdated();
                return;
            } else if (this.currentSpaceName || this.engagedWithUsers.size > 0) {
                // Bot reached player and is in conversation - stop and face
                this.bot.stop();
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return;
            } else {
                // Path ended but not in space yet - bot reached target, stop and wait for bubble
                // Don't continue with normal behavior - wait for player to get close enough for bubble
                this.bot.stop();
                this.updateProximityEngagement(); // Face the player if nearby
                this.onBotPositionUpdated();
                return;
            }
        }
        
        // Check for nearby players and stop when detected (patrol bots should always respond)
        // Use respondToPlayers flag if set, otherwise default to true for patrol bots
        const shouldRespond = config.respondToPlayers !== false; // Default to true if not explicitly false
        
        // GHOST MODE: Only stop if actually in a conversation space (like social bot)
        // Check both currentSpaceName (immediate) and engagedWithUsers (after users join)
        // CRITICAL: Check this BEFORE path following to prevent movement in bubbles
        if (shouldRespond && (this.currentSpaceName || this.engagedWithUsers.size > 0)) {
            // Actually in a conversation space - stop immediately and cancel any movement
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Update engagement to ensure facing is correct (handles player movement)
            this.updateProximityEngagement();
            this.onBotPositionUpdated(); // Track position even when stopped
            return;
        }
        
        // If bot is stopped and not in a space, check if all nearby players are idle
        // If so, resume movement (ghost through idle players) - similar to social bot pattern
        if (shouldRespond && !this.bot.getState().isMoving() && !this.bot.getIsFollowingPath() && 
            !this.currentSpaceName && this.engagedWithUsers.size === 0) {
            const now = Date.now();
            let allPlayersIdle = true;
            
            // Check if any nearby players moved recently (active)
            for (const [playerId] of this.nearbyPlayers) {
                const lastMoveTime = this.playerLastMoveTime.get(playerId) || 0;
                if (now - lastMoveTime < this.IDLE_RESUME_DELAY) {
                    allPlayersIdle = false; // Player is active
                    break;
                }
            }
            
            // If all players are idle and no space joined, resume (ghost mode)
            if (allPlayersIdle && this.nearbyPlayers.size > 0) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    const firstPlayerId = Array.from(this.nearbyPlayers.keys())[0];
                    const timeSinceMove = firstPlayerId ? Math.round((now - (this.playerLastMoveTime.get(firstPlayerId) || 0)) / 1000) : 0;
                    console.log(`[PatrolBehavior] 👻 Resuming path - player nearby but idle (${timeSinceMove}s), no space joined (ghost mode)`);
                }
                // Resume by starting movement to waypoint
                if (this.targetWaypoint) {
                    this.moveTowardsWaypoint(config, deltaTime).catch(error => {
                        console.error(`[PatrolBehavior] Error resuming to waypoint:`, error);
                    });
                }
                return;
            }
        }
        
        // ALWAYS check for players if respondToPlayers is enabled (or default true)
        if (shouldRespond) {
            // Patrol bot uses 100px detection radius (different from social bot's 80px)
            const responseRadius = config.responseRadius || 100;
            const nearbyPlayers = this.bot.getNearbyPlayers(responseRadius);
            
            // Also check nearbyPlayers map (populated by onPlayerMoved when players move within enterRadius)
            // This catches players that might be stationary or not detected by getNearbyPlayers
            const hasNearbyPlayers = nearbyPlayers.length > 0 || this.nearbyPlayers.size > 0;
            
            // Check if any nearby players are actively moving (not idle)
            const now = Date.now();
            let hasActivePlayers = false;
            for (const [playerId] of this.nearbyPlayers) {
                const lastMoveTime = this.playerLastMoveTime.get(playerId) || 0;
                if (now - lastMoveTime < this.IDLE_RESUME_DELAY) {
                    hasActivePlayers = true;
                    break;
                }
            }
            
            // Only stop if players are actively moving (not idle)
            if (hasNearbyPlayers && hasActivePlayers) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PatrolBehavior] 🛑 STOPPING - found active players (getNearbyPlayers=${nearbyPlayers.length}, nearbyPlayersMap=${this.nearbyPlayers.size}, responseRadius=${responseRadius}, isFollowingPath=${this.bot.getIsFollowingPath()})`);
                }
                if (this.bot.getIsFollowingPath()) {
                    this.bot.cancelPathfinding();
                }
                this.bot.stop();
                // Face the closest player
                if (nearbyPlayers.length > 0) {
                    this.facePosition(nearbyPlayers[0].position);
                } else if (this.nearbyPlayers.size > 0) {
                    // Use nearbyPlayers map if getNearbyPlayers didn't find them
                    const firstPlayer = this.nearbyPlayers.values().next().value;
                    if (firstPlayer) {
                        this.facePosition(firstPlayer);
                    }
                }
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return; // CRITICAL: Return early to prevent updatePathFollowing from being called
            }
        } else {
            // Log if respondToPlayers is explicitly false
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (Math.random() < 0.01) { // 1% chance to avoid spam
                    console.log(`[PatrolBehavior] respondToPlayers is false - not checking for players`);
                }
            }
        }
        
        // CRITICAL: Ghost mode behavior - bot should NEVER stop just because players are nearby
        // The bot should continue moving on its path, even if players are nearby
        // Only stop when actually interacted with (chat message, explicit interaction)
        // This prevents bubbles from being triggered by the bot stopping
        // The bot can slow down or change direction, but must keep moving
        
        // If following a path, let BotClient handle movement
        // BUT: BotClient.updatePathFollowing() already checks for nearby players and stops
        // So we just need to call it - the stop logic is handled there
        if (this.bot.getIsFollowingPath()) {
            // BotClient.updatePathFollowing() will check for nearby players and stop if needed
            this.bot.updatePathFollowing(deltaTime);
            
            // Check if path completed
            if (!this.bot.getIsFollowingPath()) {
                // Reached waypoint - check distance to confirm we're actually at the waypoint
                const botPos = this.bot.getState().getPosition();
                if (this.targetWaypoint) {
                    const dx = this.targetWaypoint.x - botPos.x;
                    const dy = this.targetWaypoint.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Check if we're stuck (not making progress towards waypoint)
                    const now = Date.now();
                    const timeSinceAttempt = now - this.waypointAttemptStartTime;
                    const isStuck = timeSinceAttempt > 10000 && distance > 50; // Stuck if trying for >10s and still >50px away
                    
                    // Check if we're making progress
                    let isMakingProgress = false;
                    if (this.lastWaypointPosition) {
                        const lastDx = this.targetWaypoint.x - this.lastWaypointPosition.x;
                        const lastDy = this.targetWaypoint.y - this.lastWaypointPosition.y;
                        const lastDistance = Math.sqrt(lastDx * lastDx + lastDy * lastDy);
                        isMakingProgress = distance < lastDistance - 10; // Moved at least 10px closer
                    }
                    
                    // Only pause if we're actually close to the waypoint (within 30px for exact positioning)
                    // BUT: Don't pause if ANY players are nearby (idle or active) - would start a bubble
                    // Ghost mode: continue moving if players are nearby to avoid triggering bubbles
                    if (distance < 30) {
                        // Check if ANY players are nearby (idle or active) - use getNearbyPlayers to catch idle players
                        const nearbyPlayersList = this.bot.getNearbyPlayers(100);
                        if (nearbyPlayersList.length > 0 || this.nearbyPlayers.size > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[PatrolBehavior] ✅ Waypoint reached (${Math.round(distance)}px away) but players nearby (${nearbyPlayersList.length} idle, ${this.nearbyPlayers.size} active) - skipping pause, continuing immediately (ghost mode)`);
                            }
                            this.waypointAttemptStartTime = 0; // Reset
                            this.lastWaypointPosition = null; // Reset
                            this.advanceToNextWaypoint(config);
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[PatrolBehavior] 🎯 Advanced to next waypoint (index ${this.currentWaypointIndex})`);
                            }
                        } else {
                            // No players nearby - safe to pause
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[PatrolBehavior] ✅ Waypoint reached (${Math.round(distance)}px away) - pausing for ${config.pauseAtWaypoints}s`);
                            }
                            this.isPaused = true;
                            this.pauseStartTime = Date.now();
                            this.waypointAttemptStartTime = 0; // Reset
                            this.lastWaypointPosition = null; // Reset
                            // If pauseAtWaypoints is 0, immediately advance to next waypoint
                            if (config.pauseAtWaypoints <= 0) {
                                this.isPaused = false;
                                this.advanceToNextWaypoint(config);
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[PatrolBehavior] 🎯 Advanced to next waypoint (index ${this.currentWaypointIndex})`);
                                }
                            }
                        }
                    } else {
                        // Not close enough - continue to waypoint using direct movement for precision
                        // BotClient pathfinding ended but we're not at exact position - use direct movement
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[PatrolBehavior] ⚠️ Path ended but still ${Math.round(distance)}px from waypoint - using direct movement to reach exact position`);
                        }
                        this.lastWaypointPosition = { x: botPos.x, y: botPos.y }; // Track position
                        // Use direct movement to reach exact waypoint position
                        const dx = this.targetWaypoint.x - botPos.x;
                        const dy = this.targetWaypoint.y - botPos.y;
                        const angle = Math.atan2(dy, dx);
                        const effectiveSpeed = config.speed > 75 ? config.speed * 0.5 : config.speed;
                        const moveDistance = effectiveSpeed * 0.016;
                        const newX = botPos.x + Math.cos(angle) * moveDistance;
                        const newY = botPos.y + Math.sin(angle) * moveDistance;
                        
                        // Validate new position is walkable
                        if (this.bot.hasPathfinding() && !this.bot.isWalkable({ x: newX, y: newY })) {
                            // Can't move directly - might be blocked, try pathfinding again after cooldown
                            const timeSincePathEnd = Date.now() - (this.bot as any).lastPathEndTime || 0;
                            if (timeSincePathEnd > 1000) {
                                this.moveTowardsWaypoint(config, deltaTime).catch(error => {
                                    console.error(`[PatrolBehavior] Error moving to waypoint:`, error);
                                });
                            }
                        } else {
                            // Safe to move directly
                            let direction = PositionMessage_Direction.DOWN;
                            if (Math.abs(dx) > Math.abs(dy)) {
                                direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                            } else {
                                direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                            }
                            this.bot.moveTo(newX, newY, direction);
                        }
                    }
                }
            }
            this.onBotPositionUpdated();
            return;
        }

        this.onBotPositionUpdated();

        // Update proximity engagement (check for nearby players and face them)
        // Only update if not in a space - if in a space, we already handled stopping above
        if (!this.currentSpaceName && this.engagedWithUsers.size === 0) {
            this.updateProximityEngagement();
        }

        // Resume patrol
        if (!this.targetWaypoint && config.waypoints.length > 0) {
            this.updateTargetWaypoint();
            if (!this.targetWaypoint) {
                this.currentWaypointIndex = 0;
                this.updateTargetWaypoint();
            }
        }

        // Handle waypoint pause
        // CRITICAL: Check for nearby players BEFORE pausing - if players nearby, skip pause (ghost mode)
        if (this.isPaused) {
            // Check if players are nearby - if so, cancel pause and continue immediately
            const nearbyPlayersList = this.bot.getNearbyPlayers(100);
            if (nearbyPlayersList.length > 0 || this.nearbyPlayers.size > 0 || this.currentSpaceName) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PatrolBehavior] 👻 Players detected during pause - canceling pause, continuing immediately (ghost mode)`);
                }
                this.isPaused = false;
                this.advanceToNextWaypoint(config);
                return;
            }
            
            const pauseDuration = (Date.now() - this.pauseStartTime) / 1000;
            if (pauseDuration >= config.pauseAtWaypoints) {
                this.isPaused = false;
                this.advanceToNextWaypoint(config);
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PatrolBehavior] 🎯 Pause complete - advanced to next waypoint (index ${this.currentWaypointIndex})`);
                }
            }
            return;
        }

        if (this.targetWaypoint) {
            // Ghost mode: bot should continue moving even if players are nearby
            // Don't stop - keep moving to avoid triggering bubbles
            
            // Only start a new path if we're not already following one
            if (!this.bot.getIsFollowingPath()) {
                // Track when we start trying to reach this waypoint
                if (this.waypointAttemptStartTime === 0) {
                    this.waypointAttemptStartTime = Date.now();
                    this.lastWaypointPosition = this.bot.getState().getPosition();
                }
                
                // Log when attempting to start movement (rate-limited)
                const now = Date.now();
                if (!this.lastMoveAttemptLog || now - this.lastMoveAttemptLog > 2000) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[PatrolBehavior] Attempting to move to waypoint (${this.targetWaypoint.x}, ${this.targetWaypoint.y}), isMoving=${this.bot.getState().isMoving()}, isPaused=${this.isPaused}`);
                    }
                    this.lastMoveAttemptLog = now;
                }
                // Move towards waypoint (async, but we don't await - it will handle pathfinding internally)
                // This will start the bot moving if it's stopped
                this.moveTowardsWaypoint(config, deltaTime).catch(error => {
                    console.error(`[PatrolBehavior] Error moving to waypoint:`, error);
                });
            }
        }
    }

    onPlayerMoved(playerId: number, position: PositionInterface): void {
        // Track when player last moved (for idle detection)
        this.playerLastMoveTime.set(playerId, Date.now());
        super.onPlayerMoved(playerId, position);
    }

    /**
     * Override updateProximityEngagement to only stop for active players (not idle)
     * This allows ghost mode: continue moving if players are idle nearby
     */
    protected updateProximityEngagement(): void {
        if (!this.bot) return;
        
        const wasEngaged = this.isEngaged;
        // Check both proximity-based and space-based engagement
        this.isEngaged = this.nearbyPlayers.size > 0 || this.engagedWithUsers.size > 0;
        
        const config = this.config as PatrolBehaviorConfig;
        const shouldRespond = config.respondToPlayers !== false;
        
        if (this.isEngaged) {
            // Find closest player (check both nearbyPlayers and engagedWithUsers)
            let closestDistance = Infinity;
            let closestId: number | null = null;
            let closestPos: PositionInterface | null = null;
            const botPos = this.bot.getState().getPosition();
            
            // Check nearby players first (proximity-based)
            for (const [playerId, playerPos] of this.nearbyPlayers) {
                const dx = playerPos.x - botPos.x;
                const dy = playerPos.y - botPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < closestDistance) {
                    closestDistance = dist;
                    closestId = playerId;
                    closestPos = playerPos;
                }
            }
            
            // Also check engaged users (space-based) if no nearby player found
            if (!closestPos) {
                for (const [userId, userData] of this.engagedWithUsers) {
                    if (userData.position) {
                        const dx = userData.position.x - botPos.x;
                        const dy = userData.position.y - botPos.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        
                        if (dist < closestDistance) {
                            closestDistance = dist;
                            closestId = userId;
                            closestPos = userData.position;
                        }
                    }
                }
            }
            
            // Face the closest player
            if (closestPos) {
                // Check if player is actively moving (not idle)
                const now = Date.now();
                const isPlayerActive = closestId !== null && 
                    this.playerLastMoveTime.has(closestId) &&
                    (now - (this.playerLastMoveTime.get(closestId) || 0)) < this.IDLE_RESUME_DELAY;
                
                // Only stop if player is actively moving OR in a conversation space
                const shouldStop = shouldRespond && (isPlayerActive || this.currentSpaceName || this.engagedWithUsers.size > 0);
                
                if (closestId !== this.closestPlayerId) {
                    // Different player or first time
                    this.closestPlayerId = closestId;
                    
                    // For patrol bots with respondToPlayers, stop and face only if player is active
                    if (shouldStop) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    
                    this.facePosition(closestPos);
                    if (!wasEngaged) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Behavior] Engaged with player ${closestId} - ${shouldStop ? 'stopped and facing' : 'facing (player idle)'}`);
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Behavior] Facing player ${closestId}`);
                        }
                    }
                } else {
                    // Same player, but they might have moved - update facing
                    // For patrol bots, ensure we're still stopped only if player is active
                    if (shouldStop && this.bot.getState().isMoving()) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    this.facePosition(closestPos);
                }
            }
        } else {
            // No longer engaged
            this.closestPlayerId = null;
            
            if (wasEngaged) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Behavior] No longer engaged - all players left proximity/space`);
                }
            }
        }
    }

    // Like social bot: always accept spaces (use default from BaseBehavior = true)
    // This prevents server from repeatedly trying to create the space

    onSpaceJoined(spaceName: string): void {
        // When bot joins a space, it means a player is in proximity
        // GHOST MODE: Don't stop - continue moving to avoid triggering bubbles
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[PatrolBehavior] SPACE JOINED: ${spaceName}, nearbyPlayers=${this.nearbyPlayers.size} - CONTINUING (ghost mode)`);
            console.log(`[PatrolBehavior] Setting currentSpaceName to: ${spaceName}`);
        }
        
        this.currentSpaceName = spaceName;
        
        // Send greeting if:
        // 1. Player actively approached (nearbyPlayers.size > 0) - normal case
        // 2. Bot is summoned - when summoned, bot should greet even if player not in nearbyPlayers yet
        const shouldGreet = this.bot && (this.nearbyPlayers.size > 0 || this.isSummoned);
        
        if (shouldGreet) {
            // Find the player to greet (first nearby player)
            let playerId: number | null = null;
            const nearbyPlayers = this.bot?.getNearbyPlayers(100);
            if (nearbyPlayers && nearbyPlayers.length > 0) {
                playerId = nearbyPlayers[0].userId;
            }
            
            if (playerId && this.bot) {
                const botId = this.bot.getBotId();
                // Generate AI greeting instead of preset
                this.generateAIGreeting(spaceName, playerId, botId).catch(error => {
                    console.error(`[PatrolBehavior] Error generating AI greeting:`, error);
                    // Fallback: don't send anything if AI fails (no preset greeting)
                });
            }
        }
    }
    
    onSpaceUserJoined(spaceName: string, user: any): void {
        if (!this.currentSpaceName) return;
        super.onSpaceUserJoined(spaceName, user);
        
        // When a user joins the space, add them to nearbyPlayers if not already there
        // This ensures stationary players are detected
        if (user.userId && this.bot && !this.bot.isOtherBot(user.userId)) {
            const userPos = user.characterPosition || this.bot.getState().getPosition();
            if (!this.nearbyPlayers.has(user.userId)) {
                this.nearbyPlayers.set(user.userId, userPos);
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PatrolBehavior] Added player ${user.userId} to nearbyPlayers via space user join`);
                }
            }
        }
        
        if (this.bot && user.characterPosition) {
            this.facePosition({ x: user.characterPosition.x, y: user.characterPosition.y });
        }
    }

    onSpaceLeft(spaceName: string): void {
        if (!this.currentSpaceName) return;
        this.currentSpaceName = null;
        this.spaceLeftTime = Date.now();
    }

    private async moveTowardsWaypoint(config: PatrolBehaviorConfig, deltaTime?: number): Promise<void> {
        if (!this.bot || !this.targetWaypoint) return;
        
        // GHOST MODE: Continue moving even if in a space - don't stop, don't cancel pathfinding
        // The bot should keep moving to avoid triggering bubbles
        
        // Log pathfinding start (rate-limited to once per second)
        const now = Date.now();
        if (!this.lastPathfindingLog || now - this.lastPathfindingLog > 1000) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PatrolBehavior] Starting path to waypoint (${this.targetWaypoint.x}, ${this.targetWaypoint.y}), isMoving=${this.bot.getState().isMoving()}`);
            }
            this.lastPathfindingLog = now;
        }

        const botPos = this.bot.getState().getPosition();
        const dx = this.targetWaypoint.x - botPos.x;
        const dy = this.targetWaypoint.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 10) {
            // Close enough to waypoint - check if players are nearby
            const nearbyPlayersList = this.bot.getNearbyPlayers(100);
            if (nearbyPlayersList.length > 0 || this.nearbyPlayers.size > 0 || this.currentSpaceName) {
                // Players nearby or in space - don't pause, just advance to next waypoint (ghost mode)
                this.advanceToNextWaypoint(config);
                return;
            }
            
            // No players nearby - safe to pause (but don't call stop() - let pause logic handle it)
            this.isPaused = true;
            this.pauseStartTime = Date.now();
            return;
        }

        // Try pathfinding first if available and not already following a path
        // IMPORTANT: Only try pathfinding if we're not already following a path AND haven't just canceled one
        if (this.bot.hasPathfinding() && !this.bot.getIsFollowingPath()) {
            // Check if target is far enough to warrant pathfinding (avoid tiny paths)
            if (distance >= 50) {
                const success = await this.bot.moveToWithPathfinding(this.targetWaypoint.x, this.targetWaypoint.y);
                if (success) {
                    // Pathfinding will handle movement via updatePathFollowing
                    return;
                }
                // Pathfinding failed or was skipped (cooldown), fall through to direct movement
            }
            // Distance < 50 or pathfinding failed - fall through to direct movement
        } else if (this.bot.getIsFollowingPath()) {
            // Already following a path, let pathfinding handle movement
            // But we already checked for nearby players above, so it's safe to continue
            return;
        }

        // Fallback to direct movement - BUT only for very close targets (< 50px)
        // For anything further, we MUST use pathfinding to avoid walls
        // Direct movement can go through walls, so we only use it when pathfinding isn't available
        // or when target is very close and we've confirmed it's safe
        if (distance >= 50 && this.bot.hasPathfinding()) {
            // Target is far and pathfinding is available - don't use direct movement
            // Wait for pathfinding cooldown to expire or try again next frame
            return;
        }

        // Only use direct movement for close targets (< 50px) or when pathfinding unavailable
        const effectiveSpeed = config.speed > 75 ? config.speed * 0.5 : config.speed;
        const angle = Math.atan2(dy, dx);
        const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
        const newX = botPos.x + Math.cos(angle) * moveDistance;
        const newY = botPos.y + Math.sin(angle) * moveDistance;
        
        // Validate new position is walkable (prevent walking through walls)
        if (this.bot.hasPathfinding()) {
            const newPos = { x: newX, y: newY };
            if (!this.bot.isWalkable(newPos)) {
                // Target position is in a wall - don't move, wait for pathfinding
                console.warn(`[PatrolBehavior] Direct movement blocked: target (${newX.toFixed(1)}, ${newY.toFixed(1)}) is not walkable`);
                return;
            }
        }

        // Log direct movement
        movementLogger.log({
            timestamp: Date.now(),
            botId: (this.bot as any).config?.botId || 'unknown',
            eventType: 'move',
            position: { x: newX, y: newY },
            targetPosition: this.targetWaypoint,
            speed: config.speed,
            effectiveSpeed: effectiveSpeed,
            moveDistance: moveDistance,
            distanceToTarget: distance,
            metadata: { movementType: 'direct_fallback', pathfindingFailed: true },
        });

        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.bot.moveTo(newX, newY, direction);
    }

    private updateTargetWaypoint(): void {
        const config = this.config as PatrolBehaviorConfig;
        if (config.waypoints.length === 0) {
            this.targetWaypoint = null;
            return;
        }

        if (this.currentWaypointIndex < config.waypoints.length) {
            const waypoint = config.waypoints[this.currentWaypointIndex];
            this.targetWaypoint = { x: waypoint.x, y: waypoint.y };
        }
    }

    private advanceToNextWaypoint(config: PatrolBehaviorConfig): void {
        this.currentWaypointIndex++;

        if (this.currentWaypointIndex >= config.waypoints.length) {
            if (config.loop) {
                this.currentWaypointIndex = 0;
            } else {
                config.waypoints.reverse();
                this.currentWaypointIndex = 0;
            }
        }

        this.updateTargetWaypoint();
        // Reset tracking when advancing to new waypoint
        this.waypointAttemptStartTime = 0;
        this.lastWaypointPosition = null;
    }

    /**
     * Generate AI greeting for a player
     */
    private async generateAIGreeting(
        spaceName: string,
        playerId: number,
        botId: string
    ): Promise<void> {
        if (!this.bot || !this.aiService) {
            return;
        }

        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            // No AI provider configured - don't send greeting
            return;
        }

        // Get conversation context (includes memory, emotions, relationship history)
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate natural response using AI - not a greeting, just respond naturally
        let fullMessage = '';
        
        try {
            // Simple prompt: player approached, respond naturally
            // The AI will use the conversation context (memory, emotions, relationship) from chatInstructions
            const playerMessage = 'A player just approached you.';
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a friendly bot.',
                botConfig.aiProviderRef,
                spaceName,
                context
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send response
                    if (fullMessage.trim()) {
                        if (this.bot && this.currentSpaceName === spaceName) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            // Store bot's message in memory
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] AI greeting error:`, error);
            // Don't send fallback - just fail silently
        }
    }

    /**
     * Handle chat messages from players
     */
    onChatMessage(spaceName: string, message: string, senderId: number): void {
        if (!this.bot) return;

        const botId = this.bot.getBotId();
        const config = this.config as PatrolBehaviorConfig;

        // Only respond if respondToPlayers is enabled (default true)
        if (config.respondToPlayers === false) {
            return;
        }

        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[PatrolBehavior] Error generating AI response:`, error);
            // Send fallback message
            this.bot?.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        });
    }

    /**
     * Generate AI response stream and send to player
     */
    private async generateAIResponseStream(
        spaceName: string,
        playerId: number,
        playerMessage: string,
        botId: string
    ): Promise<void> {
        if (!this.bot || !this.aiService) {
            console.warn(`[PatrolBehavior] Missing required services for AI response`);
            return;
        }

        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[PatrolBehavior] Bot ${botId} has no AI provider configured (aiProviderRef missing)`);
            }
            return;
        }

        // Get conversation context (includes memory, emotions, relationship history)
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate streaming response
        let fullMessage = '';
        
        try {
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a helpful patrol bot.',
                botConfig.aiProviderRef,
                spaceName,
                context
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send complete message
                    if (fullMessage.trim()) {
                        this.bot.sendChatMessage(spaceName, fullMessage);
                        // Store bot's message in memory
                        this.conversationMemory.addMessage(botId, playerId, fullMessage, 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] AI error:`, error);
            this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        }
    }
}
