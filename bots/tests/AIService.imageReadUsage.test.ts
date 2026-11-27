/**
 * A look Universe AI's vision takes at an image is reported as the person's Universe AI use (G7, second audit; Opus consent read of #2145).
 * Universe pays for it, so it is never invisible: one usage report per call, on the provider that looked, priced from what it said, marked
 * `imageRead` so Orbit never counts it as a reply. The reply's own report is unchanged and never carries the look's tokens (no double count).
 * A look on the owner's other key ("Another model") is their own provider's bill and is not reported here.
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
const mockSupportsVision = vi.fn(() => false);
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: mockGetOrCreateProvider,
        supportsVision: mockSupportsVision,
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
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })), appendVisionDescription: vi.fn(), getPendingMediaNotice: vi.fn(() => "") };
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

const ownKey = (over: Record<string, unknown> = {}) => ({
    ...provider({ providerId: "key-abc", type: "openai", endpoint: "https://api.deepseek.com", model: "text-only" }),
    source: "own-key",
    keyOwnerId: "maker",
    keyAddressTyped: false,
    ...over,
});
const visionProvider = provider({ providerId: "vision-default", model: "vision-model", defaultVision: true, supportsVision: true });
const looked = { content: "A cat on a mat.", tokensUsed: 300, usage: { promptTokens: 250, completionTokens: 50 }, latency: 40 };
const images = ["https://cdn.example.com/cat.png"];

describe("a look Universe AI's vision takes at an image", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        mockGetOrCreateProvider.mockReset();
        mockSupportsVision.mockReset();
        mockSupportsVision.mockReturnValue(false);
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => vi.resetModules());

    const replyWithImages = (service: any, channel: "world" | "dm" = "world") =>
        drain(service.generateBotResponseStream("bot-1", 42, "what is this?", "You are a bot.", "key-abc", "space-1", "", undefined, undefined, undefined, images, channel));
    const setUp = (credentials: unknown, describer: unknown) => {
        const { admin, memory } = buildMocks();
        admin.getBotAiCredentials.mockResolvedValue(credentials);
        admin.getAvailableAIProviders.mockResolvedValue([visionProvider]);
        admin.getAIProviderCredentials.mockResolvedValue(visionProvider);
        mockGetOrCreateProvider.mockReturnValue(describer);
        mockGenerateStream.mockImplementation(answer);
        return { admin, service: new AIService(memory, admin, "http://admin.local") };
    };
    const reports = (admin: any) => admin.trackAIUsage.mock.calls.map((call: any[]) => call[0]);
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    it("is reported once as the person's Universe AI use on a Brick on their own key, apart from the reply, which runs on the key as before", async () => {
        const describer = { supportsVision: () => true, generate: vi.fn().mockResolvedValue(looked) };
        const { admin, service } = setUp(ownKey({ vision: { choice: "universe-ai" } }), describer);
        await replyWithImages(service, "dm");
        await settle();
        expect(describer.generate).toHaveBeenCalledTimes(1);
        const all = reports(admin);
        expect(all).toHaveLength(2);
        const look = all.find((entry: any) => entry.imageRead);
        const reply = all.find((entry: any) => !entry.imageRead);
        expect(look).toMatchObject({
            botId: "bot-1",
            providerId: "vision-default",
            imageRead: true,
            greeting: false,
            error: false,
            tokensUsed: 300,
            userId: "test-uuid",
            channel: "dm",
            price: { inputTokens: 250, outputTokens: 50, costBasis: expect.any(String) },
        });
        // The reply is the key's, with its own tokens only: the look is never in it, so nothing is counted twice
        expect(reply).toMatchObject({ providerId: "key-abc", tokensUsed: 5 });
        expect(reply).not.toHaveProperty("imageRead");
        expect(reply.price.inputTokens + reply.price.outputTokens).toBeLessThan(250);
    });

    it("is reported for a bot on Universe AI whose model can't see too: that spend was invisible as well", async () => {
        const describer = { supportsVision: () => true, generate: vi.fn().mockResolvedValue(looked) };
        const { admin, service } = setUp(ownKey({ source: "universe-ai", providerId: "deepseek-flash", keyOwnerId: undefined }), describer);
        await replyWithImages(service);
        await settle();
        expect(reports(admin).filter((entry: any) => entry.imageRead)).toEqual([expect.objectContaining({ providerId: "vision-default", channel: "nearby" })]);
    });

    it("is reported as a failed call (a real zero) when the provider throws, and the reply still goes", async () => {
        const describer = { supportsVision: () => true, generate: vi.fn().mockRejectedValue(new Error("vision down")) };
        const { admin, service } = setUp(ownKey({ vision: { choice: "universe-ai" } }), describer);
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await replyWithImages(service);
        await settle();
        spy.mockRestore();
        const look = reports(admin).find((entry: any) => entry.imageRead);
        expect(look).toMatchObject({ error: true, tokensUsed: 0, price: { costMicros: 0, costBasis: "priced" } });
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
    });

    it("is not reported when nothing was called: no default Vision provider", async () => {
        const { admin, memory } = buildMocks();
        admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "universe-ai" } }));
        admin.getAvailableAIProviders.mockResolvedValue([]);
        mockGenerateStream.mockImplementation(answer);
        const service = new AIService(memory, admin, "http://admin.local");
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        await replyWithImages(service);
        await settle();
        spy.mockRestore();
        expect(reports(admin).filter((entry: any) => entry.imageRead)).toEqual([]);
    });

    it("is not reported for the owner's other key (Another model): that is their own provider's bill", async () => {
        const describer = { supportsVision: () => true, generate: vi.fn().mockResolvedValue(looked) };
        const another = { ...provider({ providerId: "key-vis", model: "vision-model", supportsVision: true }), keyOwnerId: "maker", keyAddressTyped: false };
        const { admin, service } = setUp(ownKey({ vision: { choice: "another", credentials: another } }), describer);
        await replyWithImages(service);
        await settle();
        expect(describer.generate).toHaveBeenCalledTimes(1);
        expect(reports(admin).filter((entry: any) => entry.imageRead)).toEqual([]);
    });

    it("is not reported when the look was stopped (the reply was cut short), as a stopped reply is not", async () => {
        const { admin, memory } = buildMocks();
        const service: any = new AIService(memory, admin, "http://admin.local");
        const stopped = new AbortController();
        stopped.abort();
        service.trackImageRead({ botId: "bot-1", talker: { channel: "dm" } }, { config: visionProvider, response: looked, sentAt: new Date() }, stopped.signal);
        await settle();
        expect(admin.trackAIUsage).not.toHaveBeenCalled();
    });

    it("is reported for an image a file tool opens and Universe AI looks at, for the person in that chat", async () => {
        const { admin, memory } = buildMocks();
        const service: any = new AIService(memory, admin, "http://admin.local");
        service.describeImagesViaDefaultVision = vi.fn().mockResolvedValue("by Universe AI");
        const readFor = { botId: "bot-1", talker: { channel: "dm", userId: "test-uuid" } };
        const { look } = service.lookAtOpened({ choice: "universe-ai" }, "own-key", undefined, readFor);
        await look("https://x/y.png");
        expect(service.describeImagesViaDefaultVision).toHaveBeenCalledWith(["https://x/y.png"], undefined, readFor);
        const unplanned = service.lookAtOpened(undefined, "universe-ai", undefined, readFor);
        await unplanned.look("https://x/z.png");
        expect(service.describeImagesViaDefaultVision).toHaveBeenLastCalledWith(["https://x/z.png"], undefined, readFor);
    });
});
