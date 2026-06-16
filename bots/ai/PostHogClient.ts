/**
 * PostHog LLM Analytics client wrapper
 * Captures $ai_trace, $ai_generation events alongside existing Sentry spans.
 * Both Sentry and PostHog run independently without conflict.
 * 
 * Only activates when POSTHOG_API_KEY env var is set — silent no-op otherwise.
 * Uses fire-and-forget pattern with try/catch isolation — never throws.
 * 
 * Sends events via direct POST to the /batch/ endpoint instead of the SDK's
 * capture() method. The posthog-node SDK v4.x silently truncates or drops
 * large string properties (prompts, responses), which breaks LLM observability.
 * Direct POST preserves the full input/output content.
 */

import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = (process.env.POSTHOG_HOST || process.env.POSTHOG_URL || 'https://eu.posthog.com').replace(/\/+$/, '');
const BATCH_URL = `${POSTHOG_HOST}/batch/`;

let client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
    if (!POSTHOG_API_KEY) return null;
    if (!client) {
        client = new PostHog(POSTHOG_API_KEY, {
            host: POSTHOG_HOST,
            flushAt: 1,
            // Custom fetch only used for SDK-internal calls (feature flags, etc.)
            // Our actual event capture uses direct POST below
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

async function sendBatch(events: Record<string, any>[]): Promise<void> {
    if (!POSTHOG_API_KEY || events.length === 0) return;

    try {
        const response = await fetch(BATCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: POSTHOG_API_KEY,
                batch: events,
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            console.error(`[PostHog] Batch send failed (${response.status}): ${text.substring(0, 200)}`);
        }
    } catch (e: any) {
        console.error('[PostHog] Batch send error:', e.message);
    }
}

/**
 * Queue a batch of events and flush immediately.
 * Groups $ai_trace + $ai_generation into one batch for efficiency.
 */
export function captureGeneration(params: CapturedGeneration): void {
    if (!POSTHOG_API_KEY) return;

    const timestamp = new Date();
    const distinctId = params.distinctId;

    // Common properties shared across both event types
    const commonProps: Record<string, any> = {
        $ai_session_id: params.sessionId,
        $ai_trace_id: params.traceId,
        $ai_model: params.model,
        $ai_provider: params.provider,
        $ai_input: params.input,
        $ai_input_tokens: params.inputTokens,
        $ai_output_tokens: params.outputTokens,
        $ai_latency: params.latency,
        $ai_cost: params.cost,
        bot_id: params.botId,
        player_id: params.playerId,
        space: params.space,
    };

    const events: Record<string, any>[] = [];

    // $ai_trace (top-level conversation turn)
    events.push({
        event: '$ai_trace',
        distinctId,
        properties: {
            ...commonProps,
            $ai_output: params.output,
        },
        timestamp: timestamp.toISOString(),
    });

    // $ai_generation (per-LLM-call — powers PostHog's LLM dashboards)
    events.push({
        event: '$ai_generation',
        distinctId,
        properties: {
            ...commonProps,
            $ai_output_choices: [{ role: 'assistant', content: params.output }],
        },
        timestamp: timestamp.toISOString(),
    });

    // Fire and forget — send batch immediately
    sendBatch(events);
}

/**
 * Flush is a no-op since we send immediately via direct POST.
 * Kept for API compatibility with existing callers.
 */
export async function flushPostHog(): Promise<void> {
    // No-op — events are sent immediately via sendBatch()
    // The SDK client may still have pending feature flag calls,
    // but those are low-priority and don't need explicit flushing.
}
