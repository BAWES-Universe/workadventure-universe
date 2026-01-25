/**
 * BotMetricsCollector - Collects and stores bot performance metrics
 * 
 * Tracks:
 * - Response time
 * - Token usage (prompt, completion, total)
 * - Repetition score
 * - System prompt leakage
 * - Personality compliance score
 * - Conversation quality metrics
 */

import type { BotMetrics, MetricType, MetricQuery, MetricAggregation, ResponseQualityMetrics } from './types';
import { AdminApiService } from '../server/AdminApiService';

export class BotMetricsCollector {
    private adminApiService: AdminApiService;
    private metricsBuffer: BotMetrics[] = [];
    private bufferSize: number = 100;
    private flushInterval: number = 30000; // 30 seconds
    private flushTimer: NodeJS.Timeout | null = null;
    private isFlushing: boolean = false;
    private readonly enabled: boolean;

    constructor(adminApiService: AdminApiService, bufferSize: number = 100, flushInterval: number = 30000) {
        this.adminApiService = adminApiService;
        this.bufferSize = bufferSize;
        this.flushInterval = flushInterval;
        
        // Only enable detailed metrics collection in development
        // Production uses BotsAiUsage table for cost/usage tracking instead
        // Set ENABLE_BOT_METRICS=true to force in production if needed
        const isDevelopment = process.env.NODE_ENV === 'development';
        const metricsEnabled = process.env.ENABLE_BOT_METRICS === 'true';
        this.enabled = isDevelopment || metricsEnabled;
        
        if (this.enabled) {
            this.startFlushTimer();
        }
    }

    /**
     * Check if metrics collection is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Record a metric (non-blocking)
     * No-op in production unless ENABLE_BOT_METRICS=true
     */
    recordMetric(metric: BotMetrics): void {
        if (!this.enabled) return;
        
        this.metricsBuffer.push(metric);

        // Flush if buffer is full
        if (this.metricsBuffer.length >= this.bufferSize) {
            this.flushMetrics().catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[BotMetricsCollector] Error flushing metrics:', error);
                }
            });
        }
    }

    /**
     * Record response time
     */
    recordResponseTime(botId: string, responseTime: number, metadata?: Record<string, any>): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                responseTime,
            },
            metadata,
        });
    }

    /**
     * Record token usage
     */
    recordTokenUsage(
        botId: string,
        promptTokens: number,
        completionTokens: number,
        metadata?: Record<string, any>
    ): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                tokenUsage: {
                    prompt: promptTokens,
                    completion: completionTokens,
                    total: promptTokens + completionTokens,
                },
            },
            metadata,
        });
    }

    /**
     * Record repetition score (0-1, where 0 = no repetition, 1 = exact duplicate)
     */
    recordRepetitionScore(botId: string, score: number, metadata?: Record<string, any>): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                repetitionScore: Math.max(0, Math.min(1, score)), // Clamp to 0-1
            },
            metadata,
        });
    }

    /**
     * Record system prompt leakage detection
     */
    recordSystemPromptLeakage(botId: string, hasLeakage: boolean, metadata?: Record<string, any>): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                systemPromptLeakage: hasLeakage,
            },
            metadata,
        });
    }

    /**
     * Record personality compliance score (0-1, where 1 = perfect match with chat instructions)
     */
    recordPersonalityCompliance(botId: string, score: number, metadata?: Record<string, any>): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                personalityCompliance: Math.max(0, Math.min(1, score)), // Clamp to 0-1
            },
            metadata,
        });
    }

    /**
     * Record conversation quality score (0-1)
     */
    recordConversationQuality(botId: string, score: number, metadata?: Record<string, any>): void {
        this.recordMetric({
            botId,
            timestamp: Date.now(),
            metrics: {
                conversationQuality: Math.max(0, Math.min(1, score)), // Clamp to 0-1
            },
            metadata,
        });
    }

    /**
     * Record a complete response quality metric
     * Note: tokenUsage in ResponseQualityMetrics is a NUMBER (total), not an object
     */
    recordResponseQuality(quality: ResponseQualityMetrics): void {
        // Build metrics object - include ALL fields even if 0 to ensure Admin API receives them
        const metricsObj: any = {};
        
        // Always include responseTime (even if 0)
        metricsObj.responseTime = quality.metrics.responseTime ?? 0;
        
        // tokenUsage in ResponseQualityMetrics is a number (total), convert to object format
        if (quality.metrics.tokenUsage !== undefined && quality.metrics.tokenUsage > 0) {
            metricsObj.tokenUsage = {
                prompt: 0, // We don't have breakdown, only total from ResponseProcessor
                completion: 0,
                total: quality.metrics.tokenUsage,
            };
        }
        
        // Always include repetitionScore (even if 0)
        metricsObj.repetitionScore = quality.metrics.repetitionScore ?? 0;
        
        // Always include systemPromptLeakage (even if false)
        metricsObj.systemPromptLeakage = quality.metrics.systemPromptLeakage ?? false;
        
        // Always include personalityCompliance (even if 0)
        metricsObj.personalityCompliance = quality.metrics.personalityCompliance ?? 0;
        
        // Always include conversationQuality (even if 0)
        metricsObj.conversationQuality = quality.metrics.overallQuality ?? 0;
        
        this.recordMetric({
            botId: quality.botId,
            timestamp: quality.timestamp,
            metrics: metricsObj,
            metadata: {
                playerId: quality.playerId,
                responseId: quality.responseId,
            },
        });
    }

    /**
     * Get current metrics for a bot (from buffer, not persisted)
     */
    getCurrentMetrics(botId: string): BotMetrics[] {
        return this.metricsBuffer.filter(m => m.botId === botId);
    }

    /**
     * Query metrics (delegates to Admin API)
     */
    async queryMetrics(query: MetricQuery): Promise<BotMetrics[]> {
        try {
            // This will be implemented when Admin API endpoints are ready
            // For now, return empty array
            return [];
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[BotMetricsCollector] Error querying metrics:', error);
            }
            return [];
        }
    }

    /**
     * Get metric aggregations (delegates to Admin API)
     */
    async getAggregations(
        botId: string,
        metricType: MetricType,
        startTime: number,
        endTime: number
    ): Promise<MetricAggregation | null> {
        try {
            // This will be implemented when Admin API endpoints are ready
            // For now, return null
            return null;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[BotMetricsCollector] Error getting aggregations:', error);
            }
            return null;
        }
    }

    /**
     * Flush metrics buffer to Admin API (non-blocking)
     * Only called in development (or if ENABLE_BOT_METRICS=true)
     */
    private async flushMetrics(): Promise<void> {
        if (this.isFlushing || this.metricsBuffer.length === 0) {
            return;
        }

        this.isFlushing = true;
        const metricsToFlush = this.metricsBuffer.splice(0, this.bufferSize);

        if (metricsToFlush.length === 0) {
            this.isFlushing = false;
            return;
        }

        try {
            // Send to Admin API (all metrics - tests only run in dev anyway)
            await this.adminApiService.saveBotMetrics(metricsToFlush);
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[BotMetricsCollector] Flushed ${metricsToFlush.length} metrics`);
            }
        } catch (error) {
            // Put metrics back in buffer if flush failed
            this.metricsBuffer.unshift(...metricsToFlush);
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[BotMetricsCollector] Error flushing metrics, re-queued:', error);
            }
        } finally {
            this.isFlushing = false;
        }
    }

    /**
     * Start periodic flush timer
     */
    private startFlushTimer(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }

        this.flushTimer = setInterval(() => {
            this.flushMetrics().catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[BotMetricsCollector] Error in periodic flush:', error);
                }
            });
        }, this.flushInterval);
    }

    /**
     * Stop the collector and flush remaining metrics
     */
    async shutdown(): Promise<void> {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }

        // Flush remaining metrics
        await this.flushMetrics();
    }
}
