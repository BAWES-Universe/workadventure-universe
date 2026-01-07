/**
 * PatrolBehavior - Bot follows a predefined route
 * 
 * Like SocialBehavior: always accepts spaces, but only engages when
 * nearbyPlayers > 0 (player moved into proximity).
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';

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
        
        // STOP only if: actively engaged (nearbyPlayers from player movement)
        const timeSinceSpaceLeft = Date.now() - this.spaceLeftTime;
        const recentlyLeftSpace = this.spaceLeftTime > 0 && timeSinceSpaceLeft < this.RESUME_DELAY;
        
        if (this.nearbyPlayers.size > 0 || recentlyLeftSpace) {
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
            this.moveTowardsWaypoint(config);
        }
    }

    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        super.onPlayerMoved(playerId, position);
    }

    // Like social bot: always accept (use default from BaseBehavior)
    // shouldJoinProximitySpace is NOT overridden - uses default true

    onSpaceJoined(spaceName: string): void {
        // Like social bot: if no nearby players, do nothing - just return
        // Bot keeps walking, space is joined but we don't engage
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

    private moveTowardsWaypoint(config: PatrolBehaviorConfig): void {
        if (!this.bot || !this.targetWaypoint) return;
        
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
            this.bot.stop();
            this.isPaused = true;
            this.pauseStartTime = Date.now();
            return;
        }

        const angle = Math.atan2(dy, dx);
        const newX = botPos.x + Math.cos(angle) * config.speed * 0.016;
        const newY = botPos.y + Math.sin(angle) * config.speed * 0.016;

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
