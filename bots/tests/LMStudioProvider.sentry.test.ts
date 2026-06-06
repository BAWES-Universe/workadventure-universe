/**
 * Tests for LMStudioProvider Sentry span creation (PR #140: startInactiveSpan with parentSpan)
 *
 * Scope: Only tests the changed behavior:
 *   - Sentry.startInactiveSpan is called (NOT startChild which was removed in v8)
 *   - parentSpan is passed from (config as any).__sentryParentSpan
 *   - When __sentryParentSpan is absent, no span is created
 *   - sentrySpan?.end() is called in the finally block
 *   - sentrySpan attributes are set on the child span
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";

// Use vi.hoisted() so mocks are defined before vi.mock is hoisted to top
const { mockSharedSpan, mockStartInactiveSpan } = vi.hoisted(() => {
    const span = { end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn() };
    return {
        mockSharedSpan: span,
        mockStartInactiveSpan: vi.fn(() => span),
    };
});

vi.mock("@sentry/node", () => ({
    startInactiveSpan: mockStartInactiveSpan,
    startSpan: vi.fn((_opts: unknown, cb: (s: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
    startSpanManual: vi.fn(),
}));

// ---- Helper: build config ----
function buildConfig(extra: Record<string, any> = {}): Record<string, any> {
    return {
        providerId: "lmstudio-1",
        name: "TestLMStudio",
        type: "lmstudio",
        enabled: true,
        endpoint: "http://localhost:1234",
        apiKeyEncrypted: null,
        model: "llama3",
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
        usage: { prompt_tokens: 5, completion_tokens: 3 },
    }),
];

describe("LMStudioProvider.generateStream – Sentry child span (PR #140)", () => {
    let provider: LMStudioProvider;

    beforeEach(() => {
        provider = new LMStudioProvider();
        vi.clearAllMocks();
    });

    it("calls Sentry.startInactiveSpan with op 'gen_ai.chat'", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockStartInactiveSpan).toHaveBeenCalledTimes(1);
        const opts = mockStartInactiveSpan.mock.calls[0][0];
        expect(opts).toMatchObject({ op: "gen_ai.chat" });
    });

    it("passes name 'LLM <model>' to startInactiveSpan", async () => {
        const config = buildConfig({ model: "mistral-7b", __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const opts = mockStartInactiveSpan.mock.calls[0][0];
        expect(opts).toMatchObject({ name: "LLM mistral-7b" });
    });

    it("passes parentSpan from config.__sentryParentSpan to startInactiveSpan", async () => {
        const parentSpan = { someId: "parent-123" };
        const config = buildConfig({ __sentryParentSpan: parentSpan });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const opts = mockStartInactiveSpan.mock.calls[0][0];
        expect(opts.parentSpan).toBe(parentSpan);
    });

    it("calls sentrySpan.end() in the finally block after a successful stream", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSharedSpan.end).toHaveBeenCalledTimes(1);
    });

    it("calls sentrySpan.end() even when fetch throws", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSharedSpan.end).toHaveBeenCalledTimes(1);
    });

    it("still streams successfully when __sentryParentSpan is absent", async () => {
        const config = buildConfig();
        mockStartInactiveSpan.mockImplementationOnce(() => undefined);

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("still streams successfully when __sentryParentSpan is null", async () => {
        const config = buildConfig({ __sentryParentSpan: null });
        mockStartInactiveSpan.mockImplementationOnce(() => undefined);

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("sets gen_ai.request.model attribute on the span", async () => {
        const config = buildConfig({ model: "phi-3", __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const attrCalls = mockSharedSpan.setAttribute.mock.calls;
        const modelAttr = attrCalls.find(([key]: string) => key === "gen_ai.request.model");
        expect(modelAttr).toBeDefined();
        expect(modelAttr![1]).toBe("phi-3");
    });

    it("sets gen_ai.system to 'lmstudio' on the span", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        const attrCalls = mockSharedSpan.setAttribute.mock.calls;
        const systemAttr = attrCalls.find(([key]: string) => key === "gen_ai.system");
        expect(systemAttr).toBeDefined();
        expect(systemAttr![1]).toBe("lmstudio");
    });

    it("sets error status on span when fetch fails", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue("Internal Server Error"),
        }));

        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockSharedSpan.setStatus).toHaveBeenCalledWith(
            expect.objectContaining({ code: 2 })
        );
    });

    it("calls startInactiveSpan exactly once per generateStream call", async () => {
        const config = buildConfig({ __sentryParentSpan: {} });

        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        await drainStream(provider.generateStream("system", "user", config));
        vi.unstubAllGlobals();

        expect(mockStartInactiveSpan).toHaveBeenCalledTimes(1);
    });
});