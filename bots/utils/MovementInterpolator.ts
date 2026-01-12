/**
 * MovementInterpolator - Provides smooth interpolation with easing functions
 */

import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';

export type EasingFunction = (t: number) => number;

/**
 * Easing functions for natural movement
 */
export const EasingFunctions = {
    /**
     * Linear interpolation (no easing)
     */
    linear: (t: number): number => t,

    /**
     * Ease-in-out cubic (smooth acceleration and deceleration)
     */
    easeInOutCubic: (t: number): number => {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },

    /**
     * Ease-in-out quadratic (gentle acceleration and deceleration)
     */
    easeInOutQuad: (t: number): number => {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    },

    /**
     * Ease-out (deceleration only)
     */
    easeOut: (t: number): number => {
        return 1 - Math.pow(1 - t, 3);
    },

    /**
     * Ease-in (acceleration only)
     */
    easeIn: (t: number): number => {
        return t * t * t;
    },
};

export class MovementInterpolator {
    /**
     * Interpolate between two positions with easing
     */
    static interpolate(
        start: PositionInterface,
        end: PositionInterface,
        progress: number, // 0.0 to 1.0
        easing: EasingFunction = EasingFunctions.easeInOutCubic
    ): PositionInterface {
        const easedProgress = easing(Math.max(0, Math.min(1, progress)));
        return {
            x: start.x + (end.x - start.x) * easedProgress,
            y: start.y + (end.y - start.y) * easedProgress,
        };
    }

    /**
     * Calculate progress along a path segment
     */
    static calculateProgress(
        current: PositionInterface,
        start: PositionInterface,
        end: PositionInterface
    ): number {
        const totalDx = end.x - start.x;
        const totalDy = end.y - start.y;
        const totalDistance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

        if (totalDistance < 0.1) {
            return 1.0; // Already at end
        }

        const currentDx = current.x - start.x;
        const currentDy = current.y - start.y;
        const currentDistance = Math.sqrt(currentDx * currentDx + currentDy * currentDy);

        return Math.max(0, Math.min(1, currentDistance / totalDistance));
    }

    /**
     * Smooth direction change (avoid instant 180-degree turns)
     */
    static smoothDirectionChange(
        currentDirection: { x: number; y: number },
        targetDirection: { x: number; y: number },
        smoothingFactor: number = 0.2 // 0.0 = instant, 1.0 = very slow
    ): { x: number; y: number } {
        return {
            x: currentDirection.x + (targetDirection.x - currentDirection.x) * (1 - smoothingFactor),
            y: currentDirection.y + (targetDirection.y - currentDirection.y) * (1 - smoothingFactor),
        };
    }
}

