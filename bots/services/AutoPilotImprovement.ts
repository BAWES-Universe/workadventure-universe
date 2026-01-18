/**
 * AutoPilotImprovement - Fully autonomous continuous improvement system
 * 
 * This system:
 * 1. Automatically creates test scenarios based on bot behavior
 * 2. Runs tests continuously
 * 3. Detects failures and issues
 * 4. Generates improvements automatically
 * 5. Applies fixes and re-tests
 * 6. Iterates until perfect
 * 
 * Runs automatically in development mode - no manual intervention needed
 */

import type { BotManager } from '../server/BotManager';
import type { TestCase, TestRun } from '../testing/types';

export interface AutoPilotConfig {
    enabled: boolean;
    testIntervalMs: number; // How often to run tests (default: 5 minutes)
    improvementIntervalMs: number; // How often to check for improvements (default: 10 minutes)
    minMetricsBeforeTesting: number; // Minimum metrics before running tests
    autoApplyImprovements: boolean; // Auto-apply fixes (default: true in dev)
    maxIterationsPerBot: number; // Max improvement iterations per bot (default: 10)
}

export class AutoPilotImprovement {
    private botManager: BotManager;
    private config: AutoPilotConfig;
    private testInterval: NodeJS.Timeout | null = null;
    private improvementInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private botIterations: Map<string, number> = new Map(); // botId -> iteration count
    private lastTestRun: Map<string, number> = new Map(); // botId -> last test timestamp

    constructor(botManager: BotManager, config: Partial<AutoPilotConfig> = {}) {
        this.botManager = botManager;
        
        const isDevelopment = process.env.NODE_ENV === 'development';
        
        this.config = {
            enabled: config.enabled ?? isDevelopment,
            testIntervalMs: config.testIntervalMs ?? 5 * 60 * 1000, // 5 minutes
            improvementIntervalMs: config.improvementIntervalMs ?? 10 * 60 * 1000, // 10 minutes
            minMetricsBeforeTesting: config.minMetricsBeforeTesting ?? 20,
            autoApplyImprovements: config.autoApplyImprovements ?? isDevelopment,
            maxIterationsPerBot: config.maxIterationsPerBot ?? 10,
        };

        // Safety: Never enable in production
        if (process.env.NODE_ENV === 'production') {
            this.config.enabled = false;
        }
    }

    /**
     * Start the autopilot system
     */
    start(): void {
        if (!this.config.enabled) {
            console.log('[AutoPilot] Autopilot disabled');
            return;
        }

        if (this.testInterval || this.improvementInterval) {
            console.warn('[AutoPilot] Already running');
            return;
        }

        console.log('[AutoPilot] 🚀 Starting fully autonomous improvement system');
        console.log(`[AutoPilot] Test interval: ${this.config.testIntervalMs / 1000}s`);
        console.log(`[AutoPilot] Improvement interval: ${this.config.improvementIntervalMs / 1000}s`);
        console.log(`[AutoPilot] Auto-apply: ${this.config.autoApplyImprovements}`);

        // Run immediately
        this.runTestCycle().catch(error => {
            console.error('[AutoPilot] Error in initial test cycle:', error);
        });

        // Then run on intervals
        this.testInterval = setInterval(() => {
            this.runTestCycle().catch(error => {
                console.error('[AutoPilot] Error in test cycle:', error);
            });
        }, this.config.testIntervalMs);

        this.improvementInterval = setInterval(() => {
            this.runImprovementCycle().catch(error => {
                console.error('[AutoPilot] Error in improvement cycle:', error);
            });
        }, this.config.improvementIntervalMs);
    }

    /**
     * Stop the autopilot system
     */
    stop(): void {
        if (this.testInterval) {
            clearInterval(this.testInterval);
            this.testInterval = null;
        }
        if (this.improvementInterval) {
            clearInterval(this.improvementInterval);
            this.improvementInterval = null;
        }
        console.log('[AutoPilot] Stopped');
    }

    /**
     * Run test cycle - automatically test all bots
     */
    private async runTestCycle(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;

        try {
            const bots = this.botManager.getAllBots();
            if (bots.length === 0) {
                return;
            }

            console.log(`[AutoPilot] 🧪 Running test cycle for ${bots.length} bot(s)`);

            for (const bot of bots) {
                const botId = bot.getBotId();
                
                // Check if we have enough metrics
                const metricsCollector = this.botManager.getMetricsCollector();
                if (metricsCollector) {
                    const metrics = await metricsCollector.queryMetrics({
                        botId,
                        limit: this.config.minMetricsBeforeTesting,
                    });

                    if (metrics.length < this.config.minMetricsBeforeTesting) {
                        console.log(`[AutoPilot] Skipping bot ${botId.substring(0, 8)}... (need ${this.config.minMetricsBeforeTesting} metrics, have ${metrics.length})`);
                        continue;
                    }
                }

                // Generate test cases based on bot configuration and metrics
                const testCases = await this.generateTestCases(botId);
                
                if (testCases.length === 0) {
                    continue;
                }

                // Run tests
                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    continue;
                }

                const testRun = await testRunner.runTestSuite({
                    id: `autopilot-${Date.now()}`,
                    name: 'AutoPilot Test Suite',
                    botId,
                    testCases,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }, botId);

                this.lastTestRun.set(botId, Date.now());

                // Check results
                if (testRun.summary.failed > 0) {
                    console.log(`[AutoPilot] ❌ Bot ${botId.substring(0, 8)}... failed ${testRun.summary.failed}/${testRun.summary.total} tests`);
                    
                    // Trigger improvement cycle for this bot
                    this.improveBot(botId).catch(error => {
                        console.error(`[AutoPilot] Error improving bot ${botId}:`, error);
                    });
                } else {
                    console.log(`[AutoPilot] ✅ Bot ${botId.substring(0, 8)}... passed all ${testRun.summary.total} tests`);
                }
            }
        } catch (error: any) {
            console.error('[AutoPilot] Error in test cycle:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Run improvement cycle - check metrics and improve
     */
    private async runImprovementCycle(): Promise<void> {
        const bots = this.botManager.getAllBots();
        if (bots.length === 0) {
            return;
        }

        console.log(`[AutoPilot] 🔍 Running improvement cycle for ${bots.length} bot(s)`);

        for (const bot of bots) {
            const botId = bot.getBotId();
            
            // Check iteration limit
            const iterations = this.botIterations.get(botId) || 0;
            if (iterations >= this.config.maxIterationsPerBot) {
                console.log(`[AutoPilot] Bot ${botId.substring(0, 8)}... reached max iterations (${iterations})`);
                continue;
            }

            await this.improveBot(botId);
        }
    }

    /**
     * Improve a specific bot
     */
    private async improveBot(botId: string): Promise<void> {
        const autoImprovement = this.botManager.getAutoImprovement();
        if (!autoImprovement) {
            return;
        }

        try {
            const recommendations = await autoImprovement.analyzeAndRecommend(botId);
            
            if (recommendations.length === 0) {
                return;
            }

            console.log(`[AutoPilot] 🔧 Bot ${botId.substring(0, 8)}... has ${recommendations.length} improvement(s)`);

            // Filter to high-priority recommendations
            const highPriority = recommendations.filter(r => 
                r.priority === 'critical' || r.priority === 'high'
            );

            if (highPriority.length === 0) {
                return;
            }

            if (this.config.autoApplyImprovements) {
                const improvementLoop = this.botManager.getSelfImprovementLoop();
                if (improvementLoop) {
                    console.log(`[AutoPilot] 🚀 Auto-applying improvements for bot ${botId.substring(0, 8)}...`);
                    const cycle = await improvementLoop.runImprovementCycle(botId);
                    
                    if (cycle.success) {
                        const iterations = (this.botIterations.get(botId) || 0) + 1;
                        this.botIterations.set(botId, iterations);
                        console.log(`[AutoPilot] ✅ Improvement applied (iteration ${iterations})`);
                    }
                }
            } else {
                console.log(`[AutoPilot] 📋 Recommendations (auto-apply disabled):`);
                for (const rec of highPriority) {
                    console.log(`[AutoPilot]   - [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.description}`);
                }
            }
        } catch (error: any) {
            console.error(`[AutoPilot] Error improving bot ${botId}:`, error);
        }
    }

    /**
     * Generate test cases automatically based on bot configuration and metrics
     */
    private async generateTestCases(botId: string): Promise<TestCase[]> {
        const testCases: TestCase[] = [];
        const bot = this.botManager.getBot(botId);
        
        if (!bot) {
            return testCases;
        }

        const config = bot.getFullConfig();
        if (!config) {
            return testCases;
        }

        const chatInstructions = config.chatInstructions || 'You are a helpful bot.';

        // Test 1: Basic greeting (always test)
        testCases.push({
            id: `autopilot-greeting-${Date.now()}`,
            name: 'Bot should respond to greeting',
            botId,
            chatInstructions,
            input: 'Hello',
            expectedBehavior: {
                shouldContain: ['hello', 'hi', 'hey', 'greeting'],
                maxResponseTime: 5000,
                personalityCompliance: true,
            },
        });

        // Test 2: Personality compliance (if personality is specified)
        if (chatInstructions.toLowerCase().includes('mean') || 
            chatInstructions.toLowerCase().includes('angry') ||
            chatInstructions.toLowerCase().includes('frustrated')) {
            testCases.push({
                id: `autopilot-personality-mean-${Date.now()}`,
                name: 'Mean bot should be mean',
                botId,
                chatInstructions,
                input: 'Hello',
                expectedBehavior: {
                    shouldNotContain: ['happy to help', 'glad to assist', 'sorry'],
                    personalityCompliance: true,
                },
            });
        } else if (chatInstructions.toLowerCase().includes('friendly') ||
                   chatInstructions.toLowerCase().includes('helpful')) {
            testCases.push({
                id: `autopilot-personality-friendly-${Date.now()}`,
                name: 'Friendly bot should be friendly',
                botId,
                chatInstructions,
                input: 'Hello',
                expectedBehavior: {
                    shouldContain: ['hello', 'hi', 'help'],
                    personalityCompliance: true,
                },
            });
        }

        // Test 3: Check for repetition (based on metrics)
        const metricsCollector = this.botManager.getMetricsCollector();
        if (metricsCollector) {
            const metrics = await metricsCollector.queryMetrics({
                botId,
                limit: 10,
            });

            const avgRepetition = metrics
                .filter(m => m.metrics.repetitionScore !== undefined)
                .reduce((sum, m) => sum + (m.metrics.repetitionScore || 0), 0) / 
                Math.max(metrics.filter(m => m.metrics.repetitionScore !== undefined).length, 1);

            if (avgRepetition > 0.2) {
                testCases.push({
                    id: `autopilot-repetition-${Date.now()}`,
                    name: 'Bot should not repeat responses',
                    botId,
                    chatInstructions,
                    input: 'Hello',
                    expectedBehavior: {
                        maxRepetitionScore: 0.2,
                    },
                });
            }
        }

        return testCases;
    }
}
