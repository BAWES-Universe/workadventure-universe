/**
 * OpenAI Provider Implementation
 * 
 * OpenAI uses standard API format
 * Endpoint: https://api.openai.com/v1/chat/completions (default)
 * Supports custom endpoints (e.g., Azure OpenAI, proxies)
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse, AIUsageDetail } from '../types';
import { decryptApiKey } from '../encryption';
import { fetchFor, statusFromError } from './ownKeyHttp';
import { linkExternalAbort } from './abortUtils';
import { resolveVisionSupport } from './visionModels';
import * as Sentry from '@sentry/node';
import { saysTooLong, stepMessages, type ReplySteps } from '../replySteps';

/**
 * True only for OpenAI's own API. The prompt-cache hints below are OpenAI
 * request fields; DeepSeek and other compatible endpoints must keep getting
 * exactly the request they get today.
 */
export function isOpenAIHost(endpoint: string | undefined): boolean {
    try {
        return new URL(endpoint || 'https://api.openai.com/v1').hostname === 'api.openai.com';
    } catch {
        return false;
    }
}

/**
 * Prompt tokens the provider served from its cache, or undefined when the
 * response carries no cache figure. DeepSeek reports prompt_cache_hit_tokens;
 * OpenAI and compatible endpoints report prompt_tokens_details.cached_tokens.
 * Both are a subset of prompt_tokens.
 */
export function readCachedPromptTokens(usage: any): number | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const deepseek = usage.prompt_cache_hit_tokens;
    if (typeof deepseek === 'number') return deepseek;
    const openai = usage.prompt_tokens_details?.cached_tokens;
    if (typeof openai === 'number') return openai;
    return undefined;
}

/**
 * Everything a response's `usage` says beyond the two totals (#1173): cached input (DeepSeek and OpenAI), tokens written
 * to the cache (OpenRouter), reasoning tokens inside the completion, and the cost the provider charged (OpenRouter).
 * A figure the provider did not send is left out, so "no cache figure" stays different from "nothing was cached".
 */
export function readUsageDetail(usage: any): AIUsageDetail {
    if (!usage || typeof usage !== 'object') return {};
    const detail: AIUsageDetail = {};
    const cached = readCachedPromptTokens(usage);
    if (cached !== undefined) detail.cachedPromptTokens = cached;
    const written = usage.prompt_tokens_details?.cache_write_tokens;
    if (typeof written === 'number') detail.cacheWriteTokens = written;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens;
    if (typeof reasoning === 'number') detail.reasoningTokens = reasoning;
    if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) detail.costUsd = usage.cost;
    return detail;
}

/** Does this error say the provider refused `stream_options` (the request asking a stream to report usage)? */
export function refusesStreamOptions(status: number, errorText: string): boolean {
    return (status === 400 || status === 422) && /stream_options|include_usage/i.test(errorText);
}

/** Orbit's smallest longest reply: a stated maximum below it is a number about something else. */
const SMALLEST_OUTPUT_CEILING = 256;

/** The words of an error answer (message, code, type), so numbers elsewhere in the JSON are never read as a cap. */
function errorWords(errorText: string): string {
    try {
        const data = JSON.parse(errorText);
        const error = data && typeof data.error === 'object' && data.error !== null ? data.error : data;
        const parts = [error?.message, data?.message, data?.detail, data?.error].filter((part): part is string => typeof part === 'string');
        if (parts.length > 0) return parts.join('\n');
    } catch {
        // Not JSON: the plain text is what it said
    }
    return errorText;
}

/**
 * How each provider words the most output tokens a model allows, the number being the first group:
 * - OpenAI: "This model supports at most 16384 completion tokens, whereas you provided 32000."
 * - Anthropic: "max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for ..."
 * - DeepSeek: "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]"
 * - Groq and others: "`max_tokens` must be less than or equal to `8192`", "max_tokens must be at most 4096"
 */
const MODEL_CAP_WORDING = [
    /supports at most (\d+) (?:completion|output) tokens/i,
    /max_(?:completion_)?tokens:\s*\d+\s*>\s*(\d+)/i,
    /valid range of `?max_(?:completion_)?tokens`? is \[\d+,\s*(\d+)\]/i,
    /`?max_(?:completion_)?tokens`? must be (?:less than or equal to|at most|<=) `?(\d+)/i,
];

/** vLLM and others: "maximum context length is 131072 tokens. However, you requested 140000 tokens (108000 in the messages, 32000 in the completion)". */
const CONTEXT_WORDING = /maximum context length is (\d+) tokens[\s\S]*?\((\d+) in the messages/i;

/**
 * The most output tokens a model allows, read from the error it gave for being asked more (Orbit #666 recommends 32,000
 * by default, above what some older models take). `lasting` is false when it is only what this request's messages left
 * of the context: it fits this request, not the model. Undefined when the error is about something else.
 */
export function statedOutputCeiling(status: number, errorText: string, asked: number | undefined): { tokens: number; lasting: boolean } | undefined {
    if ((status !== 400 && status !== 422) || !asked) return undefined;
    const words = errorWords(errorText);
    const fits = (tokens: number) => tokens >= SMALLEST_OUTPUT_CEILING && tokens < asked;
    for (const wording of MODEL_CAP_WORDING) {
        const match = wording.exec(words);
        if (match && fits(Number(match[1]))) return { tokens: Number(match[1]), lasting: true };
    }
    const context = CONTEXT_WORDING.exec(words);
    const left = context ? Number(context[1]) - Number(context[2]) : 0;
    return context && fits(left) ? { tokens: left, lasting: false } : undefined;
}

export class OpenAIProvider implements AIProvider {
    /** Endpoints that refused `stream_options` once. They are not asked again, so a provider that does not know it costs one failed request, not one per reply. */
    private static readonly refusedStreamOptions = new Set<string>();

    /** The output cap each model stated once it refused more (endpoint and model). It is asked within it from then on, so it costs one failed request, not one per reply. */
    private static readonly outputCeilings = new Map<string, number>();

    private static outputCeilingKey(config: AIProviderConfig, endpoint: string): string {
        return `${endpoint} ${config.model}`;
    }

    /** The body asked again within the cap the model stated, and the cap kept for its next requests when it is the model's own. */
    private withinOutputCeiling(requestBody: Record<string, any>, config: AIProviderConfig, endpoint: string, ceiling: { tokens: number; lasting: boolean }): Record<string, any> {
        if (ceiling.lasting) OpenAIProvider.outputCeilings.set(OpenAIProvider.outputCeilingKey(config, endpoint), ceiling.tokens);
        const retryBody = { ...requestBody };
        if (retryBody.max_completion_tokens !== undefined) retryBody.max_completion_tokens = ceiling.tokens;
        else retryBody.max_tokens = ceiling.tokens;
        return retryBody;
    }

    private readonly DEFAULT_ENDPOINT = 'https://api.openai.com/v1';
    private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

    getName(): string {
        return 'OpenAI';
    }

    isReady(): boolean {
        return true; // Always ready (cloud provider)
    }

    supportsStreaming(): boolean {
        return true;
    }

    /**
     * Whether the model config supports vision (image_url content blocks).
     * Tri-state: null/undefined = auto (model-name regex), true = force vision,
     * false = force text-only. The override comes from the provider config
     * (BotsAiProvider.supportsVision) served by the admin API.
     */
    supportsVision(config: AIProviderConfig): boolean {
        return resolveVisionSupport(config.model || '', config.supportsVision);
    }

    /**
     * Get API key from encrypted config
     */
    private getApiKey(config: AIProviderConfig): string {
        if (!config.apiKeyEncrypted) {
            throw new Error('OpenAI requires an API key');
        }

        try {
            const decrypted = decryptApiKey(config.apiKeyEncrypted);
            if (!decrypted) {
                throw new Error('Failed to decrypt API key');
            }
            return decrypted;
        } catch (error) {
            throw new Error(`Failed to decrypt OpenAI API key: ${error}`);
        }
    }

    /**
     * Get endpoint URL (defaults to OpenAI standard, allows override)
     */
    private getEndpoint(config: AIProviderConfig): string {
        const baseEndpoint = config.endpoint || this.DEFAULT_ENDPOINT;
        // Remove trailing slash if present
        const cleanEndpoint = baseEndpoint.replace(/\/$/, '');
        return `${cleanEndpoint}/chat/completions`;
    }

    /**
     * Check if model requires max_completion_tokens instead of max_tokens
     * Reasoning models (o1, o3) and newer models (gpt-5) use max_completion_tokens
     */
    private requiresMaxCompletionTokens(model: string): boolean {
        if (!model) return false;
        const modelLower = model.toLowerCase();
        // Handle various formats:
        // - Reasoning models: "o1", "o1-preview", "o1-mini", "o3", "o3-mini", etc.
        // - Newer models: "gpt-5", "gpt-5-mini", etc.
        return /^o[13]|gpt-5/.test(modelLower);
    }

    /**
     * Check if model only supports default temperature (1)
     * Some newer models (gpt-5, o1, o3) don't allow custom temperature values
     */
    private requiresDefaultTemperature(model: string): boolean {
        if (!model) return false;
        const modelLower = model.toLowerCase();
        // Models that only support temperature=1 (default)
        return /^o[13]|gpt-5/.test(modelLower);
    }

    /**
     * Build request body with correct token limit parameter
     */
    private buildRequestBody(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        stream: boolean,
        tools?: any[],
        images?: string[],
        steps?: ReplySteps
    ): Record<string, any> {
        const body: Record<string, any> = {
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
                // The reply's steps so far, with the reasoning a thinking model gave for each (it wants it back)
                ...stepMessages(steps, { reasoning: true }),
            ],
            stream,
        };

        // Vision: when the model supports image_url blocks and images are present,
        // send the user message as multipart content (text + image_url blocks).
        // Text-only models keep the plain string — the caller injects image URLs
        // into the message text instead.
        if (images && images.length > 0 && this.supportsVision(config)) {
            body.messages[1].content = [
                { type: 'text', text: userMessage },
                ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ];
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[OpenAIProvider] Sending ${images.length} image(s) as multipart content to vision-capable model ${config.model}`);
            }
        }

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }

        // OpenAI only (issue #1333): route this bot's requests to the same cache
        // (prompt_cache_key) and ask streams to report usage, which carries the
        // cached-token count. Not sent to DeepSeek or any other endpoint.
        if (isOpenAIHost(config.endpoint)) {
            const cacheKey = (config as any).__promptCacheKey;
            if (typeof cacheKey === 'string' && cacheKey) {
                body.prompt_cache_key = cacheKey;
            }
            if (stream) {
                body.stream_options = { include_usage: true };
            }
        }

        // Handle temperature: some models only support default (1)
        const requiresDefaultTemp = this.requiresDefaultTemperature(config.model);
        if (requiresDefaultTemp) {
            // Omit temperature parameter to use default (1)
            // Only include if explicitly set to 1 to avoid confusion
            if (config.temperature !== 1) {
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[OpenAIProvider] Model ${config.model} only supports temperature=1, omitting temperature parameter`);
                }
            }
        } else {
            // Include temperature for models that support custom values
            body.temperature = config.temperature;
        }

        // Use correct parameter based on model type, within the cap the model stated before
        if (config.maxTokens) {
            const ceiling = OpenAIProvider.outputCeilings.get(OpenAIProvider.outputCeilingKey(config, this.getEndpoint(config)));
            const maxTokens = ceiling ? Math.min(config.maxTokens, ceiling) : config.maxTokens;
            const requiresMaxCompletion = this.requiresMaxCompletionTokens(config.model);
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[OpenAIProvider] Model: ${config.model}, requiresMaxCompletionTokens: ${requiresMaxCompletion}`);
            }
            if (requiresMaxCompletion) {
                body.max_completion_tokens = maxTokens;
            } else {
                body.max_tokens = maxTokens;
            }
        }

        return body;
    }

    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        externalSignal?: AbortSignal,
        images?: string[],
        steps?: ReplySteps
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        let tokensUsed = 0;
        let promptTokens = 0;
        let reasoning = '';
        let usageDetail: AIUsageDetail = {};
        let completionTokens = 0;
        let responseModel = '';
        let streamEnded = false;
        let finishReason: string | undefined;
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const externalAbortCleanups: Array<() => void> = [];

        try {
            const endpoint = this.getEndpoint(config);
            const apiKey = this.getApiKey(config);

            const controller = new AbortController();
            externalAbortCleanups.push(linkExternalAbort(externalSignal, controller));
            let streamController = controller; // tracks the controller for the active stream (may be updated on retry)
            timeoutId = setTimeout(() => controller.abort(), timeout);

            const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, true, tools, images, steps);
            // Ask the stream to end with a usage chunk. Without it a provider may leave usage out of a stream, and the reply is
            // recorded with 0 tokens (#1173). A provider that refuses the field is retried without it below, and remembered.
            if (!OpenAIProvider.refusedStreamOptions.has(endpoint)) {
                requestBody.stream_options = { ...requestBody.stream_options, include_usage: true };
            }

            const response = await fetchFor(config)(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            let finalResponse = response;
            if (!response.ok) {
                const errorText = await response.text();
                let errorData: any = null;
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    // Not JSON, use as-is
                }

                const outputCeiling = statedOutputCeiling(response.status, errorText, requestBody.max_completion_tokens ?? requestBody.max_tokens);

                // Retry without temperature if model rejects it
                if (errorData?.error?.code === 'unsupported_value' && 
                    errorData?.error?.param === 'temperature' &&
                    errorData?.error?.message?.includes('Only the default')) {
                    const retryBody = { ...requestBody };
                    delete retryBody.temperature;

                    const retryController = new AbortController();
                    externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                    streamController = retryController; // update for active stream
                    timeoutId = setTimeout(() => retryController.abort(), timeout);
                    const retryResponse = await fetchFor(config)(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(retryBody),
                        signal: retryController.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!retryResponse.ok) {
                        const retryErrorText = await retryResponse.text();
                        throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                    }

                    finalResponse = retryResponse;
                }
                // Retry without stream_options if the provider does not know it
                else if (requestBody.stream_options && refusesStreamOptions(response.status, errorText)) {
                    OpenAIProvider.refusedStreamOptions.add(endpoint);
                    const retryBody = { ...requestBody };
                    delete retryBody.stream_options;

                    const retryController = new AbortController();
                    externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                    streamController = retryController; // update for active stream
                    timeoutId = setTimeout(() => retryController.abort(), timeout);
                    const retryResponse = await fetchFor(config)(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(retryBody),
                        signal: retryController.signal,
                    });

                    clearTimeout(timeoutId);

                    if (retryResponse.ok) {
                        finalResponse = retryResponse;
                    } else {
                        const retryErrorText = await retryResponse.text();
                        let retryErrorData: any;
                        try {
                            retryErrorData = JSON.parse(retryErrorText);
                        } catch {
                            retryErrorData = undefined;
                        }
                        // The model can refuse both fields: drop the temperature too, once.
                        if (
                            retryErrorData?.error?.code === 'unsupported_value' &&
                            retryErrorData?.error?.param === 'temperature' &&
                            retryErrorData?.error?.message?.includes('Only the default')
                        ) {
                            delete retryBody.temperature;
                            const secondController = new AbortController();
                            externalAbortCleanups.push(linkExternalAbort(externalSignal, secondController));
                            streamController = secondController;
                            timeoutId = setTimeout(() => secondController.abort(), timeout);
                            const secondResponse = await fetchFor(config)(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: secondController.signal,
                            });
                            clearTimeout(timeoutId);
                            if (!secondResponse.ok) {
                                const secondErrorText = await secondResponse.text();
                                throw new Error(`OpenAI API error: ${secondResponse.status} ${secondErrorText}`);
                            }
                            finalResponse = secondResponse;
                        } else {
                            throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                        }
                    }
                }
                // Retry with max_completion_tokens if model rejects max_tokens
                else if (errorData?.error?.code === 'unsupported_parameter' && 
                    errorData?.error?.param === 'max_tokens' &&
                    errorData?.error?.message?.includes('max_completion_tokens')) {
                    const retryBody = { ...requestBody };
                    delete retryBody.max_tokens;
                    retryBody.max_completion_tokens = requestBody.max_tokens ?? config.maxTokens;

                    const retryController = new AbortController();
                    externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                    streamController = retryController; // update for active stream
                    timeoutId = setTimeout(() => retryController.abort(), timeout);
                    const retryResponse = await fetchFor(config)(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(retryBody),
                        signal: retryController.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!retryResponse.ok) {
                        const retryErrorText = await retryResponse.text();
                        throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                    }

                    finalResponse = retryResponse;
                }
                // Ask again within the model's own output cap when it refuses the longest reply
                else if (outputCeiling !== undefined) {
                    const retryBody = this.withinOutputCeiling(requestBody, config, endpoint, outputCeiling);

                    const retryController = new AbortController();
                    externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                    streamController = retryController; // update for active stream
                    timeoutId = setTimeout(() => retryController.abort(), timeout);
                    const retryResponse = await fetchFor(config)(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(retryBody),
                        signal: retryController.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!retryResponse.ok) {
                        const retryErrorText = await retryResponse.text();
                        throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                    }

                    finalResponse = retryResponse;
                } else {
                    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
                }
            }

            if (!finalResponse.body) {
                throw new Error('No response body');
            }

            // Per-chunk idle timeout
            timeoutId = setTimeout(() => streamController.abort(), timeout);

            reader = finalResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Reset idle timeout on each chunk
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => streamController.abort(), timeout);

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;

                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();

                        if (data === '[DONE]') {
                            streamEnded = true;
                            break;
                        }

                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta;
                            const choice = json.choices?.[0];
                            if (choice?.finish_reason) {
                                finishReason = choice.finish_reason;
                            }

                            // Extract token usage
                            if (json.usage) {
                                const usage = json.usage;
                                if (usage.prompt_tokens !== undefined) {
                                    promptTokens = usage.prompt_tokens;
                                }
                                if (usage.completion_tokens !== undefined) {
                                    completionTokens = usage.completion_tokens;
                                }
                                tokensUsed = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
                                usageDetail = { ...usageDetail, ...readUsageDetail(usage) };
                            }

                            // Track response model
                            if (json.model) {
                                responseModel = json.model;
                            }

                            // A thinking model's reasoning: kept for the reply's next step, never shown
                            if (typeof delta?.reasoning_content === 'string') {
                                reasoning += delta.reasoning_content;
                            }

                            // YIELD directly per-chunk with event-loop yield so the frontend
                            // can render each token before the next arrives
                            if (delta?.content) {
                                yield {content: delta.content, done: false};
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }

                            // Handle tool calls
                            if (delta?.tool_calls) {
                                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[OpenAIProvider] Raw tool_calls delta:`, JSON.stringify(delta.tool_calls));
                                }
                                const toolCalls = delta.tool_calls.map((tc: any) => ({
                                    id: tc.id,
                                    name: tc.function?.name || '',
                                    arguments: tc.function?.arguments || '',
                                }));
                                yield {content: '', done: false, toolCalls};
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }

                if (streamEnded) break;
            }

            // Done chunk with metadata
            const latency = Date.now() - startTime;
            yield {
                content: '',
                done: true,
                ...(reasoning ? { reasoning } : {}),
                metadata: {
                    tokensUsed,
                    promptTokens,
                    ...(usageDetail.cachedPromptTokens !== undefined ? { cachedPromptTokens: usageDetail.cachedPromptTokens } : {}),
                    ...(usageDetail.cacheWriteTokens !== undefined ? { cacheWriteTokens: usageDetail.cacheWriteTokens } : {}),
                    ...(usageDetail.reasoningTokens !== undefined ? { reasoningTokens: usageDetail.reasoningTokens } : {}),
                    ...(usageDetail.costUsd !== undefined ? { costUsd: usageDetail.costUsd } : {}),
                    completionTokens,
                    latency,
                    error: !streamEnded && !finishReason,
                    truncated: finishReason === 'length',
                },
            };

        } catch (error: any) {
            const latency = Date.now() - startTime;
            // An external cancellation (stop/correction or quick-call deadline)
            // is not a provider failure — don't publish an error for it.
            const externallyCancelled = externalSignal?.aborted === true;
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed: 0,
                    latency,
                    error: !externallyCancelled,
                    ...(externallyCancelled ? { cancelled: true } : {}),
                    errorStatus: statusFromError(error),
                    ...(!externallyCancelled && saysTooLong(String(error?.message ?? '')) ? { tooLong: true } : {}),
                },
            };
        } finally {
            clearTimeout(timeoutId);
            externalAbortCleanups.forEach(cleanup => cleanup());
            reader?.cancel().catch(() => {});
        }
    }

    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        externalSignal?: AbortSignal,
        images?: string[]
    ): Promise<AIResponse> {
        const startTime = Date.now();
        let responseModel = '';

        return Sentry.startSpan({
            op: "gen_ai.chat",
            name: `LLM ${config.model}`,
            attributes: {
                "gen_ai.request.model": config.model,
                "gen_ai.system": config.endpoint?.includes('deepseek') ? 'deepseek' : 'openai',
                "gen_ai.agent.name": config.name || '',
            },
        }, async (span) => {
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
            const externalAbortCleanups: Array<() => void> = [];
            const controller = new AbortController();
            externalAbortCleanups.push(linkExternalAbort(externalSignal, controller));
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            try {
                const endpoint = this.getEndpoint(config);
                const apiKey = this.getApiKey(config);

                const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, false, tools, images);

                const response = await fetchFor(config)(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                let finalResponse = response;
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorData: any = null;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (e) {
                        // Not JSON, use as-is
                    }

                    const outputCeiling = statedOutputCeiling(response.status, errorText, requestBody.max_completion_tokens ?? requestBody.max_tokens);

                    // If error is about temperature, retry without temperature (use default)
                    if (errorData?.error?.code === 'unsupported_value' && 
                        errorData?.error?.param === 'temperature' &&
                        errorData?.error?.message?.includes('Only the default')) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[OpenAIProvider] Retrying without temperature parameter for model: ${config.model}`);
                        }
                        const retryBody = { ...requestBody };
                        delete retryBody.temperature;

                        const retryController = new AbortController();
                        externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                        const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                        try {
                            const retryResponse = await fetchFor(config)(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: retryController.signal,
                            });

                            if (!retryResponse.ok) {
                                const retryErrorText = await retryResponse.text();
                                throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                            }

                            finalResponse = retryResponse;
                        } finally {
                            clearTimeout(retryTimeoutId);
                        }
                    }
                    // If error is about max_tokens, retry with max_completion_tokens
                    else if (errorData?.error?.code === 'unsupported_parameter' && 
                        errorData?.error?.param === 'max_tokens' &&
                        errorData?.error?.message?.includes('max_completion_tokens')) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[OpenAIProvider] Retrying with max_completion_tokens for model: ${config.model}`);
                        }
                        const retryBody = { ...requestBody };
                        delete retryBody.max_tokens;
                        retryBody.max_completion_tokens = requestBody.max_tokens ?? config.maxTokens;

                        const retryController = new AbortController();
                        externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                        const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                        try {
                            const retryResponse = await fetchFor(config)(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: retryController.signal,
                            });

                            if (!retryResponse.ok) {
                                const retryErrorText = await retryResponse.text();
                                throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                            }

                            finalResponse = retryResponse;
                        } finally {
                            clearTimeout(retryTimeoutId);
                        }
                    }
                    // Ask again within the model's own output cap when it refuses the longest reply
                    else if (outputCeiling !== undefined) {
                        const retryBody = this.withinOutputCeiling(requestBody, config, endpoint, outputCeiling);

                        const retryController = new AbortController();
                        externalAbortCleanups.push(linkExternalAbort(externalSignal, retryController));
                        const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                        try {
                            const retryResponse = await fetchFor(config)(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: retryController.signal,
                            });

                            if (!retryResponse.ok) {
                                const retryErrorText = await retryResponse.text();
                                throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                            }

                            finalResponse = retryResponse;
                        } finally {
                            clearTimeout(retryTimeoutId);
                        }
                    } else {
                        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
                    }
                }

                const data = await finalResponse.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: any; model?: string };
                const content = data.choices?.[0]?.message?.content || '';
                const tokensUsed = data.usage?.total_tokens || 0;
                const promptTokens = data.usage?.prompt_tokens || 0;
                const completionTokens = data.usage?.completion_tokens || 0;
                const latency = Date.now() - startTime;

                span.setAttribute("gen_ai.response.model", data.model || config.model);
                span.setAttribute("gen_ai.usage.input_tokens", promptTokens);
                span.setAttribute("gen_ai.usage.output_tokens", completionTokens);
                const usageDetail = { promptTokens, completionTokens, ...readUsageDetail(data.usage) };
                if (usageDetail.cachedPromptTokens !== undefined) {
                    span.setAttribute("gen_ai.usage.cache_read.input_tokens", usageDetail.cachedPromptTokens);
                }
                span.setAttribute("gen_ai.agent.name", config.name || '');

                return {
                    content,
                    tokensUsed,
                    usage: usageDetail,
                    latency,
                    error: false,
                    truncated: data.choices?.[0]?.finish_reason === 'length',
                };
            } catch (error: any) {
                const latency = Date.now() - startTime;

                span.setStatus({ code: 2, message: error.message || 'Unknown error' });

                // External cancellation (stop/correction or quick-call deadline)
                // is not a provider failure — propagate it so callers treat it
                // as a clean stop instead of a misleading timeout report.
                if (externalSignal?.aborted) {
                    throw error;
                }

                if (error.name === 'AbortError') {
                    throw new Error(`OpenAI request timeout after ${timeout}ms`);
                }

                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[OpenAIProvider] Generate error:', error);
                }

                return {
                    content: '',
                    tokensUsed: 0,
                    latency,
                    error: true,
                };
            } finally {
                clearTimeout(timeoutId);
                externalAbortCleanups.forEach(cleanup => cleanup());
            }
        });
    }
}
