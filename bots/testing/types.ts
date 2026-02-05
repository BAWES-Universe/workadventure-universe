/**
 * Testing Types - Define interfaces for bot testing framework
 */

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestCase {
    id: string;
    name: string;
    description?: string;
    botId: string;
    chatInstructions: string; // Bot's chat instructions for this test
    input: string; // User message
    expectedBehavior?: {
        shouldCallTool?: string[]; // Expected tools to be called
        shouldNotCallTool?: string[]; // Tools that should NOT be called
        shouldContain?: string[]; // Response should contain these strings
        shouldNotContain?: string[]; // Response should NOT contain these strings
        personalityCompliance?: boolean; // Whether response should match chat instructions
        maxResponseTime?: number; // Maximum response time in ms
        minResponseLength?: number; // Minimum response length in characters
        maxRepetitionScore?: number; // Maximum allowed repetition score (0-1)
    };
    expectedEmotions?: {
        // Expected emotion values detected from input
        personSentimentMin?: number; // Minimum expected sentiment (-100 to 100)
        personSentimentMax?: number; // Maximum expected sentiment (-100 to 100)
        isInsult?: boolean; // Expected insult detection
        insultSeverityMin?: number; // Minimum expected insult severity (0-10)
        context?: string; // Expected context (sarcastic, joking, etc.)
    };
    metadata?: Record<string, any>;
}

export interface TestResult {
    testCaseId: string;
    status: TestStatus;
    passed: boolean;
    response?: string;
    responseTime?: number;
    toolsCalled?: string[];
    errors?: string[];
    metrics?: {
        repetitionScore?: number;
        systemPromptLeakage?: boolean;
        personalityCompliance?: number;
    };
    // AI-detected emotions from the response
    emotions?: {
        personSentiment: number;
        isInsult: boolean;
        insultSeverity: number;
        context: string;
    };
    timestamp: number;
}

export interface TestSuite {
    id: string;
    name: string;
    description?: string;
    testCases: TestCase[];
    botId?: string; // If set, all test cases use this bot
    createdAt: number;
    updatedAt: number;
}

export interface TestRun {
    id: string;
    testSuiteId: string;
    botId: string;
    status: TestStatus;
    results: TestResult[];
    startedAt: number;
    completedAt?: number;
    duration?: number; // milliseconds
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
}

export interface RegressionTest {
    id: string;
    name: string;
    conversationHistory: Array<{
        sender: 'bot' | 'person';
        message: string;
        timestamp: number;
    }>;
    expectedResponse?: string; // Expected bot response
    expectedBehavior?: TestCase['expectedBehavior'];
    botId: string;
    chatInstructions: string;
    createdAt: number;
}

export interface PersonalityComplianceTestCase extends TestCase {
    expectedPersonality: 'friendly' | 'mean' | 'helpful' | 'neutral' | string; // Expected personality trait
    personalityCheck: {
        shouldBeMean?: boolean; // For mean bots
        shouldBeFriendly?: boolean; // For friendly bots
        shouldBeHelpful?: boolean; // For helpful bots
        shouldNotApologize?: boolean; // For mean bots
        shouldNotBeFriendly?: boolean; // For mean bots
    };
}
