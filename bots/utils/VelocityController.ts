/**
 * VelocityController - Handles smooth acceleration and deceleration for natural movement
 */

import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';

export enum MovementState {
    Idle = 'idle',
    Accelerating = 'accelerating',
    Cruising = 'cruising',
    Decelerating = 'decelerating',
}

export interface VelocityState {
    vx: number;
    vy: number;
    speed: number;
    state: MovementState;
}

export class VelocityController {
    private currentVelocity: { vx: number; vy: number } = { vx: 0, vy: 0 };
    private targetVelocity: { vx: number; vy: number } = { vx: 0, vy: 0 };
    private currentState: MovementState = MovementState.Idle;
    
    // Acceleration/deceleration rates (pixels per second^2)
    private readonly accelerationRate: number = 200; // pixels/s^2
    private readonly decelerationRate: number = 300; // pixels/s^2
    private readonly maxSpeed: number;
    
    // State transition thresholds
    private readonly accelerationThreshold: number = 0.1; // 10% of max speed
    private readonly decelerationDistance: number = 50; // Start decelerating 50px before target

    constructor(maxSpeed: number) {
        this.maxSpeed = maxSpeed;
    }

    /**
     * Update velocity based on target direction and distance to target
     */
    update(
        deltaTime: number,
        targetDirection: { x: number; y: number },
        distanceToTarget: number,
        targetSpeed: number
    ): VelocityState {
        const deltaSeconds = deltaTime / 1000;
        const maxSpeed = Math.min(targetSpeed, this.maxSpeed);

        // Calculate target velocity vector
        if (distanceToTarget > 0.1) {
            const angle = Math.atan2(targetDirection.y, targetDirection.x);
            this.targetVelocity.vx = Math.cos(angle) * maxSpeed;
            this.targetVelocity.vy = Math.sin(angle) * maxSpeed;
        } else {
            this.targetVelocity.vx = 0;
            this.targetVelocity.vy = 0;
        }

        // Determine movement state based on distance and current speed
        const currentSpeed = Math.sqrt(
            this.currentVelocity.vx * this.currentVelocity.vx + 
            this.currentVelocity.vy * this.currentVelocity.vy
        );

        if (distanceToTarget < this.decelerationDistance && currentSpeed > 0) {
            // Decelerate when approaching target
            this.currentState = MovementState.Decelerating;
            this.decelerate(deltaSeconds, maxSpeed);
        } else if (currentSpeed < maxSpeed * this.accelerationThreshold) {
            // Accelerate from idle or low speed
            this.currentState = MovementState.Accelerating;
            this.accelerate(deltaSeconds, maxSpeed);
        } else if (Math.abs(currentSpeed - maxSpeed) < 5) {
            // Maintain cruising speed
            this.currentState = MovementState.Cruising;
            this.cruise(deltaSeconds, maxSpeed);
        } else {
            // Still accelerating to cruising speed
            this.currentState = MovementState.Accelerating;
            this.accelerate(deltaSeconds, maxSpeed);
        }

        // If target is reached, decelerate to stop
        if (distanceToTarget < 5) {
            this.currentState = MovementState.Decelerating;
            this.decelerate(deltaSeconds, 0);
        }

        // If stopped and no target, go idle
        if (currentSpeed < 0.1 && distanceToTarget < 5) {
            this.currentState = MovementState.Idle;
            this.currentVelocity.vx = 0;
            this.currentVelocity.vy = 0;
        }

        const finalSpeed = Math.sqrt(
            this.currentVelocity.vx * this.currentVelocity.vx + 
            this.currentVelocity.vy * this.currentVelocity.vy
        );

        return {
            vx: this.currentVelocity.vx,
            vy: this.currentVelocity.vy,
            speed: finalSpeed,
            state: this.currentState,
        };
    }

    /**
     * Accelerate towards target velocity
     */
    private accelerate(deltaSeconds: number, maxSpeed: number): void {
        const dvx = this.targetVelocity.vx - this.currentVelocity.vx;
        const dvy = this.targetVelocity.vy - this.currentVelocity.vy;
        const acceleration = this.accelerationRate * deltaSeconds;

        // Normalize direction and apply acceleration
        const distance = Math.sqrt(dvx * dvx + dvy * dvy);
        if (distance > 0.1) {
            const accelX = (dvx / distance) * acceleration;
            const accelY = (dvy / distance) * acceleration;

            this.currentVelocity.vx += accelX;
            this.currentVelocity.vy += accelY;

            // Cap at max speed
            const speed = Math.sqrt(
                this.currentVelocity.vx * this.currentVelocity.vx + 
                this.currentVelocity.vy * this.currentVelocity.vy
            );
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                this.currentVelocity.vx *= scale;
                this.currentVelocity.vy *= scale;
            }
        }
    }

    /**
     * Maintain cruising speed
     */
    private cruise(deltaSeconds: number, maxSpeed: number): void {
        // Maintain current velocity, with slight adjustments towards target
        const dvx = this.targetVelocity.vx - this.currentVelocity.vx;
        const dvy = this.targetVelocity.vy - this.currentVelocity.vy;
        const adjustment = 50 * deltaSeconds; // Small adjustment rate

        const distance = Math.sqrt(dvx * dvx + dvy * dvy);
        if (distance > 0.1) {
            const adjustX = (dvx / distance) * adjustment;
            const adjustY = (dvy / distance) * adjustment;

            this.currentVelocity.vx += adjustX;
            this.currentVelocity.vy += adjustY;
        }

        // Ensure we maintain max speed
        const speed = Math.sqrt(
            this.currentVelocity.vx * this.currentVelocity.vx + 
            this.currentVelocity.vy * this.currentVelocity.vy
        );
        if (speed > maxSpeed * 1.1) {
            const scale = maxSpeed / speed;
            this.currentVelocity.vx *= scale;
            this.currentVelocity.vy *= scale;
        } else if (speed < maxSpeed * 0.9) {
            // Slight acceleration if below cruising speed
            this.accelerate(deltaSeconds, maxSpeed);
        }
    }

    /**
     * Decelerate to stop or slower speed
     */
    private decelerate(deltaSeconds: number, targetSpeed: number): void {
        const currentSpeed = Math.sqrt(
            this.currentVelocity.vx * this.currentVelocity.vx + 
            this.currentVelocity.vy * this.currentVelocity.vy
        );

        if (currentSpeed <= targetSpeed + 1) {
            // Reached target speed, stop decelerating
            if (targetSpeed === 0) {
                this.currentVelocity.vx = 0;
                this.currentVelocity.vy = 0;
            } else {
                // Maintain target speed
                const scale = targetSpeed / currentSpeed;
                this.currentVelocity.vx *= scale;
                this.currentVelocity.vy *= scale;
            }
            return;
        }

        // Apply deceleration
        const deceleration = this.decelerationRate * deltaSeconds;
        const speedReduction = Math.min(deceleration, currentSpeed - targetSpeed);

        if (currentSpeed > 0.1) {
            const scale = (currentSpeed - speedReduction) / currentSpeed;
            this.currentVelocity.vx *= scale;
            this.currentVelocity.vy *= scale;
        } else {
            this.currentVelocity.vx = 0;
            this.currentVelocity.vy = 0;
        }
    }

    /**
     * Reset velocity (e.g., when stopping or changing direction abruptly)
     */
    reset(): void {
        this.currentVelocity.vx = 0;
        this.currentVelocity.vy = 0;
        this.targetVelocity.vx = 0;
        this.targetVelocity.vy = 0;
        this.currentState = MovementState.Idle;
    }

    /**
     * Get current velocity
     */
    getVelocity(): { vx: number; vy: number } {
        return { ...this.currentVelocity };
    }

    /**
     * Get current movement state
     */
    getState(): MovementState {
        return this.currentState;
    }
}

