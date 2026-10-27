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
            // and the same call for a provider the service never saw has no price: unknown, not 0 (#1173)
            expect(service.calculateCost("never-seen", { promptTokens: 1000, completionTokens: 1000 })).toBeUndefined();
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

        describe("when Orbit cannot be reached", () => {
            beforeEach(() => vi.useFakeTimers());
            afterEach(() => vi.useRealTimers());

            it("keeps replying on the last answer for a while, and tries Orbit again soon", async () => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValueOnce({ ...provider(), source: "universe-ai" });
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await reply(service, "universe-ai");
                admin.getBotAiCredentials.mockRejectedValue(new Error("Orbit is down"));
                vi.advanceTimersByTime(31_000);
                const chunks = await reply(service, "universe-ai");
                expect(chunks.some((chunk) => chunk.content === "Hi!")).toBe(true);
                expect(admin.getBotAiCredentials).toHaveBeenCalledTimes(2);
                // not asked again on every reply while it is down
                await reply(service, "universe-ai");
                expect(admin.getBotAiCredentials).toHaveBeenCalledTimes(2);
                vi.advanceTimersByTime(16_000);
                await reply(service, "universe-ai");
                expect(admin.getBotAiCredentials).toHaveBeenCalledTimes(3);
            });

            it("stops using the last answer after ten minutes, and fails as before when there never was one", async () => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValueOnce({ ...provider(), source: "universe-ai" });
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await reply(service, "universe-ai");
                admin.getBotAiCredentials.mockRejectedValue(new Error("Orbit is down"));
                vi.advanceTimersByTime(11 * 60 * 1000);
                const expired = await reply(service, "universe-ai");
                expect(expired.some((chunk) => chunk.content === "Hi!")).toBe(false);
                expect(expired[expired.length - 1].metadata?.error).toBe(true);
                const fresh = new AIService(memory, admin, "http://admin.local");
                const never = await reply(fresh, "universe-ai");
                expect(never.some((chunk) => chunk.content === "Hi!")).toBe(false);
                expect(never[never.length - 1].metadata?.error).toBe(true);
            });
        });

        it("falls back to the by-provider route when Orbit does not know the bot (or is older)", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(null);
            mockGenerateStream.mockImplementation(answer);
            const service = new AIService(memory, admin, "http://admin.local");
            await reply(service, "universe-ai");
            expect(admin.getAIProviderCredentials).toHaveBeenCalledWith("universe-ai");
            // usage on this route is priced by the provider that answered, not left at 0
            expect(service.calculateCost("deepseek-flash", { promptTokens: 1000, completionTokens: 1000 })).toBeGreaterThan(0);
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

        describe("images", () => {
            const images = ["https://cdn.example.com/cat.png"];
            const replyWithImages = (service: any) =>
                drain(service.generateBotResponseStream("bot-1", 42, "what is this?", "You are a bot.", "key-abc", "space-1", "", undefined, undefined, undefined, images));

            beforeEach(() => {
                mockSupportsVision.mockReset();
                mockSupportsVision.mockReturnValue(false);
                mockGetOrCreateProvider.mockReset();
            });

            it("are never described by Universe AI when the key's model has no Vision: the link stays in the text", async () => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValue(ownKey());
                admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await replyWithImages(service);
                expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
                expect(mockGetOrCreateProvider).not.toHaveBeenCalled();
                expect(mockGenerateStream.mock.calls[0][2]).not.toContain("Description from a vision model");
                expect(mockGenerateStream.mock.calls[0].slice(4)).not.toContainEqual(images);
            });

            it("go to the key's own model when it has Vision", async () => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValue(ownKey());
                mockSupportsVision.mockReturnValue(true);
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await replyWithImages(service);
                expect(mockGenerateStream.mock.calls[0]).toContainEqual(images);
                expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
            });

            it("are still described by the default Vision provider for a bot on Universe AI without Vision, as before", async () => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockResolvedValue(ownKey({ source: "universe-ai", providerId: "universe-ai-default" }));
                admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                const describer = { supportsVision: () => true, generate: vi.fn().mockResolvedValue({ content: "A cat." }) };
                mockGetOrCreateProvider.mockReturnValue(describer);
                mockGenerateStream.mockImplementation(answer);
                const service = new AIService(memory, admin, "http://admin.local");
                await replyWithImages(service);
                expect(describer.generate).toHaveBeenCalledTimes(1);
            });

            describe("with the Vision row set", () => {
                const visionKey = (over: Record<string, unknown> = {}) => ({
                    ...provider({ providerId: "key-vis", type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash-vision-exp", supportsVision: true }),
                    keyOwnerId: "maker",
                    keyAddressTyped: false,
                    ...over,
                });
                const describerSaying = (content: string) => {
                    const describer = { supportsVision: () => true, generate: vi.fn().mockResolvedValue({ content }) };
                    mockGetOrCreateProvider.mockReturnValue(describer);
                    return describer;
                };

                it("Another model: the picked Vision model on the same key looks, the bot's own model answers from the description", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "another", credentials: visionKey() } }));
                    const describer = describerSaying("A cat on a sofa.");
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(describer.generate).toHaveBeenCalledTimes(1);
                    expect(mockGetOrCreateProvider.mock.calls[0][0]).toMatchObject({ providerId: "key-vis", model: "deepseek-v4-flash-vision-exp", ownKey: { addressTyped: false } });
                    expect(describer.generate.mock.calls[0][5]).toEqual(images);
                    expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
                    expect(mockGenerateStream.mock.calls[0][2]).toContain("A cat on a sofa.");
                    expect(mockGenerateStream.mock.calls[0]).not.toContainEqual(images);
                    expect(mockGenerateStream.mock.calls[0][3]).toMatchObject({ providerId: "key-abc" });
                });

                it("Another model: the model picked is the one that looks, whatever the key row also declares", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(
                        ownKey({ vision: { choice: "another", credentials: visionKey({ visionModel: "some-other-model", supportsVision: false }) } })
                    );
                    describerSaying("A boat.");
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(mockGetOrCreateProvider.mock.calls[0][0]).toMatchObject({ model: "deepseek-v4-flash-vision-exp", supportsVision: true, visionModel: null });
                });

                it("Another model: a typed address on that key still goes through the address guard", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "another", credentials: visionKey({ keyAddressTyped: true }) } }));
                    describerSaying("A dog.");
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(mockGetOrCreateProvider.mock.calls[0][0].ownKey).toEqual({ addressTyped: true });
                });

                it("Another model: if the description fails, the link stays in the text and Universe AI is never asked", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "another", credentials: visionKey() } }));
                    admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                    mockGetOrCreateProvider.mockReturnValue({ supportsVision: () => true, generate: vi.fn().mockRejectedValue(new Error("boom")) });
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
                    expect(mockGenerateStream.mock.calls[0][2]).not.toContain("Description from a vision model");
                    expect(mockGenerateStream.mock.calls[0]).not.toContainEqual(images);
                });

                it("Another model whose key can't be read: the images stay with the bot's own model, never Universe AI", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "another", credentials: visionKey() } }));
                    admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                    const { decryptApiKey } = await import("../ai/encryption");
                    (decryptApiKey as any).mockImplementationOnce(() => "ok").mockImplementationOnce(() => {
                        throw new Error("bad key");
                    });
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
                    expect(mockGetOrCreateProvider).not.toHaveBeenCalled();
                    expect(mockGenerateStream.mock.calls[0]).not.toContainEqual(images);
                });

                it("Universe AI: the default Vision provider looks, because the owner picked it", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "universe-ai" } }));
                    admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                    const describer = describerSaying("A tree.");
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(describer.generate).toHaveBeenCalledTimes(1);
                    expect(mockGenerateStream.mock.calls[0][2]).toContain("A tree.");
                });

                it("This model without Vision: the link stays in the text and nothing else looks", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ source: "universe-ai", providerId: "universe-ai-default", vision: { choice: "this" } }));
                    admin.getAvailableAIProviders.mockResolvedValue([provider({ defaultVision: true, supportsVision: true })]);
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(admin.getAvailableAIProviders).not.toHaveBeenCalled();
                    expect(mockGetOrCreateProvider).not.toHaveBeenCalled();
                    expect(mockGenerateStream.mock.calls[0]).not.toContainEqual(images);
                });

                it("This model with Vision: the images go to it, as one call", async () => {
                    const { admin, memory } = buildMocks();
                    admin.getBotAiCredentials.mockResolvedValue(ownKey({ vision: { choice: "this" } }));
                    mockSupportsVision.mockReturnValue(true);
                    mockGenerateStream.mockImplementation(answer);
                    const service = new AIService(memory, admin, "http://admin.local");
                    await replyWithImages(service);
                    expect(mockGenerateStream.mock.calls[0]).toContainEqual(images);
                    expect(mockGetOrCreateProvider).not.toHaveBeenCalled();
                });
            });
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

        it("counts a reply as failed when the first call broke off after its tool calls, even if the follow-up worked", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            async function* brokenOffAfterToolCall() {
                yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
                yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: true, errorStatus: 502 } };
            }
            mockGenerateStream.mockImplementationOnce(brokenOffAfterToolCall).mockImplementationOnce(answer);
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([{ ok: false, rejected: false, status: 502 }]);
        });

        it("counts a reply as failed when the second try after nameless tool calls got an error, and as rejected on a 401", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(ownKey());
            const service = new AIService(memory, admin, "http://admin.local");
            async function* namelessToolCall() {
                yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "", arguments: "{}" }] };
                yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
            }
            mockGenerateStream.mockImplementationOnce(namelessToolCall).mockImplementationOnce(() => failed(401));
            await reply(service, "key-abc");
            expect(admin.reportAiHealth.mock.calls.map((call: any[]) => call[1])).toEqual([{ ok: false, rejected: true, status: 401 }]);
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

        it("remembers the resting line, so a repeat of it is not treated as a repetition to regenerate", async () => {
            const { admin, memory } = buildMocks();
            admin.getBotAiCredentials.mockResolvedValue(resting);
            const service = new AIService(memory, admin, "http://admin.local");
            expect(service.isRestingLine("I’m resting right now. Try me again later.")).toBe(false);
            await reply(service, "key-abc");
            expect(service.isRestingLine("I’m resting right now. Try me again later.")).toBe(true);
            expect(service.isRestingLine("  I’m resting right now. Try me again later. ")).toBe(true);
            expect(service.isRestingLine("Something else the bot said")).toBe(false);
        });

        describe("a slow credential lookup on the quick helper calls", () => {
            beforeEach(() => vi.useFakeTimers());
            afterEach(() => vi.useRealTimers());

            const slowLookup = (ms: number) => {
                const { admin, memory } = buildMocks();
                admin.getBotAiCredentials.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(provider({ providerId: "key-abc" })), ms)));
                const generate = vi.fn(async (_system: string, _prompt: string, _config: unknown, _history?: unknown, signal?: AbortSignal) => ({ content: `ok:${signal?.aborted}` }));
                mockGetOrCreateProvider.mockReturnValue({ generate });
                return { service: new AIService(memory, admin, "http://admin.local"), generate };
            };

            it("still gives the provider call its full time, instead of starting it already aborted", async () => {
                const { service, generate } = slowLookup(2500);
                const pending = service.quickGenerate("key-abc", "sys", "prompt", "bot-1");
                await vi.advanceTimersByTimeAsync(2500);
                expect(await pending).toBe("ok:false");
                expect(generate).toHaveBeenCalledTimes(1);
            });

            it("gives up on a lookup that takes longer than the quick deadline, without calling the provider", async () => {
                const { service, generate } = slowLookup(10000);
                const pending = service.quickGenerate("key-abc", "sys", "prompt", "bot-1");
                await vi.advanceTimersByTimeAsync(3500);
                expect(await pending).toBe("");
                expect(generate).not.toHaveBeenCalled();
            });
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
