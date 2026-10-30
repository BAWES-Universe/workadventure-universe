/**
 * OpenAI's reasoning models take `max_completion_tokens` and only the default temperature (#1571). Every o-series name
 * gets that request on its first reply; a model the name check misses that refuses both fields, one per answer, is fixed
 * for both and remembered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "key") }));

import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

function config(model: string, endpoint = "https://api.openai.com/v1"): AIProviderConfig {
    return {
        providerId: "p1", name: "Test", type: "openai", enabled: true, endpoint, apiKeyEncrypted: "iv:auth:data",
        model, temperature: 0.7, maxTokens: 32000, supportsStreaming: true, settings: {},
    };
}

const MAX_TOKENS_REFUSAL = JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: "invalid_request_error", param: "max_tokens", code: "unsupported_parameter" } });
const TEMPERATURE_REFUSAL = JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.", type: "invalid_request_error", param: "temperature", code: "unsupported_value" } });
const refused = (body: string) => ({ ok: false, status: 400, text: vi.fn().mockResolvedValue(body) });

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

describe("o-series models", () => {
    it.each(["o4-mini", "o4-mini-2025-04-16", "o1", "o3-mini", "o5"])("%s gets max_completion_tokens and no temperature on its first reply", async (model) => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config(model)));
        expect(last.metadata).toMatchObject({ error: false });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sent(fetchMock, 0).max_completion_tokens).toBe(32000);
        expect("max_tokens" in sent(fetchMock, 0)).toBe(false);
        expect("temperature" in sent(fetchMock, 0)).toBe(false);
    });
});

describe("a reasoning model the name check misses", () => {
    it("refusing both fields, one per answer, answers on the third call while streaming, and later replies make one", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(refused(MAX_TOKENS_REFUSAL))
            .mockResolvedValueOnce(refused(TEMPERATURE_REFUSAL))
            .mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAIProvider();
        const endpoint = "https://reasoner-stream.example/v1";

        const first = await lastChunk(provider.generateStream("sys", "hi", config("new-reasoner", endpoint)));
        expect(first.metadata).toMatchObject({ error: false });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 1)).toMatchObject({ max_completion_tokens: 32000, temperature: 0.7 });
        expect("max_tokens" in sent(fetchMock, 1)).toBe(false);
        expect(sent(fetchMock, 2).max_completion_tokens).toBe(32000);
        expect("temperature" in sent(fetchMock, 2)).toBe(false);

        await lastChunk(provider.generateStream("sys", "again", config("new-reasoner", endpoint)));
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(sent(fetchMock, 3).max_completion_tokens).toBe(32000);
        expect("max_tokens" in sent(fetchMock, 3)).toBe(false);
        expect("temperature" in sent(fetchMock, 3)).toBe(false);
    });

    it("does the same for a plain reply, in the other order", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(refused(TEMPERATURE_REFUSAL))
            .mockResolvedValueOnce(refused(MAX_TOKENS_REFUSAL))
            .mockResolvedValue(plainResponse());
        vi.stubGlobal("fetch", fetchMock);
        const response = await new OpenAIProvider().generate("sys", "hi", config("new-reasoner", "https://reasoner-plain.example/v1"));
        expect(response).toMatchObject({ content: "ok", error: false });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sent(fetchMock, 2)).toMatchObject({ max_completion_tokens: 32000 });
        expect("temperature" in sent(fetchMock, 2)).toBe(false);
    });

    it("stops after the same refusal comes back", async () => {
        const fetchMock = vi.fn().mockResolvedValue(refused(TEMPERATURE_REFUSAL));
        vi.stubGlobal("fetch", fetchMock);
        const last = await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config("stubborn", "https://stubborn.example/v1")));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(last.metadata).toMatchObject({ error: true, errorStatus: 400 });
    });
});

describe("DeepSeek V4 Flash", () => {
    it("is sent the same request as before, once", async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse());
        vi.stubGlobal("fetch", fetchMock);
        await lastChunk(new OpenAIProvider().generateStream("sys", "hi", config("deepseek-v4-flash", "https://api.deepseek.com")));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
        expect(sent(fetchMock, 0)).toEqual({
            model: "deepseek-v4-flash",
            messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
            stream: true,
            stream_options: { include_usage: true },
            temperature: 0.7,
            max_tokens: 32000,
        });
    });
});
