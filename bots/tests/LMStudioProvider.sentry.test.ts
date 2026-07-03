/**
 * Tests for LMStudioProvider.generateStream — per-chunk incremental streaming
 *
 * Scope: Verifies that generateStream yields content incrementally
 * (per-chunk from the SSE reader) instead of buffering and yielding
 * everything at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";

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

describe("LMStudioProvider.generateStream – per-chunk streaming", () => {
    let provider: LMStudioProvider;

    beforeEach(() => {
        provider = new LMStudioProvider();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("streams content chunks incrementally", async () => {
        const config = buildConfig();
        vi.stubGlobal("fetch", buildFetchOk(buildSSEStream(SIMPLE_SSE)));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        // Should have content chunks + done chunk
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks[0]).toMatchObject({ content: "Hello", done: false });
        expect(chunks[chunks.length - 1]).toMatchObject({ done: true });
    });

    it("yields per-chunk content individually (not batched)", async () => {
        const config = buildConfig();
        const encoder = new TextEncoder();
        const sseLines = [
            JSON.stringify({ choices: [{ delta: { content: "X" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "Y" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "Z" } }] }),
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

        const contentChunks = chunks.filter((c: any) => c.content && !c.done);
        expect(contentChunks).toHaveLength(3);
        expect(contentChunks[0].content).toBe("X");
        expect(contentChunks[1].content).toBe("Y");
        expect(contentChunks[2].content).toBe("Z");
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
            status: 500,
            text: vi.fn().mockResolvedValue("Internal Server Error"),
        }));
        const chunks = await drainStream(provider.generateStream("system", "user", config));

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toMatchObject({ done: true });
        expect(chunks[0].metadata?.error).toBe(true);
    });
});
