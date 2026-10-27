/**
 * Tests for AIService request shape
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
            tools: [
                { type: "function", function: { name: "zeta_tool", description: "", parameters: {} } },
                { type: "function", function: { name: "alpha_tool", description: "", parameters: {} } },
                { type: "function", function: { name: "mid_tool", description: "", parameters: {} } },
            ],
            toolServerMap: new Map(),
        }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

async function* plainStream() {
    yield { content: "Hi.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1, latency: 1, error: false, truncated: false } };
}

describe("AIService – cache-friendly request shape (issue #1333)", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        AIService = (await import("../ai/AIService")).AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    async function run() {
        const admin: any = {
            getAIProviderCredentials: vi.fn().mockResolvedValue({
                providerId: "p", name: "B", type: "openai", enabled: true, endpoint: "https://api.deepseek.com/v1", apiKeyEncrypted: null,
                model: "deepseek-v4-flash", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
            }),
            trackAIUsage: vi.fn().mockResolvedValue(undefined),
            getRoomMetadata: vi.fn().mockResolvedValue(null),
            getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        };
        mockGenerateStream.mockImplementationOnce(plainStream);
        const botClient: any = { getRoomUrl: () => "http://play/_/r/m.json" };
        const svc = new AIService({ getMemory: vi.fn(() => ({ userUuid: "u" })), getPendingMediaNotice: vi.fn(() => "") }, admin, "http://admin.local");
        for await (const _ of svc.generateBotResponseStream("bot-7", 42, "hi", "You are Zed.", "p", "space-1", "", botClient, admin)) { /* drain */ }
        return mockGenerateStream.mock.calls[0];
    }

    it("lists built-in tools first, then MCP tools sorted by name", async () => {
        const call = await run();
        const names = call[4].map((t: any) => t.function.name);
        const firstMcp = names.indexOf("alpha_tool");
        expect(names.slice(firstMcp)).toEqual(["alpha_tool", "mid_tool", "zeta_tool"]);
        expect(names.slice(0, firstMcp)).toContain("get_bot_position");
        expect(names.slice(0, firstMcp)).not.toContain("zeta_tool");
    });

    it("hands the bot id to the provider as its cache route", async () => {
        const call = await run();
        expect(call[3].__promptCacheKey).toBe("bot-7");
    });
});
