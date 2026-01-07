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
            // Keep facing the closest player while stopped
            // Uses live player list, not nearbyPlayers which can be stale
            this.faceClosestPlayer();
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
        console.log(`[PatrolBehavior] Accepting space: ${spaceName} (bot=${this.bot ? 'set' : 'null'})`);
        return true;
    }

    onSpaceJoined(spaceName: string): void {
        // ANY space join means we're in a bubble - STOP
        this.inProximitySpace = true;
        console.log(`[PatrolBehavior] Joined space: ${spaceName} - STOPPING patrol`);
        if (this.bot) {
            this.bot.stop();
            
            // Face the closest nearby player - try immediately and after short delay
            // (player list may not be updated yet when onSpaceJoined fires)
            this.faceClosestPlayer();
            setTimeout(() => {
                if (this.bot && this.inProximitySpace) {
                    this.faceClosestPlayer();
                }
            }, 100);
        }
        
        // Send greeting
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
     * Face the closest player - uses bot's live player list for accuracy
     */
    private faceClosestPlayer(): void {
        if (!this.bot) return;
        
        // Use bot's getNearbyPlayers for accurate, live player positions
        const nearbyPlayers = this.bot.getNearbyPlayers(200);
        if (nearbyPlayers.length === 0) return;
        
        const botPos = this.bot.getState().getPosition();
        let closestDist = Infinity;
        let closestPos: { x: number; y: number } | null = null;
        
        for (const player of nearbyPlayers) {
            const dx = player.position.x - botPos.x;
            const dy = player.position.y - botPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < closestDist) {
                closestDist = dist;
                closestPos = player.position;
            }
        }
        
        if (closestPos) {
            // Calculate desired direction
            const dx = closestPos.x - botPos.x;
            const dy = closestPos.y - botPos.y;
            let desiredDirection: PositionMessage_Direction;
            if (Math.abs(dx) > Math.abs(dy)) {
                desiredDirection = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
            } else {
                desiredDirection = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
            }
            
            // Only update if direction changed
            const currentDirection = this.bot.getState().getDirection();
            if (currentDirection !== desiredDirection) {
                console.log(`[PatrolBehavior] Facing player: direction ${currentDirection} -> ${desiredDirection}`);
                this.bot.getState().setDirection(desiredDirection);
                this.bot.getState().setMoving(false);
                this.bot.stopAndUpdate();
            }
        }
    }

    onSpaceLeft(spaceName: string): void {
        // Left space - clear ALL engagement state and resume patrol after delay
        this.inProximitySpace = false;
        this.spaceLeftTime = Date.now();
        // Clear base behavior engagement states to ensure clean state
        this.isEngaged = false;
        this.nearbyPlayers.clear();
        this.engagedWithUsers.clear();
        console.log(`[PatrolBehavior] Left space: ${spaceName} - cleared all engagement, will resume patrol after ${this.RESUME_DELAY}ms`);
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
