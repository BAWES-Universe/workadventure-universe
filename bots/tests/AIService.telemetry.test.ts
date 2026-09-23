/**
 * Tests for AIService token accounting on tool-calling turns
 *
 * Scope: when the initial LLM call ends by requesting a tool, its done chunk
 * carries that call's token usage. That usage must reach both the
 * $ai_generation telemetry for the initial call and the turn totals reported
 * to the admin app, alongside the follow-up call's usage. Previously the
 * tool-call branch captured telemetry and `continue`d before the chunk's
 * metadata was read, so the initial call was recorded as zero tokens and
 * omitted from the turn totals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
const mockParentSpan = {
    end: vi.fn(),
    setAttribute: vi.fn(),
    spanContext: vi.fn(() => ({ spanId: "test-span-id", traceId: "test-trace-id" })),
};

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(mockParentSpan)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));

// --- Mock @sentry/core ---
vi.mock("@sentry/core", () => ({
    _INTERNAL_setSpanForScope: vi.fn(),
}));

// --- Mock PostHog telemetry so the captured generations can be inspected ---
const mockCaptureAiGeneration = vi.fn();
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: mockCaptureAiGeneration,
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

// --- Mock encryption ---
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "decrypted-key"),
}));

// --- Mock AIProviderRegistry ---
const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
    })),
}));

// --- Mock BotClient ---
vi.mock("../client/BotClient", () => ({
    BotClient: vi.fn(),
}));

// --- Mock MCPConnector to prevent real HTTP calls during tests ---
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({
            tools: [],
            toolServerMap: new Map(),
        }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

// ---- Helper streams ----

// Initial call: requests a built-in tool (no MCP server needed) and reports its usage
// on the done chunk, as providers do with include_usage.
async function* toolCallWithUsageStream() {
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 110, promptTokens: 100, completionTokens: 10, latency: 20, error: false, truncated: false },
    };
}

// Follow-up call after the tool result: a normal text answer with its own usage.
async function* followUpAnswerWithUsageStream() {
    yield { content: "I'm right by the fountain.", done: false };
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 220, promptTokens: 200, completionTokens: 20, latency: 30, error: false, truncated: false },
    };
}

// A turn with no tool call at all, for the no-double-counting control.
async function* plainAnswerWithUsageStream() {
    yield { content: "Hello there.", done: false };
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 33, promptTokens: 30, completionTokens: 3, latency: 10, error: false, truncated: false },
    };
}

// ---- Build minimal mocks ----
function buildMocks() {
    const mockAdminApiService: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "test-provider",
            name: "TestBot",
            type: "lmstudio",
            enabled: true,
            endpoint: "http://localhost:1234",
            apiKeyEncrypted: null,
            model: "llama3",
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };

    const mockConversationMemory: any = {
        getMemory: vi.fn(() => ({ userUuid: "test-uuid" })),
    };

    return { mockAdminApiService, mockConversationMemory };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) {
        chunks.push(chunk);
    }
    return chunks;
}

describe("AIService – token accounting on tool-calling turns", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("records the initial call's own tokens in its $ai_generation event", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(toolCallWithUsageStream)
            .mockImplementationOnce(followUpAnswerWithUsageStream);

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        await drain(service.generateBotResponseStream(
            "bot-1", 42, "where are you?", "You are a bot.", "test-provider", "space-1", ""
        ));

        expect(mockGenerateStream).toHaveBeenCalledTimes(2);

        // The initial call is captured first, before the tool runs.
        expect(mockCaptureAiGeneration.mock.calls.length).toBeGreaterThanOrEqual(2);
        const initial = mockCaptureAiGeneration.mock.calls[0][0];
        expect(initial.inputTokens).toBe(100);
        expect(initial.outputTokens).toBe(10);
        expect(initial.cost).toBeDefined();
    });

    it("reports both calls' tokens in the turn totals sent to the admin app", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(toolCallWithUsageStream)
            .mockImplementationOnce(followUpAnswerWithUsageStream);

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        await drain(service.generateBotResponseStream(
            "bot-1", 42, "where are you?", "You are a bot.", "test-provider", "space-1", ""
        ));

        expect(mockAdminApiService.trackAIUsage).toHaveBeenCalledTimes(1);
        const usage = mockAdminApiService.trackAIUsage.mock.calls[0][0];
        expect(usage.promptTokens).toBe(300);
        expect(usage.completionTokens).toBe(30);
        expect(usage.tokensUsed).toBe(330);
    });

    it("does not double count a turn without tool calls", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(plainAnswerWithUsageStream);

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        await drain(service.generateBotResponseStream(
            "bot-1", 42, "hi", "You are a bot.", "test-provider", "space-1", ""
        ));

        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
        expect(mockAdminApiService.trackAIUsage).toHaveBeenCalledTimes(1);
        const usage = mockAdminApiService.trackAIUsage.mock.calls[0][0];
        expect(usage.promptTokens).toBe(30);
        expect(usage.completionTokens).toBe(3);
        expect(usage.tokensUsed).toBe(33);
    });
});
