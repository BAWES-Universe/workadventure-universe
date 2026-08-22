/**
 * Tests for the three user-verified brick chat bugs:
 *
 * 1. First-generation hiccup (empty-name tool calls) must fall back to a
 *    FIXED neutral string ("One second.") — never the model's pre-tool
 *    narration (e.g. "One moment — my thinking is hiccuping"), which is
 *    filler/thinking text, not an answer.
 * 2. The follow-up message must force the model to answer the user's LAST
 *    question directly — the user's question must always be present (it was
 *    missing when the model had already said something), with explicit bans
 *    on evasive filler, apologies, and "where were we".
 * 3. (Covered in IdleBehavior.bubble-dedup.test.ts) reset must clear pre-tool
 *    filler instead of finalizing it + rotating responseId, so greeting and
 *    follow-up never double-send as separate messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
const mockParentSpanEnd = vi.fn();
const mockParentSpan = {
    end: mockParentSpanEnd,
    setAttribute: vi.fn(),
    spanContext: vi.fn(() => ({ spanId: 'test-span-id', traceId: 'test-trace-id' })),
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
    decryptApiKey: (() => "decrypted-key") as any,
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

// First-generation hiccup: the model streams a narrated excuse as pre-tool
// filler, then emits tool calls whose names never arrived (DeepSeek quirk).
async function* excuseThenEmptyNameToolCallStream() {
    yield { content: "One moment — my thinking is hiccuping", done: false };
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 20, error: false, truncated: false } };
}

// Retry (no tools) that emits ONLY a done chunk with no content — the retry
// produced nothing at all.
async function* emptyRetryStream() {
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 20, error: false, truncated: false } };
}

// Retry (no tools) that produces a real direct answer.
async function* directAnswerStream() {
    yield { content: "Here is the direct answer to your question.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 15, latency: 30, error: false, truncated: false } };
}

// Main stream that emits pre-tool text then a VALID tool call — the follow-up
// round that follows must still answer the user's question directly.
async function* preToolTextThenValidToolCallStream() {
    yield { content: "Let me check that for you.", done: false };
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
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

describe("AIService – brick chat fixes", () => {
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

    describe("bug 1: fixed neutral fallback for first-generation hiccup", () => {
        it("yields a reset BEFORE the retry so the model's pre-tool narration never stands as (or prefixes) the answer", async () => {
            const { mockAdminApiService, mockConversationMemory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(excuseThenEmptyNameToolCallStream) // main → excuse + empty-name tool call
                .mockImplementationOnce(directAnswerStream);                // retry → real answer

            const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
            const chunks = await drain(service.generateBotResponseStream(
                "bot-1", 42, "hello", "You are a bot.", "test-provider", "space-1", ""
            ));

            // The pre-tool excuse must be discarded via a reset chunk before
            // the retry answer streams — otherwise the user sees the excuse
            // glued in front of the real answer.
            const resetIdx = chunks.findIndex((c: any) => c.reset);
            expect(resetIdx).toBeGreaterThanOrEqual(0);

            // Everything the user sees AFTER the reset is the retry answer —
            // never the model's narrated hiccup excuse.
            const postResetContent = chunks
                .slice(resetIdx + 1)
                .filter((c: any) => c.content && !c.done)
                .map((c: any) => c.content)
                .join("");
            expect(postResetContent).toContain("Here is the direct answer to your question.");
            expect(postResetContent).not.toContain("hiccuping");
            expect(postResetContent).not.toContain("One moment");
        });

        it("replaces the model-narrated hiccup excuse with the FIXED neutral fallback 'One second.' when the retry also produces nothing", async () => {
            const { mockAdminApiService, mockConversationMemory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(excuseThenEmptyNameToolCallStream) // main → excuse + empty-name tool call
                .mockImplementationOnce(emptyRetryStream);                 // retry → nothing at all

            const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
            const chunks = await drain(service.generateBotResponseStream(
                "bot-1", 42, "hello", "You are a bot.", "test-provider", "space-1", ""
            ));

            // The excuse is discarded (reset), and the final message is the
            // FIXED neutral string — the model never explains itself.
            const resetIdx = chunks.findIndex((c: any) => c.reset);
            expect(resetIdx).toBeGreaterThanOrEqual(0);

            const postResetContent = chunks
                .slice(resetIdx + 1)
                .filter((c: any) => c.content && !c.done)
                .map((c: any) => c.content)
                .join("");
            expect(postResetContent).toBe("One second.");
            expect(postResetContent).not.toContain("hiccuping");
            expect(postResetContent).not.toContain("One moment");

            // Terminates cleanly with exactly one done chunk.
            const doneChunks = chunks.filter((c: any) => c.done);
            expect(doneChunks).toHaveLength(1);
        });

        it("does not use the neutral fallback when the retry produced a real answer", async () => {
            const { mockAdminApiService, mockConversationMemory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(excuseThenEmptyNameToolCallStream)
                .mockImplementationOnce(directAnswerStream);

            const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
            const chunks = await drain(service.generateBotResponseStream(
                "bot-1", 42, "hello", "You are a bot.", "test-provider", "space-1", ""
            ));

            const content = chunks.filter((c: any) => c.content && !c.done).map((c: any) => c.content).join("");
            expect(content).toContain("Here is the direct answer to your question.");
            expect(content).not.toContain("One second.");
        });
    });

    describe("bug 2: follow-up must answer the user's last question directly", () => {
        it("always includes the user's original question in the follow-up message, even when the model already said something", async () => {
            const { mockAdminApiService, mockConversationMemory } = buildMocks();
            const userQuestion = "what's the status of the team?";
            mockGenerateStream
                .mockImplementationOnce(preToolTextThenValidToolCallStream) // main → pre-tool text + valid tool call
                .mockImplementationOnce(directAnswerStream);                 // follow-up → answer

            const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
            await drain(service.generateBotResponseStream(
                "bot-1", 42, userQuestion, "You are a bot.", "test-provider", "space-1", ""
            ));

            const followUpCall = mockGenerateStream.mock.calls[1];
            const followUpMessage = followUpCall[2] as string;

            // The user's actual question must be IN the follow-up prompt.
            // (Bug: it was omitted whenever previousRoundContent was non-empty,
            // so the model dodged with vague filler instead of answering.)
            expect(followUpMessage).toContain(userQuestion);
        });

        it("mandates a DIRECT answer and bans evasive filler, apologies, and 'where were we'", async () => {
            const { mockAdminApiService, mockConversationMemory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(preToolTextThenValidToolCallStream)
                .mockImplementationOnce(directAnswerStream);

            const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
            await drain(service.generateBotResponseStream(
                "bot-1", 42, "what's the status of the team?", "You are a bot.", "test-provider", "space-1", ""
            ));

            const followUpCall = mockGenerateStream.mock.calls[1];
            const followUpMessage = followUpCall[2] as string;
            const lower = followUpMessage.toLowerCase();

            // Direct-answer mandate.
            expect(lower).toContain("answer the user's question directly");
            // Never "where were we" — the prompt must explicitly forbid it.
            expect(lower).toContain("where were we");
            // No apologies, no evasive filler.
            expect(lower).toContain("no apologies");
            expect(lower).toContain("no evasive filler");
        });
    });
});
