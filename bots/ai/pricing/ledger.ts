/**
 * What a whole reply cost (#1173). A reply can make several calls to the provider (the first answer, a follow-up after a
 * tool, a continuation after a cut-off); each is priced as it finishes, at its own time and with its own context size,
 * and the ledger adds them up.
 */
import { priceCall, type PricedConfig } from './costing';
import { emptyUsage, type CallCost, type CallUsage, type CostBasis } from './types';

/** What the provider sent on the last chunk of a call. Cached, cache-write and reasoning tokens are parts of the prompt and completion totals. */
export interface CallMetadata {
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    costUsd?: number;
    error?: boolean;
}

const within = (value: number | undefined, max: number): number => Math.min(Math.max(value ?? 0, 0), max);

/** Splits a call's totals into parts that never overlap. Null when the provider gave no split, so nothing can be priced from it. */
export function usageFromMetadata(metadata: CallMetadata | undefined): CallUsage | null {
    const prompt = metadata?.promptTokens ?? 0;
    const completion = metadata?.completionTokens ?? 0;
    if (prompt <= 0 && completion <= 0) return null;
    const cachedTokens = within(metadata?.cachedPromptTokens, prompt);
    const cacheWriteTokens = within(metadata?.cacheWriteTokens, prompt - cachedTokens);
    const reasoningTokens = within(metadata?.reasoningTokens, completion);
    return {
        inputTokens: prompt - cachedTokens - cacheWriteTokens,
        cachedTokens,
        cacheWriteTokens,
        outputTokens: completion - reasoningTokens,
        reasoningTokens,
    };
}

/** Prices one finished call from what its last chunk said. */
export function priceMetadata(config: PricedConfig, metadata: CallMetadata | undefined, at: Date): { cost: CallCost; usage: CallUsage } {
    const split = usageFromMetadata(metadata);
    const usage = split ?? emptyUsage();
    // Priced from the split when there is one; an own computer is free and a cost the provider reported stands, with or without it
    if (split || config.type === 'lmstudio' || typeof metadata?.costUsd === 'number') {
        return { cost: priceCall({ config, usage, at, reportedCostUsd: metadata?.costUsd }), usage };
    }
    // A call that failed before it said what it used was not billed
    if (metadata?.error) return { cost: { basis: 'priced', micros: 0, source: null, version: null }, usage };
    // One that finished without a split of input and output cannot be priced: that is unknown, not zero
    return { cost: { basis: 'unknown', micros: null, source: null, version: null, reason: 'the provider did not say what the call used' }, usage };
}

/** What a reply cost in all: the figures Orbit keeps on a usage row. */
export interface TurnCost {
    basis: CostBasis;
    /** Millionths of a dollar. Null exactly when the basis is `unknown`. */
    micros: number | null;
    source: string | null;
    version: string | null;
    usage: CallUsage;
}

export class UsageLedger {
    private readonly calls: Array<{ cost: CallCost; usage: CallUsage }> = [];

    add(entry: { cost: CallCost; usage: CallUsage }): void {
        this.calls.push(entry);
    }

    /** Null when no call has finished yet. */
    summary(): TurnCost | null {
        if (this.calls.length === 0) return null;
        const usage = emptyUsage();
        for (const { usage: used } of this.calls) {
            usage.inputTokens += used.inputTokens;
            usage.cachedTokens += used.cachedTokens;
            usage.cacheWriteTokens += used.cacheWriteTokens;
            usage.outputTokens += used.outputTokens;
            usage.reasoningTokens += used.reasoningTokens;
        }
        const costs = this.calls.map((call) => call.cost);
        // One call nobody can price makes the reply's cost unknown: a total that leaves a call out would be a guess
        if (costs.some((cost) => cost.basis === 'unknown')) {
            return { basis: 'unknown', micros: null, source: firstOf(costs, 'source'), version: joined(costs), usage };
        }
        const basis: CostBasis = costs.every((cost) => cost.basis === costs[0].basis) ? costs[0].basis : 'priced';
        return {
            basis,
            micros: costs.reduce((sum, cost) => sum + (cost.micros ?? 0), 0),
            source: firstOf(costs, 'source'),
            version: joined(costs),
            usage,
        };
    }
}

function firstOf(costs: CallCost[], key: 'source' | 'version'): string | null {
    return costs.find((cost) => cost[key])?.[key] ?? null;
}

/** The versions the calls were priced at, once each: two when a reply crossed from off-peak into peak. */
function joined(costs: CallCost[]): string | null {
    const versions = [...new Set(costs.map((cost) => cost.version).filter((version): version is string => Boolean(version)))];
    return versions.length ? versions.join(',') : null;
}
