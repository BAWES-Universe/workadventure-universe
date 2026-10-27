/**
 * The price list: which models.dev provider an AI address belongs to, and what a model costs there (#1173).
 * The list is bots/ai/pricing/catalog.json, rebuilt by bots/scripts/build-price-catalog.mjs.
 */
import catalogJson from './catalog.json';
import type { ModelPrices, PriceCatalog } from './types';

export const catalog = catalogJson as unknown as PriceCatalog;

export interface FoundPrices {
    providerId: string;
    modelId: string;
    prices: ModelPrices;
}

/**
 * The provider an address belongs to. A host with one provider on it is that provider, whatever the path. A host shared
 * by several (z.ai has a pay-per-use and a coding-plan address) goes by the longest path the address starts with; if none
 * fits, it is not guessed.
 */
export function providerForAddress(endpoint: string | undefined): string | null {
    let url: URL;
    try {
        url = new URL(endpoint || '');
    } catch {
        return null;
    }
    const onHost = catalog.addresses[url.hostname];
    if (!onHost) return null;
    if (onHost.length === 1) return onHost[0].provider;
    const path = url.pathname.replace(/\/+$/, '');
    const fits = onHost.find((entry) => path === entry.path || path.startsWith(`${entry.path}/`));
    return fits ? fits.provider : null;
}

/** A model's id as the provider lists it: Gemini's model list writes `models/gemini-2.5-flash`. */
function listedAs(model: string): string[] {
    const bare = model.replace(/^models\//, '');
    return bare === model ? [model] : [model, bare];
}

/** The prices of `model` on whichever provider `endpoint` is, or null when either is not in the list. Ids match exactly, apart from capital letters. */
export function findPrices(endpoint: string | undefined, model: string | undefined): FoundPrices | null {
    const providerId = providerForAddress(endpoint);
    if (!providerId || !model) return null;
    const models = catalog.providers[providerId]?.models;
    if (!models) return null;
    for (const candidate of listedAs(model)) {
        if (models[candidate]) return { providerId, modelId: candidate, prices: models[candidate] };
        const lower = candidate.toLowerCase();
        const modelId = Object.keys(models).find((id) => id.toLowerCase() === lower);
        if (modelId) return { providerId, modelId, prices: models[modelId] };
    }
    return null;
}
