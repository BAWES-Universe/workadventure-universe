/**
 * PatrolBehavior - Bot follows a predefined route
 * 
 * IMPORTANT: This behavior uses the EXACT same engagement pattern as SocialBehavior.
 * Engagement only happens when a PLAYER moves into proximity (via onPlayerMoved).
 * If the bot walks into an idle player, no engagement occurs.
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';

export interface PatrolBehaviorConfig extends BehaviorConfig {
    type: 'patrol';
    waypoints: Array<{ x: number; y: number }>;
    loop: boolean; // Loop back to start
    pauseAtWaypoints: number; // Seconds to pause
    speed: number; // Movement speed
    respondToPlayers: boolean; // Pause to chat?
    responseRadius?: number; // Distance to respond
}

export class PatrolBehavior extends BaseBehavior {
    private currentWaypointIndex: number = 0;
    private isPaused: boolean = false;
    private pauseStartTime: number = 0;
    private targetWaypoint: PositionInterface | null = null;
    private inProximitySpace: boolean = false; // Track if we're in a bubble/proximity space
    private spaceLeftTime: number = 0; // When we left the last space
    private readonly RESUME_DELAY = 500; // Wait 500ms after leaving space before resuming
    private currentSpaceName: string = ''; // Current space we're in

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // STOP CONDITIONS:
        // 1. In proximity space (bubble active) - authoritative
        // 2. nearbyPlayers detected - backup signal when space join is delayed
        // 3. Recently left space - give time for re-engagement
        const timeSinceSpaceLeft = Date.now() - this.spaceLeftTime;
        const recentlyLeftSpace = this.spaceLeftTime > 0 && timeSinceSpaceLeft < this.RESUME_DELAY;
        
        if (this.inProximitySpace || this.nearbyPlayers.size > 0 || recentlyLeftSpace) {
            this.bot.stop();
            // Keep facing the closest player using bot's player list (last known positions)
            const nearbyPlayers = this.bot.getNearbyPlayers(1000);
            if (nearbyPlayers.length > 0) {
                this.facePosition(nearbyPlayers[0].position);
            } else if (this.nearbyPlayers.size > 0) {
                // Fallback to nearbyPlayers
                const firstPlayer = this.nearbyPlayers.values().next().value;
                if (firstPlayer) {
                    this.facePosition(firstPlayer);
                }
            }
            this.onBotPositionUpdated();
            return;
        }

        // Track bot position
        this.onBotPositionUpdated();

        // Ensure we have a target waypoint (resume patrol after disengagement)
        if (!this.targetWaypoint && config.waypoints.length > 0) {
            this.updateTargetWaypoint();
            if (!this.targetWaypoint) {
                this.currentWaypointIndex = 0;
                this.updateTargetWaypoint();
            }
        }

        // Handle pause at waypoint
        if (this.isPaused) {
            const pauseDuration = (Date.now() - this.pauseStartTime) / 1000;
            if (pauseDuration >= config.pauseAtWaypoints) {
                this.isPaused = false;
                this.advanceToNextWaypoint(config);
            }
            return;
        }

        // Move towards current waypoint
        if (this.targetWaypoint) {
            this.moveTowardsWaypoint(config);
        }
    }

    /**
     * EXACTLY like social bot - just call super
     */
    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        super.onPlayerMoved(playerId, position);
    }

    /**
     * Always accept proximity spaces and stop the bot.
     * The bot will resume patrol when the space is left.
     */
    shouldJoinProximitySpace(spaceName: string): boolean {
        // ALWAYS accept - even if bot ref is null, space join is critical
        return true;
    }

    onSpaceJoined(spaceName: string): void {
        // ANY space join means we're in a bubble - STOP
        this.inProximitySpace = true;
        this.currentSpaceName = spaceName;
        if (this.bot) {
            this.bot.stop();
        }
        
        // Send greeting after a short delay
        if (this.bot) {
            setTimeout(() => {
                if (this.bot && this.inProximitySpace) {
                    try {
                        this.bot.sendChatMessage(spaceName, "Hello! How can I help you?");
                    } catch (error) {
                        console.warn(`[PatrolBehavior] Failed to send greeting:`, error);
                    }
                }
            }, 300);
        }
    }
    
    /**
     * Override to face player when they join the space - this gives us their position directly
     */
    onSpaceUserJoined(spaceName: string, user: any): void {
        // Call base to track engagement
        super.onSpaceUserJoined(spaceName, user);
        
        // Face the player using their position from the event
        if (this.bot && user.characterPosition) {
            const playerPos = { x: user.characterPosition.x, y: user.characterPosition.y };
            this.facePosition(playerPos);
        }
    }

    onSpaceLeft(spaceName: string): void {
        // Left space - resume patrol after delay
        this.inProximitySpace = false;
        this.currentSpaceName = '';
        this.spaceLeftTime = Date.now();
        // Note: Don't clear engagedWithUsers here - let onSpaceUserLeft handle that
        // This ensures we still know about users if spaces change quickly
    }

    private moveTowardsWaypoint(config: PatrolBehaviorConfig): void {
        if (!this.bot || !this.targetWaypoint) return;
        
        // Don't move if in proximity space OR players nearby
        if (this.inProximitySpace || this.nearbyPlayers.size > 0) {
            this.bot.stop();
            return;
        }

        const botPos = this.bot.getState().getPosition();
        const dx = this.targetWaypoint.x - botPos.x;
        const dy = this.targetWaypoint.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Check if reached waypoint
        if (distance < 10) {
            this.bot.stop();
            this.isPaused = true;
            this.pauseStartTime = Date.now();
            return;
        }

        // Move towards waypoint
        const angle = Math.atan2(dy, dx);
        const newX = botPos.x + Math.cos(angle) * config.speed * 0.016;
        const newY = botPos.y + Math.sin(angle) * config.speed * 0.016;

        // Determine direction
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
