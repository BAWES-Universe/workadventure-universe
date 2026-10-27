/**
 * A bot's longest reply is set in Orbit (#666) and can be more than a model allows: 32,000 tokens to a model that writes
 * at most 16,384. Providers turn that down with a 400 that names the most it takes. This reads that number, so the call
 * is sent again once with it instead of failing the reply, and remembers it for the model so later calls fit at once.
 */

/** "at most 16384", "[1, 8192]", "> 64000, which is the maximum", "less than or equal to `8192`". */
const FIXED_CEILING = [
    /supports at most (\d+) (?:completion|output) tokens/i,
    /range of max_(?:completion_)?tokens is \[\s*\d+\s*,\s*(\d+)\s*\]/i,
    />\s*(\d+),\s*which is the maximum allowed number of output tokens/i,
    /max_(?:completion_)?tokens`?\s+must be less than or equal to\s+`?(\d+)/i,
    /maximum (?:value for|allowed) `?max_(?:completion_)?tokens`? is `?(\d+)/i,
    /max(?:imum)? output tokens? (?:is|of) (\d+)/i,
];

/** "maximum context length is 8192 tokens ... (500 in the messages, 32000 in the completion)": what is left after the prompt. */
const CONTEXT_CEILING = /maximum context length is (\d+) tokens[\s\S]*?\((\d+) (?:in the messages|of text input)/i;

/** Room left between the prompt and the context, so a count that is a little off still fits. */
const CONTEXT_MARGIN = 64;

export interface TokenCeiling {
    /** The most the model takes for one reply. */
    tokens: number;
    /** True when it is the model's own limit (kept for the model); false when it depends on this prompt's length. */
    fixed: boolean;
}

/** The most a model takes for one reply, read from a 400 that turned down the asked number; null when it is not that. */
export function statedTokenCeiling(status: number, errorText: string, asked: number): TokenCeiling | null {
    if (status !== 400 || !errorText) return null;
    for (const pattern of FIXED_CEILING) {
        const match = pattern.exec(errorText);
        const tokens = match ? Number(match[1]) : NaN;
        if (Number.isInteger(tokens) && tokens > 0 && tokens < asked) return { tokens, fixed: true };
    }
    const context = CONTEXT_CEILING.exec(errorText);
    if (context) {
        const tokens = Number(context[1]) - Number(context[2]) - CONTEXT_MARGIN;
        if (Number.isInteger(tokens) && tokens > 0 && tokens < asked) return { tokens, fixed: false };
    }
    return null;
}

/** The ceilings providers named, per address and model, so later calls ask for no more than the model takes. */
const knownCeilings = new Map<string, number>();
const ceilingKey = (endpoint: string | undefined, model: string | undefined) => `${endpoint ?? ''}|${model ?? ''}`;

export function rememberTokenCeiling(endpoint: string | undefined, model: string | undefined, tokens: number): void {
    knownCeilings.set(ceilingKey(endpoint, model), tokens);
}

/** The longest reply to ask this model for: the bot's limit, or less when the provider said the model takes less. */
export function fittedMaxTokens(endpoint: string | undefined, model: string | undefined, maxTokens: number): number {
    const ceiling = knownCeilings.get(ceilingKey(endpoint, model));
    return ceiling !== undefined && ceiling < maxTokens ? ceiling : maxTokens;
}

/** For tests. */
export function forgetTokenCeilings(): void {
    knownCeilings.clear();
}
