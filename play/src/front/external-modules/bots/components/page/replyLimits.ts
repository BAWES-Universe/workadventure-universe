/**
 * The bot page's "Longest reply" and "Steps in one reply" (Orbit #666). A bot follows the limits of what it runs on (a
 * person's key, or Universe AI) unless its editors pick a lower one, so the chips offer only values under that limit.
 * A saved value that is none of the chips gets a chip of its own, so the page never hides what the bot is set to.
 */
import type { BotAiOptions, BotLimitCeiling } from "../../types";

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
 * known. A saved value at or above the key's limit is never used, so "Key's limit" shows as picked for it.
 */
export function limitChips(
    ceiling: number | null,
    choices: number[],
    saved: number | null | undefined,
    label: (value: number) => string,
    keysLimit: (limit: string | null) => string
): { options: Array<{ value: number; label: string }>; value: number } {
    const value = saved && (ceiling === null || saved < ceiling) ? saved : 0;
    const lower = choices.filter((choice) => ceiling === null || choice < ceiling);
    const values = value && !lower.includes(value) ? [...lower, value].sort((a, b) => b - a) : lower;
    return {
        value,
        options: [
            { value: 0, label: keysLimit(ceiling === null ? null : label(ceiling)) },
            ...values.map((choice) => ({ value: choice, label: label(choice) })),
        ],
    };
}
