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
import * as Sentry from '@sentry/node';

export class LMStudioProvider implements AIProvider {
    private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

    getName(): string {
        return 'LMStudio';
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
     * override as OpenAIProvider. Multipart sending is not implemented here yet,
     * so vision-capable local models degrade to URL-as-text context.
     */
    supportsVision(config: AIProviderConfig): boolean {
        return resolveVisionSupport(config.model || '', config.supportsVision);
    }

    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        externalSignal?: AbortSignal
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        let tokensUsed = 0;
        let promptTokens = 0;
        let completionTokens = 0;
        let responseModel = '';
        let streamEnded = false;
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let cleanupExternalAbort: (() => void) | undefined;

        try {
            const endpoint = `${config.endpoint}/v1/chat/completions`;

            const controller = new AbortController();
            cleanupExternalAbort = linkExternalAbort(externalSignal, controller);
            timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                    stream: true,
                    stream_options: {
                        include_usage: true,
                    },
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId); // Connection established — clear connection timeout

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LMStudio API error: ${response.status} ${errorText}`);
            }

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
                    error: !streamEnded,
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
        externalSignal?: AbortSignal
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
                const endpoint = `${config.endpoint}/v1/chat/completions`;

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userMessage },
                        ],
                        stream: false,
                        stream_options: {
                            include_usage: true,
                        },
                        temperature: config.temperature,
                        max_tokens: config.maxTokens,
                        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
                    }),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`LMStudio API error: ${response.status} ${errorText}`);
                }

                const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }; model?: string };
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
