/**
 * Tests for OpenAIProvider.generateStream — per-chunk incremental streaming
 *
 * Scope: Verifies that generateStream yields content incrementally
 * (per-chunk from the SSE reader) instead of buffering and yielding
 * everything at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

// Mock encryption
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "***"),
}));

// ---- Helper: build a minimal AIProviderConfig for OpenAI ----
function buildConfig(extra: Record<string, any> = {}): AIProviderConfig {
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

describe("OpenAIProvider.generateStream – per-chunk streaming", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        provider = new OpenAIProvider();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("streams content chunks incrementally", async () => {
        const config = buildConfig();
        const encoder = new TextEncoder();
        // Send tokens one at a time to test true per-chunk streaming
        const sse1 = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`;
        const sse2 = `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`;
        const sseDone = "data: [DONE]\n\n";
        const allData = sse1 + sse2 + sseDone;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(allData));
                controller.close();
            },
        });

        vi.stubGlobal("fetch", buildFetchOk(stream));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        // Should have content chunks (Hello, world) + done chunk = 3 total
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        // First chunk should be the first content delta
        expect(chunks[0]).toMatchObject({ content: "Hello", done: false });
        // Last chunk should be done:true
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("streams successfully when __sentryParentSpan is absent", async () => {
        const config = buildConfig();
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("streams successfully when __sentryParentSpan is null", async () => {
        const config = buildConfig({ __sentryParentSpan: null });
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("yields per-chunk content individually (not batched)", async () => {
        const config = buildConfig();
        const encoder = new TextEncoder();
        const sseLines = [
            JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "C" } }] }),
        ];
        const allData = sseLines.map(l => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(allData));
                controller.close();
            },
        });

        vi.stubGlobal("fetch", buildFetchOk(stream));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        // Each token appears as its own chunk
        const contentChunks = chunks.filter((c: any) => c.content && !c.done);
        expect(contentChunks).toHaveLength(3);
        expect(contentChunks[0].content).toBe("A");
        expect(contentChunks[1].content).toBe("B");
        expect(contentChunks[2].content).toBe("C");
    });

    it("includes metadata on done chunk", async () => {
        const config = buildConfig();
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        const doneChunk = chunks[chunks.length - 1];
        expect(doneChunk.metadata).toBeDefined();
        expect(doneChunk.metadata.tokensUsed).toBeGreaterThan(0);
    });

    it("handles network errors gracefully", async () => {
        const config = buildConfig();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toMatchObject({ done: true });
        expect(chunks[0].metadata?.error).toBe(true);
    });

    it("handles API errors gracefully", async () => {
        const config = buildConfig();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: vi.fn().mockResolvedValue("Unauthorized"),
        }));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toMatchObject({ done: true });
        expect(chunks[0].metadata?.error).toBe(true);
    });
});
