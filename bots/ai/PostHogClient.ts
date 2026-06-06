/**
 * PostHog LLM Analytics client wrapper
 * Captures $ai_trace, $ai_generation events alongside existing Sentry spans.
 * Both Sentry and PostHog run independently without conflict.
 * 
 * Only activates when POSTHOG_API_KEY env var is set — silent no-op otherwise.
 */

import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://eu.posthog.com';

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
    cost?: number;
    botId?: string;
    playerId?: string;
    space?: string;
}

export function captureGeneration(params: CapturedGeneration): void {
    const pg = getPostHogClient();
    if (!pg) return;

    const timestamp = new Date();

    // Capture $ai_trace (top-level conversation turn)
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
            $ai_cost: params.cost,
            bot_id: params.botId,
            player_id: params.playerId,
            space: params.space,
        },
        timestamp,
    });

    // Capture $ai_generation (per-LLM-call)
    pg.capture({
        distinctId: params.distinctId,
        event: '$ai_generation',
        properties: {
            $ai_trace_id: params.traceId,
            $ai_model: params.model,
            $ai_input: params.input,
            $ai_output: params.output,
            $ai_input_tokens: params.inputTokens,
            $ai_output_tokens: params.outputTokens,
            $ai_cost: params.cost,
            $ai_provider: params.provider,
            bot_id: params.botId,
            player_id: params.playerId,
        },
        timestamp,
    });
}

export async function flushPostHog(): Promise<void> {
    if (client) {
        await client.shutdown();
        client = null;
    }
}
