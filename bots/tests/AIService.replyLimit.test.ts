/**
 * Reply limits (#1159): before each reply the bot server asks Orbit whether this person may have one more. At a limit
 * no AI is called and no usage is tracked; the caller shows the fixed limit card instead of an answer.
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

async function ask(person: object | null, allowance: object = { allowed: true }) {
    const { AIService } = await import("../ai/AIService");
    const adminApi = adminApiMock();
    adminApi.checkReplyAllowance.mockResolvedValue(allowance);
    const memory: any = { getMemory: vi.fn(() => person), getPendingMediaNotice: vi.fn(() => "") };
    const service = new AIService(memory, adminApi, "http://admin.local");
    const chunks: any[] = [];
    for await (const chunk of service.generateBotResponseStream("bot-1", 42, "hi", "You are a bot.", "test-provider", "space-1", "")) chunks.push(chunk);
    return { adminApi, chunks };
}

const SARA = { userUuid: "wa-uuid-sara", isGuest: false };
const REACHED = { allowed: false, limit: "universe-ai", resetsAt: "2026-10-27T20:20:00.000Z", who: "member" };

describe("AIService: reply limits (#1159)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.generateStream.mockReset().mockImplementation(plainAnswer);
    });
    afterEach(() => vi.resetModules());

    it("asks Orbit before any AI call, with who is talking and what the reply would run on", async () => {
        const { adminApi, chunks } = await ask(SARA);
        expect(adminApi.checkReplyAllowance).toHaveBeenCalledWith("bot-1", { userId: "wa-uuid-sara", isGuest: false, source: "provider" });
        expect(chunks.map((c) => c.content).join("")).toBe("Hello there.");
        expect(chunks.some((c) => c.replyLimit)).toBe(false);
    });

    it("at a limit calls no AI, tracks nothing, and hands back the card's facts", async () => {
        const { adminApi, chunks } = await ask(SARA, REACHED);
        expect(hoisted.generateStream).not.toHaveBeenCalled();
        expect(adminApi.trackAIUsage).not.toHaveBeenCalled();
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ content: "", done: true, replyLimit: { limit: "universe-ai", resetsAt: "2026-10-27T20:20:00.000Z", who: "member" } });
    });

    it("never asks about someone it cannot name yet", async () => {
        const { adminApi, chunks } = await ask({ userUuid: "temp-42", isGuest: true }, REACHED);
        expect(adminApi.checkReplyAllowance).not.toHaveBeenCalled();
        expect(chunks.map((c) => c.content).join("")).toBe("Hello there.");
    });

    it("says when the person is a guest", async () => {
        const { adminApi } = await ask({ userUuid: "wa-uuid-guest", isGuest: true });
        expect(adminApi.checkReplyAllowance).toHaveBeenCalledWith("bot-1", expect.objectContaining({ userId: "wa-uuid-guest", isGuest: true }));
    });
});
