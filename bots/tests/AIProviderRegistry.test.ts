/**
 * Tests for AIProviderRegistry — specifically the non-streaming fallback path.
 *
 * Scope: When a provider does not support streaming, generateStream() falls back
 * to a single provider.generate() call and wraps the result in two chunks
 * (content + done). Regression: the metadata (tokensUsed etc.) must be attached
 * ONLY to the done chunk — consumers accumulate usage with += across chunks
 * (continueTruncatedResponse, follow-up rounds), so sharing the same metadata
 * object on both chunks double-counts token usage (PR #374 review finding).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIProviderRegistry } from "../ai/AIProviderRegistry";
import type { AIProviderConfig } from "../ai/types";

function buildConfig(extra?: Record<string, unknown>): AIProviderConfig {
    return {
        providerId: "test-provider",
        name: "TestProvider",
        type: "openai",
        enabled: true,
        endpoint: "http://localhost:1234",
        apiKeyEncrypted: null,
        model: "test-model",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: false,
        settings: {},
        ...extra,
    } as AIProviderConfig;
}

// Fake non-streaming provider: generate() returns a complete response.
function createNonStreamingProvider() {
    return {
        isReady: () => true,
        supportsStreaming: () => false,
        generate: vi.fn().mockResolvedValue({
            content: "complete non-streaming answer",
            tokensUsed: 42,
            promptTokens: 20,
            completionTokens: 22,
            latency: 100,
            error: false,
            truncated: false,
        }),
        generateStream: vi.fn(),
    };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) {
        chunks.push(chunk);
    }
    return chunks;
}

describe("AIProviderRegistry – non-streaming fallback", () => {
    let registry: AIProviderRegistry;

    beforeEach(() => {
        registry = new AIProviderRegistry();
    });

    it("yields content chunk then done chunk, both carrying the full content", async () => {
        const provider = createNonStreamingProvider();
        registry.registerProvider("test-provider", provider as any);

        const chunks = await drain(registry.generateStream(
            "test-provider", "system", "user", buildConfig()
        ));

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({ content: "complete non-streaming answer", done: false });
        expect(chunks[1]).toMatchObject({ content: "", done: true });
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    it("attaches token metadata ONLY to the done chunk (no double-count via +=)", async () => {
        const provider = createNonStreamingProvider();
        registry.registerProvider("test-provider", provider as any);

        const chunks = await drain(registry.generateStream(
            "test-provider", "system", "user", buildConfig()
        ));

        // The content chunk must NOT carry metadata.
        expect(chunks[0].metadata).toBeUndefined();
        // The done chunk carries the full usage metadata exactly once.
        expect(chunks[1].metadata).toMatchObject({
            tokensUsed: 42,
            latency: 100,
            error: false,
            truncated: false,
        });

        // Simulate a += accumulator (continueTruncatedResponse / follow-up pattern):
        // summing tokensUsed across ALL chunks must equal 42, not 84.
        const accumulatedTokens = chunks.reduce(
            (sum: number, c: any) => sum + (c.metadata?.tokensUsed || 0),
            0
        );
        expect(accumulatedTokens).toBe(42);
    });

    it("propagates truncated and error flags from the non-streaming response", async () => {
        const provider = createNonStreamingProvider();
        provider.generate.mockResolvedValue({
            content: "partial",
            tokensUsed: 10,
            promptTokens: 5,
            completionTokens: 5,
            latency: 50,
            error: false,
            truncated: true,
        });
        registry.registerProvider("test-provider", provider as any);

        const chunks = await drain(registry.generateStream(
            "test-provider", "system", "user", buildConfig()
        ));

        expect(chunks[1].metadata.truncated).toBe(true);
        expect(chunks[1].metadata.error).toBe(false);
    });
});
