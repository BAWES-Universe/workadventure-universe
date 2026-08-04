/**
 * Tests for AIService auto-continuation on truncated responses
 *
 * Scope: When the provider reports finish_reason='length' (max_tokens cap hit),
 * generateBotResponseStream should issue a follow-up "continue" call and yield
 * the continuation content so the user sees the complete answer instead of a
 * mid-sentence cutoff. Continuations are capped at 2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
const mockParentSpanEnd = vi.fn();
const mockParentSpan = {
    end: mockParentSpanEnd,
    setAttribute: vi.fn(),
};

const mockStartSpanManual = vi.fn((_opts: unknown, callback: (span: any) => any) => {
    return callback(mockParentSpan);
});

vi.mock("@sentry/node", () => ({
    startSpanManual: mockStartSpanManual,
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));

// --- Mock @sentry/core ---
vi.mock("@sentry/core", () => ({
    _INTERNAL_setSpanForScope: vi.fn(),
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

// First call: content that hits the max_tokens cap mid-sentence.
async function* truncatedStream() {
    yield { content: "Here is the first part of the answer", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 50, latency: 100, error: false, truncated: true } };
}

// Continuation call: completes naturally (finish_reason='stop').
async function* continuationStream() {
    yield { content: " and here is the rest.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 20, latency: 40, error: false, truncated: false } };
}

// Continuation that ALSO hits the cap (should stop after MAX=2 continuations).
async function* stillTruncatedStream() {
    yield { content: " still cut off", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 30, error: false, truncated: true } };
}

// Normal stream: never truncated.
async function* normalStream() {
    yield { content: "a complete answer", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 30, latency: 60, error: false, truncated: false } };
}

// Stream that emits a tool call with an EMPTY name (DeepSeek streaming quirk)
// then ends — the model tried to call a tool but the name never arrived.
async function* emptyNameToolCallStream() {
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 20, error: false, truncated: false } };
}

// Direct text answer used for the retry (no tools).
async function* directAnswerStream() {
    yield { content: "Here is the direct answer to your question.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 15, latency: 30, error: false, truncated: false } };
}

// Follow-up that produced only tool calls with no text.
async function* toolCallOnlyFollowUpStream() {
    yield { content: "", done: false, toolCalls: [{ id: "call_2", name: "list_issues", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 20, error: false, truncated: false } };
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

describe("AIService – truncated response auto-continuation", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // mockImplementationOnce queue persists across clearAllMocks — reset it so
        // a leftover once-implementation from a previous test can't be consumed by
        // the next test's first call (caused cross-test content leakage).
        mockGenerateStream.mockReset();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("issues a continuation call when the main stream ends truncated, and yields the continuation content", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(truncatedStream)   // main call → truncated
            .mockImplementationOnce(continuationStream); // continuation → completes

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "tell me about the team", "You are a bot.", "test-provider", "space-1", ""
        ));

        // generateStream called twice: main + continuation
        expect(mockGenerateStream).toHaveBeenCalledTimes(2);

        // The continuation call received the partial content so the model knows
        // where to pick up.
        const continueCall = mockGenerateStream.mock.calls[1];
        const continueMessage = continueCall[2] as string;
        expect(continueMessage).toContain("first part of the answer");
        expect(continueMessage.toLowerCase()).toContain("continue");

        // Content from both the main and continuation calls reaches the behavior.
        const content = chunks.filter((c: any) => c.content && !c.done).map((c: any) => c.content).join("");
        expect(content).toContain("Here is the first part of the answer");
        expect(content).toContain("and here is the rest.");

        // Exactly one final done chunk.
        const doneChunks = chunks.filter((c: any) => c.done);
        expect(doneChunks).toHaveLength(1);
    });

    it("caps continuations at 2 when the model keeps hitting the cap", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(truncatedStream)      // main → truncated
            .mockImplementationOnce(stillTruncatedStream) // cont 1 → still truncated
            .mockImplementationOnce(stillTruncatedStream); // cont 2 → still truncated (cap)

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "tell me about the team", "You are a bot.", "test-provider", "space-1", ""
        ));

        // Main + exactly 2 continuation calls, no more.
        expect(mockGenerateStream).toHaveBeenCalledTimes(3);

        // Still terminates cleanly with one done chunk.
        const doneChunks = chunks.filter((c: any) => c.done);
        expect(doneChunks).toHaveLength(1);
        expect(doneChunks[0].done).toBe(true);
    });

    it("does NOT issue a continuation when the stream ends naturally", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(normalStream);

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "hello", "You are a bot.", "test-provider", "space-1", ""
        ));

        expect(mockGenerateStream).toHaveBeenCalledTimes(1);

        const content = chunks.filter((c: any) => c.content && !c.done).map((c: any) => c.content).join("");
        expect(content).toBe("a complete answer");
    });

    it("does not continue when the abort signal fires", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(truncatedStream);

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const controller = new AbortController();
        // Abort BEFORE draining — the generator must not fire a continuation.
        controller.abort();

        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "hello", "You are a bot.", "test-provider", "space-1", "",
            undefined, undefined, controller.signal
        ));

        // Only the main call; no continuation.
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);

        // Abort wins over continuation: no content is yielded (the loop breaks
        // at the top of the first iteration) and no done chunk fires — the
        // behavior handles the abort via abortCurrentStream(), not via a chunk.
        expect(chunks.filter((c: any) => c.content)).toHaveLength(0);
        expect(chunks.some((c: any) => c.done)).toBe(false);
    });

    it("retries once without tools when the main stream produces empty-name tool calls", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(emptyNameToolCallStream) // main call → empty-name tool call
            .mockImplementationOnce(directAnswerStream);      // retry (no tools) → real answer

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "what's the status?", "You are a bot.", "test-provider", "space-1", ""
        ));

        // Two calls: original + one retry (no more).
        expect(mockGenerateStream).toHaveBeenCalledTimes(2);

        // The retry call was made WITHOUT tools so the model can't chain another tool call.
        const retryCall = mockGenerateStream.mock.calls[1];
        const retryTools = retryCall[4];
        expect(retryTools).toEqual([]);

        // The retry's direct answer reaches the behavior.
        const content = chunks.filter((c: any) => c.content && !c.done).map((c: any) => c.content).join("");
        expect(content).toContain("Here is the direct answer to your question.");

        // Terminates cleanly with one done chunk.
        const doneChunks = chunks.filter((c: any) => c.done);
        expect(doneChunks).toHaveLength(1);
    });

    it("falls back to the placeholder only when the no-tools retry also produces nothing", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(emptyNameToolCallStream) // main call → empty-name tool call
            .mockImplementationOnce(normalStream);            // retry would produce content, so no placeholder

        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream(
            "bot-1", 42, "what's the status?", "You are a bot.", "test-provider", "space-1", ""
        ));

        const content = chunks.filter((c: any) => c.content && !c.done).map((c: any) => c.content).join("");
        // Retry produced a real answer — the placeholder must NOT appear.
        expect(content).not.toContain("Let me check on that for you.");
        expect(content).toContain("a complete answer");
    });
});
