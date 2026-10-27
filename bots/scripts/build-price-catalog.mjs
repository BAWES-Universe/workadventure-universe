#!/usr/bin/env node
/**
 * Rebuilds bots/ai/pricing/catalog.json, the prices the bot server charges a reply at (#1173).
 *
 * The prices come from models.dev, the open model price list OpenCode uses, through its npm package. The package carries
 * a full copy of the list (about 7 MB), so this keeps only what a bot can be pointed at: models that answer in text and
 * list a price, on providers whose address we can recognise.
 *
 *   npm install --no-save @opencode-ai/models@latest
 *   node bots/scripts/build-price-catalog.mjs
 *
 * Prices never change by themselves. Run this, and the diff shows exactly which prices moved; they change when that
 * diff is merged. The script prints every price that changed, then the providers Orbit offers that it could not match.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = fileURLToPath(new URL('../ai/pricing/catalog.json', import.meta.url));

/** Providers models.dev knows by name but without an `api` address (their SDKs hold it). Each is the address bots call. */
const ADDRESSES_WITHOUT_API = {
    'api.openai.com': 'openai',
    'api.anthropic.com': 'anthropic',
    'generativelanguage.googleapis.com': 'google',
    'api.mistral.ai': 'mistral',
    'api.groq.com': 'groq',
    'api.x.ai': 'xai',
    'api.together.xyz': 'togetherai',
    'api.cerebras.ai': 'cerebras',
    'api.deepinfra.com': 'deepinfra',
    'api.perplexity.ai': 'perplexity',
    'ai-gateway.vercel.sh': 'vercel',
};

/** What models.dev calls output that is not a reply in text. */
const NOT_CHAT = new Set(['embedding', 'reranking', 'image', 'video', 'transcription', 'speech', 'realtime']);

function snapshotPath() {
    try {
        return require.resolve('@opencode-ai/models/snapshot', { paths: [process.cwd(), fileURLToPath(new URL('..', import.meta.url))] });
    } catch {
        console.error('Install the price list first: npm install --no-save @opencode-ai/models@latest');
        process.exit(1);
    }
}

const { providers, generatedAt } = await import(snapshotPath());
const version = JSON.parse(readFileSync(snapshotPath().replace(/dist[\\/]snapshot\.js$/, 'package.json'), 'utf8')).version;

/** Host and path of a provider's address, or null when it is not a fixed address (some are `${SOME_ENV_VAR}/v1`). */
function split(address) {
    try {
        const url = new URL(address);
        return { host: url.hostname, path: url.pathname.replace(/\/+$/, '') };
    } catch {
        return null;
    }
}

/** One model's prices, in the shape the price lookup reads. Tiers say where a higher price starts. */
function pricesOf(cost) {
    const { context_over_200k: legacyOver200k, tiers, ...base } = cost;
    const result = { ...base };
    if (tiers?.length) {
        result.tiers = tiers.map(({ tier, ...prices }) => ({ ...prices, from: tier.size })).sort((a, b) => a.from - b.from);
    } else if (legacyOver200k) {
        result.tiers = [{ ...legacyOver200k, from: 200000 }];
    }
    return result;
}

const catalog = { source: 'models.dev', package: `@opencode-ai/models@${version}`, generatedAt, version: generatedAt.slice(0, 10), addresses: {}, providers: {} };

for (const [id, provider] of Object.entries(providers)) {
    const models = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
        if (!model.cost || typeof model.cost.input !== 'number' || typeof model.cost.output !== 'number') continue;
        if (!model.modalities?.output?.includes('text') || NOT_CHAT.has(model.type)) continue;
        models[modelId] = pricesOf(model.cost);
    }
    if (!Object.keys(models).length) continue;
    catalog.providers[id] = { models };
    const address = provider.api ? split(provider.api) : null;
    if (address) (catalog.addresses[address.host] ??= []).push({ provider: id, path: address.path });
}
for (const [host, id] of Object.entries(ADDRESSES_WITHOUT_API)) {
    if (catalog.providers[id]) (catalog.addresses[host] ??= []).push({ provider: id, path: '' });
}
// A provider with no address we can recognise can never be matched to a bot, so its prices are not kept
const reachable = new Set(Object.values(catalog.addresses).flatMap((list) => list.map((entry) => entry.provider)));
for (const id of Object.keys(catalog.providers)) if (!reachable.has(id)) delete catalog.providers[id];
for (const list of Object.values(catalog.addresses)) list.sort((a, b) => b.path.length - a.path.length || a.provider.localeCompare(b.provider));
catalog.addresses = Object.fromEntries(Object.entries(catalog.addresses).sort(([a], [b]) => a.localeCompare(b)));
catalog.providers = Object.fromEntries(Object.entries(catalog.providers).sort(([a], [b]) => a.localeCompare(b)));

// What moved, so the PR that carries the new file can say so
if (existsSync(out)) {
    const before = JSON.parse(readFileSync(out, 'utf8'));
    const changes = [];
    for (const [id, provider] of Object.entries(catalog.providers)) {
        for (const [modelId, prices] of Object.entries(provider.models)) {
            const old = before.providers?.[id]?.models?.[modelId];
            if (!old) changes.push(`new      ${id}/${modelId}`);
            else if (JSON.stringify(old) !== JSON.stringify(prices)) changes.push(`changed  ${id}/${modelId}: ${JSON.stringify(old)} -> ${JSON.stringify(prices)}`);
        }
    }
    for (const [id, provider] of Object.entries(before.providers ?? {})) {
        for (const modelId of Object.keys(provider.models)) if (!catalog.providers[id]?.models?.[modelId]) changes.push(`removed  ${id}/${modelId}`);
    }
    console.log(changes.length ? changes.join('\n') : 'No price changed.');
}

writeFileSync(out, `${JSON.stringify(catalog)}\n`);
console.log(`Wrote ${out}: ${Object.keys(catalog.providers).length} providers, ${Object.values(catalog.providers).reduce((n, p) => n + Object.keys(p.models).length, 0)} models, list of ${catalog.version}.`);
