/**
 * PostHog LLM Analytics client wrapper
 * Captures $ai_trace, $ai_generation events alongside existing Sentry spans.
 * Both Sentry and PostHog run independently without conflict.
 * 
 * Only activates when POSTHOG_API_KEY env var is set — silent no-op otherwise.
 * Uses fire-and-forget pattern with try/catch isolation — never throws.
 * Uses posthog-node SDK for capture (v4.18.0).
 * Flush uses pg.flush() (not shutdown) to avoid destroying the singleton.
 * 
 * PostHog LLM Observability data model:
 *   $ai_session_id    — Stable across all turns in one conversation (bot-player pair)
 *   $ai_trace_id      — Unique per-turn (identifies one response cycle)
 *   $ai_trace         — Root event per turn (input + output state)
 *   $ai_generation    — Per-LLM-call event (model, tokens, cost, output choices)
 */

import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
// Support both POSTHOG_HOST and POSTHOG_URL for backward compatibility
const POSTHOG_HOST = (process.env.POSTHOG_HOST || process.env.POSTHOG_URL || 'https://eu.posthog.com').replace(/\/+$/, '');

let client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
    if (!POSTHOG_API_KEY) return null;
    if (!client) {
        client = new PostHog(POSTHOG_API_KEY, {
            host: POSTHOG_HOST,
            flushAt: 1,
        });
    }
    return client;
}

export interface CapturedGeneration {
    distinctId: string;
    /** Unique per-turn trace ID (e.g. Sentry span ID or UUID) */
    traceId: string;
    /** Stable across all turns in the same conversation */
    sessionId: string;
    model: string;
    provider: string;
    input: string;
    output: string;
    inputTokens: number;
    outputTokens: number;
    latency?: number;
    cost?: number;
    botId?: string;
    playerId?: string;
    space?: string;
}

/**
 * Capture a per-LLM-call $ai_generation event.
 * Emit one call per generateStream() invocation so PostHog's trace view
 * correctly reflects multi-call tool flows (initial call + tool follow-up).
 */
export function captureAiGeneration(params: CapturedGeneration): void {
    try {
        const pg = getPostHogClient();
        if (!pg) return;

        const timestamp = new Date();

        pg.capture({
            distinctId: params.distinctId,
            event: '$ai_generation',
            properties: {
                $ai_session_id: params.sessionId,
                $ai_trace_id: params.traceId,
                $ai_model: params.model,
                $ai_provider: params.provider,
                $ai_input: [{role: 'user', content: params.input}],
                $ai_input_tokens: params.inputTokens,
                $ai_output_tokens: params.outputTokens,
                $ai_latency: params.latency,
                $ai_cost: params.cost,
                $ai_output_choices: [{role: 'assistant', content: params.output}],
                bot_id: params.botId,
                player_id: params.playerId,
                space: params.space,
            },
            timestamp,
        });
    } catch (e) {
        console.error('[PostHog] Failed to capture $ai_generation:', e);
    }
}

/**
 * Capture a turn-level $ai_trace event.
 * Fires once in the finally block — aggregates the full turn including
 * any tool call rounds into one trace event per turn.
 */
export function captureAiTrace(params: CapturedGeneration): void {
    try {
        const pg = getPostHogClient();
        if (!pg) return;

        const timestamp = new Date();

        pg.capture({
            distinctId: params.distinctId,
            event: '$ai_trace',
            properties: {
                $ai_session_id: params.sessionId,
                $ai_trace_id: params.traceId,
                $ai_model: params.model,
                $ai_provider: params.provider,
                $ai_input: [{role: 'user', content: params.input}],
                $ai_input_tokens: params.inputTokens,
                $ai_output_tokens: params.outputTokens,
                $ai_latency: params.latency,
                $ai_cost: params.cost,
                $ai_output: params.output,
                bot_id: params.botId,
                player_id: params.playerId,
                space: params.space,
            },
            timestamp,
        });
    } catch (e) {
        console.error('[PostHog] Failed to capture $ai_trace:', e);
    }
}

/**
 * Flush pending PostHog events without destroying the singleton client.
 * Safe to call per-request — pg.flush() sends queued events asynchronously.
 * Use try/catch for error isolation — never throws.
 */
export async function flushPostHog(): Promise<void> {
    try {
        if (client) {
            await client.flush();
        }
    } catch (e) {
        console.error('[PostHog] Flush failed:', e);
    }
}
