/**
 * What the OpenAI-format provider reports about a call, for pricing it (#1173): cached input, cache writes, reasoning
 * tokens and the cost OpenRouter sends, in streamed and plain replies; and asking every stream to end with its usage,
 * with one retry when a provider does not know the option.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const mockSpan = { setAttribute: vi.fn(), setStatus: vi.fn() };
vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb(mockSpan)),
    startSpanManual: vi.fn(),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "key") }));

import { OpenAIProvider, readUsageDetail, refusesStreamOptions } from "../ai/providers/OpenAIProvider";
import { AIProviderRegistry } from "../ai/AIProviderRegistry";
import type { AIProviderConfig } from "../ai/types";

function config(endpoint: string, extra: Partial<AIProviderConfig> = {}): AIProviderConfig {
    return {
        providerId: "p1", name: "Test", type: "openai", enabled: true, endpoint, apiKeyEncrypted: "iv:auth:data",
        model: "deepseek-v4-flash", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {}, ...extra,
    };
}

function streamResponse(usage?: Record<string, unknown>) {
    const encoder = new TextEncoder();
    const lines = [
        JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        // With include_usage the usage comes in a last chunk that has no choices
        ...(usage ? [JSON.stringify({ choices: [], usage })] : []),
    ];
    return {
        ok: true,
        status: 200,
        body: new ReadableStream({ start(c) { c.enqueue(encoder.encode(lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n")); c.close(); } }),
        text: vi.fn().mockResolvedValue(""),
    };
}

const refused = (message: string, status = 400) => ({ ok: false, status, text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message } })) });

async function lastChunk(gen: AsyncGenerator<any>) {
    let last: any;
    for await (const chunk of gen) last = chunk;
    return last;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("readUsageDetail", () => {
    it("reads DeepSeek's cache hits and reasoning tokens", () => {
        expect(readUsageDetail({ prompt_tokens: 5000, completion_tokens: 400, prompt_cache_hit_tokens: 4000, completion_tokens_details: { reasoning_tokens: 300 } })).toEqual({
            cachedPromptTokens: 4000, reasoningTokens: 300,
        });
    });

    it("reads OpenAI's cached tokens", () => {
        expect(readUsageDetail({ prompt_tokens_details: { cached_tokens: 2048 } })).toEqual({ cachedPromptTokens: 2048 });
    });

    it("reads what OpenRouter adds: cache writes and the cost of the call", () => {
        expect(readUsageDetail({ prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 900 }, cost: 0.0042 })).toEqual({
            cachedPromptTokens: 100, cacheWriteTokens: 900, costUsd: 0.0042,
        });
    });

    it("keeps a reported zero (free) and leaves out what was not sent", () => {
        expect(readUsageDetail({ cost: 0, prompt_tokens: 10 })).toEqual({ costUsd: 0 });
        expect(readUsageDetail({ prompt_tokens: 10 })).toEqual({});
        expect(readUsageDetail(undefined)).toEqual({});
        expect(readUsageDetail({ cost: "free" })).toEqual({});
    });
});

describe("streamed replies", () => {
    it("ask for usage and carry what the provider reports on the done chunk", async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse({ prompt_tokens: 5000, completion_tokens: 400, prompt_cache_hit_tokens: 4000, completion_tokens_details: { reasoning_tokens: 300 }, cost: 0.001 }));
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config("https://stream-asks.example/v1")));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
        expect(last.metadata).toMatchObject({ promptTokens: 5000, completionTokens: 400, tokensUsed: 5400, cachedPromptTokens: 4000, reasoningTokens: 300, costUsd: 0.001, error: false });
        expect("cacheWriteTokens" in last.metadata).toBe(false);
    });

    it("ask DeepSeek too, which is where Universe AI runs", async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse({ prompt_tokens: 10, completion_tokens: 2 }));
        vi.stubGlobal("fetch", fetchMock);
        await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config("https://api.deepseek.com")));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
    });

    it("are retried once without the option when the provider does not know it, and it is not asked again", async () => {
        const endpoint = "https://old-provider.example/v1";
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(refused("Unknown parameter: stream_options"))
            .mockResolvedValue(streamResponse({ prompt_tokens: 7, completion_tokens: 3 }));
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAIProvider();

        const first = await lastChunk(provider.generateStream("sys", "hi", config(endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
        expect("stream_options" in JSON.parse(fetchMock.mock.calls[1][1].body)).toBe(false);
        expect(first.metadata).toMatchObject({ promptTokens: 7, completionTokens: 3, error: false });

        await lastChunk(provider.generateStream("sys", "again", config(endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect("stream_options" in JSON.parse(fetchMock.mock.calls[2][1].body)).toBe(false);
    });

    it("are not retried for an error that is about something else", async () => {
        const fetchMock = vi.fn().mockResolvedValue(refused("Invalid API key", 401));
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config("https://other-error.example/v1")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(last.metadata).toMatchObject({ error: true, errorStatus: 401 });
    });
});

describe("refusesStreamOptions", () => {
    it("recognises a 400 or 422 that names the option, and nothing else", () => {
        expect(refusesStreamOptions(400, "Unknown parameter: stream_options")).toBe(true);
        expect(refusesStreamOptions(422, '{"detail":"extra fields not permitted: include_usage"}')).toBe(true);
        expect(refusesStreamOptions(400, "temperature is invalid")).toBe(false);
        expect(refusesStreamOptions(500, "stream_options")).toBe(false);
    });
});

describe("plain replies", () => {
    const plain = (usage: Record<string, unknown>) =>
        vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }], usage, model: "m" }), text: vi.fn().mockResolvedValue("") });

    it("carry the usage split, cache and cost on the response", async () => {
        vi.stubGlobal("fetch", plain({ total_tokens: 130, prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 60 }, cost: 0.5 }));
        const response = await new OpenAIProvider().generate("sys", "hi", config("https://plain.example/v1"));
        expect(response.usage).toEqual({ promptTokens: 100, completionTokens: 30, cachedPromptTokens: 60, costUsd: 0.5 });
    });

    it("reach the done chunk when a provider that cannot stream is asked through the registry", async () => {
        const registry = new AIProviderRegistry();
        registry.registerProvider("p1", {
            getName: () => "stub", isReady: () => true, supportsStreaming: () => false, supportsVision: () => false,
            generateStream: async function* () {},
            generate: async () => ({ content: "ok", tokensUsed: 130, latency: 5, usage: { promptTokens: 100, completionTokens: 30, cachedPromptTokens: 60, costUsd: 0.5 } }),
        });
        const last = await lastChunk(registry.generateStream("p1", "sys", "hi", config("https://plain.example/v1")));
        expect(last.metadata).toMatchObject({ tokensUsed: 130, promptTokens: 100, completionTokens: 30, cachedPromptTokens: 60, costUsd: 0.5 });
    });
});

describe("a stream stopped from outside (#1173)", () => {
    it("says it was cancelled, so the reply's cost leaves it out, and is still not reported as an error", async () => {
        const controller = new AbortController();
        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
            controller.abort();
            throw new DOMException("aborted", "AbortError");
        }));
        const chunks: any[] = [];
        for await (const chunk of new OpenAIProvider().generateStream("sys", "hi", config("https://api.deepseek.com"), undefined, controller.signal)) chunks.push(chunk);
        const last = chunks[chunks.length - 1];
        expect(last.metadata).toMatchObject({ cancelled: true, error: false, tokensUsed: 0 });
        vi.unstubAllGlobals();
    });
});
