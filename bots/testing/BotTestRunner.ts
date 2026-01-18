/**
 * BotTestRunner - Runs test suites programmatically
 * 
 * Supports:
 * - Running test suites
 * - Conversation replay testing
 * - Comparing responses between versions
 * - Generating test reports
 */

import type { TestCase, TestResult, TestSuite, TestRun, RegressionTest, TestStatus } from './types';
import { AIService } from '../ai/AIService';
import { ConversationMemory } from '../memory/ConversationMemory';
import { AdminApiService } from '../server/AdminApiService';
import { BotMetricsCollector } from '../metrics/BotMetricsCollector';

export class BotTestRunner {
    private aiService: AIService;
    private conversationMemory: ConversationMemory;
    private adminApiService: AdminApiService;
    private metricsCollector: BotMetricsCollector;

    constructor(
        aiService: AIService,
        conversationMemory: ConversationMemory,
        adminApiService: AdminApiService,
        metricsCollector: BotMetricsCollector
    ) {
        this.aiService = aiService;
        this.conversationMemory = conversationMemory;
        this.adminApiService = adminApiService;
        this.metricsCollector = metricsCollector;
    }

    /**
     * Run a test suite
     */
    async runTestSuite(testSuite: TestSuite, botId: string): Promise<TestRun> {
        const testRunId = `test-run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const startedAt = Date.now();
        const results: TestResult[] = [];

        console.log(`[BotTestRunner] Starting test suite "${testSuite.name}" (${testSuite.testCases.length} tests)`);

        for (const testCase of testSuite.testCases) {
            try {
                const result = await this.runTestCase(testCase, botId);
                results.push(result);
            } catch (error: any) {
                results.push({
                    testCaseId: testCase.id,
                    status: 'failed',
                    passed: false,
                    errors: [error.message || 'Unknown error'],
                    timestamp: Date.now(),
                });
            }
        }

        const completedAt = Date.now();
        const duration = completedAt - startedAt;

        const summary = {
            total: results.length,
            passed: results.filter(r => r.passed).length,
            failed: results.filter(r => !r.passed).length,
            skipped: results.filter(r => r.status === 'skipped').length,
        };

        const testRun: TestRun = {
            id: testRunId,
            testSuiteId: testSuite.id,
            botId,
            status: summary.failed === 0 ? 'passed' : 'failed',
            results,
            startedAt,
            completedAt,
            duration,
            summary,
        };

        console.log(`[BotTestRunner] Test suite "${testSuite.name}" completed: ${summary.passed}/${summary.total} passed`);

        return testRun;
    }

    /**
     * Run a single test case
     */
    async runTestCase(testCase: TestCase, botId: string): Promise<TestResult> {
        const startTime = Date.now();
        let response = '';
        let toolsCalled: string[] = [];
        const errors: string[] = [];

        try {
            // Get bot configuration
            const botConfig = await this.adminApiService.getBotConfiguration(botId);
            if (!botConfig) {
                throw new Error(`Bot ${botId} not found`);
            }

            // Use test case chat instructions if provided, otherwise use bot config
            const chatInstructions = testCase.chatInstructions || botConfig.chatInstructions || 'You are a helpful bot.';

            // Clear conversation memory for this test
            // (In a real scenario, we might want to preserve some context)
            const testPlayerId = 999999; // Use a test player ID
            this.conversationMemory.clearMemory(botId, testPlayerId);

            // Generate response
            const context = this.conversationMemory.getConversationContext(botId, testPlayerId);
            
            // Track tools called (we'll need to modify AIService to expose this)
            // For now, we'll check the response for tool markers
            let fullMessage = '';
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                testPlayerId,
                testCase.input,
                chatInstructions,
                botConfig.aiProviderRef || '',
                undefined, // spaceName
                context
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                if (chunk.done) {
                    break;
                }
            }

            response = fullMessage;
            const responseTime = Date.now() - startTime;

            // Extract tools called from response (if tool markers are present)
            // This is a simplified check - in reality, AIService should expose tools called
            if (response.includes('[END_TOOL_REQUEST]')) {
                const toolMatches = response.match(/\[get_\w+\]/g);
                if (toolMatches) {
                    toolsCalled = toolMatches.map(m => m.replace(/[\[\]]/g, ''));
                }
            }

            // Validate response against expected behavior
            const validationErrors = this.validateResponse(testCase, response, toolsCalled, responseTime);
            errors.push(...validationErrors);

            // Calculate metrics
            const metrics = {
                repetitionScore: 0, // Would be calculated by RepetitionDetector
                systemPromptLeakage: this.detectSystemPromptLeakage(response),
                personalityCompliance: 0, // Would be calculated by PersonalityComplianceValidator
            };

            const passed = errors.length === 0;

            return {
                testCaseId: testCase.id,
                status: passed ? 'passed' : 'failed',
                passed,
                response,
                responseTime,
                toolsCalled,
                errors: errors.length > 0 ? errors : undefined,
                metrics,
                timestamp: Date.now(),
            };
        } catch (error: any) {
            return {
                testCaseId: testCase.id,
                status: 'failed',
                passed: false,
                errors: [error.message || 'Unknown error'],
                timestamp: Date.now(),
            };
        }
    }

    /**
     * Validate response against expected behavior
     */
    private validateResponse(
        testCase: TestCase,
        response: string,
        toolsCalled: string[],
        responseTime: number
    ): string[] {
        const errors: string[] = [];
        const expected = testCase.expectedBehavior;

        if (!expected) {
            return errors; // No expectations, test passes
        }

        // Check tools
        if (expected.shouldCallTool) {
            for (const tool of expected.shouldCallTool) {
                if (!toolsCalled.includes(tool)) {
                    errors.push(`Expected tool "${tool}" to be called, but it wasn't`);
                }
            }
        }

        if (expected.shouldNotCallTool) {
            for (const tool of expected.shouldNotCallTool) {
                if (toolsCalled.includes(tool)) {
                    errors.push(`Expected tool "${tool}" NOT to be called, but it was`);
                }
            }
        }

        // Check response content
        if (expected.shouldContain) {
            const responseLower = response.toLowerCase();
            // Check if ANY of the shouldContain texts are present (OR logic, not AND)
            const foundAny = expected.shouldContain.some(text => 
                responseLower.includes(text.toLowerCase())
            );
            if (!foundAny) {
                errors.push(`Expected response to contain one of: ${expected.shouldContain.join(', ')}`);
            }
        }

        if (expected.shouldNotContain) {
            for (const text of expected.shouldNotContain) {
                if (response.toLowerCase().includes(text.toLowerCase())) {
                    errors.push(`Expected response NOT to contain "${text}"`);
                }
            }
        }

        // Check response time
        if (expected.maxResponseTime && responseTime > expected.maxResponseTime) {
            errors.push(`Response time ${responseTime}ms exceeds maximum ${expected.maxResponseTime}ms`);
        }

        return errors;
    }

    /**
     * Detect system prompt leakage in response
     */
    private detectSystemPromptLeakage(response: string): boolean {
        const leakageMarkers = [
            'CRITICAL:',
            'CORE RULES',
            'TECHNICAL RESPONSE GUIDELINES',
            'ANTI-HALLUCINATION',
            'LOCATION QUESTIONS:',
            'NAVIGATION:',
            'CONTEXT:',
        ];

        return leakageMarkers.some(marker => response.includes(marker));
    }

    /**
     * Replay a conversation with different prompt versions
     */
    async replayConversation(regressionTest: RegressionTest, newChatInstructions?: string): Promise<{
        originalResponse?: string;
        newResponse: string;
        differences: string[];
    }> {
        const botId = regressionTest.botId;
        const chatInstructions = newChatInstructions || regressionTest.chatInstructions;
        const testPlayerId = 999999;

        // Clear memory
        this.conversationMemory.clearMemory(botId, testPlayerId);

        // Replay conversation history
        for (const message of regressionTest.conversationHistory) {
            if (message.sender === 'person') {
                // Add person message
                this.conversationMemory.addMessage(botId, testPlayerId, message.message, 'person');
            } else {
                // Add bot message (for context)
                this.conversationMemory.addMessage(botId, testPlayerId, message.message, 'bot');
            }
        }

        // Get the last person message (or use a default)
        const lastPersonMessage = regressionTest.conversationHistory
            .filter(m => m.sender === 'person')
            .pop()?.message || 'Hello';

        // Generate new response
        const botConfig = await this.adminApiService.getBotConfiguration(botId);
        if (!botConfig) {
            throw new Error(`Bot ${botId} not found`);
        }

        const context = this.conversationMemory.getConversationContext(botId, testPlayerId);
        let newResponse = '';

        for await (const chunk of this.aiService.generateBotResponseStream(
            botId,
            testPlayerId,
            lastPersonMessage,
            chatInstructions,
            botConfig.aiProviderRef || '',
            undefined,
            context
        )) {
            if (chunk.content) {
                newResponse += chunk.content;
            }
            if (chunk.done) {
                break;
            }
        }

        // Compare with expected response
        const differences: string[] = [];
        if (regressionTest.expectedResponse) {
            if (newResponse !== regressionTest.expectedResponse) {
                differences.push('Response differs from expected');
            }
        }

        return {
            originalResponse: regressionTest.expectedResponse,
            newResponse,
            differences,
        };
    }

    /**
     * Generate test report
     */
    generateTestReport(testRun: TestRun): string {
        const lines: string[] = [];
        lines.push(`Test Run: ${testRun.id}`);
        lines.push(`Suite: ${testRun.testSuiteId}`);
        lines.push(`Bot: ${testRun.botId}`);
        lines.push(`Status: ${testRun.status}`);
        lines.push(`Duration: ${testRun.duration}ms`);
        lines.push('');
        lines.push(`Summary: ${testRun.summary.passed}/${testRun.summary.total} passed, ${testRun.summary.failed} failed, ${testRun.summary.skipped} skipped`);
        lines.push('');

        for (const result of testRun.results) {
            lines.push(`- ${result.testCaseId}: ${result.status}`);
            if (result.errors && result.errors.length > 0) {
                for (const error of result.errors) {
                    lines.push(`  Error: ${error}`);
                }
            }
            if (result.responseTime) {
                lines.push(`  Response time: ${result.responseTime}ms`);
            }
        }

        return lines.join('\n');
    }
}
