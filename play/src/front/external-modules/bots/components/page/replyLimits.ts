/**
 * The bot page's "Longest reply" and "Steps in one reply" (Orbit #666). A bot follows the limits of what it runs on (a
 * person's key, or Universe AI) unless its editors pick a lower one, so the chips offer only values under that limit.
 * A saved value that is none of the chips gets a chip of its own, so the page never hides what the bot is set to.
 */
import type { BotAiOptions, BotLimitCeiling } from "../../types";
import { botModelOf, keyOfRef, modelRow } from "../../modelPickerModel";

/** Lower longest replies a bot can pick, in tokens. */
export const REPLY_CHOICES = [16000, 8000, 4000];
/** Lower step counts a bot can pick. */
export const STEP_CHOICES = [20, 10];

/**
 * The limits of what the bot runs on: one of the viewer's keys, someone else's key it is on now, or Universe AI (which
 * also covers a provider pinned by a super admin). Null until Orbit has said, or from an older Orbit.
 */
export function ceilingFor(options: BotAiOptions | null, ref: string | undefined): BotLimitCeiling | null {
    if (!options) return null;
    const key = ref ? options.keys.find((choice) => choice.id === ref) : undefined;
    if (key) return key.limits ?? null;
    if (ref && options.currentKey?.id === ref) return options.currentKey.limits ?? null;
    return options.universeAi.limits ?? null;
}

/** "32k", "12.5k", or the number itself under a thousand. */
export function tokensLabel(tokens: number): string {
    return tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : String(tokens);
}

/**
 * The chips for one limit and which one is picked. 0 is "Key's limit" (saved as null), named with the key's value once
 * known (`words` are the page's own, so they follow its language). A saved value at or above the key's limit is never used, so "Key's limit" shows as picked for it.
 */
export function limitChips(
    ceiling: number | null,
    choices: number[],
    saved: number | null | undefined,
    label: (value: number) => string,
    words: { keysLimit: () => string; keysLimitIs: (values: { limit: string }) => string }
): { options: Array<{ value: number; label: string }>; value: number } {
    const value = saved && (ceiling === null || saved < ceiling) ? saved : 0;
    const lower = choices.filter((choice) => ceiling === null || choice < ceiling);
    const values = value && !lower.includes(value) ? [...lower, value].sort((a, b) => b - a) : lower;
    return {
        value,
        options: [
            { value: 0, label: ceiling === null ? words.keysLimit() : words.keysLimitIs({ limit: label(ceiling) }) },
            ...values.map((choice) => ({ value: choice, label: label(choice) })),
        ],
    };
}

/** A chip this close under the model's own limit says nothing new ("16k" next to "16.4k"), so it is left out. */
const CLEARLY_LOWER = 0.9;

/**
 * The model the bot replies with and the longest reply it can write (Orbit #673), when its provider says: on one of the
 * person's own keys, the model picked on this page; on someone else's key, the one Orbit says it is on. Null on Universe
 * AI, and for a model whose provider does not say.
 */
export function modelCapFor(
    options: BotAiOptions | null,
    bot: { aiProviderRef?: string | null; aiModel?: string | null }
): { model: string; tokens: number } | null {
    if (!options) return null;
    const ref = bot.aiProviderRef ?? options.current;
    const key = keyOfRef(options, ref);
    if (key) {
        const row = modelRow(options, ref, botModelOf(options, bot));
        if (!row) return null;
        if (row.kind === "unlisted") {
            return row.model && row.model === key.model && key.output ? { model: row.model, tokens: key.output } : null;
        }
        return row.model?.output ? { model: row.model.id, tokens: row.model.output } : null;
    }
    const current = options.currentKey;
    return current && current.id === ref && current.model && current.output
        ? { model: current.model, tokens: current.output }
        : null;
}

/** The lower longest replies to offer under a model that stops at `tokens`: only the clearly lower ones. */
export function choicesUnder(tokens: number): number[] {
    return REPLY_CHOICES.filter((choice) => choice <= tokens * CLEARLY_LOWER);
}
