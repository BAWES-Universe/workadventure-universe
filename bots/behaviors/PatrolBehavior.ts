/**
 * PatrolBehavior - Bot follows a predefined route
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
    private wasEngaged: boolean = false; // Track previous engagement state

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // Track bot position at START of update cycle (before any movement)
        // This is critical for detecting if bot walked over stationary players
        this.onBotPositionUpdated();

        // If engaged with nearby player, stop immediately and face them
        // This must be checked FIRST before any movement logic
        if (this.isEngaged) {
            this.bot.stop(); // Ensure bot stops immediately - call stop() every frame when engaged
            this.wasEngaged = true;
            return; // Don't do anything else when engaged
        }

        // If we just became disengaged, resume patrol immediately
        if (this.wasEngaged && !this.isEngaged) {
            this.wasEngaged = false;
            this.isPaused = false; // Clear any pause state
            // Continue to movement logic below
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

        // Check if we should respond to players
        if (config.respondToPlayers && config.responseRadius) {
            const nearbyPlayers = this.bot.getNearbyPlayers(config.responseRadius);
            if (nearbyPlayers.length > 0) {
                // Pause patrol to interact
                this.isPaused = true;
                this.pauseStartTime = Date.now();
                return;
            }
        }

        // Move towards current waypoint (will check isEngaged internally)
        if (this.targetWaypoint) {
            this.moveTowardsWaypoint(config);
        }
    }

    onSpaceJoined(spaceName: string): void {
        // Pause patrol when in conversation
        this.isPaused = true;
        this.pauseStartTime = Date.now();
    }

    onSpaceLeft(spaceName: string): void {
        // Return to assigned space if configured
        this.returnToAssignedSpace();

        // Resume patrol after conversation
        const config = this.config as PatrolBehaviorConfig;
        if (config.respondToPlayers) {
            // Wait a bit before resuming
            this.pauseStartTime = Date.now();
            this.isPaused = true;
        } else {
            this.isPaused = false;
        }
    }

    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        // Call base behavior for proximity tracking and facing
        super.onPlayerMoved(playerId, position);
    }

    private moveTowardsWaypoint(config: PatrolBehaviorConfig): void {
        if (!this.bot || !this.targetWaypoint) return;
        
        // CRITICAL: Don't move if engaged with a player
        if (this.isEngaged) {
            this.bot.stop();
            return;
        }

        const botPos = this.bot.getState().getPosition();
        const dx = this.targetWaypoint.x - botPos.x;
        const dy = this.targetWaypoint.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Check if reached waypoint
        if (distance < 10) {
            // Reached waypoint, pause
            this.bot.stop();
            this.isPaused = true;
            this.pauseStartTime = Date.now();
            return;
        }

        // Move towards waypoint
        const angle = Math.atan2(dy, dx);
        const newX = botPos.x + Math.cos(angle) * config.speed * 0.016; // Assuming 60fps
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
                // Reverse direction
                config.waypoints.reverse();
                this.currentWaypointIndex = 0;
            }
        }

        this.updateTargetWaypoint();
    }
}

