// The names a hearing provider is asked to expect (#1864): the bot's own name and the names of the other voice bots in the
// bubble. People call a bot by its name, so a hearing that writes "Nora" as "نورا" (or "Noura") makes the bot ignore them.
// Both providers take names to favour and how to spell them (Soniox `context.terms`, Deepgram Nova-3 `keyterm`). Names
// only, never anything a person said.

/** The most names one bubble sends, and the longest one. The schema has the same limits. */
export const MAX_TERMS = 16;
export const MAX_TERM_CHARS = 64;

/** Trimmed, one space between words, no empty or repeated names, within the limits. The bot's own name comes first, so it is the last one dropped. */
export function cleanTerms(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const item of raw) {
        if (typeof item !== 'string') continue;
        const term = item.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS).trim();
        if (!term || seen.has(term)) continue;
        seen.add(term);
        terms.push(term);
        if (terms.length >= MAX_TERMS) break;
    }
    return terms;
}

/** The names that fit in `maxChars` in all, in order: a provider with a budget (Deepgram's 500 tokens) is never sent more than it takes. */
export function termsWithin(terms: readonly string[], maxChars: number): string[] {
    const kept: string[] = [];
    let used = 0;
    for (const term of terms) {
        if (used + term.length > maxChars) break;
        used += term.length;
        kept.push(term);
    }
    return kept;
}
