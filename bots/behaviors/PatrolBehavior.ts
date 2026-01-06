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

    constructor(config: PatrolBehaviorConfig) {
        super(config);
        this.updateTargetWaypoint();
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as PatrolBehaviorConfig;
        
        // If engaged in conversation, stop moving and face the player (EXACTLY like social bot)
        if (this.isEngaged) {
            // CRITICAL: Stop immediately and ensure we stay stopped
            this.bot.stop();
            this.onBotPositionUpdated(); // Track position even when stopped
            
            // Continuously face the closest player every frame
            if (this.nearbyPlayers.size > 0) {
                let closestDistance = Infinity;
                let closestPos: PositionInterface | null = null;
                const botPos = this.bot.getState().getPosition();
                for (const playerPos of this.nearbyPlayers.values()) {
                    const dx = playerPos.x - botPos.x;
                    const dy = playerPos.y - botPos.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < closestDistance) {
                        closestDistance = dist;
                        closestPos = playerPos;
                    }
                }
                if (closestPos) {
                    this.facePosition(closestPos);
                }
            }
            // CRITICAL: Return immediately - don't do ANY movement logic
            return;
        }

        // Track bot position after checking engagement
        this.onBotPositionUpdated();

        // Handle pause at waypoint (only for waypoint pauses, not conversations)
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

        // Move towards current waypoint (double-check isEngaged before moving)
        if (this.targetWaypoint && !this.isEngaged) {
            this.moveTowardsWaypoint(config);
        }
    }

    /**
     * Only join spaces if player moved into our proximity (not bot walked into idle player)
     * This matches social bot behavior - onPlayerMoved is only called when player moves
     */
    shouldJoinProximitySpace(spaceName: string): boolean {
        // nearbyPlayers only contains players who moved (onPlayerMoved only called when player moves)
        // If empty, bot walked into idle player - decline
        const shouldJoin = this.nearbyPlayers.size > 0;
        if (!shouldJoin) {
            console.log(`[PatrolBehavior] Declining space - bot walked into idle player`);
        }
        return shouldJoin;
    }

    onSpaceJoined(spaceName: string): void {
        // Only send greeting if we have nearby players (player approached us)
        if (this.bot && this.nearbyPlayers.size > 0) {
            setTimeout(() => {
                if (this.bot && this.nearbyPlayers.size > 0) {
                    try {
                        this.bot.sendChatMessage(spaceName, "Hello! How can I help you?");
                    } catch (error) {
                        console.warn(`[PatrolBehavior] Failed to send greeting:`, error);
                    }
                }
            }, 300);
        }
    }

    onSpaceLeft(spaceName: string): void {
        // Ensure bot is stopped when space is left (in case of rapid join/leave spam)
        // isEngaged will be false and bot will resume in next update() cycle
        if (this.bot && this.isEngaged) {
            // Still engaged (maybe another space), ensure stopped
            this.bot.stop();
        }
    }

    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        // Call base behavior for proximity tracking and facing (EXACTLY like social bot)
        super.onPlayerMoved(playerId, position);
    }

    private moveTowardsWaypoint(config: PatrolBehaviorConfig): void {
        if (!this.bot || !this.targetWaypoint) return;
        
        // CRITICAL: Don't move if engaged (triple-check safety)
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

