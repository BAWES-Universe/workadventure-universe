/**
 * A reply that comes back with nothing (no words, no tool call) or fails at the provider used to leave no trace: a DM
 * showed "Couldn't answer" while Sentry marked the turn ok and PostHog got no event (#1498). It now logs one line with
 * the reason, marks the span as an error and sends the trace with $ai_is_error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
const mockParentSpan = {
    end: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
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
const mockCaptureAiTrace = vi.fn();
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: mockCaptureAiGeneration,
    captureAiTrace: mockCaptureAiTrace,
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

// DeepSeek on 27 Oct: the whole 4,000-token limit went on thinking, so no words came back.
async function* thinkingOnlyStream() {
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 10581, promptTokens: 6581, completionTokens: 4000, reasoningTokens: 4000, latency: 25000, error: false, truncated: true, finishReason: "length" },
    };
}

async function* providerErrorStream() {
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 0, latency: 300, error: true, errorStatus: 400, errorText: "OpenAI API error: 400 max_tokens is too large" },
    };
}

async function* plainAnswerStream() {
    yield { content: "Hello there.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 33, promptTokens: 30, completionTokens: 3, latency: 10, error: false, truncated: false, finishReason: "stop" } };
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
        getPendingMediaNotice: vi.fn(() => ""),
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

describe("AIService – a reply that leaves the person nothing (#1498)", () => {
    let AIService: any;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        warn.mockRestore();
        vi.resetModules();
    });

    const run = async (message = "build me an artifact with music") => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        await drain(service.generateBotResponseStream("bot-1", 42, message, "You are a bot.", "test-provider", "space-1", ""));
    };
    const warnings = () => warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes("gave no answer"));

    it("says why a reply came back with no words", async () => {
        mockGenerateStream.mockImplementationOnce(thinkingOnlyStream);
        await run();

        expect(warnings()).toEqual([
            "[AIService] Bot bot-1 gave no answer on llama3 (test-provider): no words and no tool call: it reached the longest reply, 4000 tokens used of 512 allowed, 4000 on thinking",
        ]);
        expect(mockParentSpan.setStatus).toHaveBeenCalledWith({ code: 2, message: expect.stringContaining("reached the longest reply") });
        expect(mockCaptureAiTrace).toHaveBeenCalledTimes(1);
        expect(mockCaptureAiTrace.mock.calls[0][0].error).toContain("no words and no tool call");
    });

    it("says what the provider answered when the call failed", async () => {
        mockGenerateStream.mockImplementationOnce(providerErrorStream);
        await run();

        expect(warnings()).toEqual([
            "[AIService] Bot bot-1 gave no answer on llama3 (test-provider): the provider failed (400): OpenAI API error: 400 max_tokens is too large",
        ]);
        expect(mockCaptureAiTrace.mock.calls[0][0].error).toBe("the provider failed (400): OpenAI API error: 400 max_tokens is too large");
    });

    it("never puts the person's words in the line", async () => {
        mockGenerateStream.mockImplementationOnce(thinkingOnlyStream);
        await run("my secret plan");
        expect(warnings().join(" ")).not.toContain("secret");
    });

    it("leaves a reply with an answer alone", async () => {
        mockGenerateStream.mockImplementationOnce(plainAnswerStream);
        await run();

        expect(warnings()).toEqual([]);
        expect(mockParentSpan.setStatus).not.toHaveBeenCalled();
        expect(mockCaptureAiTrace).toHaveBeenCalledTimes(1);
        expect(mockCaptureAiTrace.mock.calls[0][0].error).toBeUndefined();
    });
});
