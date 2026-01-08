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

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // If following a path, let BotClient handle movement
        if (this.bot.getIsFollowingPath()) {
            this.bot.updatePathFollowing(deltaTime);
            
            // Check if path completed
            if (!this.bot.getIsFollowingPath()) {
                // Reached waypoint - check distance to confirm we're actually at the waypoint
                const botPos = this.bot.getState().getPosition();
                if (this.targetWaypoint) {
                    const dx = this.targetWaypoint.x - botPos.x;
                    const dy = this.targetWaypoint.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Only pause if we're actually close to the waypoint (within 50px)
                    if (distance < 50) {
                        const playersNearby = this.bot.getNearbyPlayers(100);
                        if (playersNearby.length > 0) {
                            // Player nearby - don't stop, just advance to next waypoint
                            this.advanceToNextWaypoint(config);
                        } else {
                            // No players nearby - safe to pause
                            this.isPaused = true;
                            this.pauseStartTime = Date.now();
                        }
                    } else {
                        // Not close enough, continue to waypoint
                        this.moveTowardsWaypoint(config, deltaTime).catch(error => {
                            console.error(`[PatrolBehavior] Error moving to waypoint:`, error);
                        });
                    }
                }
            }
            this.onBotPositionUpdated();
            return;
        }
        
        // STOP only if: actively engaged (nearbyPlayers from player movement)
        const timeSinceSpaceLeft = Date.now() - this.spaceLeftTime;
        const recentlyLeftSpace = this.spaceLeftTime > 0 && timeSinceSpaceLeft < this.RESUME_DELAY;
        
        if (this.nearbyPlayers.size > 0 || recentlyLeftSpace) {
            // Cancel pathfinding if active
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
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
            return;
        }

        this.onBotPositionUpdated();

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
            }
            return;
        }

        if (this.targetWaypoint) {
            // Only start a new path if we're not already following one
            if (!this.bot.getIsFollowingPath()) {
                // Move towards waypoint (async, but we don't await - it will handle pathfinding internally)
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
        // Like social bot: if no nearby players (bot walked into idle player),
        // just return - don't engage, keep walking
        if (this.nearbyPlayers.size === 0) return;
        
        // Player actively approached us - engage
        this.currentSpaceName = spaceName;
        if (this.bot) {
            this.bot.stop();
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
    
    onSpaceUserJoined(spaceName: string, user: any): void {
        if (!this.currentSpaceName) return;
        super.onSpaceUserJoined(spaceName, user);
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
        
        console.log(`[PatrolBehavior] moveTowardsWaypoint called: target=(${this.targetWaypoint.x}, ${this.targetWaypoint.y}), nearbyPlayers=${this.nearbyPlayers.size}`);
        
        // Don't move if engaged
        if (this.nearbyPlayers.size > 0) {
            this.bot.stop();
            return;
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

        // Try pathfinding first if available and not already following a path
        if (this.bot.hasPathfinding() && !this.bot.getIsFollowingPath()) {
            const success = await this.bot.moveToWithPathfinding(this.targetWaypoint.x, this.targetWaypoint.y);
            if (success) {
                // Pathfinding will handle movement via updatePathFollowing
                return;
            }
            // Pathfinding failed, fall through to direct movement
        }

        // Fallback to direct movement with speed fix (halve if > 75)
        const effectiveSpeed = config.speed > 75 ? config.speed * 0.5 : config.speed;
        const angle = Math.atan2(dy, dx);
        const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
        const newX = botPos.x + Math.cos(angle) * moveDistance;
        const newY = botPos.y + Math.sin(angle) * moveDistance;

        // Debug: Always log to console for now
        console.log(`[PatrolBehavior] Direct movement: speed=${config.speed}, effectiveSpeed=${effectiveSpeed}, moveDistance=${moveDistance.toFixed(3)}, distance=${distance.toFixed(1)}`);

        // Log direct movement
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.bot.config.botId,
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
    }
}
