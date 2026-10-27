/**
 * Usage rows say where a reply was given and who it was for (Orbit #491, #1159 step 6). The bot server sends the
 * channel with every reply, and the person once it knows their WorkAdventure uuid; a temporary id is never sent.
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
    } as any;
}

async function sentFor(person: object | null, channel?: "world" | "dm") {
    const { AIService } = await import("../ai/AIService");
    const adminApi = adminApiMock();
    const memory: any = { getMemory: vi.fn(() => person), getPendingMediaNotice: vi.fn(() => "") };
    const service = new AIService(memory, adminApi, "http://admin.local");
    const stream = service.generateBotResponseStream("bot-1", 42, "hi", "You are a bot.", "test-provider", "space-1", "", undefined, undefined, undefined, undefined, channel);
    for await (const _chunk of stream) { /* drain */ }
    expect(adminApi.trackAIUsage).toHaveBeenCalledTimes(1);
    return adminApi.trackAIUsage.mock.calls[0][0];
}

describe("AIService: where a reply was given and who it was for", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.generateStream.mockReset().mockImplementation(plainAnswer);
    });
    afterEach(() => vi.resetModules());

    it("sends nearby chat and the signed-in person for a reply on the map", async () => {
        expect(await sentFor({ userUuid: "wa-uuid-sara", isGuest: false })).toMatchObject({ channel: "nearby", userId: "wa-uuid-sara", isGuest: false });
    });

    it("sends direct messages for a reply by direct message", async () => {
        expect(await sentFor({ userUuid: "wa-uuid-sara", isGuest: false }, "dm")).toMatchObject({ channel: "dm", userId: "wa-uuid-sara" });
    });

    it("says when it was a guest", async () => {
        expect(await sentFor({ userUuid: "wa-uuid-guest", isGuest: true })).toMatchObject({ userId: "wa-uuid-guest", isGuest: true });
    });

    it("never sends a temporary id, only the channel", async () => {
        const sent = await sentFor({ userUuid: "temp-42", isGuest: true });
        expect(sent.channel).toBe("nearby");
        expect(sent).not.toHaveProperty("userId");
        expect(sent).not.toHaveProperty("isGuest");
    });

    it("sends only the channel when the bot has no memory of them", async () => {
        const sent = await sentFor(null, "dm");
        expect(sent.channel).toBe("dm");
        expect(sent).not.toHaveProperty("userId");
    });

    it("keeps the usage numbers exactly as before", async () => {
        expect(await sentFor({ userUuid: "wa-uuid-sara", isGuest: false })).toMatchObject({ botId: "bot-1", tokensUsed: 33, promptTokens: 30, completionTokens: 3, apiCalls: 1 });
    });
});
