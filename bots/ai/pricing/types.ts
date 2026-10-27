/**
 * Types for pricing a bot reply (#1173).
 */

/** USD per 1 million tokens, as models.dev lists them. */
export interface Rates {
    input: number;
    output: number;
    /** Price of reasoning tokens when it differs from the output price. */
    reasoning?: number;
    /** Input read back from the provider's cache. */
    cache_read?: number;
    /** Input written to the provider's cache (Claude charges extra for this). */
    cache_write?: number;
}

/** A higher (or lower) price that starts once a request's context reaches `from` tokens. */
export interface RateTier extends Rates {
    from: number;
}

export interface ModelPrices extends Rates {
    tiers?: RateTier[];
}

export interface PriceCatalog {
    source: string;
    package: string;
    generatedAt: string;
    /** The date of the models.dev list the prices were taken from, e.g. 2026-10-25. */
    version: string;
    /** Where each provider is served from: host, then the providers on it with the path their address starts with. */
    addresses: Record<string, Array<{ provider: string; path: string }>>;
    providers: Record<string, { models: Record<string, ModelPrices> }>;
}

/**
 * What one call to a provider used. The five numbers never overlap, so together they are everything that was billed:
 * `inputTokens` is input that was neither read from nor written to a cache, and `outputTokens` leaves out reasoning.
 */
export interface CallUsage {
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens: number;
}

/**
 * How a cost was worked out. `priced`: from the price list. `provider`: the provider said what the call cost.
 * `override`: a super admin's own rate. `own_computer`: a model on someone's computer, which costs Universe nothing.
 * `unknown`: nobody knows the price, so no number is made up.
 */
export type CostBasis = 'priced' | 'provider' | 'override' | 'own_computer' | 'unknown';

export interface CallCost {
    basis: CostBasis;
    /** Millionths of a dollar. Null exactly when the basis is `unknown`. */
    micros: number | null;
    /** Where the prices came from, e.g. models.dev. Null for an own computer. */
    source: string | null;
    /** Which list and which rate: enough to find the prices again by hand. Null for an own computer. */
    version: string | null;
    /** Why a price is unknown, for logs. */
    reason?: string;
}

export const emptyUsage = (): CallUsage => ({ inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 });
