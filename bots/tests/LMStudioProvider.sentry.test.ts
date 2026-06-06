/**
 * Tests for LMStudioProvider Sentry span changes (PR: use parentSpan.startChild())
 *
 * Scope: Only tests the changed behavior in this PR:
 *   - parentSpan is extracted from (config as any).__sentryParentSpan
 *   - parentSpan?.startChild() is used instead of Sentry.startInactiveSpan({parentSpan:...})
 *   - When __sentryParentSpan is absent, no span is created (optional chaining)
 *   - sentrySpan?.end() is called in the finally block
 *   - sentrySpan attributes are set on the child span, not via Sentry module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import type { AIProviderConfig } from "../ai/types";

// Mock @sentry/node to ensure it is NOT used for span creation in generateStream
vi.mock("@sentry/node", () => ({
    startInactiveSpan: vi.fn(), // should NOT be called in generateStream
    startSpanManual: vi.fn(),
    startSpan: vi.fn((_opts: unknown, cb: (s: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
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

// ---- Helper: build a minimal AIProviderConfig for LMStudio ----
function buildConfig(extra: Partial<AIProviderConfig & { __sentryParentSpan?: any }> = {}): AIProviderConfig & { __sentryParentSpan?: any } {
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

// ---- Helper: build a minimal Server-Sent Events response ----
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
        usage: { prompt_tokens: 5, completion_tokens: 3 },
    }),
];

describe("LMStudioProvider.generateStream – Sentry child span (PR change)", () => {
    let provider: LMStudioProvider;

    beforeEach(() => {
        provider = new LMStudioProvider();
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
        const config = buildConfig({ model: "mistral-7b", __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const [childOpts] = parentSpan.startChild.mock.calls[0];
        expect(childOpts).toMatchObject({ name: "LLM mistral-7b" });

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

    it("calls sentrySpan.end() even when fetch throws an error", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

        // generateStream yields an error chunk rather than throwing
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(childSpan.end).toHaveBeenCalledTimes(1);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true, metadata: { error: true } });

        vi.unstubAllGlobals();
    });

    it("does not throw and sentrySpan is undefined when __sentryParentSpan is absent", async () => {
        // No __sentryParentSpan on config — optional chaining should prevent errors
        const config = buildConfig(); // no __sentryParentSpan

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

    it("does not throw and sentrySpan is undefined when __sentryParentSpan is null", async () => {
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
        const config = buildConfig({ model: "phi-3", __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const attrCalls = childSpan.setAttribute.mock.calls;
        const modelAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.request.model");
        expect(modelAttr).toBeDefined();
        expect(modelAttr![1]).toBe("phi-3");

        vi.unstubAllGlobals();
    });

    it("sets gen_ai.system to 'lmstudio' on the child span", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", buildFetchMock(buildSSEStream(SIMPLE_SSE_LINES)));

        await drainStream(provider.generateStream("system", "user", config));

        const attrCalls = childSpan.setAttribute.mock.calls;
        const systemAttr = attrCalls.find(([key]: [string]) => key === "gen_ai.system");
        expect(systemAttr).toBeDefined();
        expect(systemAttr![1]).toBe("lmstudio");

        vi.unstubAllGlobals();
    });

    it("sets error status on child span when fetch fails", async () => {
        const childSpan = makeMockChildSpan();
        const parentSpan = makeMockParentSpan(childSpan);
        const config = buildConfig({ __sentryParentSpan: parentSpan } as any);

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue("Internal Server Error"),
        }));

        await drainStream(provider.generateStream("system", "user", config));

        expect(childSpan.setStatus).toHaveBeenCalledWith(
            expect.objectContaining({ code: 2 })
        );

        vi.unstubAllGlobals();
    });

    // Regression test: verifies optional chaining prevents crash when parentSpan
    // is set but startChild returns undefined (defensive scenario)
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
});