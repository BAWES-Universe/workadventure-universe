/**
 * What AIService tells the Claude provider about its prompt, and what it does with the cache figures that come back
 * (#975): the fixed part of the system prompt is named by offsets, and a turn's cache reads and writes reach the usage
 * call, the PostHog events and the Sentry span.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));

const mockCaptureAiGeneration = vi.fn();
const mockCaptureAiTrace = vi.fn();
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: mockCaptureAiGeneration,
    captureAiTrace: mockCaptureAiTrace,
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));

const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({ generateStream: mockGenerateStream })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

/** A call that, like the registry, tells the config what it read from and wrote to the cache before its closing chunk */
function call(options: { read?: number; write?: number; prompt: number; completion: number; text?: string; tool?: boolean; cached?: number }) {
    return async function* (_providerId: string, _system: string, _message: string, config: any) {
        if (options.tool) yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
        else yield { content: options.text ?? "Hello there.", done: false };
        if (options.read || options.write) config.onCacheTokens?.(options.read ?? 0, options.write ?? 0);
        yield {
            content: "",
            done: true,
            metadata: {
                tokensUsed: options.prompt + options.completion,
                promptTokens: options.prompt,
                completionTokens: options.completion,
                cachedPromptTokens: options.cached,
                cacheReadTokens: options.read,
                cacheWriteTokens: options.write,
                latency: 10,
                error: false,
                truncated: false,
            },
        };
    };
}

function buildMocks(roomName: string | null = null) {
    const admin: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "test-provider",
            name: "TestBot",
            type: "anthropic",
            enabled: true,
            endpoint: "https://api.anthropic.com/v1",
            apiKeyEncrypted: null,
            model: "claude-sonnet-5-5",
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(roomName ? { universeName: "Uni", worldName: "World", roomName } : null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })), getPendingMediaNotice: vi.fn(() => undefined) };
    return { admin, memory };
}

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe("AIService and the provider's prompt cache", () => {
    let AIService: any;
    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        AIService = (await import("../ai/AIService")).AIService;
    });
    afterEach(() => {
        vi.resetModules();
    });

    const run = async (service: any, admin: any, instructions = "You are a bot.", botClient?: any) =>
        drain(service.generateBotResponseStream("bot-1", 42, "hi", instructions, "test-provider", "space-1", "", botClient, admin));

    describe("the fixed part of the system prompt", () => {
        it("names the end of the fixed rules, so everything before it is the same for every message", async () => {
            const { admin, memory } = buildMocks();
            let config: any;
            let system = "";
            mockGenerateStream.mockImplementationOnce(async function* (_p: string, s: string, _m: string, c: any) {
                system = s;
                config = c;
                yield { content: "ok", done: false };
                yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1 } };
            });
            await run(new AIService(memory, admin, "http://admin.local"), admin, "Be a pirate.");

            expect(config.promptCacheEnds).toHaveLength(1);
            const fixed = system.slice(0, config.promptCacheEnds[0]);
            expect(fixed.startsWith("Be a pirate.")).toBe(true);
            // The instructions with the personality wrapper, then the rules that are the same for everyone
            expect(fixed).toContain("takes precedence over any conflicting technical rules below.");
            // What follows is what changes: the person's memory and the day
            expect(system.slice(config.promptCacheEnds[0])).toContain("**NOW:**");
            expect(fixed).not.toContain("**NOW:**");
        });

        it("names the end of the room too when the bot knows where it is", async () => {
            const { admin, memory } = buildMocks("Lobby");
            let config: any;
            let system = "";
            mockGenerateStream.mockImplementationOnce(async function* (_p: string, s: string, _m: string, c: any) {
                system = s;
                config = c;
                yield { content: "ok", done: false };
                yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1 } };
            });
            await run(new AIService(memory, admin, "http://admin.local"), admin, "Be a pirate.", { getRoomUrl: () => "https://play.example/@/uni/world/lobby" });

            expect(config.promptCacheEnds).toHaveLength(2);
            const [rules, room] = config.promptCacheEnds;
            expect(system.slice(rules, room)).toMatch(/^\n\nCurrent Location Context[\s\S]*- Room: Lobby/);
            expect(system.slice(room).startsWith("\n\n**NOW:**")).toBe(true);
        });

        it("hands every call of a turn the same hint", async () => {
            const { admin, memory } = buildMocks();
            const seen: any[] = [];
            const record = (inner: ReturnType<typeof call>) =>
                async function* (p: string, s: string, m: string, c: any) {
                    seen.push(c.promptCacheEnds);
                    yield* inner(p, s, m, c);
                };
            mockGenerateStream
                .mockImplementationOnce(record(call({ prompt: 100, completion: 10, tool: true })))
                .mockImplementationOnce(record(call({ prompt: 200, completion: 20, text: "By the fountain." })));
            await run(new AIService(memory, admin, "http://admin.local"), admin);
            expect(seen).toHaveLength(2);
            expect(seen[0]).toEqual(seen[1]);
        });
    });

    describe("a turn that used the cache", () => {
        it("sends the usage call the cache reads and writes, inside the prompt tokens", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementationOnce(call({ prompt: 3025, completion: 7, read: 3000 }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);
            expect(admin.trackAIUsage).toHaveBeenCalledTimes(1);
            expect(admin.trackAIUsage.mock.calls[0][0]).toMatchObject({ promptTokens: 3025, completionTokens: 7, tokensUsed: 3032, cacheReadTokens: 3000 });
            expect(admin.trackAIUsage.mock.calls[0][0]).not.toHaveProperty("cacheWriteTokens");
        });

        it("adds the cache figures of a tool round to the turn's, and gives each PostHog event its own call's share", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(call({ prompt: 3100, completion: 10, write: 3000, tool: true }))
                .mockImplementationOnce(call({ prompt: 3200, completion: 20, read: 3000, text: "By the fountain." }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);

            const usage = admin.trackAIUsage.mock.calls[0][0];
            expect(usage).toMatchObject({ promptTokens: 6300, cacheReadTokens: 3000, cacheWriteTokens: 3000 });

            const events = mockCaptureAiGeneration.mock.calls.map((args) => args[0]);
            expect(events).toHaveLength(2);
            expect(events[0]).toMatchObject({ inputTokens: 3100, cacheWriteTokens: 3000 });
            expect(events[0].cacheReadTokens).toBe(0);
            expect(events[1]).toMatchObject({ inputTokens: 3200, cacheReadTokens: 3000 });
            expect(events[1].cacheWriteTokens).toBe(0);

            expect(mockCaptureAiTrace.mock.calls[0][0]).toMatchObject({ inputTokens: 6300, cacheReadTokens: 3000, cacheWriteTokens: 3000 });
        });

        it("does not hand a tool-only round's cache figures to the next round's event", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream
                .mockImplementationOnce(call({ prompt: 3100, completion: 10, write: 3000, tool: true }))
                .mockImplementationOnce(call({ prompt: 3150, completion: 10, read: 3000, tool: true }))
                .mockImplementationOnce(call({ prompt: 3200, completion: 20, read: 3000, text: "By the fountain." }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);

            const events = mockCaptureAiGeneration.mock.calls.map((args) => args[0]);
            const last = events[events.length - 1];
            expect(last).toMatchObject({ inputTokens: 3200, cacheReadTokens: 3000 });
            expect(last.cacheReadTokens).toBeLessThanOrEqual(last.inputTokens);

            // The turn still adds every round up
            expect(admin.trackAIUsage.mock.calls[0][0]).toMatchObject({ cacheReadTokens: 6000, cacheWriteTokens: 3000 });
        });

        it("keeps the ledger's cache reads on the Sentry span when the provider's own cached figure is smaller", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementationOnce(call({ prompt: 3025, completion: 7, read: 3000, cached: 1000 }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);

            const reads = mockParentSpan.setAttribute.mock.calls.filter(([key]) => key === "gen_ai.usage.cache_read.input_tokens");
            expect(reads.length).toBeGreaterThan(0);
            expect(reads[reads.length - 1][1]).toBe(3000);
        });

        it("keeps the provider's cached figure on the Sentry span when it reports cache writes but no ledger reads", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementationOnce(call({ prompt: 3025, completion: 7, write: 500, cached: 1000 }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);

            const reads = mockParentSpan.setAttribute.mock.calls.filter(([key]) => key === "gen_ai.usage.cache_read.input_tokens");
            expect(reads[reads.length - 1][1]).toBe(1000);
            const writes = mockParentSpan.setAttribute.mock.calls.filter(([key]) => key === "gen_ai.usage.cache_creation.input_tokens");
            expect(writes[writes.length - 1][1]).toBe(500);
        });

        it("puts the cache figures on the turn's Sentry span, the cached tokens inside input_tokens", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementationOnce(call({ prompt: 3025, completion: 7, read: 3000, write: 20 }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);
            const attributes = Object.fromEntries(mockParentSpan.setAttribute.mock.calls);
            expect(attributes).toMatchObject({
                "gen_ai.usage.input_tokens": 3025,
                "gen_ai.usage.output_tokens": 7,
                "gen_ai.usage.cache_read.input_tokens": 3000,
                "gen_ai.usage.cache_creation.input_tokens": 20,
            });
        });
    });

    describe("a turn that did not (DeepSeek, LM Studio, a Claude reply under the minimum)", () => {
        it("sends the usage call, PostHog and Sentry exactly what it sent before", async () => {
            const { admin, memory } = buildMocks();
            mockGenerateStream.mockImplementationOnce(call({ prompt: 30, completion: 3 }));
            await run(new AIService(memory, admin, "http://admin.local"), admin);

            const usage = admin.trackAIUsage.mock.calls[0][0];
            expect(usage).toMatchObject({ promptTokens: 30, completionTokens: 3, tokensUsed: 33 });
            expect(usage).not.toHaveProperty("cacheReadTokens");
            expect(usage).not.toHaveProperty("cacheWriteTokens");
            for (const [event] of mockCaptureAiGeneration.mock.calls) {
                expect(event).not.toHaveProperty("cacheReadTokens");
                expect(event).not.toHaveProperty("cacheWriteTokens");
            }
            expect(mockCaptureAiTrace.mock.calls[0][0]).not.toHaveProperty("cacheReadTokens");
            expect(mockParentSpan.setAttribute.mock.calls.map(([name]) => name).filter((name) => String(name).startsWith("gen_ai.usage"))).toEqual([]);
        });
    });
});
