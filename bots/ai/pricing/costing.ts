/**
 * Prices one call to an AI provider (#1173): what it used, the model, and when it was sent go in; a cost in millionths
 * of a dollar, how it was worked out, and where the prices came from come out. A price nobody knows comes out as
 * `unknown`, never as a guess.
 */
import { catalog, findPrices, providerForAddress } from './priceCatalog';
import { DEEPSEEK_PEAK_FACTOR, DEEPSEEK_PROVIDER, MODEL_ALIASES, isDeepSeekPeak, warnIfHolidaysUnknown } from './overrides';
import type { CallCost, CallUsage, ModelPrices, Rates } from './types';

export interface PricedConfig {
    type: string;
    endpoint?: string;
    model?: string;
    settings?: Record<string, any>;
}

export interface PriceCallInput {
    config: PricedConfig;
    usage: CallUsage;
    /** When the call was sent. Prices that depend on the time of day use it. */
    at: Date;
    /** What the provider said the call cost, in dollars (OpenRouter sends it with every reply). */
    reportedCostUsd?: number;
}

const totalTokens = (usage: CallUsage): number => usage.inputTokens + usage.cachedTokens + usage.cacheWriteTokens + usage.outputTokens + usage.reasoningTokens;

/** Millionths of a dollar for a sum of dollars. A call that cost anything at all is at least 1, so it is never saved as free. */
export function toMicros(dollars: number): number {
    const micros = dollars * 1e6;
    return micros > 0 ? Math.max(1, Math.round(micros)) : 0;
}

/** Rates for a request of `context` tokens: the highest tier whose start the context has reached, over the base rates. */
function ratesFor(prices: ModelPrices, context: number): Rates {
    const { tiers, ...base } = prices;
    const tier = tiers?.filter((candidate) => context >= candidate.from).sort((a, b) => b.from - a.from)[0];
    if (!tier) return base;
    const { from: _from, ...tierRates } = tier;
    return { ...base, ...tierRates };
}

/**
 * Input that is read from or written to a cache is charged its own price; a provider that lists none charged the full
 * input price. Reasoning is charged as output unless the list gives it a price of its own.
 */
function dollarsFor(rates: Rates, usage: CallUsage): number {
    const perMillion =
        usage.inputTokens * rates.input +
        usage.cachedTokens * (rates.cache_read ?? rates.input) +
        usage.cacheWriteTokens * (rates.cache_write ?? rates.input) +
        usage.outputTokens * rates.output +
        usage.reasoningTokens * (rates.reasoning ?? rates.output);
    return perMillion / 1e6;
}

const unknown = (reason: string): CallCost => ({ basis: 'unknown', micros: null, source: null, version: null, reason });

export function priceCall({ config, usage, at, reportedCostUsd }: PriceCallInput): CallCost {
    // A model on someone's own computer costs Universe nothing; the person pays their own power bill
    if (config.type === 'lmstudio') return { basis: 'own_computer', micros: 0, source: null, version: null };

    // A super admin's own rate for this provider wins over every list
    const costPerToken = Number(config.settings?.costPerToken);
    if (costPerToken > 0) {
        const markup = Number(config.settings?.markup) > 0 ? Number(config.settings?.markup) : 1;
        return { basis: 'override', micros: toMicros(totalTokens(usage) * costPerToken * markup), source: 'provider settings', version: 'costPerToken' };
    }

    // The provider said what the call cost: nothing is more exact than that
    if (typeof reportedCostUsd === 'number' && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0) {
        return { basis: 'provider', micros: toMicros(reportedCostUsd), source: 'provider', version: 'usage.cost' };
    }

    const aliased = MODEL_ALIASES[providerForAddress(config.endpoint) ?? '']?.[config.model ?? ''];
    const found = findPrices(config.endpoint, aliased ?? config.model);
    if (!found) return unknown('model or address not in the price list');

    // models.dev lists some models at 0 when no price is published (a subscription, a free trial). Only an explicit :free variant is free.
    if (found.prices.input === 0 && found.prices.output === 0 && !found.modelId.endsWith(':free')) return unknown('listed at zero');

    const context = usage.inputTokens + usage.cachedTokens + usage.cacheWriteTokens;
    let rates = ratesFor(found.prices, context);
    let version = catalog.version;
    if (found.providerId === DEEPSEEK_PROVIDER) {
        warnIfHolidaysUnknown(at);
        const peak = isDeepSeekPeak(at);
        version = `${catalog.version} deepseek-${peak ? 'peak' : 'off-peak'}`;
        if (peak) rates = scaled(rates, DEEPSEEK_PEAK_FACTOR);
    }
    return { basis: 'priced', micros: toMicros(dollarsFor(rates, usage)), source: catalog.source, version };
}

function scaled(rates: Rates, factor: number): Rates {
    const result: Rates = { input: rates.input * factor, output: rates.output * factor };
    if (rates.reasoning !== undefined) result.reasoning = rates.reasoning * factor;
    if (rates.cache_read !== undefined) result.cache_read = rates.cache_read * factor;
    if (rates.cache_write !== undefined) result.cache_write = rates.cache_write * factor;
    return result;
}
