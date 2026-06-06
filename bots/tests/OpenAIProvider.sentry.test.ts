/**
 * Tests for OpenAIProvider Sentry span changes (PR: use parentSpan.startChild())
 *
 * Scope: Only tests the changed behavior in this PR:
 *   - parentSpan is extracted from (config as any).__sentryParentSpan
 *   - parentSpan?.startChild() is used instead of Sentry.startInactiveSpan({parentSpan:...})
 *   - When __sentryParentSpan is absent, no span is created (optional chaining)
 *   - sentrySpan?.end() is called in the finally block
 *   - sentrySpan attributes are set on the child span, not via Sentry module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

// Mock @sentry/node to ensure it is NOT used for span creation in generateStream
vi.mock("@sentry/node", () => ({
    startInactiveSpan: vi.fn(), // should NOT be called in generateStream
    startSpanManual: vi.fn(),
    startSpan: vi.fn((_opts: unknown, cb: (s: any) => any) =>
        cb({ setAttribute: vi.fn(), setStatus: vi.fn() })
    ),
}));

// Mock encryption so we can pass a fake encrypted key without real crypto
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "sk-test-decrypted"),
}));

// ---- Helper: create a mock Sentry span (child span) ----
function makeMockChildSpan() {
    return {
        end: vi.fn(),
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
    };
}

// ---- Helper: create a mock parent span ----
function makeMockParentSpan(childSpan: ReturnType<typeof makeMockChildSpan>) {
    return {
        startChild: vi.fn(() => childSpan),
    };
}

// ---- Helper: build a minimal AIProviderConfig for OpenAI ----
function buildConfig(
    extra: Partial<AIProviderConfig & { __sentryParentSpan?: any }> = {}
): AIProviderConfig & { __sentryParentSpan?: any } {
    return {
        providerId: "openai-1",
        name: "TestOpenAI",
        type: "openai",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        apiKeyEncrypted: "fakeiv:fakeauth:fakedata", // decryptApiKey is mocked
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: true,
        settings: {},
        ...extra,
    };
}

// ---- Helper: build a Server-Sent Events response ----
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

function buildFetchMock(stream: ReadableStream) {
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

// ---- One simple SSE payload ----
const SIMPLE_SSE_LINES = [
    JSON.stringify({
        choices: [{ delta: { content: "Hello" } }],
    }),
    JSON.stringify({
        choices: [{ delta: { content: " world" } }],
        usage: { total_tokens: 8, prompt_tokens: 5, completion_tokens: 3 },
        model: "gpt-4o-2024-05-13",
    }),
];

describe("OpenAIProvider.generateStream – Sentry child span (PR change)", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        provider = new OpenAIProvider();
        vi.clearAllMocks();
    });

    it("calls parentSpan.startChild() with op 'gen_ai.chat'", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        expect(parentSpan.startChild).toHaveBeenCalledTimes(1);
        const [childOpts] = parentSpan.startChild.mock.calls[0];
        expect(childOpts).toMatchObject({ op: "gen_ai.chat" });

        vi.unstubAllGlobals();
    });

    it("calls parentSpan.startChild() with name 'LLM <model>'", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ model: "gpt-4o-mini", __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const [childOpts] = parentSpan.startChild.mock.calls[0];
        expect(childOpts).toMatchObject({ name: "LLM gpt-4o-mini" });

        vi.unstubAllGlobals();
    });

    it("does NOT call Sentry.startInactiveSpan (removed in PR)", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const Sentry = await import("@sentry/node");
        expect(Sentry.startInactiveSpan).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
    });

    it("calls sentrySpan.end() in the finally block after a successful stream", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        expect(childSpan.end).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });

    it("calls sentrySpan.end() even when fetch throws", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(childSpan.end).toHaveBeenCalledTimes(1);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true, metadata: { error: true } });

        vi.unstubAllGlobals();
    });

    it("does not throw when __sentryParentSpan is absent (no span created)", async () => {
        // No __sentryParentSpan — optional chaining on undefined is safe
        const config = buildConfig();

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        let threwError = false;
        try {
            await drainStream(provider.generateStream("system", "user", config));
        } catch {
            threwError = true;
        }
        expect(threwError).toBe(false);

        vi.unstubAllGlobals();
    });

    it("does not throw when __sentryParentSpan is null", async () => {
        const config = buildConfig({ __sentryParentSpan: null } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        let threwError = false;
        try {
            await drainStream(provider.generateStream("system", "user", config));
        } catch {
            threwError = true;
        }
        expect(threwError).toBe(false);

        vi.unstubAllGlobals();
    });

    it("sets gen_ai.request.model attribute on the child span", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ model: "gpt-3.5-turbo", __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const attrCalls = childSpan.setAttribute.mock.calls;
        const modelAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.request.model");
        expect(modelAttr).toBeDefined();
        expect(modelAttr![1]).toBe("gpt-3.5-turbo");

        vi.unstubAllGlobals();
    });

    it("sets gen_ai.system to 'openai' for standard OpenAI endpoint", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({
            endpoint: "https://api.openai.com/v1",
            __sentryParentSpan: parentSpan,
        } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const attrCalls = childSpan.setAttribute.mock.calls;
        const systemAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.system");
        expect(systemAttr).toBeDefined();
        expect(systemAttr![1]).toBe("openai");

        vi.unstubAllGlobals();
    });

    it("sets gen_ai.system to 'deepseek' for DeepSeek endpoint", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({
            endpoint: "https://api.deepseek.com/v1",
            __sentryParentSpan: parentSpan,
        } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const attrCalls = childSpan.setAttribute.mock.calls;
        const systemAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.system");
        expect(systemAttr).toBeDefined();
        expect(systemAttr![1]).toBe("deepseek");

        vi.unstubAllGlobals();
    });

    it("sets error status on child span when the API returns a non-ok response", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: vi.fn().mockResolvedValue("Unauthorized"),
        }));

        await drainStream(provider.generateStream("system", "user", config));

        expect(childSpan.setStatus).toHaveBeenCalledWith(
            expect.objectContaining({ code: 2 })
        );

        vi.unstubAllGlobals();
    });

    // Regression: verifies optional chaining prevents crash when startChild returns undefined
    it("handles the case where startChild returns undefined without crashing", async () => {
        const parentSpan = { startChild: vi.fn(() => undefined) };
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        let threwError = false;
        try {
            await drainStream(provider.generateStream("system", "user", config));
        } catch {
            threwError = true;
        }
        expect(threwError).toBe(false);

        vi.unstubAllGlobals();
    });

    // Boundary: verify that startChild is only called once per generateStream invocation
    it("calls startChild exactly once per generateStream call", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        expect(parentSpan.startChild).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });
});