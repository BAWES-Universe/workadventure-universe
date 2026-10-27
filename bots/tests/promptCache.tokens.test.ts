/**
 * Tests for reading provider prompt-cache figures (issue #1333, stage 0).
 *
 * DeepSeek reports prompt_cache_hit_tokens, OpenAI and compatible endpoints
 * report prompt_tokens_details.cached_tokens. Both are a subset of
 * prompt_tokens. They must reach the done-chunk metadata, the Sentry span and
 * PostHog. The request sent to the provider must not change, and LM Studio
 * keeps reporting nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpan = { setAttribute: vi.fn(), setStatus: vi.fn() };
vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb(mockSpan)),
    startSpanManual: vi.fn(),
}));

vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "key"),
}));

import { OpenAIProvider, readCachedPromptTokens } from "../ai/providers/OpenAIProvider";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import type { AIProviderConfig } from "../ai/types";

function buildConfig(type: "openai" | "lmstudio", extra: Record<string, any> = {}): AIProviderConfig {
    return {
        providerId: `${type}-1`,
        name: "Test",
        type,
        enabled: true,
        endpoint: type === "openai" ? "https://api.deepseek.com/v1" : "http://localhost:1234",
        apiKeyEncrypted: type === "openai" ? "iv:auth:data" : null,
        model: type === "openai" ? "deepseek-v4-flash" : "llama3",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: true,
        settings: {},
        ...extra,
    };
}

function sse(usage: Record<string, unknown> | undefined) {
    const lines = [
        JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " world" } }], ...(usage ? { usage } : {}) }),
    ];
    const encoder = new TextEncoder();
    const data = lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
    return vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
            start(c) {
                c.enqueue(encoder.encode(data));
                c.close();
            },
        }),
        text: vi.fn().mockResolvedValue(""),
    });
}

async function done(gen: AsyncGenerator<any>) {
    let last: any;
    for await (const chunk of gen) last = chunk;
    return last;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("readCachedPromptTokens", () => {
    it("reads the DeepSeek field", () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 })).toBe(80);
    });
    it("reads the OpenAI field", () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } })).toBe(64);
    });
    it("keeps a reported zero (a miss is a figure, not 'unknown')", () => {
        expect(readCachedPromptTokens({ prompt_cache_hit_tokens: 0 })).toBe(0);
    });
    it("is undefined when the provider reports nothing", () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100 })).toBeUndefined();
        expect(readCachedPromptTokens(undefined)).toBeUndefined();
    });
});

describe("OpenAIProvider.generateStream – cached tokens", () => {
    it("puts the DeepSeek hit count on the done chunk", async () => {
        vi.stubGlobal("fetch", sse({ prompt_tokens: 5000, completion_tokens: 30, prompt_cache_hit_tokens: 4200, prompt_cache_miss_tokens: 800 }));
        const last = await done(new OpenAIProvider().generateStream("sys", "hi", buildConfig("openai")));
        expect(last.metadata.promptTokens).toBe(5000);
        expect(last.metadata.cachedPromptTokens).toBe(4200);
    });

    it("puts the OpenAI cached_tokens count on the done chunk", async () => {
        vi.stubGlobal("fetch", sse({ prompt_tokens: 3000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 2048 } }));
        const last = await done(new OpenAIProvider().generateStream("sys", "hi", buildConfig("openai")));
        expect(last.metadata.cachedPromptTokens).toBe(2048);
    });

    it("leaves the figure out when the provider does not report one", async () => {
        vi.stubGlobal("fetch", sse({ prompt_tokens: 50, completion_tokens: 5 }));
        const last = await done(new OpenAIProvider().generateStream("sys", "hi", buildConfig("openai")));
        expect(last.metadata.promptTokens).toBe(50);
        expect("cachedPromptTokens" in last.metadata).toBe(false);
    });

    it("sends the same request body as before, apart from asking the stream to end with its usage (#1173)", async () => {
        const fetchMock = sse({ prompt_tokens: 1, completion_tokens: 1 });
        vi.stubGlobal("fetch", fetchMock);
        await done(new OpenAIProvider().generateStream("sys", "hi", buildConfig("openai"), [{ type: "function", function: { name: "t" } }]));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toEqual({
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "hi" },
            ],
            stream: true,
            stream_options: { include_usage: true },
            tools: [{ type: "function", function: { name: "t" } }],
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 512,
        });
    });
});

describe("OpenAIProvider.generate – cached tokens on the Sentry span", () => {
    beforeEach(() => mockSpan.setAttribute.mockClear());

    function plain(usage: Record<string, unknown>) {
        return vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }], usage, model: "m" }),
            text: vi.fn().mockResolvedValue(""),
        });
    }

    it("sets gen_ai.usage.cache_read.input_tokens when reported", async () => {
        vi.stubGlobal("fetch", plain({ total_tokens: 12, prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 7 }));
        await new OpenAIProvider().generate("sys", "hi", buildConfig("openai"));
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("gen_ai.usage.cache_read.input_tokens", 7);
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("gen_ai.usage.input_tokens", 10);
    });

    it("does not set it when the provider reports nothing", async () => {
        vi.stubGlobal("fetch", plain({ total_tokens: 12, prompt_tokens: 10, completion_tokens: 2 }));
        await new OpenAIProvider().generate("sys", "hi", buildConfig("openai"));
        const names = mockSpan.setAttribute.mock.calls.map((c) => c[0]);
        expect(names).not.toContain("gen_ai.usage.cache_read.input_tokens");
    });
});

describe("LMStudioProvider – unchanged", () => {
    it("reports no cached figure and sends the same body", async () => {
        const fetchMock = sse({ prompt_tokens: 40, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 32 } });
        vi.stubGlobal("fetch", fetchMock);
        const last = await done(new LMStudioProvider().generateStream("sys", "hi", buildConfig("lmstudio")));
        expect(last.metadata.promptTokens).toBe(40);
        expect("cachedPromptTokens" in last.metadata).toBe(false);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toEqual({
            model: "llama3",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "hi" },
            ],
            stream: true,
            stream_options: { include_usage: true },
            temperature: 0.7,
            max_tokens: 512,
        });
    });
});
