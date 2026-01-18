/**
 * AutoPilotImprovement - Fully autonomous continuous improvement system
 * 
 * This system:
 * 1. Automatically creates test scenarios based on bot behavior
 * 2. Runs tests continuously (every 30 seconds)
 * 3. Detects failures and issues immediately
 * 4. Creates improvement task files for AI analysis
 * 5. Triggers immediate re-test after improvements
 * 6. Iterates until perfect
 * 
 * The AI (Auto) analyzes task files and improves code/system prompts.
 * This system just runs tests and creates tasks - the AI does the improving.
 */

import type { BotManager } from '../server/BotManager';
import type { TestCase, TestRun } from '../testing/types';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AutoPilotConfig {
    enabled: boolean;
    testIntervalMs: number; // How often to run tests (default: 30 seconds for fast iteration)
    improvementIntervalMs: number; // How often to check for improvements (default: 1 minute)
    minMetricsBeforeTesting: number; // Minimum metrics before running tests
    autoApplyImprovements: boolean; // Auto-apply fixes (default: true in dev)
    maxIterationsPerBot: number; // Max improvement iterations per bot (default: 50 for fast iteration)
    tasksDirectory: string; // Directory to write improvement task files
}

export interface ImprovementTask {
    id: string;
    botId: string;
    timestamp: number;
    testResults: TestRun;
    metrics: {
        repetitionScore?: number;
        personalityCompliance?: number;
        systemPromptLeakage?: number;
        responseTime?: number;
        conversationQuality?: number;
    };
    failedTests: Array<{
        testCaseId: string;
        name: string;
        input: string;
        expectedBehavior?: any;
        actualResponse?: string;
        errors?: string[];
    }>;
    recommendations: Array<{
        type: string;
        priority: string;
        description: string;
        suggestedChanges: any;
    }>;
    priority: 'low' | 'medium' | 'high' | 'critical';
    botConfig?: {
        chatInstructions?: string;
        behaviorType?: string;
    };
}

export class AutoPilotImprovement {
    private botManager: BotManager;
    private config: AutoPilotConfig;
    private testInterval: NodeJS.Timeout | null = null;
    private improvementInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private botIterations: Map<string, number> = new Map(); // botId -> iteration count
    private lastTestRun: Map<string, number> = new Map(); // botId -> last test timestamp
    private tasksDirectory: string;

    constructor(botManager: BotManager, config: Partial<AutoPilotConfig> = {}) {
        this.botManager = botManager;
        
        const isDevelopment = process.env.NODE_ENV === 'development';
        
        // Fix path - process.cwd() is /usr/src/app/bots in docker
        // We want: /usr/src/app/bots/improvement-tasks
        // But if path already has /bots/bots/, normalize it
        let tasksDir = config.tasksDirectory || 
            process.env.IMPROVEMENT_TASKS_DIR || 
            path.join(process.cwd(), 'improvement-tasks');
        
        // Normalize: remove double "bots" if present
        this.tasksDirectory = tasksDir.replace(/\/bots\/bots\//g, '/bots/');
        
        this.config = {
            enabled: config.enabled ?? isDevelopment,
            testIntervalMs: config.testIntervalMs ?? 30000, // 30 seconds for fast iteration
            improvementIntervalMs: config.improvementIntervalMs ?? 60000, // 1 minute
            minMetricsBeforeTesting: config.minMetricsBeforeTesting ?? 0, // Run tests immediately, don't wait for metrics
            autoApplyImprovements: config.autoApplyImprovements ?? isDevelopment,
            maxIterationsPerBot: config.maxIterationsPerBot ?? 50, // Higher limit for continuous iteration
            tasksDirectory: this.tasksDirectory,
        };

        // Safety: Never enable in production
        if (process.env.NODE_ENV === 'production') {
            this.config.enabled = false;
        }

        // Ensure tasks directory exists
        this.ensureTasksDirectory().catch(error => {
            console.error('[AutoPilot] Failed to create tasks directory:', error);
        });
    }

    /**
     * Ensure tasks directory exists
     */
    private async ensureTasksDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.tasksDirectory, { recursive: true });
        } catch (error: any) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
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
        console.log(`[AutoPilot] Test interval: ${this.config.testIntervalMs / 1000}s (FAST ITERATION)`);
        console.log(`[AutoPilot] Improvement interval: ${this.config.improvementIntervalMs / 1000}s`);
        console.log(`[AutoPilot] Tasks directory: ${this.tasksDirectory}`);
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
     * Run test cycle - automatically test all bots (runs every 30 seconds)
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
                
                // Get metrics (if available) - but don't skip if we don't have any
                const metricsCollector = this.botManager.getMetricsCollector();
                let metrics: any[] = [];
                if (metricsCollector) {
                    metrics = await metricsCollector.queryMetrics({
                        botId,
                        limit: 50,
                    });
                }

                // Always run tests - don't wait for metrics
                // Generate test cases based on bot configuration
                const testCases = await this.generateTestCases(botId);
                
                if (testCases.length === 0) {
                    console.log(`[AutoPilot] No test cases generated for bot ${botId.substring(0, 8)}...`);
                    continue;
                }

                // Run tests
                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    console.log(`[AutoPilot] Test runner not available for bot ${botId.substring(0, 8)}...`);
                    continue;
                }

                console.log(`[AutoPilot] 🧪 Running ${testCases.length} test(s) for bot ${botId.substring(0, 8)}...`);

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
                    
                    // Create improvement task file for AI to analyze
                    await this.createImprovementTask(botId, testRun, metrics);
                    
                    // Also trigger improvement cycle
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
     * Run improvement cycle - check metrics and create tasks
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
     * Improve a specific bot - creates task file for AI analysis
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

            // Get metrics for task file
            const metricsCollector = this.botManager.getMetricsCollector();
            const metrics = await metricsCollector.queryMetrics({
                botId,
                limit: 50,
            });

            // Calculate average metrics
            const avgMetrics = {
                repetitionScore: metrics.filter(m => m.metrics.repetitionScore !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.repetitionScore || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.repetitionScore !== undefined).length, 1),
                personalityCompliance: metrics.filter(m => m.metrics.personalityCompliance !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.personalityCompliance || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.personalityCompliance !== undefined).length, 1),
                systemPromptLeakage: metrics.filter(m => m.metrics.systemPromptLeakage === true).length / 
                    Math.max(metrics.length, 1),
                responseTime: metrics.filter(m => m.metrics.responseTime !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.responseTime || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.responseTime !== undefined).length, 1),
            };

            // Create improvement task file
            await this.createImprovementTaskFromMetrics(botId, avgMetrics, highPriority);

            if (this.config.autoApplyImprovements) {
                // Note: Auto-apply would happen here if we had code modification capability
                // For now, we just create task files for AI to analyze
                console.log(`[AutoPilot] 📝 Improvement task created - AI will analyze and improve code`);
            } else {
                console.log(`[AutoPilot] 📋 Recommendations logged in task file`);
            }
        } catch (error: any) {
            console.error(`[AutoPilot] Error improving bot ${botId}:`, error);
        }
    }

    /**
     * Create improvement task file from test results
     */
    private async createImprovementTask(
        botId: string,
        testRun: TestRun,
        metrics: any[]
    ): Promise<void> {
        try {
            await this.ensureTasksDirectory();

            // Get recommendations
            const autoImprovement = this.botManager.getAutoImprovement();
            const recommendations = autoImprovement ? 
                await autoImprovement.analyzeAndRecommend(botId) : [];

            // Get bot config
            const bot = this.botManager.getBot(botId);
            const botConfig = bot?.getFullConfig();

            // Calculate average metrics
            const avgMetrics = {
                repetitionScore: metrics.filter(m => m.metrics.repetitionScore !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.repetitionScore || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.repetitionScore !== undefined).length, 1),
                personalityCompliance: metrics.filter(m => m.metrics.personalityCompliance !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.personalityCompliance || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.personalityCompliance !== undefined).length, 1),
                systemPromptLeakage: metrics.filter(m => m.metrics.systemPromptLeakage === true).length / 
                    Math.max(metrics.length, 1),
                responseTime: metrics.filter(m => m.metrics.responseTime !== undefined)
                    .reduce((sum, m) => sum + (m.metrics.responseTime || 0), 0) / 
                    Math.max(metrics.filter(m => m.metrics.responseTime !== undefined).length, 1),
            };

            const task: ImprovementTask = {
                id: `task-${Date.now()}-${botId.substring(0, 8)}`,
                botId,
                timestamp: Date.now(),
                testResults: testRun,
                metrics: avgMetrics,
                failedTests: testRun.results
                    .filter(r => !r.passed)
                    .map(r => ({
                        testCaseId: r.testCaseId,
                        name: testRun.results.find(tr => tr.testCaseId === r.testCaseId)?.testCaseId || 'unknown',
                        input: testRun.results.find(tr => tr.testCaseId === r.testCaseId)?.response || 'unknown',
                        expectedBehavior: undefined, // Would need to get from test case
                        actualResponse: r.response,
                        errors: r.errors,
                    })),
                recommendations,
                priority: testRun.summary.failed > 0 ? 'high' : 'medium',
                botConfig: botConfig ? {
                    chatInstructions: botConfig.chatInstructions,
                    behaviorType: botConfig.behaviorType,
                } : undefined,
            };

            const taskFile = path.join(this.tasksDirectory, `${task.id}.json`);
            await fs.writeFile(taskFile, JSON.stringify(task, null, 2), 'utf-8');
            
            console.log(`[AutoPilot] 📝 Created improvement task: ${taskFile}`);
            console.log(`[AutoPilot]    Failed tests: ${task.failedTests.length}`);
            console.log(`[AutoPilot]    Recommendations: ${recommendations.length}`);
        } catch (error: any) {
            console.error(`[AutoPilot] Error creating improvement task:`, error);
        }
    }

    /**
     * Create improvement task file from metrics (when no test failures, but metrics show issues)
     */
    private async createImprovementTaskFromMetrics(
        botId: string,
        metrics: any,
        recommendations: any[]
    ): Promise<void> {
        try {
            await this.ensureTasksDirectory();

            // Get bot config
            const bot = this.botManager.getBot(botId);
            const botConfig = bot?.getFullConfig();

            const task: ImprovementTask = {
                id: `task-${Date.now()}-${botId.substring(0, 8)}`,
                botId,
                timestamp: Date.now(),
                testResults: {
                    id: 'metrics-based',
                    testSuiteId: 'metrics',
                    botId,
                    status: 'passed',
                    results: [],
                    startedAt: Date.now(),
                    completedAt: Date.now(),
                    duration: 0,
                    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
                },
                metrics,
                failedTests: [],
                recommendations,
                priority: recommendations.some(r => r.priority === 'critical') ? 'critical' :
                         recommendations.some(r => r.priority === 'high') ? 'high' : 'medium',
                botConfig: botConfig ? {
                    chatInstructions: botConfig.chatInstructions,
                    behaviorType: botConfig.behaviorType,
                } : undefined,
            };

            const taskFile = path.join(this.tasksDirectory, `${task.id}.json`);
            await fs.writeFile(taskFile, JSON.stringify(task, null, 2), 'utf-8');
            
            console.log(`[AutoPilot] 📝 Created improvement task from metrics: ${taskFile}`);
        } catch (error: any) {
            console.error(`[AutoPilot] Error creating improvement task from metrics:`, error);
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

    /**
     * Get all pending improvement tasks
     */
    async getPendingTasks(): Promise<ImprovementTask[]> {
        try {
            await this.ensureTasksDirectory();
            const files = await fs.readdir(this.tasksDirectory);
            const taskFiles = files.filter(f => f.endsWith('.json'));
            
            const tasks: ImprovementTask[] = [];
            for (const file of taskFiles) {
                try {
                    const content = await fs.readFile(path.join(this.tasksDirectory, file), 'utf-8');
                    const task = JSON.parse(content) as ImprovementTask;
                    tasks.push(task);
                } catch (error) {
                    console.error(`[AutoPilot] Error reading task file ${file}:`, error);
                }
            }
            
            return tasks.sort((a, b) => {
                const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                return priorityOrder[b.priority] - priorityOrder[a.priority];
            });
        } catch (error) {
            console.error('[AutoPilot] Error getting pending tasks:', error);
            return [];
        }
    }

    /**
     * Mark task as resolved (delete task file)
     */
    async resolveTask(taskId: string): Promise<void> {
        try {
            const taskFile = path.join(this.tasksDirectory, `${taskId}.json`);
            await fs.unlink(taskFile);
            console.log(`[AutoPilot] ✅ Resolved task: ${taskId}`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error(`[AutoPilot] Error resolving task ${taskId}:`, error);
            }
        }
    }
}
