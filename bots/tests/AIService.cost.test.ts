/**
 * Tests for AI cost calculation, usage extraction, and streaming usage options (Issue #1173)
 *
 * Covers:
 * - DeepSeek peak vs off-peak UTC hours (weekdays 01:00–04:00 and 06:00–10:00 UTC)
 * - DeepSeek cached input tokens ($0.003/1M off-peak, $0.006/1M peak) vs uncached ($0.15/$0.30)
 * - LM Studio / local providers ($0, priceSource "own computer")
 * - OpenRouter replies with real usage.cost
 * - Expanded models.dev pricing (Gemini 2.5 Flash/Pro, GPT-5, Claude 4, Kimi, Qwen, GLM)
 * - Cheap replies ($0.00002 preserved as $0.00002, not rounded to $0)
 * - Unknown model without settings.costPerToken ("unknown" / null cost, no $30/1M flat rate)
 * - Explicit super-admin settings.costPerToken override
 * - OpenAIProvider streamed calls sending stream_options: { include_usage: true },
 *   parsing cached/reasoning/cost fields, and retrying without stream_options on 400
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

// --- Mock @sentry/node ---
const mockParentSpan = {
    end: vi.fn(),
    setAttribute: vi.fn(),
    spanContext: vi.fn(() => ({ spanId: "test-span-id", traceId: "test-trace-id" })),
};

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(mockParentSpan)),
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(mockParentSpan)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));

vi.mock("@sentry/core", () => ({
    _INTERNAL_setSpanForScope: vi.fn(),
}));

vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "decrypted-key"),
}));

vi.mock("../client/BotClient", () => ({
    BotClient: vi.fn(),
}));

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

function buildSSEStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const data = lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(data));
            controller.close();
        },
    });
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const item of gen) {
        out.push(item);
    }
    return out;
}

describe("AIService & OpenAIProvider – AI cost figures and streamed usage (#1173)", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function createServiceWithCachedProvider(config: Partial<AIProviderConfig> & { providerId: string }) {
        const mockAdminApiService: any = {
            getAIProviderCredentials: vi.fn().mockResolvedValue({
                providerId: config.providerId,
                name: config.name || "TestProvider",
                type: config.type || "openai",
                enabled: true,
                endpoint: config.endpoint || "https://api.deepseek.com/v1",
                apiKeyEncrypted: "enc",
                model: config.model ?? "deepseek-v4-flash",
                temperature: 0.7,
                maxTokens: 512,
                supportsStreaming: true,
                settings: config.settings || {},
            }),
            trackAIUsage: vi.fn().mockResolvedValue(undefined),
            getRoomMetadata: vi.fn().mockResolvedValue(null),
            getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        };
        const mockConversationMemory: any = {
            getMemory: vi.fn(() => ({ userUuid: "user-1" })),
        };
        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        // Seed credential cache directly for synchronous resolveCost / calculateCost tests
        (service as any).credentialCache.set(config.providerId, {
            credentials: {
                providerId: config.providerId,
                name: config.name || "TestProvider",
                type: config.type || "openai",
                enabled: true,
                endpoint: config.endpoint || "https://api.deepseek.com/v1",
                apiKeyEncrypted: "enc",
                model: config.model ?? "deepseek-v4-flash",
                temperature: 0.7,
                maxTokens: 512,
                supportsStreaming: true,
                settings: config.settings || {},
            },
            expiresAt: Date.now() + 3600_000,
        });
        return { service, mockAdminApiService };
    }

    describe("DeepSeek pricing: peak vs off-peak UTC and cached input tokens", () => {
        it("identifies DeepSeek peak hours on weekdays (01:00–04:00 and 06:00–10:00 UTC) and off-peak otherwise", () => {
            // Wednesday 2026-10-21
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T00:59:59Z"))).toBe(false);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T01:00:00Z"))).toBe(true);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T03:59:59Z"))).toBe(true);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T04:00:00Z"))).toBe(false);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T05:30:00Z"))).toBe(false);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T06:00:00Z"))).toBe(true);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T09:59:59Z"))).toBe(true);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T10:00:00Z"))).toBe(false);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-21T18:00:00Z"))).toBe(false);

            // Saturday 2026-10-24 and Sunday 2026-10-25 (weekends are always off-peak)
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-24T02:00:00Z"))).toBe(false);
            expect(AIService.isDeepSeekPeakUtc(new Date("2026-10-25T07:30:00Z"))).toBe(false);
        });

        it("calculates DeepSeek off-peak uncached cost ($0.15/1M in, $0.60/1M out)", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "deepseek-main",
                type: "openai",
                model: "deepseek-v4-flash",
            });

            // Off-peak: Wednesday 12:00 UTC
            // 10,000 input tokens ($0.0015) + 2,000 output tokens ($0.0012) = $0.0027
            const resolved = service.resolveCost(
                "deepseek-main",
                {
                    tokensUsed: 12000,
                    promptTokens: 10000,
                    completionTokens: 2000,
                    cachedTokens: 0,
                },
                new Date("2026-10-21T12:00:00Z")
            );

            expect(resolved.cost).toBe(0.0027);
            expect(resolved.priceSource).toBe("deepseek");
            expect(resolved.priceVersion).toBe("deepseek-2026-10-offpeak");
        });

        it("calculates DeepSeek off-peak cached input cost ($0.003/1M cached, $0.15/1M uncached, $0.60/1M out)", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "deepseek-main",
                type: "openai",
                model: "deepseek-v4-flash",
            });

            // 10,000 total prompt tokens, of which 8,000 are cache hits and 2,000 are cache misses, plus 1,000 output tokens
            // Uncached input: 2,000 * $0.15/1M = $0.0003
            // Cached input:   8,000 * $0.003/1M = $0.000024
            // Output:         1,000 * $0.60/1M = $0.0006
            // Total = $0.000924
            const resolved = service.resolveCost(
                "deepseek-main",
                {
                    tokensUsed: 11000,
                    promptTokens: 10000,
                    completionTokens: 1000,
                    cachedTokens: 8000,
                },
                new Date("2026-10-21T12:00:00Z")
            );

            expect(resolved.cost).toBe(0.000924);
            expect(resolved.priceSource).toBe("deepseek");
            expect(resolved.priceVersion).toBe("deepseek-2026-10-offpeak");
        });

        it("calculates DeepSeek peak cached and uncached cost ($0.30/1M in, $0.006/1M cached, $1.20/1M out)", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "deepseek-main",
                type: "openai",
                model: "deepseek-v4-flash",
            });

            // Peak: Wednesday 02:30 UTC
            // 10,000 total prompt tokens (8,000 cached, 2,000 uncached) + 1,000 output tokens
            // Uncached input: 2,000 * $0.30/1M = $0.0006
            // Cached input:   8,000 * $0.006/1M = $0.000048
            // Output:         1,000 * $1.20/1M = $0.0012
            // Total = $0.001848
            const resolved = service.resolveCost(
                "deepseek-main",
                {
                    tokensUsed: 11000,
                    promptTokens: 10000,
                    completionTokens: 1000,
                    cachedTokens: 8000,
                },
                new Date("2026-10-21T02:30:00Z")
            );

            expect(resolved.cost).toBe(0.001848);
            expect(resolved.priceSource).toBe("deepseek");
            expect(resolved.priceVersion).toBe("deepseek-2026-10-peak");
        });
    });

    describe("LM Studio and own-computer providers", () => {
        it("records $0 with priceSource 'own computer' for lmstudio", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "local-lmstudio",
                type: "lmstudio",
                model: "qwen2.5-7b-instruct",
            });

            const resolved = service.resolveCost("local-lmstudio", {
                tokensUsed: 5000,
                promptTokens: 4000,
                completionTokens: 1000,
            });

            expect(resolved.cost).toBe(0);
            expect(resolved.priceSource).toBe("own computer");
            expect(resolved.priceVersion).toBeNull();
        });
    });

    describe("OpenRouter usage.cost passthrough", () => {
        it("records the exact cost returned by OpenRouter in usage.cost", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "openrouter-key",
                type: "openai",
                endpoint: "https://openrouter.ai/api/v1",
                model: "anthropic/claude-sonnet-4",
            });

            const resolved = service.resolveCost("openrouter-key", {
                tokensUsed: 1500,
                promptTokens: 1200,
                completionTokens: 300,
                upstreamCost: 0.008123,
            });

            expect(resolved.cost).toBe(0.008123);
            expect(resolved.priceSource).toBe("openrouter");
        });
    });

    describe("Unknown models, cheap replies, and explicit costPerToken override", () => {
        it("marks an unknown model as 'unknown' with null cost instead of charging $30/1M", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "mystery-provider",
                type: "openai",
                model: "some-brand-new-unknown-model-99b",
            });

            const resolved = service.resolveCost("mystery-provider", {
                tokensUsed: 1000,
                promptTokens: 800,
                completionTokens: 200,
            });

            expect(resolved.cost).toBeNull();
            expect(resolved.priceSource).toBe("unknown");
            expect((service as any).calculateCost("mystery-provider", {
                tokensUsed: 1000,
                promptTokens: 800,
                completionTokens: 200,
            })).toBe(0);
        });

        it("honors explicit super-admin settings.costPerToken override", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "custom-priced",
                type: "openai",
                model: "some-brand-new-unknown-model-99b",
                settings: { costPerToken: 0.000002, markup: 1.5 },
            });

            const resolved = service.resolveCost("custom-priced", {
                tokensUsed: 1000,
                promptTokens: 800,
                completionTokens: 200,
            });

            expect(resolved.cost).toBe(0.003);
            expect(resolved.priceSource).toBe("custom");
        });

        it("preserves full precision on a $0.00002 reply instead of rounding to $0", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "gemini-flash",
                type: "openai",
                model: "gemini-2.0-flash", // $0.10/1M input ($0.0001/1K)
            });

            // 200 input tokens * $0.10/1M = $0.00002
            const resolved = service.resolveCost("gemini-flash", {
                tokensUsed: 200,
                promptTokens: 200,
                completionTokens: 0,
            });

            expect(resolved.cost).toBe(0.00002);
            expect(resolved.priceSource).toBe("models.dev");
        });

        it("prices Gemini 2.5 Flash at $0.30/1M in and $2.50/1M out", () => {
            const { service } = createServiceWithCachedProvider({
                providerId: "gemini-25-flash",
                type: "openai",
                model: "google/gemini-2.5-flash",
            });

            // 1,000 input ($0.0003) + 1,000 output ($0.0025) = $0.0028
            const resolved = service.resolveCost("gemini-25-flash", {
                tokensUsed: 2000,
                promptTokens: 1000,
                completionTokens: 1000,
            });

            expect(resolved.cost).toBe(0.0028);
            expect(resolved.priceSource).toBe("models.dev");
        });
    });

    describe("OpenAIProvider streamed usage & stream_options fallback", () => {
        const baseConfig: AIProviderConfig = {
            providerId: "openai-1",
            name: "TestOpenAI",
            type: "openai",
            enabled: true,
            endpoint: "https://api.openai.com/v1",
            apiKeyEncrypted: "fakeiv:fakeauth:fakedata",
            model: "gpt-4o",
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        };

        it("requests stream_options.include_usage=true and extracts cached_tokens, reasoning_tokens, and usage.cost", async () => {
            const provider = new OpenAIProvider();
            const sseLines = [
                JSON.stringify({ choices: [{ delta: { content: "Hi!" } }] }),
                JSON.stringify({
                    choices: [{ delta: {}, finish_reason: "stop" }],
                    usage: {
                        prompt_tokens: 1000,
                        completion_tokens: 200,
                        total_tokens: 1200,
                        prompt_tokens_details: { cached_tokens: 600 },
                        completion_tokens_details: { reasoning_tokens: 50 },
                        cost: 0.00425,
                    },
                }),
            ];

            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                body: buildSSEStream(sseLines),
                text: vi.fn().mockResolvedValue(""),
            });
            vi.stubGlobal("fetch", fetchMock);

            const chunks = await drain(provider.generateStream("sys", "hello", baseConfig));
            expect(fetchMock).toHaveBeenCalledTimes(1);

            const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(sentBody.stream).toBe(true);
            expect(sentBody.stream_options).toEqual({ include_usage: true });

            const doneChunk = chunks[chunks.length - 1];
            expect(doneChunk.done).toBe(true);
            expect(doneChunk.metadata).toMatchObject({
                tokensUsed: 1200,
                promptTokens: 1000,
                completionTokens: 200,
                cachedTokens: 600,
                reasoningTokens: 50,
                upstreamCost: 0.00425,
                error: false,
            });
        });

        it("extracts DeepSeek prompt_cache_hit_tokens from streamed usage chunk", async () => {
            const provider = new OpenAIProvider();
            const sseLines = [
                JSON.stringify({ choices: [{ delta: { content: "Reply" } }] }),
                JSON.stringify({
                    choices: [{ delta: {}, finish_reason: "stop" }],
                    usage: {
                        prompt_tokens: 2000,
                        completion_tokens: 100,
                        total_tokens: 2100,
                        prompt_cache_hit_tokens: 1500,
                        prompt_cache_miss_tokens: 500,
                    },
                }),
            ];

            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    body: buildSSEStream(sseLines),
                    text: vi.fn().mockResolvedValue(""),
                })
            );

            const chunks = await drain(
                provider.generateStream("sys", "hello", {
                    ...baseConfig,
                    endpoint: "https://api.deepseek.com/v1",
                    model: "deepseek-v4-flash",
                })
            );

            const doneChunk = chunks[chunks.length - 1];
            expect(doneChunk.metadata).toMatchObject({
                tokensUsed: 2100,
                promptTokens: 2000,
                completionTokens: 100,
                cachedTokens: 1500,
            });
        });

        it("retries without stream_options when a provider rejects stream_options with 400", async () => {
            const provider = new OpenAIProvider();
            const sseLines = [
                JSON.stringify({ choices: [{ delta: { content: "Recovered" } }] }),
                JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
            ];

            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce({
                    ok: false,
                    status: 400,
                    text: vi.fn().mockResolvedValue(
                        JSON.stringify({
                            error: {
                                message: "Unknown parameter: 'stream_options'.",
                                type: "invalid_request_error",
                                param: "stream_options",
                            },
                        })
                    ),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    body: buildSSEStream(sseLines),
                    text: vi.fn().mockResolvedValue(""),
                });

            vi.stubGlobal("fetch", fetchMock);

            const chunks = await drain(provider.generateStream("sys", "hello", baseConfig));
            expect(fetchMock).toHaveBeenCalledTimes(2);

            const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
            expect(firstBody.stream_options).toEqual({ include_usage: true });
            expect(secondBody.stream_options).toBeUndefined();

            const contentChunks = chunks.filter((c) => c.content);
            expect(contentChunks.map((c) => c.content).join("")).toBe("Recovered");
            expect(chunks[chunks.length - 1].metadata?.error).toBe(false);
        });

        it("forwards cachedTokens, reasoningTokens, cost, priceSource, and priceVersion to AdminApiService.trackAIUsage on a streamed DeepSeek turn", async () => {
            const { service, mockAdminApiService } = createServiceWithCachedProvider({
                providerId: "deepseek-stream-provider",
                type: "openai",
                endpoint: "https://api.deepseek.com/v1",
                model: "deepseek-v4-flash",
            });

            const sseLines = [
                JSON.stringify({ choices: [{ delta: { content: "Hello from DeepSeek! [EMOTION_UPDATE]{\"personSentiment\":10,\"isInsult\":false,\"insultSeverity\":0,\"context\":\"sincere\"}[/EMOTION_UPDATE]" } }] }),
                JSON.stringify({
                    choices: [{ delta: {}, finish_reason: "stop" }],
                    usage: {
                        prompt_tokens: 1000,
                        completion_tokens: 500,
                        total_tokens: 1500,
                        prompt_cache_hit_tokens: 800,
                        completion_tokens_details: { reasoning_tokens: 100 },
                    },
                }),
            ];

            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    body: buildSSEStream(sseLines),
                    text: vi.fn().mockResolvedValue(""),
                })
            );

            await drain(
                service.generateBotResponseStream(
                    "bot-1",
                    42,
                    "Hi!",
                    "You are a helpful bot.",
                    "deepseek-stream-provider",
                    "space-1",
                    ""
                )
            );

            expect(mockAdminApiService.trackAIUsage).toHaveBeenCalledTimes(1);
            const tracked = mockAdminApiService.trackAIUsage.mock.calls[0][0];
            expect(tracked.promptTokens).toBe(1000);
            expect(tracked.completionTokens).toBe(500);
            expect(tracked.cachedTokens).toBe(800);
            expect(tracked.reasoningTokens).toBe(100);
            expect(tracked.priceSource).toBe("deepseek");
            expect(tracked.priceVersion).toMatch(/^deepseek-2026-10-(peak|offpeak)$/);
            expect(typeof tracked.cost).toBe("number");
            expect(tracked.cost).toBeGreaterThan(0);
        });
    });
});
