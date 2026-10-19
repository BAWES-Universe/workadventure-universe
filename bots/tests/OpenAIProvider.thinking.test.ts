/**
 * Open-source Qwen3 models refuse a non-streaming reply unless thinking is off (the 400 names `enable_thinking`): the
 * call is asked again once with it off, streamed replies and every other call stay as they were (#374).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback({ setStatus: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "sk-person") }));

import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

const config = (): AIProviderConfig => ({
    providerId: "key-qwen",
    name: "Qwen",
    type: "openai",
    enabled: true,
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKeyEncrypted: "iv:tag:data",
    model: "qwen3-32b",
    temperature: 0.7,
    maxTokens: 300,
    supportsStreaming: true,
    settings: {},
});

const REFUSAL = '{"error":{"message":"parameter.enable_thinking must be set to false for non-streaming calls","type":"invalid_request_error"}}';
const failure = (status: number, text: string) => ({ ok: false, status, text: async () => text }) as unknown as Response;
const json = () =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { total_tokens: 3 } }), text: async () => "" }) as unknown as Response;
const sent = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe("OpenAIProvider and a non-streaming call that needs thinking off", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("asks again with thinking off, keeping the temperature, and then answers", async () => {
        fetchMock.mockResolvedValueOnce(failure(400, REFUSAL)).mockResolvedValueOnce(json());
        const result = await new OpenAIProvider().generate("s", "hi", config());
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 0)).not.toHaveProperty("enable_thinking");
        expect(sent(fetchMock, 1)).toMatchObject({ enable_thinking: false, temperature: 0.7 });
        expect(result).toMatchObject({ content: "hi", error: false });
    });

    it("asks only once, and not for a 400 that is about something else", async () => {
        fetchMock.mockResolvedValue(failure(400, REFUSAL));
        await expect(new OpenAIProvider().generate("s", "hi", config())).resolves.toMatchObject({ error: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(failure(400, '{"error":{"message":"bad request"}}'));
        await new OpenAIProvider().generate("s", "hi", config());
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("leaves a normal call exactly as it was: one call with no thinking field", async () => {
        fetchMock.mockResolvedValueOnce(json());
        await new OpenAIProvider().generate("s", "hi", config());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sent(fetchMock, 0)).not.toHaveProperty("enable_thinking");
    });
});
