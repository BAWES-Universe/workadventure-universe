/**
 * MovementLogger - Comprehensive logging and analysis of bot movements
 * 
 * NOTE: Only active in development environment (ENABLE_MOVEMENT_LOGGING=true)
 * Disabled in production to avoid performance overhead and security concerns
 */

import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';

// Only enable logging in development
const ENABLE_LOGGING = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';

// Debug: Log if logging is enabled (always log this to verify module loads)
console.log(`[MovementLogger] Module loaded - ENABLE_MOVEMENT_LOGGING=${process.env.ENABLE_MOVEMENT_LOGGING}, NODE_ENV=${process.env.NODE_ENV}, ENABLE_LOGGING=${ENABLE_LOGGING}`);

export interface MovementEvent {
    timestamp: number;
    botId: string;
    eventType: 'move' | 'stop' | 'waypoint_advance' | 'path_start' | 'path_end' | 'path_fail' | 'speed_change';
    position: PositionInterface;
    targetPosition?: PositionInterface;
    speed?: number;
    effectiveSpeed?: number;
    moveDistance?: number;
    deltaTime?: number;
    waypointIndex?: number;
    pathLength?: number;
    distanceToTarget?: number;
    metadata?: Record<string, any>;
}

export class MovementLogger {
    private events: MovementEvent[] = [];
    private readonly MAX_EVENTS = 10000; // Keep last 10k events
    private readonly LOG_INTERVAL = 1000; // Log every 1 second per bot
    private lastLogTime: Map<string, number> = new Map();
    private frameCounts: Map<string, number> = new Map();
    private totalEventsLogged: number = 0; // Track total events logged

    /**
     * Log a movement event
     */
    log(event: MovementEvent): void {
        // Check if logging is enabled
        const envValue = process.env.ENABLE_MOVEMENT_LOGGING;
        const nodeEnv = process.env.NODE_ENV;
        const isEnabled = envValue === 'true' || nodeEnv === 'development';
        
        if (!isEnabled) {
            return;
        }
        
        // Debug: Log first few calls to verify it's being invoked
        if (this.totalEventsLogged < 5) {
            console.log(`[MovementLogger] log() called for bot ${event.botId.substring(0, 8)}, eventType: ${event.eventType}, totalEventsLogged: ${this.totalEventsLogged}`);
        }
        
        // Store events for API access (always store if enabled, regardless of console logging throttling)
        this.events.push(event);
        this.totalEventsLogged++;
        if (this.events.length > this.MAX_EVENTS) {
            this.events.shift();
        }

        // Throttle console logging to avoid spam
        const botId = event.botId;
        const now = Date.now();
        const lastLog = this.lastLogTime.get(botId) || 0;
        const frameCount = (this.frameCounts.get(botId) || 0) + 1;
        this.frameCounts.set(botId, frameCount);

        // Log to console every second or on important events
        const shouldLog = 
            now - lastLog > this.LOG_INTERVAL ||
            event.eventType === 'path_start' ||
            event.eventType === 'path_end' ||
            event.eventType === 'path_fail' ||
            event.eventType === 'stop';

        if (shouldLog) {
            this.lastLogTime.set(botId, now);
            // Format log message
            const logMsg = this.formatEvent(event, frameCount);
            console.log(logMsg);
        }
    }

    /**
     * Format event for logging
     */
    private formatEvent(event: MovementEvent, frameCount: number): string {
        const parts: string[] = [];
        parts.push(`[MovementLogger:${event.botId.substring(0, 8)}]`);
        parts.push(`${event.eventType.toUpperCase()}`);
        parts.push(`pos=(${event.position.x.toFixed(1)},${event.position.y.toFixed(1)})`);
        
        if (event.targetPosition) {
            parts.push(`target=(${event.targetPosition.x.toFixed(1)},${event.targetPosition.y.toFixed(1)})`);
        }
        
        if (event.speed !== undefined) {
            parts.push(`speed=${event.speed}`);
        }
        
        if (event.effectiveSpeed !== undefined) {
            parts.push(`effSpeed=${event.effectiveSpeed.toFixed(1)}`);
        }
        
        if (event.moveDistance !== undefined) {
            parts.push(`moveDist=${event.moveDistance.toFixed(3)}`);
        }
        
        if (event.deltaTime !== undefined) {
            parts.push(`deltaT=${event.deltaTime}`);
        }
        
        if (event.waypointIndex !== undefined && event.pathLength !== undefined) {
            parts.push(`waypoint=${event.waypointIndex}/${event.pathLength}`);
        }
        
        if (event.distanceToTarget !== undefined) {
            parts.push(`distToTarget=${event.distanceToTarget.toFixed(1)}`);
        }

        if (event.metadata) {
            const metaStr = Object.entries(event.metadata)
                .map(([k, v]) => `${k}=${v}`)
                .join(',');
            parts.push(`[${metaStr}]`);
        }

        parts.push(`frames=${frameCount}`);

        return parts.join(' ');
    }

    /**
     * Get recent events for a bot
     */
    getRecentEvents(botId: string, count: number = 50): MovementEvent[] {
        return this.events
            .filter(e => e.botId === botId)
            .slice(-count);
    }

    /**
     * Get all events (for analysis)
     */
    getAllEvents(): MovementEvent[] {
        return [...this.events];
    }

    /**
     * Analyze movement patterns
     */
    analyzeMovement(botId: string, timeWindow: number = 10000): {
        averageSpeed: number;
        totalDistance: number;
        waypointChanges: number;
        pathFailures: number;
        oscillationDetected: boolean;
    } {
        const now = Date.now();
        const recentEvents = this.events.filter(
            e => e.botId === botId && (now - e.timestamp) < timeWindow
        );

        if (recentEvents.length === 0) {
            return {
                averageSpeed: 0,
                totalDistance: 0,
                waypointChanges: 0,
                pathFailures: 0,
                oscillationDetected: false,
            };
        }

        let totalDistance = 0;
        let totalSpeed = 0;
        let speedCount = 0;
        let waypointChanges = 0;
        let pathFailures = 0;
        const positions: PositionInterface[] = [];

        for (let i = 1; i < recentEvents.length; i++) {
            const prev = recentEvents[i - 1];
            const curr = recentEvents[i];

            if (curr.eventType === 'move' && prev.eventType === 'move') {
                const dist = Math.sqrt(
                    Math.pow(curr.position.x - prev.position.x, 2) +
                    Math.pow(curr.position.y - prev.position.y, 2)
                );
                totalDistance += dist;
                positions.push(curr.position);
            }

            if (curr.speed !== undefined) {
                totalSpeed += curr.speed;
                speedCount++;
            }

            if (curr.eventType === 'waypoint_advance') {
                waypointChanges++;
            }

            if (curr.eventType === 'path_fail') {
                pathFailures++;
            }
        }

        // Detect oscillation (back and forth movement)
        let oscillationDetected = false;
        if (positions.length > 10) {
            // Check if bot is moving back and forth
            const recentPositions = positions.slice(-10);
            let directionChanges = 0;
            for (let i = 2; i < recentPositions.length; i++) {
                const dx1 = recentPositions[i - 1].x - recentPositions[i - 2].x;
                const dy1 = recentPositions[i - 1].y - recentPositions[i - 2].y;
                const dx2 = recentPositions[i].x - recentPositions[i - 1].x;
                const dy2 = recentPositions[i].y - recentPositions[i - 1].y;
                
                // Check if direction changed significantly
                const dot = dx1 * dx2 + dy1 * dy2;
                if (dot < 0) {
                    directionChanges++;
                }
            }
            oscillationDetected = directionChanges > 3; // More than 3 direction changes in 10 moves
        }

        return {
            averageSpeed: speedCount > 0 ? totalSpeed / speedCount : 0,
            totalDistance,
            waypointChanges,
            pathFailures,
            oscillationDetected,
        };
    }

    /**
     * Clear events (for memory management)
     */
    clear(): void {
        this.events = [];
        this.lastLogTime.clear();
        this.frameCounts.clear();
    }

    /**
     * Get summary statistics
     */
    getSummary(): {
        totalEvents: number;
        botsTracked: number;
        eventTypes: Record<string, number>;
        totalEventsLogged: number;
    } {
        const botIds = new Set(this.events.map(e => e.botId));
        const eventTypes: Record<string, number> = {};

        for (const event of this.events) {
            eventTypes[event.eventType] = (eventTypes[event.eventType] || 0) + 1;
        }

        return {
            totalEvents: this.events.length,
            botsTracked: botIds.size,
            eventTypes,
            totalEventsLogged: this.totalEventsLogged,
        };
    }
}

// Singleton instance
export const movementLogger = new MovementLogger();

