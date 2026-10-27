/**
 * Pricing one AI call (#1173): the price list, DeepSeek's peak and off-peak hours, cached input, reasoning, higher
 * prices for long contexts, a cost the provider reported, own computers, and a model nobody knows the price of.
 * Prices are written out by hand here, so a changed list shows up as a failing test and not as a silent new cost.
 */
import { describe, expect, it, vi } from "vitest";
import { priceCall, toMicros } from "../ai/pricing/costing";
import { catalog, findPrices, providerForAddress } from "../ai/pricing/priceCatalog";
import { isChineseHoliday, isDeepSeekPeak } from "../ai/pricing/overrides";
import { emptyUsage } from "../ai/pricing/types";

const usage = (parts: Partial<ReturnType<typeof emptyUsage>>) => ({ ...emptyUsage(), ...parts });
const deepseek = { type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash" };
const monday = (time: string) => new Date(`2026-10-26T${time}:00Z`);

describe("the price list the tests below rely on", () => {
    it("holds DeepSeek's off-peak prices, which the peak rule doubles (refresh the list and this test shows it moved)", () => {
        expect(findPrices("https://api.deepseek.com", "deepseek-flash")?.prices).toEqual({ input: 0.15, output: 0.6, reasoning: 0.6, cache_read: 0.003 });
        expect(findPrices("https://api.deepseek.com", "deepseek-v4-pro")?.prices).toEqual({ input: 0.66, output: 1.98, reasoning: 1.98, cache_read: 0.022 });
    });
});

describe("DeepSeek", () => {
    const call = { inputTokens: 1000, cachedTokens: 4000, outputTokens: 200 };

    it("prices cached input at the cache price, off-peak: 1000 x 0.15 + 4000 x 0.003 + 200 x 0.6 = 282 millionths", () => {
        expect(priceCall({ config: deepseek, usage: usage(call), at: monday("05:00") })).toEqual({
            basis: "priced", micros: 282, source: "models.dev", version: `${catalog.version} deepseek-off-peak`,
        });
    });

    it("charges twice that in peak hours, every line doubled, and says so in the version", () => {
        expect(priceCall({ config: deepseek, usage: usage(call), at: monday("02:00") })).toMatchObject({ micros: 564, version: `${catalog.version} deepseek-peak` });
    });

    it("prices the same call the same way for the model's older ids", () => {
        for (const model of ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"]) {
            expect(priceCall({ config: { ...deepseek, model }, usage: usage(call), at: monday("05:00") }).micros).toBe(282);
        }
    });

    it("prices V4 Pro on its own rates: 1000 x 0.66 + 4000 x 0.022 + 200 x 1.98 = 1144 millionths", () => {
        expect(priceCall({ config: { ...deepseek, model: "deepseek-v4-pro" }, usage: usage(call), at: monday("05:00") }).micros).toBe(1144);
    });

    it("charges reasoning as output: 100 output + 300 reasoning at 0.6", () => {
        expect(priceCall({ config: deepseek, usage: usage({ outputTokens: 100, reasoningTokens: 300 }), at: monday("05:00") }).micros).toBe(240);
    });

    it("keeps a cheap reply as what it cost, not as $0: 6666 cached tokens are 20 millionths", () => {
        expect(priceCall({ config: deepseek, usage: usage({ cachedTokens: 6666 }), at: monday("05:00") }).micros).toBe(20);
    });

    it("never saves a call that cost something as free, however small", () => {
        expect(priceCall({ config: deepseek, usage: usage({ cachedTokens: 10 }), at: monday("05:00") }).micros).toBe(1);
        expect(priceCall({ config: deepseek, usage: usage({}), at: monday("05:00") }).micros).toBe(0);
    });

    it("works the same whichever address form is saved", () => {
        for (const endpoint of ["https://api.deepseek.com", "https://api.deepseek.com/", "https://api.deepseek.com/v1", "https://api.deepseek.com/beta"]) {
            expect(priceCall({ config: { ...deepseek, endpoint }, usage: usage(call), at: monday("05:00") }).micros).toBe(282);
        }
    });
});

describe("DeepSeek peak hours (01:00-04:00 and 06:00-10:00 UTC, Monday to Friday, not Chinese holidays)", () => {
    it.each([
        ["00:59", false], ["01:00", true], ["03:59", true], ["04:00", false], ["05:59", false], ["06:00", true], ["09:59", true], ["10:00", false], ["23:00", false],
    ])("a Monday at %s UTC: peak is %s", (time, peak) => {
        expect(isDeepSeekPeak(monday(time))).toBe(peak);
    });

    it("is off-peak all weekend", () => {
        expect(isDeepSeekPeak(new Date("2026-10-24T02:00:00Z"))).toBe(false); // Saturday
        expect(isDeepSeekPeak(new Date("2026-10-25T07:00:00Z"))).toBe(false); // Sunday
    });

    it("is off-peak on a Chinese public holiday that falls on a weekday, and peak again the day after", () => {
        expect(isChineseHoliday(new Date("2026-10-01T02:00:00Z"))).toBe(true);
        expect(isDeepSeekPeak(new Date("2026-10-01T02:00:00Z"))).toBe(false); // National Day, a Thursday
        expect(isDeepSeekPeak(new Date("2026-09-25T07:00:00Z"))).toBe(false); // Mid-Autumn Festival, a Friday
        expect(isDeepSeekPeak(new Date("2026-10-07T07:00:00Z"))).toBe(false); // last day of the National Day break
        expect(isDeepSeekPeak(new Date("2026-10-08T07:00:00Z"))).toBe(true); // Thursday after
    });

    it("keeps a make-up working weekend off-peak, since the page says Monday through Friday", () => {
        expect(isDeepSeekPeak(new Date("2026-10-10T02:00:00Z"))).toBe(false); // Saturday, a working day in China
    });

    it("says once that a call is dated past the holiday list", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const call = { config: deepseek, usage: usage({ inputTokens: 10 }), at: new Date("2027-01-04T02:00:00Z") };
        priceCall(call);
        priceCall(call);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe("other providers, from the list", () => {
    it("prices Claude's cache reads and writes apart from input: 1000 x 3 + 20000 x 0.3 + 5000 x 3.75 + 500 x 15 = 35250 millionths", () => {
        const config = { type: "anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, cachedTokens: 20000, cacheWriteTokens: 5000, outputTokens: 500 }), at: monday("05:00") })).toEqual({
            basis: "priced", micros: 35250, source: "models.dev", version: catalog.version,
        });
    });

    it("prices OpenAI's cached input: 1000 x 1.25 + 4000 x 0.125 + 200 x 10", () => {
        const config = { type: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-5" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, cachedTokens: 4000, outputTokens: 200 }), at: monday("05:00") }).micros).toBe(3750);
    });

    it("uses the higher price once a request's context reaches the tier, for the whole request (Gemini 2.5 Pro above 200k)", () => {
        const config = { type: "openai", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "models/gemini-2.5-pro" };
        expect(priceCall({ config, usage: usage({ inputTokens: 100000, outputTokens: 1000 }), at: monday("05:00") }).micros).toBe(135000);
        expect(priceCall({ config, usage: usage({ inputTokens: 300000, outputTokens: 1000 }), at: monday("05:00") }).micros).toBe(765000);
        // cached tokens count toward the context that picks the tier
        expect(priceCall({ config, usage: usage({ inputTokens: 100000, cachedTokens: 150000, outputTokens: 0 }), at: monday("05:00") }).micros).toBe(100000 * 2.5 + 150000 * 0.25);
    });

    it("charges reasoning at the tier's output price when the tier lists no reasoning price of its own (Qwen 3.5 Plus above 256k)", () => {
        const config = { type: "openai", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen3.5-plus" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, reasoningTokens: 1000 }), at: monday("05:00") }).micros).toBe(1000 * 0.4 + 1000 * 2.4);
        expect(priceCall({ config, usage: usage({ inputTokens: 300000, reasoningTokens: 1000 }), at: monday("05:00") }).micros).toBe(300000 * 0.5 + 1000 * 3);
    });

    it("raises a tier's cache prices with its input price when the tier lists none (Claude Sonnet 4.6 above 200k: 1000 x 6 + 20000 x 0.6 + 5000 x 7.5 + 500 x 22.5)", () => {
        const config = { type: "openai", endpoint: "https://api.302.ai/v1", model: "claude-sonnet-4-6" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, cachedTokens: 20000, cacheWriteTokens: 190000, outputTokens: 500 }), at: monday("05:00") }).micros).toBe(1000 * 6 + 20000 * 0.6 + 190000 * 7.5 + 500 * 22.5);
        // below the tier the base cache prices stand
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, cachedTokens: 20000, cacheWriteTokens: 5000, outputTokens: 500 }), at: monday("05:00") }).micros).toBe(1000 * 3 + 20000 * 0.3 + 5000 * 3.75 + 500 * 15);
    });

    it("finds a model whose id differs only in capital letters", () => {
        const config = { type: "openai", endpoint: "https://api.openai.com/v1", model: "GPT-5" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000 }), at: monday("05:00") }).basis).toBe("priced");
    });
});

describe("a call with nothing to price it by", () => {
    it("is unknown for a model that is not in the list, with no number and not a flat rate", () => {
        const call = priceCall({ config: { type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-v9" }, usage: usage({ inputTokens: 1000, outputTokens: 1000 }), at: monday("05:00") });
        expect(call).toMatchObject({ basis: "unknown", micros: null });
    });

    it("is unknown for an address nobody lists, such as a model server somebody runs", () => {
        const call = priceCall({ config: { type: "openai", endpoint: "https://llm.example.org/v1", model: "gpt-5" }, usage: usage({ inputTokens: 1000 }), at: monday("05:00") });
        expect(call).toMatchObject({ basis: "unknown", micros: null });
    });

    it("is unknown when the list has the model at zero, which means no published price", () => {
        const model = Object.entries(catalog.providers["zai-coding-plan"].models).find(([, prices]) => prices.input === 0 && prices.output === 0);
        expect(model).toBeDefined();
        const call = priceCall({ config: { type: "openai", endpoint: "https://api.z.ai/api/coding/paas/v4", model: model![0] }, usage: usage({ inputTokens: 1000 }), at: monday("05:00") });
        expect(call).toMatchObject({ basis: "unknown", micros: null });
    });
});

describe("token counts that cannot be read", () => {
    const config = { type: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-5" };
    it("are unknown, never a free call, when a count is missing or not a number", () => {
        const missing = { ...emptyUsage(), inputTokens: 1000, cachedTokens: undefined } as any;
        expect(priceCall({ config, usage: missing, at: monday("05:00") })).toMatchObject({ basis: "unknown", micros: null });
        expect(priceCall({ config, usage: usage({ inputTokens: NaN }), at: monday("05:00") })).toMatchObject({ basis: "unknown", micros: null });
        expect(priceCall({ config, usage: usage({ outputTokens: -5 }), at: monday("05:00") })).toMatchObject({ basis: "unknown", micros: null });
    });
    it("leave a super admin rate unknown too, but the provider own figure still counts", () => {
        const bad = usage({ inputTokens: NaN });
        const withRate = { ...config, settings: { costPerToken: 0.000001 } };
        expect(priceCall({ config: withRate, usage: bad, at: monday("05:00") }).basis).toBe("unknown");
        expect(priceCall({ config, usage: bad, at: monday("05:00"), reportedCostUsd: 0.002 })).toMatchObject({ basis: "provider", micros: 2000 });
    });
});

describe("a cost somebody else said", () => {
    it("takes the cost OpenRouter sent with the reply as it is, not the list's price", () => {
        const config = { type: "openai", endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000, outputTokens: 1000 }), at: monday("05:00"), reportedCostUsd: 0.0000325 })).toEqual({
            basis: "provider", micros: 33, source: "provider", version: "usage.cost",
        });
    });

    it("keeps a reported cost of zero as a real zero", () => {
        const config = { type: "openai", endpoint: "https://openrouter.ai/api/v1", model: "x/y:free" };
        expect(priceCall({ config, usage: usage({ inputTokens: 5 }), at: monday("05:00"), reportedCostUsd: 0 })).toMatchObject({ basis: "provider", micros: 0 });
    });

    it("prices an OpenRouter reply from the list when it sent no cost", () => {
        const config = { type: "openai", endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash" };
        expect(priceCall({ config, usage: usage({ inputTokens: 1000 }), at: monday("05:00") }).basis).toBe("priced");
    });

    it("uses a super admin's own rate when one is set, whatever the list says", () => {
        const call = priceCall({ config: { ...deepseek, settings: { costPerToken: 0.00001, markup: 2 } }, usage: usage({ inputTokens: 1000, outputTokens: 500 }), at: monday("05:00") });
        expect(call).toMatchObject({ basis: "override", micros: 30000 });
    });
});

describe("a model on someone's own computer", () => {
    it("costs nothing and says why", () => {
        expect(priceCall({ config: { type: "lmstudio", endpoint: "http://localhost:1234", model: "qwen3-8b" }, usage: usage({ inputTokens: 5000, outputTokens: 500 }), at: monday("05:00") })).toEqual({
            basis: "own_computer", micros: 0, source: null, version: null,
        });
    });
});

describe("finding the provider from an address", () => {
    it("tells a provider's pay-per-use address from its coding-plan one on the same host", () => {
        expect(providerForAddress("https://api.z.ai/api/paas/v4")).toBe("zai");
        expect(providerForAddress("https://api.z.ai/api/coding/paas/v4")).toBe("zai-coding-plan");
        expect(providerForAddress("https://api.z.ai/somewhere/else")).toBeNull();
    });

    it("does not guess a provider for an address it does not list, or one that is not an address", () => {
        expect(providerForAddress("https://example.com/v1")).toBeNull();
        expect(providerForAddress("not an address")).toBeNull();
        expect(providerForAddress(undefined)).toBeNull();
    });

    it("recognises every provider Orbit offers by name", () => {
        const offered = [
            "https://openrouter.ai/api/v1", "https://generativelanguage.googleapis.com/v1beta/openai", "https://integrate.api.nvidia.com/v1",
            "https://api.openai.com/v1", "https://api.deepseek.com", "https://api.anthropic.com/v1", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1", "https://api.z.ai/api/paas/v4",
            "https://open.bigmodel.cn/api/paas/v4", "https://api.x.ai/v1", "https://api.mistral.ai/v1", "https://api.groq.com/openai/v1",
            "https://api.together.xyz/v1", "https://api.fireworks.ai/inference/v1", "https://api.deepinfra.com/v1/openai", "https://api.cerebras.ai/v1",
            "https://router.huggingface.co/v1", "https://ai-gateway.vercel.sh/v1",
        ];
        expect(offered.filter((endpoint) => providerForAddress(endpoint) === null)).toEqual([]);
    });
});

describe("toMicros", () => {
    it("rounds to whole millionths and never turns a cost into zero", () => {
        expect(toMicros(0.00002)).toBe(20);
        expect(toMicros(0.0000004)).toBe(1);
        expect(toMicros(0)).toBe(0);
    });
});
