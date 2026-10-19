/**
 * Tests for how AIService finds a bot's AI (#374).
 *
 * What must not change: a bot on a server provider (DeepSeek on the openai type, LM Studio on local) is served by
 * provider id exactly as before and Orbit's by-bot route is never asked. What is new: a bot on Universe AI or a
 * person's own key is resolved by Orbit for that bot, briefly cached, flagged as an own key, reported on, and rests
 * with one fixed line when its key is down and its owner chose Stop replying.
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
const mockGetOrCreateProvider = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: mockGetOrCreateProvider,
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
    providerId: "deepseek-flash",
    name: "DeepSeek V4 Flash",
    type: "openai",
    enabled: true,
    endpoint: "https://api.deepseek.com",
    apiKeyEncrypted: "iv:tag:data",
    model: "deepseek-v4-flash",
    temperature: 0.7,
    maxTokens: 512,
    supportsStreaming: true,
    supportsVision: null,
    visionModel: null,
    defaultVision: false,
    settings: {},
    ...over,
});

function buildMocks() {
    const admin: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue(provider()),
        getBotAiCredentials: vi.fn(),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })) };
    return { admin, memory };
}

async function* answer() {
    yield { content: "Hi!", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}
async function* failed(errorStatus?: number) {
    yield { content: "", done: true, metadata: { tokensUsed: 0, latency: 10, error: true, errorStatus } };
}

async function* toolCall() {
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe("AIService – finding a bot's AI by bot id", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => vi.resetModules());

    const reply = (service: any, ref: string, botId = "bot-1") =>
        drain(service.generateBotResponseStream(botId, 42, "hello", "You are a bot.", ref, "space-1", ""));

    describe("a server provider is untouched", () => {
        it.each(["deepseek-flash", "lmstudio-local", "any-id-at-all"])("%s is fetched by provider id and Orbit is never asked by bot", async (ref) => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, ref);
            expect(admin.getAIProviderCredentials).toHaveBeenCalledWith(ref);
            expect(admin.getBotAiCredentials).not.toHaveBeenCalled();
            expect(admin.reportAiHealth).not.toHaveBeenCalled();
            // No own-key flag: nothing about how it is called changes
            expect(mockGenerateStream.mock.calls[0][3].ownKey).toBeUndefined();
        });

        it("keeps a server provider for an hour, as before", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "deepseek-flash");
            await reply(service, "deepseek-flash");
            expect(admin.getAIProviderCredentials).toHaveBeenCalledTimes(1);
        });

        it("records usage against the provider, as before", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "deepseek-flash");
            expect(admin.trackAIUsage.mock.calls[0][0]).toMatchObject({ botId: "bot-1", providerId: "deepseek-flash" });
        });
    });

    describe("Universe AI", () => {
        it("is resolved for the bot, and usage goes to the provider that really answered", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue({ ...provider(), source: "universe-ai" });
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "universe-ai");
            expect(admin.getBotAiCredentials).toHaveBeenCalledWith("bot-1");
            expect(admin.getAIProviderCredentials).not.toHaveBeenCalled();
            expect(admin.trackAIUsage.mock.calls[0][0].providerId).toBe("deepseek-flash");
            expect(admin.reportAiHealth).not.toHaveBeenCalled();
        });

        it("is still priced: usage cost is not lost because the config came by bot id", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue({ ...provider(), source: "universe-ai" });
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "universe-ai");
            expect(service.calculateCost("deepseek-flash", { promptTokens: 1000, completionTokens: 1000 })).toBeGreaterThan(0);
            // the bot is on "universe-ai": the cost is looked up by that ref too
            expect(service.calculateCost("universe-ai", { promptTokens: 1000, completionTokens: 1000 })).toBeGreaterThan(0);
            // and the same call for a provider the service never saw is still 0, as before
            expect(service.calculateCost("never-seen", { promptTokens: 1000, completionTokens: 1000 })).toBe(0);
        });

        it("is asked again after 30 seconds, so a new Default reaches the next reply", async () => {
            vi.useFakeTimers();
            try {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValue({ ...provider(), source: "universe-ai" });
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await reply(service, "universe-ai");
                await reply(service, "universe-ai");
                expect(admin.getBotAiCredentials).toHaveBeenCalledTimes(1);
                vi.advanceTimersByTime(31_000);
                await reply(service, "universe-ai");
                expect(admin.getBotAiCredentials).toHaveBeenCalledTimes(2);
            } finally {
                vi.useRealTimers();
            }
        });

        it("falls back to the by-provider route when Orbit does not know the bot (or is older)", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(null);
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "universe-ai");
            expect(admin.getAIProviderCredentials).toHaveBeenCalledWith("universe-ai");
        });
    });

    describe("a person's own key", () => {
        const ownKey = (over: Record<string, unknown> = {}) => ({
            ...provider({ providerId: "key-abc", type: "lmstudio", endpoint: "https://lm.example.com", apiKeyEncrypted: null }),
            source: "own-key",
            keyOwnerId: "maker",
            keyAddressTyped: true,
            ...over,
        });

        it("is resolved for the bot and flagged, so the address guard applies to a typed address", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "key-abc");
            expect(mockGenerateStream.mock.calls[0][3]).toMatchObject({ providerId: "key-abc", ownKey: { addressTyped: true } });
        });

        it("does not apply the guard to a hosted key at its provider's own address", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey({ keyAddressTyped: false, type: "openai" }));
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "key-abc");
            expect(mockGenerateStream.mock.calls[0][3].ownKey).toEqual({ addressTyped: false });
        });

        it("applies the guard when Orbit does not say", async () => {
            const { admin, memory } = buildMocks();
            const { keyAddressTyped: _drop, ...withoutFlag } = ownKey();
            admin.getBotAiCredentials.mockResolvedValue(withoutFlag);
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "key-abc");
            expect(mockGenerateStream.mock.calls[0][3].ownKey).toEqual({ addressTyped: true });
        });

        it("tells Orbit a reply worked", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "key-abc");
            expect(admin.reportAiHealth).toHaveBeenCalledWith("bot-1", { ok: true });
        });

        it("tells Orbit a reply failed, and that the key was rejected when the provider said 401 or 403", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            mockGenerateStream.mockImplementationOnce(() => failed(500));
            await reply(service, "key-abc");
            mockGenerateStream.mockImplementationOnce(() => failed(401));
            await reply(service, "key-abc");
            mockGenerateStream.mockImplementationOnce(() => failed(403));
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([
                { ok: false, rejected: false, status: 500 },
                { ok: false, rejected: true, status: 401 },
                { ok: false, rejected: true, status: 403 },
            ]);
        });

        it("counts a reply whose follow-up after a tool failed as failed, and as rejected when that follow-up got a 401", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            mockGenerateStream.mockImplementationOnce(toolCall).mockImplementationOnce(() => failed(500));
            await reply(service, "key-abc");
            mockGenerateStream.mockImplementationOnce(toolCall).mockImplementationOnce(() => failed(401));
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([
                { ok: false, rejected: false, status: 500 },
                { ok: false, rejected: true, status: 401 },
            ]);
        });

        it("still counts a reply as worked when its tool follow-up worked", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            mockGenerateStream.mockImplementationOnce(toolCall).mockImplementationOnce(answer);
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([{ ok: true }]);
        });

        it("sends no status when the provider gave none (a dropped connection), and the provider's own status otherwise", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            mockGenerateStream.mockImplementationOnce(() => failed(undefined));
            await reply(service, "key-abc");
            mockGenerateStream.mockImplementationOnce(() => failed(429));
            await reply(service, "key-abc");
            mockGenerateStream.mockImplementationOnce(() => failed(400));
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([
                { ok: false, rejected: false },
                { ok: false, rejected: false, status: 429 },
                { ok: false, rejected: false, status: 400 },
            ]);
        });

        it("tells Orbit nothing when the reply was cancelled", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const controller = new AbortController();
            mockGenerateStream.mockImplementation(async function* () {
                controller.abort();
                yield { content: "", done: true, metadata: { tokensUsed: 0, latency: 1 } };
            });
            const service = new AIService(memory, admin, "http://admin.local");
            await drain(service.generateBotResponseStream("bot-1", 42, "hi", "You are a bot.", "key-abc", "space-1", "", undefined, undefined, controller.signal));
            expect(admin.reportAiHealth).not.toHaveBeenCalled();
        });
    });

    describe("a key that is down with Stop replying", () => {
        const resting = { source: "resting", keyOwnerId: "maker", restingLine: "I’m resting right now. Try me again later." };

        it("says the one fixed line, calls no AI and counts nothing", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(resting);
            const service = new AIService(memory, admin, "http://admin.local");
            const chunks = await reply(service, "key-abc");
            expect(chunks.map((chunk) => chunk.content).join("")).toBe("I’m resting right now. Try me again later.");
            expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
            expect(chunks.some((chunk) => chunk.metadata?.error)).toBe(false);
            expect(mockGenerateStream).not.toHaveBeenCalled();
            expect(admin.trackAIUsage).not.toHaveBeenCalled();
            expect(admin.reportAiHealth).not.toHaveBeenCalled();
        });

        it("makes the quick helper calls come back empty instead of reaching another AI", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(resting);
            const service = new AIService(memory, admin, "http://admin.local");
            expect(await service.quickGenerate("key-abc", "sys", "prompt", "bot-1")).toBe("");
            expect(await service.quickClassify("key-abc", "task", "msg", "bot-1")).toEqual({ action: "queue", message: "" });
            expect(admin.getAIProviderCredentials).not.toHaveBeenCalled();
        });
    });
});
