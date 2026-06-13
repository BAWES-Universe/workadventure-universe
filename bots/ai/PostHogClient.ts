/**
 * PostHog LLM Analytics client wrapper
 * Captures $ai_trace, $ai_generation events alongside existing Sentry spans.
 * Both Sentry and PostHog run independently without conflict.
 * 
 * Only activates when POSTHOG_API_KEY env var is set — silent no-op otherwise.
 * Uses fire-and-forget pattern with try/catch isolation — never throws.
 * Flush uses pg.flush() (not shutdown) to avoid destroying the singleton.
 */

import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
// Support both POSTHOG_HOST and POSTHOG_URL for backward compatibility
const POSTHOG_HOST = process.env.POSTHOG_HOST || process.env.POSTHOG_URL || 'https://eu.posthog.com';

let client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
    if (!POSTHOG_API_KEY) return null;
    if (!client) {
        client = new PostHog(POSTHOG_API_KEY, {
            host: POSTHOG_HOST,
        });
    }
    return client;
}

export interface CapturedGeneration {
    distinctId: string;
    traceId: string;
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

export function captureGeneration(params: CapturedGeneration): void {
    try {
        const pg = getPostHogClient();
        if (!pg) return;

        const timestamp = new Date();

        // Capture $ai_trace (top-level conversation turn)
        try {
            pg.capture({
                distinctId: params.distinctId,
                event: '$ai_trace',
                properties: {
                    $ai_trace_id: params.traceId,
                    $ai_input: params.input,
                    $ai_output: params.output,
                    $ai_model: params.model,
                    $ai_provider: params.provider,
                    $ai_input_tokens: params.inputTokens,
                    $ai_output_tokens: params.outputTokens,
                    $ai_latency: params.latency,
                    $ai_cost: params.cost,
                    bot_id: params.botId,
                    player_id: params.playerId,
                    space: params.space,
                },
                timestamp,
            });
        } catch (e) {
            console.error('[PostHog] Failed to capture $ai_trace:', e);
        }

        // Capture $ai_generation (per-LLM-call)
        try {
            pg.capture({
                distinctId: params.distinctId,
                event: '$ai_generation',
                properties: {
                    $ai_trace_id: params.traceId,
                    $ai_model: params.model,
                    $ai_input: params.input,
                    $ai_output_choices: [{role: 'assistant', content: params.output}],
                    $ai_input_tokens: params.inputTokens,
                    $ai_output_tokens: params.outputTokens,
                    $ai_latency: params.latency,
                    $ai_cost: params.cost,
                    $ai_provider: params.provider,
                    bot_id: params.botId,
                    player_id: params.playerId,
                },
                timestamp,
            });
        } catch (e) {
            console.error('[PostHog] Failed to capture $ai_generation:', e);
        }
    } catch (e) {
        // Outer catch — never let PostHog failures impact the request path
        console.error('[PostHog] captureGeneration failed:', e);
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
