/**
 * LMStudio Provider Implementation
 * 
 * LMStudio uses OpenAI-compatible API format
 * Endpoint: {endpoint}/v1/chat/completions
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse } from '../types';
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

    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[]
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        let tokensUsed = 0;
        let promptTokens = 0;
        let completionTokens = 0;
        let responseModel = '';
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;

        // Use startSpanManual so the span stays alive across async-generator yield points.
        // startSpan wraps everything in a callback that must complete before yielding,
        // forcing chunk buffering. startSpanManual gives us the span handle immediately
        // so we can yield each chunk in real-time and end() the span when done.
        const sentrySpan = Sentry.startSpanManual(
            {
                op: "gen_ai.chat",
                name: `LLM ${config.model}`,
                parentSpan: (config as any).__sentryParentSpan,
            },
            (span) => span
        );
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
                    const endpoint = `${config.endpoint}/v1/chat/completions`;

                    const controller = new AbortController();
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
                                include_usage: true,  // Enable token counts in streaming
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

                    // Per-chunk idle timeout — only after confirming a successful stream response
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

                        // Reset idle timeout on each chunk — long streams stay alive as long as tokens keep flowing
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
                                    const latency = Date.now() - startTime;

                                    sentrySpan?.setAttribute("gen_ai.request.model", config.model);
                                    sentrySpan?.setAttribute("gen_ai.response.model", responseModel || config.model);
                                    sentrySpan?.setAttribute("gen_ai.system", "lmstudio");
                                    sentrySpan?.setAttribute("gen_ai.usage.input_tokens", promptTokens || 0);
                                    sentrySpan?.setAttribute("gen_ai.usage.output_tokens", completionTokens || 0);
                                    sentrySpan?.setAttribute("gen_ai.agent.name", config.name || '');

                                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.log(`[LMStudioProvider] Received [DONE], yielding final chunk with tokensUsed=${tokensUsed}`);
                                    }
                                    yield {
                                        content: '',
                                        done: true,
                                        metadata: {
                                            tokensUsed,
                                            promptTokens,
                                            completionTokens,
                                            latency,
                                            error: false,
                                        },
                                    };
                                    return;
                                }

                                try {
                                    const json = JSON.parse(data);
                                    const delta = json.choices?.[0]?.delta;

                                    // Extract token usage - can come in usage chunks when include_usage is true
                                    // Check usage FIRST, as it might come in chunks without delta.content
                                    if (json.usage) {
                                        if (json.usage.prompt_tokens !== undefined || json.usage.completion_tokens !== undefined) {
                                            // Track prompt and completion tokens separately
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
                                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                                console.log(`[LMStudioProvider] Token usage updated: ${tokensUsed} (prompt: ${json.usage.prompt_tokens || 0}, completion: ${json.usage.completion_tokens || 0})`);
                                            }
                                        } else if (json.usage.total_tokens) {
                                            // Fallback to total_tokens if available
                                            tokensUsed = json.usage.total_tokens;
                                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                                console.log(`[LMStudioProvider] Token usage from total_tokens: ${tokensUsed}`);
                                            }
                                        }
                                    }

                                    // Handle tool calls
                                    if (delta?.tool_calls) {
                                        const toolCalls = delta.tool_calls.map((tc: any) => {
                                            // Use empty string instead of '{}' for undefined arguments
                                            // This allows proper accumulation of streamed arguments
                                            const toolCall = {
                                                id: tc.id,
                                                name: tc.function?.name || '',
                                                arguments: tc.function?.arguments || '',
                                            };
                                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                                console.log(`[LMStudioProvider] Tool call chunk: id=${toolCall.id}, name=${toolCall.name}, args="${toolCall.arguments.substring(0, 50)}"`);
                                            }
                                            return toolCall;
                                        });
                                        yield {
                                            content: '',
                                            done: false,
                                            toolCalls,
                                        };
                                    }

                                    // Yield content chunks
                                    if (delta?.content) {
                                        yield {
                                            content: delta.content,
                                            done: false,
                                        };
                                    }
                                } catch (e) {
                                    // Skip invalid JSON lines
                                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.warn('[LMStudioProvider] Invalid JSON in stream:', line);
                                    }
                                }
                            }
                        }
                    }

                    // Final chunk
                    const latency = Date.now() - startTime;

                    sentrySpan?.setAttribute("gen_ai.request.model", config.model);
                    sentrySpan?.setAttribute("gen_ai.response.model", responseModel || config.model);
                    sentrySpan?.setAttribute("gen_ai.system", "lmstudio");
                    sentrySpan?.setAttribute("gen_ai.usage.input_tokens", promptTokens || 0);
                    sentrySpan?.setAttribute("gen_ai.usage.output_tokens", completionTokens || 0);
                    sentrySpan?.setAttribute("gen_ai.agent.name", config.name || '');

                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[LMStudioProvider] Final chunk: tokensUsed=${tokensUsed}, latency=${latency}ms`);
                    }
                    yield {
                        content: '',
                        done: true,
                        metadata: {
                            tokensUsed,
                            promptTokens,
                            completionTokens,
                            latency,
                            error: false,
                        },
                    };
                } catch (error: any) {
                    const latency = Date.now() - startTime;
                    
                    sentrySpan?.setAttribute("gen_ai.request.model", config.model);
                    sentrySpan?.setAttribute("gen_ai.system", "lmstudio");
                    sentrySpan?.setAttribute("gen_ai.agent.name", config.name || '');
                    sentrySpan?.setStatus({ code: 2, message: error.message || 'Unknown error' });

                    if (error.name === 'AbortError') {
                        throw new Error(`LMStudio request timeout after ${timeout}ms`);
                    }

                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.error('[LMStudioProvider] Stream error:', error);
                    }

                    yield {
                        content: '',
                        done: true,
                        metadata: {
                            tokensUsed: 0,
                            latency,
                            error: true,
                        },
                    };
                } finally {
                    clearTimeout(timeoutId);
                    reader?.cancel();
                    sentrySpan?.end();
                }
    }

    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[]
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
            try {
            const endpoint = `${config.endpoint}/v1/chat/completions`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

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
                        include_usage: true,  // For consistency
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

            const data = await response.json();
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
            }
        });
    }
}

