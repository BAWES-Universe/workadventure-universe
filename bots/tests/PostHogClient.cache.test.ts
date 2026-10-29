/**
 * The cache figures on a PostHog generation event (#975): a figure that was not reported is left out, so it can never
 * overwrite the cached count the call itself carries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
vi.mock("posthog-node", () => ({ PostHog: vi.fn(() => ({ capture, flush: vi.fn() })) }));

describe("captureAiGeneration and the cache figures", () => {
    beforeEach(() => {
        capture.mockReset();
        vi.resetModules();
        process.env.POSTHOG_API_KEY = "phc_test";
    });

    const base = { distinctId: "bot-1", traceId: "t", sessionId: "s", model: "m", provider: "anthropic", input: "hi", output: "yo", inputTokens: 3025, outputTokens: 7 };

    it("keeps the cached count when only cache writes are reported on top", async () => {
        const { captureAiGeneration } = await import("../ai/PostHogClient");
        captureAiGeneration({ ...base, cachedInputTokens: 2000, cacheWriteTokens: 10 });
        expect(capture.mock.calls[0][0].properties).toMatchObject({
            $ai_cache_read_input_tokens: 2000,
            $ai_cache_creation_input_tokens: 10,
            $ai_cache_reporting_exclusive: false,
        });
    });

    it("sends the read figure and the write figure when both were reported", async () => {
        const { captureAiGeneration } = await import("../ai/PostHogClient");
        captureAiGeneration({ ...base, cachedInputTokens: 3000, cacheReadTokens: 3000, cacheWriteTokens: 0 });
        expect(capture.mock.calls[0][0].properties).toMatchObject({ $ai_cache_read_input_tokens: 3000, $ai_cache_reporting_exclusive: false });
    });

    it("sends no cache fields for a call that used no cache", async () => {
        const { captureAiGeneration } = await import("../ai/PostHogClient");
        captureAiGeneration({ ...base });
        const properties = capture.mock.calls[0][0].properties;
        expect(properties).not.toHaveProperty("$ai_cache_read_input_tokens");
        expect(properties).not.toHaveProperty("$ai_cache_creation_input_tokens");
    });
});
