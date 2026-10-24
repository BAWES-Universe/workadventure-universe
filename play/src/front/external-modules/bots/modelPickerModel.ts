import type { BotAiOptions, KeyModelOption } from "./types";

/**
 * The bot page's Model row and model list (#1319), decided in one place, so every case is a test. A bot on one of the
 * person's own keys has its own model (Orbit #575): the key's models the lend here allows. The words are the page's
 * (i18n); this only says what is what.
 */

type KeyEntry = BotAiOptions["keys"][number];

/**
 * What a provider suggests as the first model of a key (Orbit's `suggestedModel` for the key's kind). Orbit has one today.
 * A key's check model is not the same thing: for a provider with no suggestion (OpenRouter) it is only the first one listed.
 */
const SUGGESTED_MODELS: Readonly<Record<string, string>> = { deepseek: "deepseek-v4-flash" };

/** Makers shown before "Show all", biggest first. */
export const MAKERS_FIRST = 8;

/** The viewer's own key the bot is on (lent here), or undefined when the bot is on something else. */
export function keyOfRef(options: BotAiOptions, ref: string | null | undefined): KeyEntry | undefined {
    return ref ? options.keys.find((key) => key.id === ref) : undefined;
}

/** The models a key offers this bot, or null when Orbit could not list them. */
export function allowedModelsOf(key: KeyEntry): KeyModelOption[] | null {
    return Array.isArray(key.models) ? key.models : null;
}

/**
 * The model a bot starts on when it is put on a key, with no pick from the person: the only model the lend allows, else the
 * provider's suggested one when the lend allows it. Null when the person has to pick.
 */
export function preselectedModel(key: KeyEntry): string | null {
    const models = allowedModelsOf(key);
    if (!models || models.length === 0) return null;
    if (models.length === 1) return models[0].id;
    const suggested = key.kind ? SUGGESTED_MODELS[key.kind] : undefined;
    return suggested && models.some((model) => model.id === suggested) ? suggested : null;
}

/** Putting the bot on this key: the model it starts on, or `needsPick` when the person must choose one first. */
export function keyChoice(key: KeyEntry): { model: string | null; needsPick: boolean } {
    const models = allowedModelsOf(key);
    // A list Orbit couldn't load changes nothing: the bot is put on the key as it always was
    if (!models || models.length <= 1) return { model: preselectedModel(key), needsPick: false };
    const model = preselectedModel(key);
    return { model, needsPick: model === null };
}

export type ModelRow =
    /** The lend allows one model: shown, nothing to change. */
    | { kind: "single"; model: KeyModelOption }
    /** Several models: the one the bot is on (null: none of them yet) and Change. */
    | { kind: "choose"; model: KeyModelOption | null; models: KeyModelOption[] }
    /** Orbit could not list the key's models: the model it runs on, nothing to change. */
    | { kind: "unlisted"; model: string | null };

/**
 * The Model row under Runs on, for the key the bot is on. Null when the bot is not on one of the person's own keys.
 * `botModel` is the bot's own model: what it was last saved with, or what the person has picked on this page.
 */
export function modelRow(
    options: BotAiOptions,
    ref: string | null | undefined,
    botModel: string | null | undefined
): ModelRow | null {
    const key = keyOfRef(options, ref);
    if (!key) return null;
    const models = allowedModelsOf(key);
    if (!models) return { kind: "unlisted", model: botModel ?? key.model ?? null };
    if (models.length === 0) return null;
    if (models.length === 1) return { kind: "single", model: models[0] };
    // What it replies with: its own pick, else the key's check model, each only while the lend allows it
    const named = [botModel, key.model].find((id) => !!id && models.some((model) => model.id === id)) ?? null;
    return { kind: "choose", model: models.find((model) => model.id === named) ?? null, models };
}

/** What the page remembers of the model the bot is saved with, for the bot's own pick before the person changes it. */
export function botModelOf(
    options: BotAiOptions,
    bot: { aiProviderRef?: string | null; aiModel?: string | null }
): string | null {
    // The page's own pick (null: put on a key with nothing picked) wins over what Orbit said when the page opened
    if (bot.aiModel !== undefined) return bot.aiModel;
    const ref = bot.aiProviderRef ?? options.current;
    return ref && ref === options.current ? options.currentModel ?? null : null;
}

// ─── The list ────────────────────────────────────────────────────────────────

/** The maker in a model id like "openai/gpt-5", or null for an id with no maker (Claude's own list is flat). */
export function makerOf(id: string): string | null {
    const slash = id.indexOf("/");
    return slash > 0 ? id.slice(0, slash) : null;
}

/** The model's name without its maker: "deepseek/deepseek-v4-flash" is "deepseek-v4-flash". */
export function shortName(id: string): string {
    const slash = id.indexOf("/");
    return slash > 0 ? id.slice(slash + 1) : id;
}

const MAKER_NAMES: Readonly<Record<string, string>> = {
    openai: "OpenAI",
    qwen: "Qwen",
    google: "Google",
    mistralai: "Mistral",
    anthropic: "Anthropic",
    "meta-llama": "Meta",
    deepseek: "DeepSeek",
    "x-ai": "xAI",
};

export function makerName(maker: string): string {
    return MAKER_NAMES[maker] ?? maker.charAt(0).toUpperCase() + maker.slice(1);
}

export interface MakerGroup {
    id: string;
    name: string;
    models: KeyModelOption[];
}

/** Models with no maker, flat, then the makers: the biggest first, ties by name. */
export function groupModels(models: readonly KeyModelOption[]): { flat: KeyModelOption[]; makers: MakerGroup[] } {
    const flat: KeyModelOption[] = [];
    const byMaker = new Map<string, KeyModelOption[]>();
    for (const model of models) {
        const maker = makerOf(model.id);
        if (!maker) {
            flat.push(model);
        } else {
            const list = byMaker.get(maker);
            if (list) list.push(model);
            else byMaker.set(maker, [model]);
        }
    }
    const makers = [...byMaker].map(([id, list]) => ({ id, name: makerName(id), models: list }));
    makers.sort((a, b) => b.models.length - a.models.length || a.name.localeCompare(b.name));
    return { flat, makers };
}

export interface ModelFilter {
    query: string;
    tools: boolean;
    vision: boolean;
}

export const NO_FILTER: ModelFilter = { query: "", tools: false, vision: false };

export const isFiltering = (filter: ModelFilter): boolean =>
    filter.query.trim() !== "" || filter.tools || filter.vision;

/** The models a search and the Tools / Vision filters keep: the words match a model's id or its maker's name. */
export function filterModels(models: readonly KeyModelOption[], filter: ModelFilter): KeyModelOption[] {
    const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((model) => {
        if (filter.tools && model.tools !== true) return false;
        if (filter.vision && model.vision !== true) return false;
        const maker = makerOf(model.id);
        const text = `${model.id} ${maker ? makerName(maker) : ""}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
}

/**
 * The makers to show: all of them when asked or when the person is searching, else the biggest few, and any maker that is
 * opened or holds the pick (so the pick is never hidden behind "Show all").
 */
export function visibleMakers(
    makers: readonly MakerGroup[],
    options: { showAll: boolean; filtering: boolean; keep: ReadonlySet<string> }
): MakerGroup[] {
    if (options.showAll || options.filtering) return [...makers];
    return makers.filter((maker, index) => index < MAKERS_FIRST || options.keep.has(maker.id));
}

/** The maker holding this model, to open its row first. */
export function makerHolding(id: string | null | undefined): string | null {
    return id ? makerOf(id) : null;
}

// ─── Saving ──────────────────────────────────────────────────────────────────

/**
 * What a save of the bot's mind sends for its model. Orbit puts a bot back on its key's check model whenever its key
 * changes, so a model is sent only when the bot has one picked that it isn't saved with on this key. Nothing is sent
 * for a model that hasn't changed, and none for a bot on Universe AI. `base` is the model the bot is saved with once its
 * key is saved, before any model is sent.
 */
export function aiModelPlan(
    next: { ref?: string | null; model?: string | null },
    saved: { ref?: string | null; model?: string | null }
): { send: string | null; base: string | null } {
    const moved = (next.ref ?? null) !== (saved.ref ?? null);
    const base = moved ? null : saved.model ?? null;
    const model = next.model ?? null;
    return { send: model && model !== base ? model : null, base };
}
