/**
 * Tests for OpenAIProvider Sentry span creation (PR #140: startSpan scope pinning)
 *
 * Scope: Only tests the changed behavior:
 *   - Sentry.startSpan is called (pinned to scope via _setSpanForScope)
 *   - parentSpan is passed from (config as any).__sentryParentSpan
 *   - When __sentryParentSpan is absent, no span is created (optional chaining)
 *   - span is auto-ended via handleCallbackErrors
 *   - sentrySpan attributes are set on the child span
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

// Use vi.hoisted() so mocks are defined before vi.mock is hoisted to top
const { mockSentrySpan, mockStartSpan } = vi.hoisted(() => {
    const span = { end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn() };
    return {
        mockSentrySpan: span,
        mockStartSpan: vi.fn(async (_opts: any, cb: any) => {
            const result = await cb(span);
            span.end();
            return result;
        }),
    };
});

vi.mock("@sentry/node", () => ({
    startSpan: mockStartSpan,
    startSpanManual: vi.fn(),
}));

// Mock encryption
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "***"),
}));

// ---- Helper: build a minimal AIProviderConfig for OpenAI ----
function buildConfig(extra: Record<string, any> = {}): Record<string, any> {
    return {
        providerId: "openai-1",
        name: "TestOpenAI",
        type: "openai",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        apiKeyEncrypted: "fakeiv:fakeauth:fakedata",
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: true,
        settings: {},
        ...extra,
    };
}

// ---- Helper: build SSE response ----
function buildSSEStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const data = lines.map(l => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(data));
            controller.close();
        },
    });
}

function buildFetchOk(stream: ReadableStream) {
    return vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
        text: vi.fn().mockResolvedValue(""),
    });
}

async function drainStream(gen: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of gen) {
        chunks.push(chunk);
    }
    return chunks;
}

const SIMPLE_SSE = [
    JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
    JSON.stringify({
        choices: [{ delta: { content: " world" } }],
        usage: { total_tokens: 8, prompt_tokens: 5, completion_tokens: 3 },
        model: "gpt-4o-2024-05-13",
    }),
];

describe("OpenAIProvider.generateStream – Sentry child span (PR #140)", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        provider = new OpenAIProvider();
        vi.clearAllMocks();
    });

    it("calls Sentry.startSpan with op 'gen_ai.chat'", async () => {
        const parentSpan = {};
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockStartSpan).toHaveBeenCalledTimes(1);
        const [opts] = mockStartSpan.mock.calls[0];
        expect(opts).toMatchObject({ op: "gen_ai.chat" });
    });

    it("passes name 'LLM <model>' to startSpan", async () => {
        const parentSpan = {};
        const config = buildConfig({ model: "gpt-4o-mini", __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const [opts] = mockStartSpan.mock.calls[0];
        expect(opts).toMatchObject({ name: "LLM gpt-4o-mini" });
    });

    it("passes parentSpan from config.__sentryParentSpan to startSpan", async () => {
        const parentSpan = { someId: "parent-123" };
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const [opts] = mockStartSpan.mock.calls[0];
        expect(opts.parentSpan).toBe(parentSpan);
    });

    it("calls sentrySpan.end() in the finally block after a successful stream", async () => {
        const parentSpan = {};
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSentrySpan.end).toHaveBeenCalledTimes(1);
    });

    it("calls sentrySpan.end() even when fetch throws", async () => {
        const parentSpan = {};
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSentrySpan.end).toHaveBeenCalledTimes(1);
    });

    it("still streams successfully when __sentryParentSpan is absent", async () => {
        const config = buildConfig(); // no __sentryParentSpan
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("still streams successfully when __sentryParentSpan is null", async () => {
        const config = buildConfig({ __sentryParentSpan: null });
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("sets gen_ai.request.model attribute on the span", async () => {
        const parentSpan = {};
        const config = buildConfig({ model: "gpt-3.5-turbo", __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const attrCalls = mockSentrySpan.setAttribute.mock.calls;
        const modelAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.request.model");
        expect(modelAttr).toBeDefined();
        expect(modelAttr![1]).toBe("gpt-3.5-turbo");
    });

    it("sets gen_ai.system to 'deepseek' for DeepSeek endpoints", async () => {
        const parentSpan = {};
        const config = buildConfig({
            endpoint: "https://api.deepseek.com/v1",
            __sentryParentSpan: parentSpan,
        });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const attrCalls = mockSentrySpan.setAttribute.mock.calls;
        const systemAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.system");
        expect(systemAttr).toBeDefined();
        expect(systemAttr![1]).toBe("deepseek");
    });

    it("sets error status on span when API returns non-ok response", async () => {
        const parentSpan = {};
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: vi.fn().mockResolvedValue("Unauthorized"),
        }));

        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSentrySpan.setStatus).toHaveBeenCalledWith(
            expect.objectContaining({ code: 2 })
        );
    });

    it("calls startSpan exactly once per generateStream call", async () => {
        const parentSpan = {};
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockStartSpan).toHaveBeenCalledTimes(1);
    });
});