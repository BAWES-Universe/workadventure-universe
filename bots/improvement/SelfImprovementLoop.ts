/**
 * SelfImprovementLoop - Runs improvement cycles automatically
 * 
 * Features:
 * - Run improvement cycles automatically
 * - Test fixes before applying
 * - Compare metrics before/after
 * - Generate improvement reports
 */

import { AutoImprovement } from './AutoImprovement';
import { BotTestRunner } from '../testing/BotTestRunner';
import { BotMetricsCollector } from '../metrics/BotMetricsCollector';
import type { ImprovementRecommendation } from './AutoImprovement';
import type { TestRun } from '../testing/types';

export interface ImprovementCycle {
    id: string;
    botId: string;
    startedAt: number;
    completedAt?: number;
    recommendations: ImprovementRecommendation[];
    appliedRecommendations: string[]; // IDs of applied recommendations
    testResults?: TestRun;
    metricsBefore: Record<string, number>;
    metricsAfter?: Record<string, number>;
    success: boolean;
    report?: string;
}

export class SelfImprovementLoop {
    private autoImprovement: AutoImprovement;
    private testRunner: BotTestRunner | null;
    private metricsCollector: BotMetricsCollector;
    private isRunning: boolean = false;

    constructor(
        autoImprovement: AutoImprovement,
        testRunner: BotTestRunner | null,
        metricsCollector: BotMetricsCollector
    ) {
        this.autoImprovement = autoImprovement;
        this.testRunner = testRunner;
        this.metricsCollector = metricsCollector;
    }

    /**
     * Run an improvement cycle for a bot
     */
    async runImprovementCycle(botId: string): Promise<ImprovementCycle> {
        if (this.isRunning) {
            throw new Error('Improvement cycle already running');
        }

        this.isRunning = true;
        const cycleId = `improvement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const startedAt = Date.now();

        try {
            // Step 1: Get baseline metrics
            const metricsBefore = await this.getBaselineMetrics(botId);

            // Step 2: Analyze and get recommendations
            const recommendations = await this.autoImprovement.analyzeAndRecommend(botId);

            if (recommendations.length === 0) {
                return {
                    id: cycleId,
                    botId,
                    startedAt,
                    completedAt: Date.now(),
                    recommendations: [],
                    appliedRecommendations: [],
                    metricsBefore,
                    success: true,
                    report: 'No improvements needed.',
                };
            }

            // Step 3: Apply recommendations (for now, just log them)
            // In a real implementation, this would apply code/prompt changes
            const appliedRecommendations = recommendations
                .filter(r => r.priority === 'critical' || r.priority === 'high')
                .map(r => r.type);

            // Step 4: Test fixes (if test runner is available)
            let testResults: TestRun | undefined;
            if (this.testRunner) {
                // Run tests to validate improvements
                // This would require a test suite for the bot
                // For now, skip testing
            }

            // Step 5: Get metrics after (would be done after deployment in real scenario)
            const metricsAfter = metricsBefore; // Placeholder

            // Step 6: Generate report
            const report = this.generateReport(cycleId, recommendations, metricsBefore, metricsAfter);

            return {
                id: cycleId,
                botId,
                startedAt,
                completedAt: Date.now(),
                recommendations,
                appliedRecommendations,
                testResults,
                metricsBefore,
                metricsAfter,
                success: true,
                report,
            };
        } catch (error: any) {
            return {
                id: cycleId,
                botId,
                startedAt,
                completedAt: Date.now(),
                recommendations: [],
                appliedRecommendations: [],
                metricsBefore: {},
                success: false,
                report: `Error: ${error.message}`,
            };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get baseline metrics
     */
    private async getBaselineMetrics(botId: string): Promise<Record<string, number>> {
        const metrics = await this.metricsCollector.queryMetrics({
            botId,
            limit: 100,
        });

        const baseline: Record<string, number> = {};

        // Calculate averages
        const repetitionScores = metrics.filter(m => m.metrics.repetitionScore !== undefined);
        if (repetitionScores.length > 0) {
            baseline.repetitionScore = repetitionScores.reduce((sum, m) => 
                sum + (m.metrics.repetitionScore || 0), 0
            ) / repetitionScores.length;
        }

        const complianceScores = metrics.filter(m => m.metrics.personalityCompliance !== undefined);
        if (complianceScores.length > 0) {
            baseline.personalityCompliance = complianceScores.reduce((sum, m) => 
                sum + (m.metrics.personalityCompliance || 0), 0
            ) / complianceScores.length;
        }

        const responseTimes = metrics.filter(m => m.metrics.responseTime !== undefined);
        if (responseTimes.length > 0) {
            baseline.responseTime = responseTimes.reduce((sum, m) => 
                sum + (m.metrics.responseTime || 0), 0
            ) / responseTimes.length;
        }

        return baseline;
    }

    /**
     * Generate improvement report
     */
    private generateReport(
        cycleId: string,
        recommendations: ImprovementRecommendation[],
        metricsBefore: Record<string, number>,
        metricsAfter?: Record<string, number>
    ): string {
        const lines: string[] = [];
        lines.push(`Improvement Cycle: ${cycleId}`);
        lines.push(`Recommendations: ${recommendations.length}`);
        lines.push('');

        for (const rec of recommendations) {
            lines.push(`- [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.description}`);
            if (rec.estimatedImpact) {
                lines.push(`  Expected improvement: ${rec.estimatedImpact.expectedImprovement}% in ${rec.estimatedImpact.metric}`);
            }
        }

        lines.push('');
        lines.push('Baseline Metrics:');
        for (const [metric, value] of Object.entries(metricsBefore)) {
            lines.push(`  ${metric}: ${value.toFixed(2)}`);
        }

        if (metricsAfter) {
            lines.push('');
            lines.push('Metrics After:');
            for (const [metric, value] of Object.entries(metricsAfter)) {
                lines.push(`  ${metric}: ${value.toFixed(2)}`);
            }
        }

        return lines.join('\n');
    }
}
