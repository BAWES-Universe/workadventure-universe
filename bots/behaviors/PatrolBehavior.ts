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
import { BotClient } from '../client/BotClient';
import { parseEmotionsFromResponse } from '../ai/EmotionParser';

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
    private conversationMemory: ConversationMemory | null = null; // Will be set by setConversationMemory
    private readonly RESUME_DELAY = 500;
    private lastPathfindingLog: number = 0; // Rate limit pathfinding logs
    private lastMoveAttemptLog: number = 0; // Rate limit move attempt logs
    private waypointAttemptStartTime: number = 0; // Track when we started trying to reach current waypoint
    private lastWaypointPosition: PositionInterface | null = null; // Track last position to detect if stuck
    private playerLastMoveTime: Map<number, number> = new Map(); // Track when each player last moved
    private readonly IDLE_RESUME_DELAY = 2000; // Resume if player idle for 2 seconds
    private readonly INTERACTION_COOLDOWN = 5000; // Prevent patrol resumption for 5s after space interaction ends
    private lastInteractionTime: number = 0; // Timestamp of last space interaction (start via join, reset via leave)

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        // ConversationMemory will be set by BotManager via setConversationMemory
        this.updateTargetWaypoint();
    }
    
    /**
     * Set conversation memory (called by BotManager to share the persistent memory instance)
     */
    setConversationMemory(memory: ConversationMemory): void {
        this.conversationMemory = memory;
    }
    
    /**
     * Set user UUID in conversation memory (called from BaseBehavior when user joins space)
     */
    protected setUserUuidInMemory(botId: string, userId: number, userUuid: string, isLogged: boolean): void {
        if (this.conversationMemory && 'setUserUuid' in this.conversationMemory) {
            (this.conversationMemory as any).setUserUuid(botId, userId, userUuid, isLogged);
        }
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // If bot is summoned or leading, allow movement (don't stop for normal behavior logic)
        // The bot will stop when it reaches the target position
        if (this.isSummoned || this.isLeading) {
            // When leading, get the target from leadingTarget
            let targetPos: { x: number; y: number } | null = null;
            if (this.isLeading && this.leadingTarget) {
                targetPos = this.leadingTarget.position;
            } else if (this.isSummoned && this.summonedPlayerUuid) {
                targetPos = this.getSummonedPlayerPosition();
            }
            
            // Check if we've reached the target position
            if (targetPos) {
                const botPos = this.bot.getState().getPosition();
                const dx = targetPos.x - botPos.x;
                const dy = targetPos.y - botPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If we're close to the target (< 50px), stop and wait for bubble to initiate
                if (distance < 50) {
            if (this.bot.getIsFollowingPath()) {
                        this.bot.cancelPathfinding();
                    }
                    this.bot.stop();
                    
                    // If leading to a person, send goodbye message to follower, then return
                    if (this.isLeading && this.leadingTarget?.type === 'person') {
                        // Leading to a person - send goodbye message to follower, then return
                        const targetPersonName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (followers.length > 0) {
                            // Send goodbye message FIRST (before ending leading)
                            // This ensures the person is still following and in the space
                            this.sendPersonArrivalMessage(targetPersonName, followers).then(() => {
                                // After message sent, end leading and return
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[PatrolBehavior] Error sending person arrival message:`, error);
                                // Still end leading and return even if message failed
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            // No followers found, just end leading and return
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else if (this.isLeading && this.leadingTarget?.type === 'area') {
                        // Leading to an area - send arrival message to follower
                        const areaName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (followers.length > 0) {
                            // Send arrival and goodbye message FIRST (before ending leading)
                            // This ensures the person is still following and in the space
                            this.sendAreaArrivalMessage(areaName, followers).then(() => {
                                // After message sent, end leading and return
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[PatrolBehavior] Error sending area arrival message:`, error);
                                // Still end leading and return even if message failed
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            // No followers found, just end leading and return
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else {
                        // Not leading, just end leading normally
                        this.endLeading();
                    }
                    
                    this.facePosition(targetPos);
                this.onBotPositionUpdated();
                return;
                }
            }
            
            // During summon/leading, only stop if we've reached the target and are in a conversation space
            // BUT: When leading, don't stop just because we're in a space - continue to target
            if (this.bot.getIsFollowingPath()) {
                // Bot is moving to target - allow it
                this.onBotPositionUpdated();
                return;
            } else if ((this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading) {
                // Bot reached player and is in conversation - stop and face (only when summoned, not leading)
                this.bot.stop();
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return;
            } else if (this.isLeading) {
                // When leading, if path ended but we're not at target, continue (pathfinding will handle it)
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
        
        // If bot is returning to original position after leading/summon, allow movement
        if (this.isReturning) {
            // During return, allow pathfinding to continue
            if (this.bot.getIsFollowingPath()) {
                // Bot is returning - allow it to continue
                this.onBotPositionUpdated();
                return;
            }
            // If not following path, might have reached start position
            // Continue with normal behavior to resume patrolling
        }
        
        // Check for nearby players and stop when detected (patrol bots should always respond)
        // Use respondToPlayers flag if set, otherwise default to true for patrol bots
        const shouldRespond = config.respondToPlayers !== false; // Default to true if not explicitly false
        
        // GHOST MODE: Only stop if actually in a conversation space (like social bot)
        // Check both currentSpaceName (immediate) and engagedWithUsers (after users join)
        // CRITICAL: Check this BEFORE path following to prevent movement in bubbles
        // BUT: When leading, don't stop just because we're in a space - continue to target
        if (shouldRespond && (this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading) {
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
            const timeSinceInteraction = now - this.lastInteractionTime;
            
            // Cooldown guard: don't ghost through during cooldown period after space interaction
            if (timeSinceInteraction < this.INTERACTION_COOLDOWN) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[PatrolBehavior] 🛑 Cooldown active (${Math.round((this.INTERACTION_COOLDOWN - timeSinceInteraction) / 1000)}s remaining) - not ghosting through`);
                }
                return;
            }
            
            // Check if any nearby players moved recently (active)
            let allPlayersIdle = true;
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
            // BUT: When leading, don't stop just because players are nearby - continue to target
            if (hasNearbyPlayers && (hasActivePlayers || (now - this.lastInteractionTime) < this.INTERACTION_COOLDOWN) && !this.isLeading) {
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
        // CRITICAL: Don't call updatePathFollowing if we're in a conversation space
        if (this.bot.getIsFollowingPath()) {
            // CRITICAL FIX: Check if we're in a space BEFORE calling updatePathFollowing
            // This prevents the bot from continuing to move after stopping in a conversation
            if (shouldRespond && (this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading) {
                // We're in a conversation space - stop and cancel pathfinding
                this.bot.cancelPathfinding();
                this.bot.stop();
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return;
            }
            
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

        // Cooldown guard: don't restart pathfinding during cooldown period after space interaction ends
        if ((Date.now() - this.lastInteractionTime) < this.INTERACTION_COOLDOWN) {
            // Still within cooldown - don't resume patrolling
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[PatrolBehavior] 🛑 Cooldown active - not restarting pathfinding`);
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
                // When leading, don't face the follower - face the direction of movement instead
                // The pathfinding system will handle facing the direction of movement
                if (this.isLeading) {
                    // Skip facing the player when leading - let pathfinding handle direction
                    return;
                }
                
                // Check if player is actively moving (not idle)
                const now = Date.now();
                const isPlayerActive = closestId !== null && 
                    this.playerLastMoveTime.has(closestId) &&
                    (now - (this.playerLastMoveTime.get(closestId) || 0)) < this.IDLE_RESUME_DELAY;
                
                // Only stop if player is actively moving OR in a conversation space
                // BUT: Don't stop if bot is leading - it needs to continue to destination
                const shouldStop = shouldRespond && (isPlayerActive || this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading;
                
                if (closestId !== this.closestPlayerId) {
                    // Different player or first time
                    this.closestPlayerId = closestId;
                    
                    // For patrol bots with respondToPlayers, stop and face only if player is active
                    // BUT: Don't stop if bot is leading - it needs to continue to destination
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
                    // BUT: Don't stop if bot is leading - it needs to continue to destination
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
        // CRITICAL: Stop immediately and cancel pathfinding to prevent continued movement
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[PatrolBehavior] SPACE JOINED: ${spaceName}, nearbyPlayers=${this.nearbyPlayers.size}`);
            console.log(`[PatrolBehavior] Setting currentSpaceName to: ${spaceName}`);
        }
        
        this.currentSpaceName = spaceName;
        this.lastInteractionTime = Date.now(); // Record interaction start timestamp
        
        // CRITICAL: Stop immediately when joining a conversation space
        // This prevents the bot from continuing to move during the frame where onSpaceJoined is called
        // BUT: Don't stop if bot is leading - it needs to continue to destination
        const config = this.config as PatrolBehaviorConfig;
        const shouldRespond = config.respondToPlayers !== false;
        
        if (shouldRespond && !this.isLeading) {
            if (this.bot?.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot?.stop();
        }
        
        // Check if we just completed leading someone to this person
        if (this.justCompletedLeading && this.justCompletedLeading.targetPersonId) {
            const targetPersonId = this.justCompletedLeading.targetPersonId;
            const followerUuid = this.justCompletedLeading.followerUuid;
            
            // Find the player in the space who matches the target
            const nearbyPlayers = this.bot?.getNearbyPlayers(100);
            const targetPlayer = nearbyPlayers?.find(p => p.userId === targetPersonId);
            
            if (targetPlayer && this.bot) {
                // Clear the flag
                this.justCompletedLeading = null;
                
                const botId = this.bot.getBotId();
                // Generate special greeting explaining we brought someone
                this.generateAIGreetingWithLeadingContext(spaceName, targetPersonId, botId, followerUuid).catch(error => {
                    console.error(`[PatrolBehavior] Error generating leading completion greeting:`, error);
                });
                return; // Don't continue with normal greeting
            }
        }
        
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
        
        // Inline leading cleanup from BaseBehavior.onSpaceLeft() instead of calling super.
        // super.onSpaceLeft() calls returnAfterLeading() → returnToAssignedSpace() →
        // moveToWithPathfinding() which is ASYNC (awaits findPath). By the time the
        // pathfinding promise resolves, our synchronous getIsFollowingPath() check below
        // would have already run and returned false, so cancelPathfinding() never fires.
        // The bot then moves back to its assigned space, bypassing the cooldown.
        if (!this.isLeading) {
            this.justCompletedLeading = null;
        }
        // Do NOT call returnAfterLeading() here — the patrol bot should respect the
        // cooldown before returning to its assigned space.
        
        // Only clear currentSpaceName when the departing space matches the active space
        // This prevents dropping guards for other simultaneous spaces
        if (this.currentSpaceName === spaceName) {
            this.currentSpaceName = null;
            this.spaceLeftTime = Date.now();
        }
        
        // Summon cleanup (inlined from BaseBehavior.onSpaceLeft without calling super)
        // If player leaves the conversation space but stays nearby, end the summon
        // so the bot can resume patrol instead of staying stuck in summoned state
        if (this.isSummoned && this.summonedPlayerUuid) {
            const playerStillNearby = this.checkSummonedPlayerStillNearby();
            if (!playerStillNearby) {
                this.endSummon();
            }
        }
        
        // Clear engagedWithUsers entries for the departing space only.
        // This lets the ghost mode entry condition (engagedWithUsers.size === 0)
        // evaluate to true during the cooldown, so the cooldown guard at line 228
        // can actually fire. Without this, if onSpaceUserLeft never arrives,
        // line 206 catches engagedWithUsers.size > 0 every frame and the bot
        // is permanently stuck — even after the cooldown expires.
        for (const [userId, userData] of this.engagedWithUsers) {
            if (userData.spaceName === spaceName) {
                this.engagedWithUsers.delete(userId);
            }
        }
        // CRITICAL: Keep nearbyPlayers intact so the stop/cooldown logic
        // can still detect the player is nearby
        this.lastInteractionTime = Date.now();
    }

    private async moveTowardsWaypoint(config: PatrolBehaviorConfig, deltaTime?: number): Promise<void> {
        if (!this.bot || !this.targetWaypoint) return;
        
        // Cooldown guard: don't restart pathfinding during cooldown or if in a space
        if (this.currentSpaceName || (Date.now() - this.lastInteractionTime) < this.INTERACTION_COOLDOWN) {
            return;
        }
        
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
     * Send area arrival message to follower(s)
     */
    /**
     * Send area arrival message to follower(s)
     * Sends one message to the space - all followers in that space will receive it
     */
    private async sendAreaArrivalMessage(areaName: string, followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>): Promise<void> {
        if (!this.bot || !this.aiService || followers.length === 0) {
            return;
        }

        // Get the current space - prefer conversation spaces over world spaces
        // Use leadingSpaceName as fallback (set when user joined during leading)
        const currentSpaces = this.bot.getCurrentSpaces();
        // Filter out world spaces (like "allWorldUser") and prefer conversation spaces
        const conversationSpaces = currentSpaces.filter(space => !space.includes('allWorldUser') && space.includes('#'));
        const spaceName = conversationSpaces.length > 0 
            ? conversationSpaces[0] 
            : (currentSpaces.length > 0 ? currentSpaces[0] : this.leadingSpaceName);
        if (!spaceName) {
            console.warn(`[PatrolBehavior] Bot not in any space when trying to send area arrival message`);
            return;
        }

        // Get bot configuration
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            return;
        }

        const botId = this.bot.getBotId();
        
        // Find the first follower who is still nearby
        const nearbyPlayers = this.bot.getNearbyPlayers(100);
        const followerPlayer = nearbyPlayers.find(p => followers.some(f => f.userId === p.userId));
        
        if (!followerPlayer) {
            // No followers nearby, skip
            return;
        }
        
        // Set flag to prevent returnToAssignedSpace from being called while sending message
        this.isSendingGoodbye = true;
        
        try {
            // Get conversation context (use first follower for context, but message goes to all)
            const context = this.conversationMemory?.getConversationContext(botId, followerPlayer.userId) || '';
            
            // Generate arrival and goodbye message using AI
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to the ${areaName} area. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            let fullMessage = '';
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerPlayer.userId,
                arrivalPrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, followerPlayer.userId, parsedResponse.emotions);
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            followerPlayer.userId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        // Send message to space - all followers in the space will receive it
                        this.bot.sendChatMessage(spaceName, cleanedMessage.trim());
                        // Store in memory for the first follower (representative of the group)
                        this.conversationMemory?.addMessage(botId, followerPlayer.userId, cleanedMessage.trim(), 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] Error generating area arrival message:`, error);
        } finally {
            // Clear flag and leave the space after message is sent
            this.isSendingGoodbye = false;
            await this.bot.leaveAllSpaces();
        }
    }

    /**
     * Send person arrival message to follower(s)
     * Similar to sendAreaArrivalMessage but for when leading to a person
     */
    private async sendPersonArrivalMessage(personName: string, followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>): Promise<void> {
        if (!this.bot || !this.aiService || followers.length === 0) {
            return;
        }

        // Get the current space - prefer conversation spaces over world spaces
        // Use leadingSpaceName as fallback (set when user joined during leading)
        const currentSpaces = this.bot.getCurrentSpaces();
        // Filter out world spaces (like "allWorldUser") and prefer conversation spaces
        const conversationSpaces = currentSpaces.filter(space => !space.includes('allWorldUser') && space.includes('#'));
        const spaceName = conversationSpaces.length > 0 
            ? conversationSpaces[0] 
            : (currentSpaces.length > 0 ? currentSpaces[0] : this.leadingSpaceName);
        if (!spaceName) {
            console.warn(`[PatrolBehavior] Bot not in any space when trying to send person arrival message`);
            return;
        }

        // Get bot configuration
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            return;
        }

        const botId = this.bot.getBotId();
        
        // Find the first follower who is still nearby
        const nearbyPlayers = this.bot.getNearbyPlayers(100);
        const followerPlayer = nearbyPlayers.find(p => followers.some(f => f.userId === p.userId));
        
        if (!followerPlayer) {
            // No followers nearby, skip
            return;
        }
        
        // Set flag to prevent returnToAssignedSpace from being called while sending message
        this.isSendingGoodbye = true;
        
        try {
            // Get conversation context (use first follower for context, but message goes to all)
            const context = this.conversationMemory?.getConversationContext(botId, followerPlayer.userId) || '';
            
            // Generate arrival and goodbye message using AI
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to ${personName}. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            let fullMessage = '';
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerPlayer.userId,
                arrivalPrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, followerPlayer.userId, parsedResponse.emotions);
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            followerPlayer.userId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        // Send message to space - all followers in the space will receive it
                        this.bot.sendChatMessage(spaceName, cleanedMessage.trim());
                        // Store in memory for the first follower (representative of the group)
                        this.conversationMemory?.addMessage(botId, followerPlayer.userId, cleanedMessage.trim(), 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] Error generating person arrival message:`, error);
        } finally {
            // Clear flag and leave the space after message is sent
            this.isSendingGoodbye = false;
            await this.bot.leaveAllSpaces();
        }
    }

    /**
     * Generate AI greeting with special context for leading completion
     */
    private async generateAIGreetingWithLeadingContext(
        spaceName: string,
        playerId: number,
        botId: string,
        followerUuid: string | null
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

        // Get conversation context
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';

        let fullMessage = '';
        
        try {
            // Special prompt for leading completion
            const leadingContext = followerUuid === 'group' 
                ? 'You just guided a group of people to this person. They asked about them. Let them know you\'ve brought the people who wanted to talk with them.'
                : 'You just guided someone to this person. They asked about them. Let them know you\'ve brought the person who wanted to talk with them.';
            
            const playerMessage = leadingContext;
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a friendly bot. Respond naturally when someone approaches you.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot. Respond naturally when someone approaches you.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    // Send response
                    if (cleanedMessage.trim()) {
                        if (this.bot && this.currentSpaceName === spaceName) {
                            this.bot.sendChatMessage(spaceName, cleanedMessage.trim());
                            // Store bot's message in memory
                            this.conversationMemory?.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
                        }
                    }
                    // After greeting, send goodbye message and return
                    this.sendGoodbyeAndReturn(spaceName, playerId, botId, 'person').catch(error => {
                        console.error(`[PatrolBehavior] Error sending goodbye and returning:`, error);
                    });
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] AI leading completion greeting error:`, error);
            // Don't send fallback - just fail silently
        }
    }

    /**
     * Generate AI greeting for a person
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
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';

        // Generate natural response using AI - not a greeting, just respond naturally
        let fullMessage = '';
        
        try {
            // Natural prompt: person approached, respond naturally based on context
            // The AI has access to memory (if they've met before), map context, and can assess the situation
            // It should respond naturally, not ask meta questions
            const playerMessage = 'Greet this person who just approached you.';
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a friendly bot. Respond naturally when someone approaches you.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a friendly bot. Respond naturally when someone approaches you.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    // Send response
                    if (cleanedMessage.trim()) {
                        if (this.bot && this.currentSpaceName === spaceName) {
                            this.bot.sendChatMessage(spaceName, cleanedMessage.trim());
                            // Store bot's message in memory
                            this.conversationMemory?.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
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

        // Start conversation in memory if needed
        this.conversationMemory?.startConversation(botId, senderId);
        
        // Get user info from bot's player map
        const playerInfo = this.bot.getPlayerInfo(senderId);
        const userName = playerInfo?.name;
        
        // Get UUID (REQUIRED by Admin API) - should be available from InitSpaceUsersMessage or addSpaceUserMessage
        const userUuid = this.userIdToUuid.get(senderId);
        if (!userUuid) {
            console.warn(`[PatrolBehavior] UUID not found for user ${senderId} (${userName}). This should not happen if InitSpaceUsersMessage is working correctly.`);
            // Don't proceed without UUID - conversation cannot be stored correctly
            return;
        }
        
        // Get authentication status (for isGuest determination)
        const isLogged = this.userIdToIsLogged.get(senderId) ?? false;
        
        // Start conversation in storage (if available) - userUuid is REQUIRED
        if (this.conversationStorage) {
            this.conversationStorage.startConversation(botId, userUuid, {
                name: userName,
                uuid: userUuid,
                isLogged: isLogged,
            });
        }
        
        // Store player's message in memory
        this.conversationMemory?.addMessage(botId, senderId, message, 'person', spaceName);
        
        // Store player's message in conversation storage
        if (this.conversationStorage) {
            this.conversationStorage.addMessage(botId, userUuid, message, 'person').catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[PatrolBehavior] Error adding person message to conversation storage:', error);
                }
            });
        }
        
        // Extract personal information from message
        this.conversationMemory?.extractPersonalInfo(botId, senderId, message);

        // Start typing indicator
        this.bot?.startTyping(spaceName);

        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[PatrolBehavior] Error generating AI response:`, error);
            // Stop typing indicator on error
            this.bot?.stopTyping(spaceName);
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
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';

        // Generate streaming response
        let fullMessage = '';
        const startTime = Date.now(); // Track response time BEFORE streaming starts
        let tokensUsed = 0;
        let latency = 0;
        
        try {
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a helpful patrol bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                // Extract token usage and latency from chunk metadata
                if (chunk.tokensUsed) {
                    tokensUsed = chunk.tokensUsed;
                }
                if (chunk.metadata?.tokensUsed) {
                    tokensUsed = chunk.metadata.tokensUsed;
                }
                if (chunk.metadata?.latency) {
                    latency = chunk.metadata.latency;
                }
                
                if (chunk.done) {
                    // Stop typing indicator
                    this.bot.stopTyping(spaceName);
                    
                    // Calculate response time (use latency from metadata if available, otherwise calculate)
                    const responseTime = latency || (Date.now() - startTime);
                    
                    // Parse emotions from AI response (unified emotion system)
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let processedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    }
                    
                    if (this.responseProcessor && processedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful patrol bot.';
                        // Pass responseTime and tokenUsage to ResponseProcessor so it can include them in ONE metric record
                        const tokenUsage = tokensUsed > 0 ? {
                            prompt: chunk.metadata?.promptTokens || Math.floor(tokensUsed * 0.7),
                            completion: chunk.metadata?.completionTokens || Math.floor(tokensUsed * 0.3),
                            total: tokensUsed
                        } : undefined;
                        
                        // Note: Emotions already parsed above, use processedMessage (cleaned response)
                        let processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            processedMessage,
                            chatInstructions,
                            responseTime,
                            tokenUsage
                        );
                        processedMessage = processed.cleaned;
                        
                        // If high repetition detected (score >= 0.85), block and regenerate (up to 3 attempts)
                        // Lower threshold catches near-duplicates like "*snorts* response" vs "*grunts* response"
                        let regenerationAttempts = 0;
                        const maxRegenerationAttempts = 3;
                        const repetitionThreshold = 0.85; // Block at 85% similarity, not just exact duplicates
                        let currentRepetitionScore = processed.metrics.repetitionScore;
                        let currentMessage = fullMessage;
                        
                        while (currentRepetitionScore >= repetitionThreshold && regenerationAttempts < maxRegenerationAttempts) {
                            regenerationAttempts++;
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[PatrolBehavior] ⚠️ High repetition (${(currentRepetitionScore * 100).toFixed(0)}%) detected for bot ${botId}, player ${playerId} (attempt ${regenerationAttempts}/${maxRegenerationAttempts}). Blocking response: "${currentMessage.substring(0, 50)}..."`);
                            }
                            
                            // BLOCK the duplicate - don't send it
                            // Instead, generate a new response with explicit anti-repetition instruction
                            const urgency = regenerationAttempts > 1 ? `ATTEMPT ${regenerationAttempts} - ` : '';
                            const antiRepetitionPrompt = `${chatInstructions}\n\n${urgency}CRITICAL: You just said "${currentMessage.substring(0, 100)}". DO NOT repeat this. Give a COMPLETELY DIFFERENT response. Use different words and structure.`;
                            
                            // Regenerate with anti-repetition prompt
                            let regeneratedMessage = '';
                            try {
                                for await (const chunk of this.aiService.generateBotResponseStream(
                                    botId,
                                    playerId,
                                    playerMessage + ` [IMPORTANT: Give a COMPLETELY DIFFERENT response - attempt ${regenerationAttempts}]`,
                                    antiRepetitionPrompt,
                                    botConfig.aiProviderRef,
                                    spaceName,
                                    context,
                                    this.bot,
                                    this.adminApiService
                                )) {
                                    if (chunk.content) {
                                        regeneratedMessage += chunk.content;
                                    }
                                    if (chunk.done) break;
                                }
                                
                                // Parse emotions from regenerated response
                                const regeneratedParsed = parseEmotionsFromResponse(regeneratedMessage);
                                
                                // Update emotions from regenerated response
                                if (regeneratedParsed.emotions && this.conversationMemory) {
                                    this.conversationMemory.updateEmotionsFromAI(botId, playerId, regeneratedParsed.emotions);
                                }
                                
                                // Process the regenerated response
                                if (regeneratedParsed.cleanedResponse.trim() && this.responseProcessor) {
                                    // Use the same responseTime and tokenUsage from the original response
                                    const reprocessed = this.responseProcessor.processResponse(
                                        botId,
                                        playerId,
                                        regeneratedParsed.cleanedResponse,
                                        chatInstructions,
                                        responseTime, // Use original response time
                                        tokenUsage    // Use original token usage
                                    );
                                    processedMessage = reprocessed.cleaned;
                                    currentRepetitionScore = reprocessed.metrics.repetitionScore;
                                    currentMessage = regeneratedParsed.cleanedResponse;
                                    processed = reprocessed; // Update processed for next iteration check
                                    
                                    if (currentRepetitionScore < 1.0) {
                                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                            console.log(`[PatrolBehavior] ✅ Regenerated response after blocking duplicate (attempt ${regenerationAttempts})`);
                                        }
                                    }
                                } else {
                                    // Fallback if regeneration fails - don't break, try again
                                    continue;
                                }
                            } catch (error) {
                                console.error(`[PatrolBehavior] Error regenerating response after duplicate:`, error);
                                // Don't break, try again if attempts remaining
                                continue;
                            }
                        }
                        
                        // If still too similar after max attempts, use a varied fallback
                        if (currentRepetitionScore >= repetitionThreshold && regenerationAttempts >= maxRegenerationAttempts) {
                            console.warn(`[PatrolBehavior] ⚠️ Still duplicate after ${maxRegenerationAttempts} attempts, using fallback and clearing context`);
                            // Use varied fallbacks to avoid repetition loop
                            const fallbacks = [
                                "Hmm, let me approach this differently.",
                                "Interesting point. Let me think...",
                                "That's something to consider.",
                                "I hear you.",
                                "Alright then.",
                                "Fair enough.",
                                "I see what you mean.",
                                "Got it.",
                            ];
                            processedMessage = fallbacks[Math.floor(Math.random() * fallbacks.length)];
                            // Clear recent responses to break the repetition cycle
                            if (this.responseProcessor) {
                                this.responseProcessor.clearRecentResponses(botId, playerId);
                            }
                        }
                        
                        if (processed.metrics.repetitionScore > 0.8 && processed.metrics.repetitionScore < 1.0) {
                            // High repetition (but not exact duplicate) - warn but allow
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[PatrolBehavior] ⚠️ High repetition detected (${(processed.metrics.repetitionScore * 100).toFixed(1)}%) for bot ${botId}, player ${playerId}`);
                            }
                        }
                    }
                    
                    // Metrics are now recorded in ResponseProcessor (combined into one record)
                    // No need to record separately here - prevents duplicate metrics
                    
                    // Send processed message
                    if (processedMessage.trim()) {
                        this.bot.sendChatMessage(spaceName, processedMessage);
                        // Store bot's message in memory
                        if (this.conversationMemory) {
                            this.conversationMemory.addMessage(botId, playerId, processedMessage, 'bot', spaceName);
                        }
                        // Store in conversation storage
                        if (this.conversationStorage) {
                            const userUuid = this.userIdToUuid.get(playerId);
                            if (userUuid) {
                                this.conversationStorage.addMessage(botId, userUuid, processedMessage, 'bot').catch(error => {
                                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.error('[PatrolBehavior] Error adding bot message to conversation storage:', error);
                                    }
                                });
                            }
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] AI error:`, error);
            // Stop typing indicator on error
            this.bot.stopTyping(spaceName);
            this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        }
    }

    /**
     * Send goodbye message and return to start position
     */
    private async sendGoodbyeAndReturn(spaceName: string, playerId: number, botId: string, destinationType: 'person' | 'area'): Promise<void> {
        if (!this.bot || !this.aiService) {
            this.returnAfterLeading();
            return;
        }

        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            this.returnAfterLeading();
            return;
        }

        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';
        const destinationText = destinationType === 'person' ? 'this person' : 'the destination';
        
        let fullMessage = '';
        try {
            const goodbyePrompt = `You've arrived at ${destinationText}. It was nice talking to them. Say goodbye and that you'll see them soon.`;
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                goodbyePrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        if (this.bot) {
                            this.bot.sendChatMessage(spaceName, cleanedMessage.trim());
                            this.conversationMemory?.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[PatrolBehavior] Error generating goodbye message:`, error);
        }
        
        // Return to start position after sending message
        this.returnAfterLeading();
    }
}
