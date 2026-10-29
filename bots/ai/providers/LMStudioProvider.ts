/**
 * LMStudio Provider Implementation
 * 
 * LMStudio uses OpenAI-compatible API format
 * Endpoint: {endpoint}/v1/chat/completions
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse } from '../types';
import { linkExternalAbort } from './abortUtils';
import { resolveVisionSupport } from './visionModels';
import { decryptApiKey } from '../encryption';
import { fetchFor, providerErrorText, statusFromError } from './ownKeyHttp';
import * as Sentry from '@sentry/node';
import { stepMessages, tooLongOf, type ReplySteps } from '../replySteps';
import { refusesStreamOptions, statedContext, statedOutputCeiling } from './OpenAIProvider';
import { inlineImages } from './inlineImages';

export class LMStudioProvider implements AIProvider {
    private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

    /**
     * Endpoints that refused `stream_options` once, for a reply that streams or one that does not (vLLM refuses it only on
     * a call that does not stream). They are not sent it again.
     */
    private static readonly refusedStreamOptions = new Set<string>();

    /** The output cap each model stated once it refused more (endpoint and model). It is asked within it from then on. */
    private static readonly outputCeilings = new Map<string, number>();

    /**
     * The context each model stated once a request did not fit it (endpoint and model). When it is no more than the longest
     * reply, no reply can be longer than it anyway: `max_tokens` is left out from then on, and the server (vLLM) fills
     * what the messages leave, so the reply needs no second call.
     */
    private static readonly contextLengths = new Map<string, number>();

    private static streamOptionsKey(endpoint: string, body: Record<string, any>): string {
        return `${endpoint} ${body.stream ? 'stream' : 'once'}`;
    }

    /** The body as sent to this endpoint today, less what it refused before: `stream_options`, or a longest reply its model can't take. */
    private remembered(body: Record<string, any>, endpoint: string, config: AIProviderConfig): Record<string, any> {
        const sent = { ...body };
        if (LMStudioProvider.refusedStreamOptions.has(LMStudioProvider.streamOptionsKey(endpoint, sent))) delete sent.stream_options;
        if (typeof sent.max_tokens === 'number') {
            const model = `${endpoint} ${config.model}`;
            const ceiling = LMStudioProvider.outputCeilings.get(model);
            if (ceiling !== undefined && sent.max_tokens > ceiling) sent.max_tokens = ceiling;
            const context = LMStudioProvider.contextLengths.get(model);
            if (context !== undefined && context <= sent.max_tokens) delete sent.max_tokens;
        }
        return sent;
    }

    /**
     * Posts the body, and asks again (twice at most) when the server refuses what `OpenAIProvider` also asks again for
     * (#1569): `stream_options`, or a longest reply above the model's cap or above what the messages left of its context
     * (vLLM refuses any request whose reply cap and messages are more than the context). What the model or endpoint
     * refused for good is remembered, so later replies make one call. Any other refusal throws, as before.
     */
    private async post(endpoint: string, body: Record<string, any>, config: AIProviderConfig, signal: AbortSignal): Promise<Response> {
        let sent = this.remembered(body, endpoint, config);
        for (let attempt = 0; ; attempt++) {
            const response = await fetchFor(config)(endpoint, {
                method: 'POST',
                headers: this.headers(config),
                body: JSON.stringify(sent),
                signal,
            });
            if (response.ok) return response;
            const errorText = await response.text();
            const retry = attempt < 2 ? this.retryBody(response.status, errorText, sent, endpoint, config) : undefined;
            if (!retry) throw new Error(`LMStudio API error: ${response.status} ${errorText}`);
            sent = retry;
        }
    }

    /** The body to ask again with after a refusal, or undefined when asking again would not help. */
    private retryBody(status: number, errorText: string, sent: Record<string, any>, endpoint: string, config: AIProviderConfig): Record<string, any> | undefined {
        if (sent.stream_options && refusesStreamOptions(status, errorText)) {
            LMStudioProvider.refusedStreamOptions.add(LMStudioProvider.streamOptionsKey(endpoint, sent));
            const retry = { ...sent };
            delete retry.stream_options;
            return retry;
        }
        const ceiling = statedOutputCeiling(status, errorText, sent.max_tokens);
        if (!ceiling) return undefined;
        const model = `${endpoint} ${config.model}`;
        if (ceiling.lasting) LMStudioProvider.outputCeilings.set(model, ceiling.tokens);
        else {
            const context = statedContext(status, errorText);
            if (context) LMStudioProvider.contextLengths.set(model, context.context);
        }
        return { ...sent, max_tokens: ceiling.tokens };
    }

    getName(): string {
        return 'LMStudio';
    }

    /**
     * The server's own LM Studio sends no key, as it always has. A person's own key (#374) may have one, for a
     * server that asks for it: only then is an Authorization header sent.
     */
    private headers(config: AIProviderConfig): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.ownKey && config.apiKeyEncrypted) {
            const key = decryptApiKey(config.apiKeyEncrypted);
            if (key) headers.Authorization = `Bearer ${key}`;
        }
        return headers;
    }

    isReady(): boolean {
        return true; // Always ready (local provider)
    }

    supportsStreaming(): boolean {
        return true;
    }

    /**
     * Whether the model config supports vision (image_url content blocks).
     * LMStudio serves local models via the OpenAI-compatible protocol; vision
     * capability is resolved from the model name with the same tri-state
     * override as OpenAIProvider.
     */
    supportsVision(config: AIProviderConfig): boolean {
        return resolveVisionSupport(config.model || '', config.supportsVision);
    }

    /**
     * Build the user message content: plain text, or multipart (text + image_url
     * blocks) when the model supports vision and images are present. Mirrors
     * OpenAIProvider so local vision models (llava, qwen-vl, ...) get the same
     * treatment as remote ones. A person's own key gets each picture inside the
     * request (#1570): Ollama takes no links. The server's own LM Studio keeps
     * getting links, as before.
     */
    private async buildUserContent(
        userMessage: string,
        config: AIProviderConfig,
        images?: string[]
    ): Promise<string | Array<Record<string, any>>> {
        if (images && images.length > 0 && this.supportsVision(config)) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[LMStudioProvider] Sending ${images.length} image(s) as multipart content to vision-capable model ${config.model}`);
            }
            const sent = config.ownKey ? await inlineImages(images) : images;
            return [
                { type: 'text', text: userMessage },
                ...sent.map((url) => ({ type: 'image_url', image_url: { url } })),
            ];
        }
        return userMessage;
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
        let completionTokens = 0;
        let responseModel = '';
        let streamEnded = false;
        let finishReason: string | undefined;
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let cleanupExternalAbort: (() => void) | undefined;

        try {
            const endpoint = `${config.endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
            // Before the connection timeout starts: fetching pictures is not the server's time
            const userContent = await this.buildUserContent(userMessage, config, images);

            const controller = new AbortController();
            cleanupExternalAbort = linkExternalAbort(externalSignal, controller);
            timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await this.post(endpoint, {
                model: config.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                    // The reply's steps so far
                    ...stepMessages(steps),
                ],
                stream: true,
                stream_options: {
                    include_usage: true,
                },
                temperature: config.temperature,
                max_tokens: config.maxTokens,
                ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
            }, config, controller.signal);

            clearTimeout(timeoutId); // Connection established — clear connection timeout

            // Per-chunk idle timeout
            timeoutId = setTimeout(() => controller.abort(), timeout);

            reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Reset idle timeout on each chunk
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => controller.abort(), timeout);

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
                                if (json.usage.prompt_tokens !== undefined || json.usage.completion_tokens !== undefined) {
                                    if (json.usage.prompt_tokens !== undefined) {
                                        promptTokens = json.usage.prompt_tokens;
                                    }
                                    if (json.usage.completion_tokens !== undefined) {
                                        completionTokens = json.usage.completion_tokens;
                                    }
                                    const newTokens = promptTokens + completionTokens;
                                    if (newTokens > 0) {
                                        tokensUsed = newTokens;
                                    }
                                } else if (json.usage.total_tokens) {
                                    tokensUsed = json.usage.total_tokens;
                                }
                            }

                            // Track response model
                            if (json.model) {
                                responseModel = json.model;
                            }

                            // YIELD directly per-chunk with event-loop yield so the frontend
                            // can render each token before the next arrives
                            if (delta?.content) {
                                yield {content: delta.content, done: false};
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }

                            // Handle tool calls
                            if (delta?.tool_calls) {
                                const toolCalls = delta.tool_calls.map((tc: any) => {
                                    const toolCall = {
                                        id: tc.id,
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || '',
                                    };
                                    return toolCall;
                                });
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
                metadata: {
                    tokensUsed,
                    promptTokens,
                    completionTokens,
                    latency,
                    error: !streamEnded && !finishReason,
                    truncated: finishReason === 'length',
                    ...(finishReason ? { finishReason } : {}),
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
                    errorStatus: statusFromError(error),
                    ...(externallyCancelled ? {} : { ...tooLongOf(error?.message), errorText: providerErrorText(error) }),
                },
            };
        } finally {
            clearTimeout(timeoutId);
            cleanupExternalAbort?.();
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

        return Sentry.startSpan({
            op: "gen_ai.chat",
            name: `LLM ${config.model}`,
            attributes: {
                "gen_ai.request.model": config.model,
                "gen_ai.system": "lmstudio",
                "gen_ai.agent.name": config.name || '',
            },
        }, async (span) => {
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
            const controller = new AbortController();
            const cleanupExternalAbort = linkExternalAbort(externalSignal, controller);
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            try {
                const endpoint = `${config.endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
                const userContent = await this.buildUserContent(userMessage, config, images);

                const response = await this.post(endpoint, {
                    model: config.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent },
                    ],
                    stream: false,
                    stream_options: {
                        include_usage: true,
                    },
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
                }, config, controller.signal);

                clearTimeout(timeoutId);

                const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }; model?: string };
                const content = data.choices?.[0]?.message?.content || '';
                const tokensUsed = data.usage?.total_tokens || 0;
                const promptTokens = data.usage?.prompt_tokens || 0;
                const completionTokens = data.usage?.completion_tokens || 0;
                const latency = Date.now() - startTime;

                span.setAttribute("gen_ai.response.model", data.model || config.model);
                span.setAttribute("gen_ai.usage.input_tokens", promptTokens);
                span.setAttribute("gen_ai.usage.output_tokens", completionTokens);

                return {
                    content,
                    tokensUsed,
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
                    throw new Error(`LMStudio request timeout after ${timeout}ms`);
                }

                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[LMStudioProvider] Generate error:', error);
                }

                return {
                    content: '',
                    tokensUsed: 0,
                    latency,
                    error: true,
                };
            } finally {
                clearTimeout(timeoutId);
                cleanupExternalAbort();
            }
        });
    }
}
