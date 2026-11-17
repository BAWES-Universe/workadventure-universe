/**
 * A greeting a bot makes on its own costs the person nothing (greetings cooldown, approved 10 Nov 2026): the person's replies left
 * are not asked about, and the usage is sent marked as a greeting, so Orbit never counts it against them. The payer still sees it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
    span: { end: vi.fn(), setAttribute: vi.fn(), spanContext: vi.fn(() => ({ spanId: "s", traceId: "t" })) },
    generateStream: vi.fn(),
    axios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(hoisted.span)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/PostHogClient", () => ({ captureAiGeneration: vi.fn(), captureAiTrace: vi.fn(), flushPostHog: vi.fn(async () => {}) }));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({ generateStream: hoisted.generateStream })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));
vi.mock("axios", () => ({ default: hoisted.axios, ...hoisted.axios }));

async function* plainAnswer() {
    yield { content: "Hello there.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 33, promptTokens: 30, completionTokens: 3, latency: 10, error: false, truncated: false } };
}

function adminApiMock() {
    return {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "test-provider", name: "TestBot", type: "lmstudio", enabled: true, endpoint: "http://localhost:1234",
            apiKeyEncrypted: null, model: "llama3", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        isBotPrivate: vi.fn(async () => false),
        checkReplyAllowance: vi.fn().mockResolvedValue({ allowed: true }),
    } as any;
}

const SARA = { userUuid: "wa-uuid-sara", isGuest: false };
const REACHED = { allowed: false, limit: "universe-ai", resetsAt: "2026-10-27T20:20:00.000Z", who: "member" };

async function run(kind: "greeting" | "reply") {
    const { AIService } = await import("../ai/AIService");
    const adminApi = adminApiMock();
    adminApi.checkReplyAllowance.mockResolvedValue(REACHED);
    const memory: any = { getMemory: vi.fn(() => SARA), getPendingMediaNotice: vi.fn(() => "") };
    const service = new AIService(memory, adminApi, "http://admin.local");
    const stream =
        kind === "greeting"
            ? service.generateGreetingStream("bot-1", 42, "Sara just approached you.", "You are a bot.", "test-provider", "space-1", "")
            : service.generateBotResponseStream("bot-1", 42, "hi", "You are a bot.", "test-provider", "space-1", "");
    const chunks: any[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    await vi.waitFor(() => expect(adminApi.trackAIUsage.mock.calls.length + (kind === "reply" ? 1 : 0)).toBeGreaterThan(0));
    return { adminApi, chunks };
}

describe("AIService: a greeting is free for the person", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.generateStream.mockReset().mockImplementation(plainAnswer);
    });
    afterEach(() => vi.resetModules());

    it("is made even for someone who used every reply, without asking about their replies left", async () => {
        const { adminApi, chunks } = await run("greeting");
        expect(adminApi.checkReplyAllowance).not.toHaveBeenCalled();
        expect(chunks.map((c) => c.content).join("")).toBe("Hello there.");
        expect(chunks.some((c) => c.replyLimit)).toBe(false);
    });

    it("is still kept as usage of whoever pays, marked as a greeting with who it was for", async () => {
        const { adminApi } = await run("greeting");
        expect(adminApi.trackAIUsage).toHaveBeenCalledWith(expect.objectContaining({ botId: "bot-1", userId: "wa-uuid-sara", isGuest: false, greeting: true }));
    });

    it("leaves an ordinary reply as it was: asked about, and not marked", async () => {
        const { adminApi, chunks } = await run("reply");
        expect(adminApi.checkReplyAllowance).toHaveBeenCalledTimes(1);
        expect(chunks.some((c) => c.replyLimit)).toBe(true);
        for (const [usage] of adminApi.trackAIUsage.mock.calls) expect(usage.greeting).toBeUndefined();
    });
});
