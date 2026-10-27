/**
 * A model that takes fewer output tokens than the longest reply it is given (Orbit #666 recommends 32,000) is asked
 * again once within the cap it states, and from then on within it, so the person never sees the error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const mockSpan = { setAttribute: vi.fn(), setStatus: vi.fn() };
vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb(mockSpan)),
    startSpanManual: vi.fn(),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "key") }));

import { OpenAIProvider, statedOutputCeiling } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

function config(endpoint: string, model = "gpt-4o"): AIProviderConfig {
    return {
        providerId: "p1", name: "Test", type: "openai", enabled: true, endpoint, apiKeyEncrypted: "iv:auth:data",
        model, temperature: 0.7, maxTokens: 32000, supportsStreaming: true, settings: {},
    };
}

const OPENAI_REFUSAL = "max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000.";
const refused = (message: string, status = 400) => ({ ok: false, status, text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message, type: "invalid_request_error", param: "max_tokens" } })) });

function streamResponse() {
    const encoder = new TextEncoder();
    const lines = [JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }), JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })];
    return {
        ok: true,
        status: 200,
        body: new ReadableStream({ start(c) { c.enqueue(encoder.encode(lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n")); c.close(); } }),
        text: vi.fn().mockResolvedValue(""),
    };
}

const plainResponse = () => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }), text: vi.fn().mockResolvedValue("") });

async function lastChunk(gen: AsyncGenerator<any>) {
    let last: any;
    for await (const chunk of gen) last = chunk;
    return last;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("statedOutputCeiling", () => {
    it("reads the cap from each provider's words", () => {
        expect(statedOutputCeiling(400, OPENAI_REFUSAL, 32000)).toBe(16384);
        expect(statedOutputCeiling(400, "max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku-20241022", 32000)).toBe(8192);
        expect(statedOutputCeiling(400, "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]", 32000)).toBe(8192);
        expect(statedOutputCeiling(400, "`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window` for this model", 32000)).toBe(8192);
        expect(statedOutputCeiling(400, "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens (108000 in the messages, 32000 in the completion).", 32000)).toBe(23072);
        expect(statedOutputCeiling(422, '{"detail":"max_tokens must be at most 4096"}', 32000)).toBe(4096);
    });

    it("leaves every other error alone", () => {
        expect(statedOutputCeiling(401, OPENAI_REFUSAL, 32000)).toBeUndefined();
        expect(statedOutputCeiling(400, "temperature must be at most 2", 32000)).toBeUndefined();
        expect(statedOutputCeiling(400, "max_tokens must be an integer", 32000)).toBeUndefined();
        // A number that is no real cap, or one that is not below what was asked
        expect(statedOutputCeiling(400, "max_tokens must be at most 5 times the input", 32000)).toBeUndefined();
        expect(statedOutputCeiling(400, "max_tokens is too large: 32000, at most 64000", 32000)).toBeUndefined();
        // The messages alone fill the context: a smaller reply would not help
        expect(statedOutputCeiling(400, "maximum context length is 131072 tokens. However, you requested 163072 tokens (131000 in the messages, 32000 in the completion)", 32000)).toBeUndefined();
        expect(statedOutputCeiling(400, OPENAI_REFUSAL, undefined)).toBeUndefined();
    });
});

describe("a model that takes fewer output tokens", () => {
    it("is asked again once within its cap while streaming, and within it from then on", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(OPENAI_REFUSAL)).mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAIProvider();
        const endpoint = "https://capped-stream.example/v1";

        const first = await lastChunk(provider.generateStream("sys", "hi", config(endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 0).max_tokens).toBe(32000);
        expect(sent(fetchMock, 1).max_tokens).toBe(16384);
        expect(first.metadata).toMatchObject({ error: false });

        await lastChunk(provider.generateStream("sys", "again", config(endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 2).max_tokens).toBe(16384);
    });

    it("is asked again within its cap for a plain reply, keeping max_completion_tokens for the models that use it", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(OPENAI_REFUSAL.replace("max_tokens", "max_completion_tokens"))).mockResolvedValue(plainResponse());
        vi.stubGlobal("fetch", fetchMock);
        const response = await new OpenAIProvider().generate("sys", "hi", config("https://capped-plain.example/v1", "o3-mini"));
        expect(response.content).toBe("ok");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 1)).toMatchObject({ max_completion_tokens: 16384 });
        expect("max_tokens" in sent(fetchMock, 1)).toBe(false);
    });

    it("keeps the cap to that model on that endpoint, and asks only once", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(OPENAI_REFUSAL)).mockResolvedValueOnce(refused(OPENAI_REFUSAL)).mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAIProvider();

        const failed = await lastChunk(provider.generateStream("sys", "hi", config("https://capped-twice.example/v1")));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(failed.metadata).toMatchObject({ error: true });

        await lastChunk(provider.generateStream("sys", "hi", config("https://capped-twice.example/v1", "gpt-5.1")));
        expect(sent(fetchMock, 2).max_completion_tokens).toBe(32000);
    });
});
