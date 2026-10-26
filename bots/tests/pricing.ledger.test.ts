/**
 * Adding up what a reply cost, call by call (#1173): splitting a call's totals into parts that never overlap, pricing a
 * finished call from what its last chunk said, and the sum over a reply's calls.
 */
import { describe, expect, it } from "vitest";
import { UsageLedger, priceMetadata, usageFromMetadata } from "../ai/pricing/ledger";
import type { CallCost } from "../ai/pricing/types";
import { emptyUsage } from "../ai/pricing/types";

const deepseek = { type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash" };
const offPeak = new Date("2026-10-26T05:00:00Z");
const peak = new Date("2026-10-26T02:00:00Z");

describe("usageFromMetadata", () => {
    it("splits the totals so that nothing is counted twice", () => {
        expect(usageFromMetadata({ promptTokens: 5000, completionTokens: 400, cachedPromptTokens: 4000, cacheWriteTokens: 200, reasoningTokens: 300 })).toEqual({
            inputTokens: 800, cachedTokens: 4000, cacheWriteTokens: 200, outputTokens: 100, reasoningTokens: 300,
        });
    });

    it("never lets a figure exceed the total it is a part of", () => {
        expect(usageFromMetadata({ promptTokens: 100, completionTokens: 10, cachedPromptTokens: 500, reasoningTokens: 99 })).toEqual({
            inputTokens: 0, cachedTokens: 100, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 10,
        });
    });

    it("is null when the provider gave no split", () => {
        expect(usageFromMetadata({ tokensUsed: 50 })).toBeNull();
        expect(usageFromMetadata(undefined)).toBeNull();
    });
});

describe("priceMetadata", () => {
    it("prices a finished DeepSeek call: 1000 x 0.15 + 4000 x 0.003 + 200 x 0.6 = 282 millionths off-peak", () => {
        const { cost, usage } = priceMetadata(deepseek, { promptTokens: 5000, completionTokens: 200, cachedPromptTokens: 4000, tokensUsed: 5200 }, offPeak);
        expect(cost).toMatchObject({ basis: "priced", micros: 282 });
        expect(usage).toEqual({ inputTokens: 1000, cachedTokens: 4000, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 0 });
    });

    it("prices a call on an own computer as free even if it said nothing about what it used", () => {
        expect(priceMetadata({ type: "lmstudio", model: "qwen" }, { tokensUsed: 0 }, offPeak).cost).toMatchObject({ basis: "own_computer", micros: 0 });
    });

    it("takes a cost the provider reported, even with no split", () => {
        expect(priceMetadata({ type: "openai", endpoint: "https://openrouter.ai/api/v1", model: "x/y" }, { costUsd: 0.000123 }, offPeak).cost).toMatchObject({ basis: "provider", micros: 123 });
    });

    it("saves a call that failed before it said anything as a real zero: nothing was billed", () => {
        expect(priceMetadata(deepseek, { tokensUsed: 0, error: true }, offPeak).cost).toMatchObject({ basis: "priced", micros: 0 });
    });

    it("cannot price a call that finished without saying what it used: unknown, not zero", () => {
        expect(priceMetadata(deepseek, { tokensUsed: 0, error: false }, offPeak).cost).toMatchObject({ basis: "unknown", micros: null });
        expect(priceMetadata(deepseek, { tokensUsed: 800, error: false }, offPeak).cost).toMatchObject({ basis: "unknown", micros: null });
    });
});

describe("UsageLedger", () => {
    const call = (config: typeof deepseek, metadata: Parameters<typeof priceMetadata>[1], at: Date) => priceMetadata(config, metadata, at);

    it("has no summary until a call has finished", () => {
        expect(new UsageLedger().summary()).toBeNull();
    });

    it("adds up the calls of one reply, each priced for itself", () => {
        const ledger = new UsageLedger();
        ledger.add(call(deepseek, { promptTokens: 5000, completionTokens: 200, cachedPromptTokens: 4000 }, offPeak)); // 282
        ledger.add(call(deepseek, { promptTokens: 6000, completionTokens: 100, cachedPromptTokens: 5000 }, offPeak)); // 150 + 15 + 60 = 225
        expect(ledger.summary()).toEqual({
            basis: "priced", micros: 507, source: "models.dev", version: expect.stringContaining("deepseek-off-peak"),
            usage: { inputTokens: 2000, cachedTokens: 9000, cacheWriteTokens: 0, outputTokens: 300, reasoningTokens: 0 },
        });
    });

    it("names both versions when a reply crossed from off-peak into peak", () => {
        const ledger = new UsageLedger();
        ledger.add(call(deepseek, { promptTokens: 1000, completionTokens: 0 }, offPeak));
        ledger.add(call(deepseek, { promptTokens: 1000, completionTokens: 0 }, peak));
        const summary = ledger.summary();
        expect(summary?.micros).toBe(150 + 300);
        expect(summary?.version).toMatch(/deepseek-off-peak,.*deepseek-peak$/);
        expect((summary?.version ?? "").length).toBeLessThanOrEqual(60);
    });

    it("makes the whole reply unknown when one call cannot be priced, rather than leaving that call out", () => {
        const ledger = new UsageLedger();
        ledger.add(call(deepseek, { promptTokens: 1000, completionTokens: 100 }, offPeak));
        ledger.add(call(deepseek, { tokensUsed: 700 }, offPeak));
        expect(ledger.summary()).toMatchObject({ basis: "unknown", micros: null });
    });

    it("keeps an own computer's zero as a zero", () => {
        const ledger = new UsageLedger();
        ledger.add({ cost: { basis: "own_computer", micros: 0, source: null, version: null } as CallCost, usage: emptyUsage() });
        expect(ledger.summary()).toMatchObject({ basis: "own_computer", micros: 0 });
    });
});
