/**
 * BotUsageTracker - Tracks bot usage metrics and reports to Admin API
 */

import { adminApiService, type BotUsageMetrics } from './AdminApiService';

export interface BotUsageData {
    botId: string;
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    userId?: string;
}

export class BotUsageTracker {
    private metrics: Map<string, BotUsageMetrics> = new Map();
    private conversationCounts: Map<string, number> = new Map();
    private messageCounts: Map<string, number> = new Map();
    private activeTime: Map<string, number> = new Map();
    private startTimes: Map<string, Date> = new Map();

    /**
     * Initialize tracking for a bot
     */
    startTracking(data: BotUsageData): void {
        const key = this.getKey(data.botId, data.roomUrl);
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, {
                botId: data.botId,
                roomUrl: data.roomUrl,
                worldUrl: data.worldUrl,
                universeUrl: data.universeUrl,
                userId: data.userId,
                totalConversations: 0,
                totalMessages: 0,
                totalActiveTime: 0,
                lastActiveAt: new Date(),
                conversationsByDate: [],
            });
        }

        this.startTimes.set(key, new Date());
    }

    /**
     * Stop tracking for a bot
     */
    stopTracking(botId: string, roomUrl: string): void {
        const key = this.getKey(botId, roomUrl);
        const startTime = this.startTimes.get(key);
        
        if (startTime) {
            const activeTime = Date.now() - startTime.getTime();
            const current = this.activeTime.get(key) || 0;
            this.activeTime.set(key, current + activeTime);
            this.startTimes.delete(key);
        }

        // Flush metrics to admin API
        this.flushMetrics(botId, roomUrl);
    }

    /**
     * Track a conversation
     */
    trackConversation(botId: string, playerId: number, roomUrl: string, duration: number): void {
        const key = this.getKey(botId, roomUrl);
        const count = this.conversationCounts.get(key) || 0;
        this.conversationCounts.set(key, count + 1);

        const metrics = this.metrics.get(key);
        if (metrics) {
            metrics.totalConversations++;
            metrics.lastActiveAt = new Date();

            // Update conversations by date
            const today = new Date().toISOString().split('T')[0];
            const dateEntry = metrics.conversationsByDate.find((e) => e.date === today);
            if (dateEntry) {
                dateEntry.count++;
            } else {
                metrics.conversationsByDate.push({ date: today, count: 1 });
            }
        }

        // Track in admin API
        adminApiService.trackConversation(botId, playerId, roomUrl, duration);
    }

    /**
     * Track a message sent
     */
    trackMessage(botId: string, roomUrl: string, messageLength: number): void {
        const key = this.getKey(botId, roomUrl);
        const count = this.messageCounts.get(key) || 0;
        this.messageCounts.set(key, count + 1);

        const metrics = this.metrics.get(key);
        if (metrics) {
            metrics.totalMessages++;
            metrics.lastActiveAt = new Date();
        }

        // Track in admin API
        adminApiService.trackMessage(botId, roomUrl, messageLength);
    }

    /**
     * Update active time
     */
    updateActiveTime(botId: string, roomUrl: string, deltaTime: number): void {
        const key = this.getKey(botId, roomUrl);
        const current = this.activeTime.get(key) || 0;
        this.activeTime.set(key, current + deltaTime);

        const metrics = this.metrics.get(key);
        if (metrics) {
            metrics.totalActiveTime = this.activeTime.get(key);
            metrics.lastActiveAt = new Date();
        }
    }

    /**
     * Get current metrics for a bot
     */
    getMetrics(botId: string, roomUrl: string): BotUsageMetrics | undefined {
        const key = this.getKey(botId, roomUrl);
        const metrics = this.metrics.get(key);
        
        if (metrics) {
            // Update active time if currently tracking
            const startTime = this.startTimes.get(key);
            if (startTime) {
                const activeTime = Date.now() - startTime.getTime();
                metrics.totalActiveTime = (this.activeTime.get(key) || 0) + activeTime;
            } else {
                metrics.totalActiveTime = this.activeTime.get(key) || 0;
            }
        }

        return metrics;
    }

    /**
     * Flush metrics to admin API
     */
    private async flushMetrics(botId: string, roomUrl: string): Promise<void> {
        const metrics = this.getMetrics(botId, roomUrl);
        if (metrics) {
            await adminApiService.trackBotUsage(metrics);
        }
    }

    /**
     * Flush all metrics periodically
     */
    startPeriodicFlush(intervalMs: number = 60000): void {
        setInterval(() => {
            for (const [key, metrics] of this.metrics.entries()) {
                // Update active time
                const startTime = this.startTimes.get(key);
                if (startTime) {
                    const activeTime = Date.now() - startTime.getTime();
                    metrics.totalActiveTime = (this.activeTime.get(key) || 0) + activeTime;
                } else {
                    metrics.totalActiveTime = this.activeTime.get(key) || 0;
                }

                // Flush to admin API
                adminApiService.trackBotUsage(metrics).catch((error) => {
                    console.error(`[BotUsageTracker] Error flushing metrics for ${key}:`, error);
                });
            }
        }, intervalMs);
    }

    private getKey(botId: string, roomUrl: string): string {
        return `${botId}:${roomUrl}`;
    }
}

// Singleton instance
export const botUsageTracker = new BotUsageTracker();

