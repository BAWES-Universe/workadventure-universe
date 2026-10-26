/**
 * What the bot server tells Orbit a reply cost (#1173): the cost is worked out as each call to the provider finishes
 * and sent with the tokens, the basis, and where the prices came from. Nothing is made up: a model with no known price
 * is unknown, an own computer is a real zero, and a cost OpenRouter reports is taken as it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) =>
        callback({ end: vi.fn(), setAttribute: vi.fn(), spanContext: vi.fn(() => ({ spanId: "s", traceId: "t" })) })
    ),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));
const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: vi.fn(),
        supportsVision: vi.fn(() => false),
    })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

const provider = (over: Record<string, unknown> = {}) => ({
    providerId: "deepseek-flash", name: "DeepSeek V4 Flash", type: "openai", enabled: true, endpoint: "https://api.deepseek.com",
    apiKeyEncrypted: "iv:tag:data", model: "deepseek-v4-flash", temperature: 0.7, maxTokens: 512, supportsStreaming: true,
    supportsVision: null, visionModel: null, defaultVision: false, settings: {}, ...over,
});

function buildMocks(config: Record<string, unknown>) {
    const admin: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue(config),
        getBotAiCredentials: vi.fn(),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })), appendVisionDescription: vi.fn() };
    return { admin, memory };
}

const finished = (metadata: Record<string, unknown>) =>
    async function* () {
        yield { content: "Hi!", done: false };
        yield { content: "", done: true, metadata: { latency: 10, error: false, ...metadata } };
    };

async function drain(generator: AsyncGenerator<any>) {
    for await (const _chunk of generator) { /* drain */ }
}

describe("AIService – what a reply cost", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        vi.useFakeTimers({ toFake: ["Date"] });
        AIService = (await import("../ai/AIService")).AIService;
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.resetModules();
    });

    async function priceOf(config: Record<string, unknown>, metadata: Record<string, unknown>) {
        const { admin, memory } = buildMocks(config);
        mockGenerateStream.mockImplementation(finished(metadata));
        const service = new AIService(memory, admin, "http://admin.local");
        await drain(service.generateBotResponseStream("bot-1", 42, "hello", "You are a bot.", String(config.providerId), "space-1", ""));
        return admin.trackAIUsage.mock.calls[0][0];
    }

    const cached = { tokensUsed: 5200, promptTokens: 5000, completionTokens: 200, cachedPromptTokens: 4000 };

    it("sends a DeepSeek reply off-peak at the cache price: 1000 x 0.15 + 4000 x 0.003 + 200 x 0.6 = 282 millionths", async () => {
        vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
        const sent = await priceOf(provider(), cached);
        expect(sent.price).toMatchObject({
            costMicros: 282, costBasis: "priced", priceSource: "models.dev", priceVersion: expect.stringContaining("deepseek-off-peak"),
            inputTokens: 1000, cachedTokens: 4000, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 0,
        });
        // the old estimate is no longer sent
        expect(sent.cost).toBeUndefined();
        expect(sent).toMatchObject({ tokensUsed: 5200, providerId: "deepseek-flash" });
    });

    it("sends the same reply in DeepSeek's peak hours at twice the price", async () => {
        vi.setSystemTime(new Date("2026-10-26T02:00:00Z"));
        const sent = await priceOf(provider(), cached);
        expect(sent.price).toMatchObject({ costMicros: 564, priceVersion: expect.stringContaining("deepseek-peak") });
    });

    it("keeps a reply that cost 20 millionths as 20", async () => {
        vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
        const sent = await priceOf(provider(), { tokensUsed: 6666, promptTokens: 6666, completionTokens: 0, cachedPromptTokens: 6666 });
        expect(sent.price.costMicros).toBe(20);
    });

    it("sends an own computer as a real zero with the reason", async () => {
        const sent = await priceOf(provider({ providerId: "lmstudio-local", type: "lmstudio", endpoint: "http://localhost:1234", model: "qwen3-8b" }), { tokensUsed: 600, promptTokens: 500, completionTokens: 100 });
        expect(sent.price).toMatchObject({ costMicros: 0, costBasis: "own_computer", priceSource: null, priceVersion: null });
    });

    it("sends a model nobody lists as unknown, with no number and not $30 per million", async () => {
        const sent = await priceOf(provider({ providerId: "other", endpoint: "https://llm.example.org/v1", model: "some-new-model" }), { tokensUsed: 1000000, promptTokens: 900000, completionTokens: 100000 });
        expect(sent.price).toMatchObject({ costMicros: null, costBasis: "unknown" });
    });

    it("takes the cost OpenRouter reported for the reply", async () => {
        const sent = await priceOf(
            provider({ providerId: "or", endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash" }),
            { tokensUsed: 1200, promptTokens: 1000, completionTokens: 200, costUsd: 0.0000412 }
        );
        expect(sent.price).toMatchObject({ costMicros: 41, costBasis: "provider", priceSource: "provider" });
    });

    it("uses a super admin's own rate when one is set on the provider", async () => {
        const sent = await priceOf(provider({ settings: { costPerToken: 0.00001 } }), { tokensUsed: 1000, promptTokens: 800, completionTokens: 200 });
        expect(sent.price).toMatchObject({ costMicros: 10000, costBasis: "override" });
    });

    it("sends a reply the provider failed on as a real zero", async () => {
        const sent = await priceOf(provider(), { tokensUsed: 0, error: true });
        expect(sent.price).toMatchObject({ costMicros: 0, costBasis: "priced" });
        expect(sent.error).toBe(true);
    });

    it("sends a reply the provider gave no usage for as unknown, not as free", async () => {
        const sent = await priceOf(provider(), { tokensUsed: 0 });
        expect(sent.price).toMatchObject({ costMicros: null, costBasis: "unknown" });
    });
    it("leaves a call that was stopped from outside out of the reply's cost, and keeps the cost of the calls that finished (#1173)", async () => {
        vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
        const { admin, memory } = buildMocks(provider());
        const service = new AIService(memory, admin, "http://admin.local");
        const { UsageLedger } = await import("../ai/pricing/ledger");
        const ledger = new UsageLedger();
        const run = async (metadata: Record<string, unknown>) => {
            mockGenerateStream.mockImplementation(finished(metadata));
            await drain(service.meteredStream(ledger, "deepseek-flash", "sys", "hi", provider(), undefined, undefined, undefined));
        };
        await run(cached);
        await run({ tokensUsed: 0, error: false, cancelled: true });
        expect(ledger.summary()).toMatchObject({ basis: "priced", micros: 282 });
    });
});
