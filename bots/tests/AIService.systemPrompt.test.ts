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

// ---- The prompt handed to the provider registry, for both live provider types ----
async function* plainStream() {
    yield { content: "Hi.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1, latency: 1, error: false, truncated: false } };
}

async function promptFor(AIService: any, type: string, context: string, notice = ""): Promise<string> {
    const admin: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "p", name: "B", type, enabled: true, endpoint: "http://x", apiKeyEncrypted: null,
            model: "llama3", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    mockGenerateStream.mockReset();
    mockGenerateStream.mockImplementationOnce(plainStream);
    const svc = new AIService({ getMemory: vi.fn(() => ({ userUuid: "u" })), getPendingMediaNotice: vi.fn(() => notice) }, admin, "http://admin.local");
    for await (const _ of svc.generateBotResponseStream("bot-1", 42, "hi", "You are Zed.", "p", "space-1", context)) { /* drain */ }
    return mockGenerateStream.mock.calls[0][1];
}

describe("AIService – system prompt handed to the provider", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-24T11:30:00Z"));
        AIService = (await import("../ai/AIService")).AIService;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();
    });

    it.each(["openai", "lmstudio"])("%s bots get the rules before the memory and the current time last", async (type) => {
        const prompt = await promptFor(AIService, type, "Recent conversation:\nThey: \"hi\" (just now)");
        expect(prompt.startsWith("You are Zed.")).toBe(true);
        expect(prompt.indexOf("**HOW TO CONVERSE NATURALLY")).toBeLessThan(prompt.indexOf("Conversation Context:"));
        expect(prompt).toContain("**NOW:** Saturday, October 24, 2026, 11:30 UTC");
        expect(prompt.indexOf("Conversation Context:")).toBeLessThan(prompt.indexOf("**NOW:**"));
    });

    it("sends openai and lmstudio bots the same prompt", async () => {
        const a = await promptFor(AIService, "openai", "ctx");
        const b = await promptFor(AIService, "lmstudio", "ctx");
        expect(a).toBe(b);
    });

    it("puts the pending-media notice after the current time", async () => {
        const notice = "[System: 1 media item(s) from the previous session are being delivered alongside this message. Do NOT generate or request them again.]";
        const prompt = await promptFor(AIService, "openai", "ctx", notice);
        expect(prompt.trimEnd().endsWith(notice)).toBe(true);
        expect(prompt.indexOf(notice)).toBeGreaterThan(prompt.indexOf("**NOW:**"));
    });
});
