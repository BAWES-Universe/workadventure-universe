/**
 * An OpenAI-format provider that refuses the temperature we send (Kimi's fixed-temperature models answer 400 with a
 * message about it) is asked again once without it, and nothing else changes (#374).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback({ setStatus: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "sk-person") }));

import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

// A refusal is remembered per endpoint and model for as long as the server runs, so each test gets a model of its own
let models = 0;
const config = (extra: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
    providerId: "key-kimi",
    name: "Kimi",
    type: "openai",
    enabled: true,
    endpoint: "https://api.moonshot.ai/v1",
    apiKeyEncrypted: "iv:tag:data",
    model: `kimi-k2.6-${models}`,
    temperature: 0.7,
    maxTokens: 300,
    supportsStreaming: true,
    settings: {},
    ...extra,
});

function sse(): Response {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
        },
    });
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

const failure = (status: number, text: string) => ({ ok: false, status, text: async () => text }) as unknown as Response;
const json = () =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { total_tokens: 3 } }), text: async () => "" }) as unknown as Response;

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe("OpenAIProvider and a refused temperature", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        models += 1;
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    const KIMI_REFUSAL = '{"error":{"message":"invalid temperature: only 1 is allowed for this model","type":"invalid_request_error"}}';

    it("streams: asks again without the temperature when a 400 is about it, and then answers", async () => {
        fetchMock.mockResolvedValueOnce(failure(400, KIMI_REFUSAL)).mockResolvedValueOnce(sse());
        const chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 0).temperature).toBe(0.7);
        expect(sent(fetchMock, 1)).not.toHaveProperty("temperature");
        expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content)).toEqual(["hi"]);
        expect(chunks[chunks.length - 1].metadata.error).toBe(false);
    });

    it("answers whole: asks again without the temperature, and then answers", async () => {
        fetchMock.mockResolvedValueOnce(failure(400, KIMI_REFUSAL)).mockResolvedValueOnce(json());
        const result = await new OpenAIProvider().generate("s", "hi", config());
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 1)).not.toHaveProperty("temperature");
        expect(result).toMatchObject({ content: "hi", error: false });
    });

    it("keeps OpenAI's own answer working: its code names the temperature", async () => {
        const openai = '{"error":{"code":"unsupported_value","param":"temperature","message":"Only the default (1) value is supported."}}';
        fetchMock.mockResolvedValueOnce(failure(400, openai)).mockResolvedValueOnce(sse());
        await drain(new OpenAIProvider().generateStream("s", "hi", config({ endpoint: "https://api.openai.com/v1", model: "gpt-4o" })));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sent(fetchMock, 1)).not.toHaveProperty("temperature");
    });

    it("does not ask again for a 400 that is about something else, or for any other status", async () => {
        fetchMock.mockResolvedValue(failure(400, '{"error":{"message":"messages: must not be empty"}}'));
        let chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(failure(500, "temperature service is down"));
        chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 500 });
    });

    it("does not ask again when no temperature was sent, and asks only once when the second answer refuses too", async () => {
        fetchMock.mockResolvedValue(failure(400, "temperature is not allowed"));
        await drain(new OpenAIProvider().generateStream("s", "hi", config({ model: "gpt-5" })));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(failure(400, KIMI_REFUSAL));
        const chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
    });

    it("remembers the refusal: the next replies do not send the temperature at all", async () => {
        fetchMock.mockResolvedValueOnce(failure(400, KIMI_REFUSAL)).mockResolvedValueOnce(sse());
        await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(sse());
        await drain(new OpenAIProvider().generateStream("s", "again", config()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sent(fetchMock, 0)).not.toHaveProperty("temperature");
        // Another model on the same endpoint still gets its temperature
        await drain(new OpenAIProvider().generateStream("s", "other", config({ model: "kimi-other" })));
        expect(sent(fetchMock, 1)).toMatchObject({ temperature: 0.7 });
    });

    it("leaves a normal call exactly as it was: one call, temperature and Bearer key sent", async () => {
        fetchMock.mockResolvedValue(sse());
        await drain(new OpenAIProvider().generateStream("s", "hi", config({ endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash" })));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-person");
        expect(sent(fetchMock, 0)).toMatchObject({ temperature: 0.7, max_tokens: 300 });
    });
});

describe("OpenAIProvider and a key the provider calls invalid with a 400", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    const GEMINI = '[{ "error": { "code": 400, "message": "Please pass a valid API key", "status": "INVALID_ARGUMENT" } } ]';

    it("reports Gemini's 400 for a wrong key as a 401, so Orbit marks the key rejected", async () => {
        fetchMock.mockResolvedValue(failure(400, GEMINI));
        const chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config({ endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" })));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 401 });
        fetchMock.mockResolvedValue(failure(400, GEMINI));
        await expect(new OpenAIProvider().generate("s", "hi", config())).resolves.toMatchObject({ error: true });
    });

    it("reports Gemini's 400 for an expired key as a 401 too", async () => {
        fetchMock.mockResolvedValue(failure(400, '[{ "error": { "code": 400, "message": "API key expired. Please renew the API key.", "status": "INVALID_ARGUMENT" } } ]'));
        const chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config({ endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" })));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 401 });
    });

    it("leaves every other 400 as a 400", async () => {
        fetchMock.mockResolvedValue(failure(400, '{"error":{"message":"messages: must not be empty"}}'));
        const chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
    });

    it("keeps a real 401 and 402 as they are", async () => {
        fetchMock.mockResolvedValueOnce(failure(401, '{"error":{"message":"Incorrect API key provided"}}'));
        let chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ errorStatus: 401 });
        fetchMock.mockResolvedValueOnce(failure(402, '{"error":{"message":"Insufficient Balance"}}'));
        chunks = await drain(new OpenAIProvider().generateStream("s", "hi", config()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ errorStatus: 402 });
    });
});
