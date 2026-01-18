/**
 * ImprovementScheduler - Automatically runs improvement cycles for bots
 * 
 * This service runs in the background and continuously improves bots by:
 * 1. Monitoring metrics
 * 2. Running improvement cycles when issues are detected
 * 3. Logging results for review
 */

import type { BotManager } from '../server/BotManager';

export interface SchedulerConfig {
    enabled: boolean;
    intervalMs: number; // How often to check (default: 1 hour)
    minMetricsBeforeImprovement: number; // Minimum metrics needed before improving
    autoApply: boolean; // Whether to auto-apply improvements (default: false in production)
}

export class ImprovementScheduler {
    private botManager: BotManager;
    private config: SchedulerConfig;
    private interval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastRun: Map<string, number> = new Map(); // botId -> last run timestamp

    constructor(botManager: BotManager, config: Partial<SchedulerConfig> = {}) {
        this.botManager = botManager;
        
        // STRICT: Only enable in development mode
        const isDevelopment = process.env.NODE_ENV === 'development';
        
        this.config = {
            enabled: config.enabled ?? isDevelopment,
            intervalMs: config.intervalMs ?? 60 * 60 * 1000, // 1 hour
            minMetricsBeforeImprovement: config.minMetricsBeforeImprovement ?? 50,
            autoApply: config.autoApply ?? isDevelopment, // Only auto-apply in dev
        };
        
        // Safety check: Never enable in production
        if (process.env.NODE_ENV === 'production' && this.config.enabled) {
            console.warn('[ImprovementScheduler] WARNING: Scheduler disabled in production for performance');
            this.config.enabled = false;
        }
    }

    /**
     * Start the scheduler
     */
    start(): void {
        if (!this.config.enabled) {
            console.log('[ImprovementScheduler] Scheduler disabled');
            return;
        }

        if (this.interval) {
            console.warn('[ImprovementScheduler] Scheduler already running');
            return;
        }

        console.log(`[ImprovementScheduler] Starting scheduler (interval: ${this.config.intervalMs}ms, autoApply: ${this.config.autoApply})`);

        // Run immediately on start
        this.runCycle().catch(error => {
            console.error('[ImprovementScheduler] Error in initial cycle:', error);
        });

        // Then run on interval
        this.interval = setInterval(() => {
            this.runCycle().catch(error => {
                console.error('[ImprovementScheduler] Error in scheduled cycle:', error);
            });
        }, this.config.intervalMs);
    }

    /**
     * Stop the scheduler
     */
    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            console.log('[ImprovementScheduler] Scheduler stopped');
        }
    }

    /**
     * Run improvement cycle for all active bots
     */
    private async runCycle(): Promise<void> {
        if (this.isRunning) {
            console.log('[ImprovementScheduler] Cycle already running, skipping');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        try {
            // Get all active bots
            const bots = this.botManager.getAllBots();
            
            if (bots.length === 0) {
                console.log('[ImprovementScheduler] No active bots to improve');
                return;
            }

            console.log(`[ImprovementScheduler] Running improvement cycle for ${bots.length} bot(s)`);

            for (const bot of bots) {
                const botId = bot.getBotId();
                
                // Check if we should skip (too soon since last run)
                const lastRunTime = this.lastRun.get(botId) || 0;
                const timeSinceLastRun = Date.now() - lastRunTime;
                if (timeSinceLastRun < this.config.intervalMs) {
                    console.log(`[ImprovementScheduler] Skipping bot ${botId} (last run ${Math.round(timeSinceLastRun / 1000)}s ago)`);
                    continue;
                }

                try {
                    // Get recommendations first
                    const autoImprovement = this.botManager.getAutoImprovement();
                    if (!autoImprovement) {
                        console.log(`[ImprovementScheduler] Auto-improvement not available for bot ${botId}`);
                        continue;
                    }

                    const recommendations = await autoImprovement.analyzeAndRecommend(botId);
                    
                    if (recommendations.length === 0) {
                        console.log(`[ImprovementScheduler] No improvements needed for bot ${botId}`);
                        this.lastRun.set(botId, Date.now());
                        continue;
                    }

                    console.log(`[ImprovementScheduler] Found ${recommendations.length} recommendations for bot ${botId}`);
                    
                    // Log recommendations
                    for (const rec of recommendations) {
                        console.log(`[ImprovementScheduler]   - [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.description}`);
                    }

                    // Run improvement cycle if auto-apply is enabled
                    if (this.config.autoApply) {
                        const improvementLoop = this.botManager.getSelfImprovementLoop();
                        if (improvementLoop) {
                            console.log(`[ImprovementScheduler] Running improvement cycle for bot ${botId}...`);
                            const cycle = await improvementLoop.runImprovementCycle(botId);
                            
                            if (cycle.success) {
                                console.log(`[ImprovementScheduler] ✅ Improvement cycle completed for bot ${botId}`);
                                console.log(`[ImprovementScheduler] Report: ${cycle.report?.substring(0, 200)}...`);
                            } else {
                                console.warn(`[ImprovementScheduler] ⚠️ Improvement cycle failed for bot ${botId}: ${cycle.report}`);
                            }
                        }
                    } else {
                        console.log(`[ImprovementScheduler] Auto-apply disabled. Recommendations logged above.`);
                    }

                    this.lastRun.set(botId, Date.now());
                } catch (error: any) {
                    console.error(`[ImprovementScheduler] Error improving bot ${botId}:`, error);
                }
            }

            const duration = Date.now() - startTime;
            console.log(`[ImprovementScheduler] Cycle completed in ${duration}ms`);
        } catch (error: any) {
            console.error('[ImprovementScheduler] Error in improvement cycle:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Manually trigger improvement for a specific bot
     */
    async improveBot(botId: string): Promise<void> {
        const autoImprovement = this.botManager.getAutoImprovement();
        if (!autoImprovement) {
            throw new Error('Auto-improvement not available');
        }

        const recommendations = await autoImprovement.analyzeAndRecommend(botId);
        console.log(`[ImprovementScheduler] Found ${recommendations.length} recommendations for bot ${botId}`);

        if (recommendations.length > 0) {
            const improvementLoop = this.botManager.getSelfImprovementLoop();
            if (improvementLoop) {
                const cycle = await improvementLoop.runImprovementCycle(botId);
                console.log(`[ImprovementScheduler] Improvement cycle result:`, cycle);
            }
        }
    }
}
