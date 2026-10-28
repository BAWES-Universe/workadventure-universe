/**
 * Why a reply left the person with nothing (#1498). Without this, a reply that failed or came back empty showed
 * "Couldn't answer" in a direct message and left no line in the logs, no error on the Sentry span and no PostHog event.
 */

export interface ReplyFacts {
    /** A call to the provider failed. */
    error: boolean;
    errorStatus?: number;
    /** What the provider said, already short and without logins (providerErrorText). */
    errorText?: string;
    /** Why the provider ended the call, when it said. */
    finishReason?: string;
    /** The reply has words, or the model called a tool. */
    answered: boolean;
    outputTokens: number;
    /** Thinking tokens inside outputTokens. */
    reasoningTokens: number;
    /** The longest reply the bot was allowed. */
    maxTokens?: number;
}

/** The reasons a provider gives for ending a call; anything else is not copied into a log, since it comes from outside. */
const KNOWN_FINISH_REASONS = new Set([
    'stop', 'length', 'tool_calls', 'function_call', 'content_filter', 'end_turn', 'max_tokens', 'tool_use',
    'stop_sequence', 'pause_turn', 'refusal', 'safety', 'recitation', 'other', 'error',
]);

/** One plain line saying why the reply has nothing in it, or undefined when it has an answer. Never the conversation. */
export function replyProblem(facts: ReplyFacts): string | undefined {
    if (facts.error) {
        const status = facts.errorStatus ? ` (${facts.errorStatus})` : '';
        return `the provider failed${status}: ${facts.errorText ?? 'the answer stopped before it finished'}`;
    }
    if (facts.answered) return undefined;
    const limit = facts.maxTokens ? ` of ${facts.maxTokens} allowed` : '';
    // All of it went on thinking and it hit the longest reply: the limit is too low for this model
    const reason = facts.finishReason?.toLowerCase();
    const known = reason && KNOWN_FINISH_REASONS.has(reason) ? reason : undefined;
    const why = reason === 'length' ? 'it reached the longest reply' : `it stopped (${facts.finishReason === undefined ? 'no reason given' : known ?? 'an unrecognised reason'})`;
    return `no words and no tool call: ${why}, ${facts.outputTokens} tokens used${limit}, ${facts.reasoningTokens} on thinking`;
}
