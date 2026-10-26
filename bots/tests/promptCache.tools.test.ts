/**
 * Tests for the cache-friendly request shape (issue #1333, prompt caching stage 3).
 *
 * Tool order is part of the cached prefix, so MCP tools are sorted by name.
 * OpenAI's own API gets prompt_cache_key and stream usage; DeepSeek, LM Studio
 * and every other endpoint keep the request they get today.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_o: unknown, cb: (span: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
    startSpanManual: vi.fn(),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "key") }));

import { OpenAIProvider, isOpenAIHost } from "../ai/providers/OpenAIProvider";
import { sortToolsByName } from "../ai/toolOrder";
import type { AIProviderConfig } from "../ai/types";

function config(endpoint: string, extra: Record<string, any> = {}): AIProviderConfig {
    return {
        providerId: "p1",
        name: "Test",
        type: "openai",
        enabled: true,
        endpoint,
        apiKeyEncrypted: "iv:auth:data",
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: true,
        settings: {},
        ...extra,
    };
}

function sseFetch() {
    const encoder = new TextEncoder();
    const data = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`;
    return vi.fn().mockImplementation(async () => ({
        ok: true,
        body: new ReadableStream({ start(c) { c.enqueue(encoder.encode(data)); c.close(); } }),
        text: vi.fn().mockResolvedValue(""),
    }));
}

async function bodyFor(cfg: AIProviderConfig, stream = true): Promise<Record<string, any>> {
    const fetchMock = stream
        ? sseFetch()
        : vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }),
            text: vi.fn().mockResolvedValue(""),
        });
    vi.stubGlobal("fetch", fetchMock);
    const p = new OpenAIProvider();
    if (stream) {
        for await (const _ of p.generateStream("sys", "hi", cfg, [{ type: "function", function: { name: "t" } }])) { /* drain */ }
    } else {
        await p.generate("sys", "hi", cfg);
    }
    return JSON.parse(fetchMock.mock.calls[0][1].body);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("sortToolsByName", () => {
    const tool = (name: string) => ({ type: "function", function: { name } });

    it("gives the same order whichever MCP server answered first", () => {
        const a = sortToolsByName([tool("zeta"), tool("alpha"), tool("mid")]);
        const b = sortToolsByName([tool("mid"), tool("zeta"), tool("alpha")]);
        expect(a.map((t) => t.function.name)).toEqual(["alpha", "mid", "zeta"]);
        expect(b).toEqual(a);
    });

    it("does not change the list it was given", () => {
        const input = [tool("b"), tool("a")];
        sortToolsByName(input);
        expect(input.map((t) => t.function.name)).toEqual(["b", "a"]);
    });
});

describe("isOpenAIHost", () => {
    it("is true only for api.openai.com", () => {
        expect(isOpenAIHost("https://api.openai.com/v1")).toBe(true);
        expect(isOpenAIHost(undefined)).toBe(true); // provider default endpoint
        expect(isOpenAIHost("https://api.deepseek.com/v1")).toBe(false);
        expect(isOpenAIHost("http://localhost:1234/v1")).toBe(false);
        expect(isOpenAIHost("https://api.openai.com.evil.example/v1")).toBe(false);
        expect(isOpenAIHost("https://example.openai.azure.com/openai")).toBe(false);
        expect(isOpenAIHost("not a url")).toBe(false);
    });
});

describe("OpenAIProvider request body", () => {
    it("adds prompt_cache_key and stream usage for api.openai.com", async () => {
        const body = await bodyFor(config("https://api.openai.com/v1", { __promptCacheKey: "bot-1" }));
        expect(body.prompt_cache_key).toBe("bot-1");
        expect(body.stream_options).toEqual({ include_usage: true });
    });

    it("asks for no stream usage on a plain (non-stream) call, but still sends the cache key", async () => {
        const body = await bodyFor(config("https://api.openai.com/v1", { __promptCacheKey: "bot-1" }), false);
        expect(body.prompt_cache_key).toBe("bot-1");
        expect(body.stream_options).toBeUndefined();
    });

    it("sends the DeepSeek request exactly as before", async () => {
        const body = await bodyFor(config("https://api.deepseek.com/v1", { model: "deepseek-v4-flash", __promptCacheKey: "bot-1" }));
        expect(body).toEqual({
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "hi" },
            ],
            stream: true,
            tools: [{ type: "function", function: { name: "t" } }],
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 512,
        });
    });

    it("sends other compatible endpoints the same body as before", async () => {
        const body = await bodyFor(config("https://llm.example.com/v1", { __promptCacheKey: "bot-1" }));
        expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature", "tool_choice", "tools"]);
    });
});
