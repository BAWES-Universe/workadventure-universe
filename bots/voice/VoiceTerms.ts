// The names a bubble's hearing provider is asked to expect (#1864): this bot's own name, then the names of the other voice
// bots in the bubble. People call a bot by its name, and a hearing that was never told it writes "Nora" said in Arabic as
// "نورا", which the name check does not match, so the bot ignores the person. Names only, never anything a person said.

/** The most names sent, and the longest one. The worker's schema has the same limits. */
export const MAX_HEARING_TERMS = 16;
export const MAX_HEARING_TERM_CHARS = 64;

/** The names to send: this bot's first (so it is the last one dropped), the others in a fixed order, tidied, none twice. */
export function hearingTerms(own: string, others: readonly string[]): string[] {
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const raw of [own, ...[...others].sort()]) {
        const term = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_HEARING_TERM_CHARS).trim() : '';
        if (!term || seen.has(term)) continue;
        seen.add(term);
        terms.push(term);
        if (terms.length >= MAX_HEARING_TERMS) break;
    }
    return terms;
}
