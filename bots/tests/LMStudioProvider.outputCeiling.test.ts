/**
 * A server on someone's own computer (vLLM, a gateway, LM Studio) that refuses the longest reply or `stream_options` is
 * asked again the way OpenAIProvider asks hosted keys (#1569), and later replies make one call.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
}));

import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import { statedContext, statedOutputCeiling } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

function config(endpoint: string, model = "Qwen2.5-7B"): AIProviderConfig {
    return {
        providerId: "lm", name: "LM", type: "lmstudio", enabled: true, endpoint, apiKeyEncrypted: null,
        model, temperature: 0.7, maxTokens: 32000, supportsStreaming: true, settings: {},
    };
}

/** vLLM's answer to a request bigger than an 8,192-token context, in its words since 0.6. */
const VLLM_CONTEXT = (messages: number) => JSON.stringify({
    object: "error",
    message: `'max_tokens' or 'max_completion_tokens' is too large: 32000. This model's maximum context length is 8192 tokens and your request has ${messages} input tokens (32000 > 8192 - ${messages}). None`,
    type: "BadRequestError", param: null, code: 400,
});
const GATEWAY_CAP = JSON.stringify({ error: { message: "max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000." } });
const VLLM_STREAM_OPTIONS = JSON.stringify({ object: "error", message: "Stream options can only be defined when `stream=True`.", type: "BadRequestError", code: 400 });

const refused = (body: string, status = 400) => ({ ok: false, status, text: vi.fn().mockResolvedValue(body) });

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

describe("vLLM's newer context wording", () => {
    it("is read as the context and what the messages took of it", () => {
        expect(statedContext(400, VLLM_CONTEXT(500))).toEqual({ context: 8192, messages: 500 });
        expect(statedOutputCeiling(400, VLLM_CONTEXT(500), 32000)).toEqual({ tokens: 7692, lasting: false });
        expect(statedContext(401, VLLM_CONTEXT(500))).toBeUndefined();
        expect(statedContext(400, GATEWAY_CAP)).toBeUndefined();
    });
});

describe("a vLLM model with a context smaller than the longest reply", () => {
    it("answers on the second call, and later replies make one call with no max_tokens", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(VLLM_CONTEXT(500))).mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new LMStudioProvider();
        const endpoint = "http://vllm-small.example:8000";

        const first = await lastChunk(provider.generateStream("sys", "hi", config(endpoint)));
        expect(first.metadata).toMatchObject({ error: false });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 0).max_tokens).toBe(32000);
        expect(sent(fetchMock, 1).max_tokens).toBe(7692);

        await lastChunk(provider.generateStream("sys", "again", config(endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect("max_tokens" in sent(fetchMock, 2)).toBe(false);
        // Only that model on that server
        await lastChunk(provider.generateStream("sys", "hi", config(endpoint, "other-model")));
        expect(sent(fetchMock, 3).max_tokens).toBe(32000);
    });

    it("still fails when the messages alone fill the context", async () => {
        const fetchMock = vi.fn().mockResolvedValue(refused(VLLM_CONTEXT(8100)));
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new LMStudioProvider().generateStream("sys", "a long one", config("http://vllm-full.example:8000")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(last.metadata).toMatchObject({ error: true, errorStatus: 400 });
    });
});

describe("a gateway that states the model's own cap", () => {
    it("is asked within the cap, and within it from then on", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(GATEWAY_CAP)).mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new LMStudioProvider();
        const endpoint = "https://litellm.example";

        await lastChunk(provider.generateStream("sys", "hi", config(endpoint, "gpt-4o")));
        expect(sent(fetchMock, 1).max_tokens).toBe(16384);
        await lastChunk(provider.generateStream("sys", "again", config(endpoint, "gpt-4o")));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 2).max_tokens).toBe(16384);
    });
});

describe("a server that refuses stream_options", () => {
    it("is asked again without it for a plain reply, and not sent it again for plain replies only", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(VLLM_STREAM_OPTIONS)).mockResolvedValueOnce(plainResponse()).mockResolvedValueOnce(plainResponse()).mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new LMStudioProvider();
        const endpoint = "http://vllm-plain.example:8000";

        const response = await provider.generate("sys", "hi", config(endpoint));
        expect(response).toMatchObject({ content: "ok", error: false });
        expect(sent(fetchMock, 1).stream_options).toBeUndefined();

        await provider.generate("sys", "again", config(endpoint));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 2).stream_options).toBeUndefined();

        // A streamed reply still asks for usage
        await lastChunk(provider.generateStream("sys", "hi", config(endpoint)));
        expect(sent(fetchMock, 3).stream_options).toEqual({ include_usage: true });
    });

    it("then the context: both refusals are fixed in one reply", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(refused(VLLM_STREAM_OPTIONS)).mockResolvedValueOnce(refused(VLLM_CONTEXT(500))).mockResolvedValue(plainResponse());
        vi.stubGlobal("fetch", fetchMock);
        const response = await new LMStudioProvider().generate("sys", "hi", config("http://vllm-both.example:8000"));
        expect(response).toMatchObject({ content: "ok", error: false });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 2)).toMatchObject({ max_tokens: 7692 });
        expect(sent(fetchMock, 2).stream_options).toBeUndefined();
    });
});

describe("a local LM Studio", () => {
    it("is sent the same request as before, once", async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const tools = [{ type: "function", function: { name: "look", parameters: { type: "object", properties: {} } } }];
        await lastChunk(new LMStudioProvider().generateStream("sys", "hi", config("http://localhost:1234/", "qwen3-8b"), tools));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/chat/completions");
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
        expect(sent(fetchMock, 0)).toEqual({
            model: "qwen3-8b",
            messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
            stream: true,
            stream_options: { include_usage: true },
            temperature: 0.7,
            max_tokens: 32000,
            tools,
            tool_choice: "auto",
        });
    });

    it("is not asked again for any other refusal", async () => {
        const fetchMock = vi.fn().mockResolvedValue(refused(JSON.stringify({ error: "model not loaded" })));
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new LMStudioProvider().generateStream("sys", "hi", config("http://localhost:1235")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(last.metadata).toMatchObject({ error: true, errorStatus: 400 });
    });
});
