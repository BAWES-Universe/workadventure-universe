/**
 * How the providers reach a person's own key (#374) without changing how they reach a server provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback({ setStatus: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "sk-person") }));
const ownFetch = vi.fn();
vi.mock("../ai/ownComputerFetch", () => ({ ownComputerFetch: (...args: unknown[]) => ownFetch(...args) }));

import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import { fetchFor, statusFromError } from "../ai/providers/ownKeyHttp";
import type { AIProviderConfig } from "../ai/types";

const config = (extra: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
    providerId: "lm",
    name: "LM",
    type: "lmstudio",
    enabled: true,
    endpoint: "https://lm.example.com",
    apiKeyEncrypted: null,
    model: "qwen3-8b",
    temperature: 0.7,
    maxTokens: 100,
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

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe("LMStudioProvider and keys", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        ownFetch.mockReset();
        fetchMock = vi.fn().mockImplementation(async () => sse());
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("the server's own LM Studio: plain fetch, no Authorization, as always", async () => {
        await drain(new LMStudioProvider().generateStream("sys", "hi", config()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
        expect(ownFetch).not.toHaveBeenCalled();
    });

    it("a server provider that happens to hold a key still sends none: only a person's own key does", async () => {
        await drain(new LMStudioProvider().generateStream("sys", "hi", config({ apiKeyEncrypted: "iv:tag:data" })));
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
    });

    it("a person's own key with a key sends it, and an address they typed goes through the guard", async () => {
        ownFetch.mockImplementation(async () => sse());
        const chunks = await drain(new LMStudioProvider().generateStream("sys", "hi", config({ apiKeyEncrypted: "iv:tag:data", ownKey: { addressTyped: true } })));
        expect(chunks.map((chunk) => chunk.content).join("")).toBe("hi");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(ownFetch.mock.calls[0][0]).toBe("https://lm.example.com/v1/chat/completions");
        expect(ownFetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-person" });
    });

    it("a person's own key with no key sends no Authorization", async () => {
        ownFetch.mockImplementation(async () => sse());
        await drain(new LMStudioProvider().generateStream("sys", "hi", config({ ownKey: { addressTyped: true } })));
        expect(ownFetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
    });

    it("says which HTTP status failed a call, so a rejected key can be told from a server that is down", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" });
        const chunks = await drain(new LMStudioProvider().generateStream("sys", "hi", config()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 401 });
    });

    it("a server that does not answer has no status", async () => {
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const chunks = await drain(new LMStudioProvider().generateStream("sys", "hi", config()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true });
        expect(chunks[chunks.length - 1].metadata.errorStatus).toBeUndefined();
    });
});

describe("OpenAIProvider and keys", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        ownFetch.mockReset();
        fetchMock = vi.fn().mockImplementation(async () => sse());
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });
    const hosted = (extra: Partial<AIProviderConfig> = {}) =>
        config({ providerId: "deepseek", type: "openai", endpoint: "https://api.deepseek.com", apiKeyEncrypted: "iv:tag:data", model: "deepseek-v4-flash", ...extra });

    it("DeepSeek on the openai type: plain fetch with its bearer key, exactly as before", async () => {
        await drain(new OpenAIProvider().generateStream("sys", "hi", hosted()));
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-person" });
        expect(ownFetch).not.toHaveBeenCalled();
    });

    it("a hosted key at its provider's own address uses plain fetch", async () => {
        await drain(new OpenAIProvider().generateStream("sys", "hi", hosted({ ownKey: { addressTyped: false } })));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(ownFetch).not.toHaveBeenCalled();
    });

    it("a person's own NIM address goes through the guard", async () => {
        ownFetch.mockImplementation(async () => sse());
        await drain(new OpenAIProvider().generateStream("sys", "hi", hosted({ endpoint: "https://nim.example.com/v1", ownKey: { addressTyped: true } })));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(ownFetch.mock.calls[0][0]).toBe("https://nim.example.com/v1/chat/completions");
    });

    it("says which HTTP status failed a call", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "no" });
        const chunks = await drain(new OpenAIProvider().generateStream("sys", "hi", hosted()));
        expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 403 });
    });
});

describe("helpers", () => {
    it("fetchFor picks the guard only for an address a person typed", () => {
        expect(fetchFor(config({ ownKey: { addressTyped: true } }))).toBeTypeOf("function");
        ownFetch.mockResolvedValue("guarded");
        return Promise.all([
            expect(fetchFor(config({ ownKey: { addressTyped: true } }))("https://x.example.com/v1/models")).resolves.toBe("guarded"),
        ]);
    });

    it.each([
        [new Error("LMStudio API error: 401 nope"), 401],
        [new Error("OpenAI API error: 503 down"), 503],
        [new Error("fetch failed"), undefined],
        ["LMStudio API error: 403 x", 403],
        [undefined, undefined],
    ])("reads the status from %s", (error, expected) => {
        expect(statusFromError(error)).toBe(expected);
    });
});
