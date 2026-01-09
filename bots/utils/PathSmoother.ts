/**
 * PathSmoother - Smooths and optimizes paths for natural movement
 */

import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';

export class PathSmoother {
    private readonly minWaypointDistance: number = 100; // Minimum distance between waypoints (pixels) - increased to prevent glitching
    private readonly directionChangeThreshold: number = 0.1; // Minimum direction change to keep waypoint (radians)

    /**
     * Smooth and optimize a path
     */
    smoothPath(path: PositionInterface[]): PositionInterface[] {
        if (path.length <= 2) {
            return path; // Too short to smooth
        }

        // Step 1: Remove redundant waypoints (too close together)
        let smoothed = this.removeRedundantWaypoints(path);

        // Step 2: Simplify path (remove waypoints that don't change direction significantly)
        smoothed = this.simplifyPath(smoothed);

        // Step 3: Ensure minimum distance between waypoints
        smoothed = this.enforceMinimumDistance(smoothed);

        return smoothed;
    }

    /**
     * Remove waypoints that are too close together
     */
    private removeRedundantWaypoints(path: PositionInterface[]): PositionInterface[] {
        if (path.length <= 2) {
            return path;
        }

        const result: PositionInterface[] = [path[0]]; // Always keep start

        for (let i = 1; i < path.length - 1; i++) {
            const prev = result[result.length - 1];
            const current = path[i];
            const distance = this.distance(prev, current);

            // Keep waypoint if it's far enough from previous
            if (distance >= this.minWaypointDistance) {
                result.push(current);
            }
        }

        // Always keep end point
        result.push(path[path.length - 1]);

        return result;
    }

    /**
     * Simplify path by removing waypoints that don't significantly change direction
     */
    private simplifyPath(path: PositionInterface[]): PositionInterface[] {
        if (path.length <= 3) {
            return path; // Need at least 3 points to simplify
        }

        const result: PositionInterface[] = [path[0]]; // Always keep start

        for (let i = 1; i < path.length - 1; i++) {
            const prev = path[i - 1];
            const current = path[i];
            const next = path[i + 1];

            // Calculate direction vectors
            const dir1 = this.normalize({
                x: current.x - prev.x,
                y: current.y - prev.y,
            });
            const dir2 = this.normalize({
                x: next.x - current.x,
                y: next.y - current.y,
            });

            // Calculate angle between directions
            const dot = dir1.x * dir2.x + dir1.y * dir2.y;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot))); // Clamp to avoid NaN

            // Keep waypoint if direction changes significantly
            if (angle > this.directionChangeThreshold) {
                result.push(current);
            }
        }

        // Always keep end point
        result.push(path[path.length - 1]);

        return result;
    }

    /**
     * Ensure minimum distance between waypoints
     */
    private enforceMinimumDistance(path: PositionInterface[]): PositionInterface[] {
        if (path.length <= 2) {
            return path;
        }

        const result: PositionInterface[] = [path[0]];

        for (let i = 1; i < path.length; i++) {
            const prev = result[result.length - 1];
            const current = path[i];
            const distance = this.distance(prev, current);

            if (distance >= this.minWaypointDistance) {
                result.push(current);
            } else if (i === path.length - 1) {
                // Always include the last waypoint, even if close
                result.push(current);
            }
            // Otherwise skip this waypoint (too close to previous)
        }

        return result;
    }

    /**
     * Calculate distance between two points
     */
    private distance(a: PositionInterface, b: PositionInterface): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Normalize a direction vector
     */
    private normalize(dir: { x: number; y: number }): { x: number; y: number } {
        const length = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
        if (length < 0.001) {
            return { x: 0, y: 0 };
        }
        return {
            x: dir.x / length,
            y: dir.y / length,
        };
    }

    /**
     * Add bezier curve smoothing for natural turns (optional enhancement)
     * This creates smoother curves around corners
     */
    smoothWithBezier(path: PositionInterface[], tension: number = 0.5): PositionInterface[] {
        if (path.length <= 2) {
            return path;
        }

        const result: PositionInterface[] = [path[0]];

        for (let i = 1; i < path.length - 1; i++) {
            const prev = path[i - 1];
            const current = path[i];
            const next = path[i + 1];

            // Create control points for bezier curve
            const cp1 = {
                x: current.x - (next.x - prev.x) * tension,
                y: current.y - (next.y - prev.y) * tension,
            };
            const cp2 = {
                x: current.x + (next.x - prev.x) * tension,
                y: current.y + (next.y - prev.y) * tension,
            };

            // Add intermediate points along the curve
            const steps = 5;
            for (let t = 0; t <= 1; t += 1 / steps) {
                const point = this.bezierPoint(prev, cp1, cp2, next, t);
                result.push(point);
            }
        }

        result.push(path[path.length - 1]);
        return result;
    }

    /**
     * Calculate a point on a bezier curve
     */
    private bezierPoint(
        p0: PositionInterface,
        p1: PositionInterface,
        p2: PositionInterface,
        p3: PositionInterface,
        t: number
    ): PositionInterface {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;

        return {
            x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
            y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
        };
    }
}

