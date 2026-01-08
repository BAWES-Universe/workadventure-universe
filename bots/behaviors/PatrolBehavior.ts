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

export interface PatrolBehaviorConfig extends BehaviorConfig {
    type: 'patrol';
    waypoints: Array<{ x: number; y: number }>;
    loop: boolean;
    pauseAtWaypoints: number;
    speed: number;
    respondToPlayers: boolean;
    responseRadius?: number;
}

export class PatrolBehavior extends BaseBehavior {
    private currentWaypointIndex: number = 0;
    private isPaused: boolean = false;
    private pauseStartTime: number = 0;
    private targetWaypoint: PositionInterface | null = null;
    private currentSpaceName: string | null = null;
    private spaceLeftTime: number = 0;
    private readonly RESUME_DELAY = 500;
    private lastPathfindingLog: number = 0; // Rate limit pathfinding logs
    private lastMoveAttemptLog: number = 0; // Rate limit move attempt logs
    private waypointAttemptStartTime: number = 0; // Track when we started trying to reach current waypoint
    private lastWaypointPosition: PositionInterface | null = null; // Track last position to detect if stuck

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // DEBUG: Log currentSpaceName every frame to see if it's set
        if (Math.random() < 0.05) { // 5% chance to avoid spam
            console.log(`[PatrolBehavior] 🔍 update() - currentSpaceName=${this.currentSpaceName || 'null'}, nearbyPlayers=${this.nearbyPlayers.size}, isFollowingPath=${this.bot.getIsFollowingPath()}, isMoving=${this.bot.getState().isMoving()}`);
        }
        
        // CRITICAL: If we're in a space with a player, STOP immediately
        // This is the PRIMARY detection method - spaces are created when players are in proximity
        if (this.currentSpaceName) {
            console.log(`[PatrolBehavior] 🛑🛑🛑 In space ${this.currentSpaceName} - STOPPING (isFollowingPath=${this.bot.getIsFollowingPath()}, isMoving=${this.bot.getState().isMoving()})`);
            if (this.bot.getIsFollowingPath()) {
                console.log(`[PatrolBehavior] 🛑 Canceling pathfinding in update() due to space`);
                this.bot.cancelPathfinding();
            }
            const beforeStop = this.bot.getState().isMoving();
            this.bot.stop();
            const afterStop = this.bot.getState().isMoving();
            console.log(`[PatrolBehavior] 🛑 stop() in update() - before=${beforeStop}, after=${afterStop}`);
            this.onBotPositionUpdated();
            return; // Don't continue to movement logic
        }
        
        // CRITICAL: Check for nearby players FIRST - stop immediately if any found
        // The nearbyPlayers map is populated by onPlayerMoved() when players move within PROXIMITY_RADIUS (64px)
        // This is the PRIMARY source of truth - it's updated in real-time as players move
        // getNearbyPlayers() is secondary and may be empty if server hasn't sent player updates
        
        // Update nearbyPlayers map from getNearbyPlayers() if available (for players we know about)
        const nearbyPlayersList = this.bot.getNearbyPlayers(config.responseRadius || 100);
        for (const player of nearbyPlayersList) {
            // Add/update players from getNearbyPlayers
            this.nearbyPlayers.set(player.userId, player.position);
        }
        
        // CRITICAL: Never remove players from nearbyPlayers map in update()
        // The map is managed by onPlayerMoved() which has proper enter/leave radius logic
        // Removing players here causes race conditions where players are detected but then immediately removed
        // Only onPlayerMoved() should remove players when they leave the DISENGAGE_RADIUS
        
        // CRITICAL: Check behavior's nearbyPlayers BEFORE path following
        // This ensures we stop immediately when players approach, even during path following
        const hasNearbyPlayers = this.nearbyPlayers.size > 0 || nearbyPlayersList.length > 0;
        
        // DEBUG: Log player detection state
        if (Math.random() < 0.05) { // 5% chance to avoid spam
            console.log(`[PatrolBehavior] 🔍 update() - nearbyPlayersMap=${this.nearbyPlayers.size}, getNearbyPlayers()=${nearbyPlayersList.length}, isEngaged=${(this as any).isEngaged}`);
            if (nearbyPlayersList.length > 0) {
                for (const player of nearbyPlayersList) {
                    const botPos = this.bot.getState().getPosition();
                    const dx = player.position.x - botPos.x;
                    const dy = player.position.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    console.log(`[PatrolBehavior]   Player ${player.userId} at distance ${Math.round(distance)}px`);
                }
            }
        }
        
        // STOP immediately if players are nearby
        // PRIMARY: Check nearbyPlayers map (populated by onPlayerMoved in real-time)
        // SECONDARY: Check getNearbyPlayers result (may be empty if server hasn't sent updates)
        const timeSinceSpaceLeft = Date.now() - this.spaceLeftTime;
        const recentlyLeftSpace = this.spaceLeftTime > 0 && timeSinceSpaceLeft < this.RESUME_DELAY;
        
        // DEBUG: Log the state when players detected
        if (hasNearbyPlayers || recentlyLeftSpace) {
            console.log(`[PatrolBehavior] 🛑 STOPPING - nearbyPlayersMap=${this.nearbyPlayers.size}, nearbyPlayersList=${nearbyPlayersList.length}, recentlyLeftSpace=${recentlyLeftSpace}, isEngaged=${(this as any).isEngaged}`);
        }
        
        if (hasNearbyPlayers || recentlyLeftSpace) {
            console.log(`[PatrolBehavior] 🛑 STOPPING - calling stop() and cancelPathfinding()`);
            // Cancel pathfinding if active
            if (this.bot.getIsFollowingPath()) {
                console.log(`[PatrolBehavior] Canceling pathfinding due to nearby players`);
                this.bot.cancelPathfinding();
            }
            const beforeStop = this.bot.getState().isMoving();
            this.bot.stop();
            const afterStop = this.bot.getState().isMoving();
            console.log(`[PatrolBehavior] 🛑 stop() called - before=${beforeStop}, after=${afterStop}, isFollowingPath=${this.bot.getIsFollowingPath()}`);
            // Face closest player
            if (this.nearbyPlayers.size > 0) {
                const nearbyPlayers = this.bot.getNearbyPlayers(1000);
                if (nearbyPlayers.length > 0) {
                    this.facePosition(nearbyPlayers[0].position);
                } else {
                    const firstPlayer = this.nearbyPlayers.values().next().value;
                    if (firstPlayer) {
                        this.facePosition(firstPlayer);
                    }
                }
            }
            this.onBotPositionUpdated();
            return; // CRITICAL: Exit early - don't continue to movement logic
        }
        
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
                    
                    // CRITICAL: Check for nearby players before continuing
                    const playersNearby = this.nearbyPlayers.size > 0 || this.bot.getNearbyPlayers(100).length > 0;
                    if (playersNearby) {
                        console.log(`[PatrolBehavior] 🛑 Waypoint reached but players nearby - stopping`);
                        this.bot.stop();
                        this.onBotPositionUpdated();
                        return;
                    }
                    
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
                    if (distance < 30) {
                        // No players nearby - safe to pause
                        console.log(`[PatrolBehavior] ✅ Waypoint reached (${Math.round(distance)}px away) - pausing for ${config.pauseAtWaypoints}s`);
                        this.isPaused = true;
                        this.pauseStartTime = Date.now();
                        this.waypointAttemptStartTime = 0; // Reset
                        this.lastWaypointPosition = null; // Reset
                        // If pauseAtWaypoints is 0, immediately advance to next waypoint
                        if (config.pauseAtWaypoints <= 0) {
                            this.isPaused = false;
                            this.advanceToNextWaypoint(config);
                            console.log(`[PatrolBehavior] 🎯 Advanced to next waypoint (index ${this.currentWaypointIndex})`);
                        }
                    } else {
                        // Not close enough - continue to waypoint using direct movement for precision
                        // BotClient pathfinding ended but we're not at exact position - use direct movement
                        console.log(`[PatrolBehavior] ⚠️ Path ended but still ${Math.round(distance)}px from waypoint - using direct movement to reach exact position`);
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
        this.updateProximityEngagement();

        // Resume patrol
        if (!this.targetWaypoint && config.waypoints.length > 0) {
            this.updateTargetWaypoint();
            if (!this.targetWaypoint) {
                this.currentWaypointIndex = 0;
                this.updateTargetWaypoint();
            }
        }

        // Handle waypoint pause
        if (this.isPaused) {
            const pauseDuration = (Date.now() - this.pauseStartTime) / 1000;
            if (pauseDuration >= config.pauseAtWaypoints) {
                this.isPaused = false;
                this.advanceToNextWaypoint(config);
                console.log(`[PatrolBehavior] 🎯 Pause complete - advanced to next waypoint (index ${this.currentWaypointIndex})`);
            }
            return;
        }

        if (this.targetWaypoint) {
            // CRITICAL: Check for nearby players before starting new path
            const playersNearby = this.nearbyPlayers.size > 0 || this.bot.getNearbyPlayers(config.responseRadius || 100).length > 0;
            if (playersNearby) {
                // Players nearby - don't start movement
                if (this.bot.getIsFollowingPath()) {
                    this.bot.cancelPathfinding();
                }
                this.bot.stop();
                return;
            }
            
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
                    console.log(`[PatrolBehavior] Attempting to move to waypoint (${this.targetWaypoint.x}, ${this.targetWaypoint.y}), isMoving=${this.bot.getState().isMoving()}, isPaused=${this.isPaused}`);
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

    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        super.onPlayerMoved(playerId, position);
    }

    // Like social bot: always accept spaces (use default from BaseBehavior = true)
    // This prevents server from repeatedly trying to create the space

    onSpaceJoined(spaceName: string): void {
        // When bot joins a space, it means a player is in proximity
        // Even if nearbyPlayers is empty (player might be stationary), we should stop
        console.log(`[PatrolBehavior] SPACE JOINED: ${spaceName}, nearbyPlayers=${this.nearbyPlayers.size} - STOPPING BOT`);
        console.log(`[PatrolBehavior] Setting currentSpaceName to: ${spaceName}`);
        
        this.currentSpaceName = spaceName;
        
        // Stop immediately when space is joined (player is in bubble)
        if (this.bot) {
            // Cancel any active pathfinding
            if (this.bot.getIsFollowingPath()) {
                console.log(`[PatrolBehavior] 🛑 Canceling pathfinding due to space join`);
                this.bot.cancelPathfinding();
            }
            const beforeStop = this.bot.getState().isMoving();
            this.bot.stop();
            const afterStop = this.bot.getState().isMoving();
            console.log(`[PatrolBehavior] 🛑 stop() called from onSpaceJoined - before=${beforeStop}, after=${afterStop}, isFollowingPath=${this.bot.getIsFollowingPath()}`);
            
            // If we have nearby players, send greeting
            if (this.nearbyPlayers.size > 0) {
                setTimeout(() => {
                    if (this.bot && this.currentSpaceName === spaceName) {
                        try {
                            this.bot.sendChatMessage(spaceName, "Hello! How can I help you?");
                        } catch (error) {
                            // Ignore
                        }
                    }
                }, 300);
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
                console.log(`[PatrolBehavior] Added player ${user.userId} to nearbyPlayers via space user join`);
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
        
        // CRITICAL: If we're in a space, don't move
        if (this.currentSpaceName) {
            const now = Date.now();
            if (!this.lastPathfindingLog || now - this.lastPathfindingLog > 2000) {
                console.log(`[PatrolBehavior] 🛑 moveTowardsWaypoint BLOCKED - in space ${this.currentSpaceName}`);
                this.lastPathfindingLog = now;
            }
            return;
        }
        
        // CRITICAL: Check for nearby players BEFORE doing anything
        // Check both nearbyPlayers map (from onPlayerMoved) AND getNearbyPlayers() (from server updates)
        const nearbyCheck = this.bot.getNearbyPlayers(config.responseRadius || 100);
        const hasNearby = this.nearbyPlayers.size > 0 || nearbyCheck.length > 0;
        
        if (hasNearby) {
            const now = Date.now();
            if (!this.lastPathfindingLog || now - this.lastPathfindingLog > 2000) {
                console.log(`[PatrolBehavior] 🛑 moveTowardsWaypoint BLOCKED - nearbyPlayers=${this.nearbyPlayers.size}, nearbyCheck=${nearbyCheck.length}`);
                this.lastPathfindingLog = now;
            }
            this.bot.cancelPathfinding();
            this.bot.stop();
            return;
        }
        
        // Log pathfinding start (rate-limited to once per second)
        const now = Date.now();
        if (!this.lastPathfindingLog || now - this.lastPathfindingLog > 1000) {
            console.log(`[PatrolBehavior] Starting path to waypoint (${this.targetWaypoint.x}, ${this.targetWaypoint.y}), isMoving=${this.bot.getState().isMoving()}`);
            this.lastPathfindingLog = now;
        }

        const botPos = this.bot.getState().getPosition();
        const dx = this.targetWaypoint.x - botPos.x;
        const dy = this.targetWaypoint.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 10) {
            // Check if there are any players nearby (even idle ones)
            // If so, skip the pause to avoid triggering bubble with idle players
            const playersNearby = this.bot.getNearbyPlayers(100);
            if (playersNearby.length > 0) {
                // Player nearby - don't stop, just advance to next waypoint
                this.advanceToNextWaypoint(config);
                return;
            }
            
            // No players nearby - safe to pause
            this.bot.stop();
            this.isPaused = true;
            this.pauseStartTime = Date.now();
            return;
        }

        // Check if players are nearby - if so, stop and face them (even if following a path)
        if (this.nearbyPlayers.size > 0) {
            // Cancel any active pathfinding to stop movement
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Face the closest player (handled by updateProximityEngagement in update loop)
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
}
// EXACT POSITION FIX - 01:22:37
