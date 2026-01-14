/**
 * LMStudio Provider Implementation
 * 
 * LMStudio uses OpenAI-compatible API format
 * Endpoint: {endpoint}/v1/chat/completions
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse } from '../types';

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
        config: AIProviderConfig
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        let tokensUsed = 0;
        let error = false;

        try {
            const endpoint = `${config.endpoint}/v1/chat/completions`;
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;

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
                    stream: true,
                    stream_options: {
                        include_usage: true,  // Enable token counts in streaming
                    },
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LMStudio API error: ${response.status} ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;

                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        
                        if (data === '[DONE]') {
                            const latency = Date.now() - startTime;
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[LMStudioProvider] Received [DONE], yielding final chunk with tokensUsed=${tokensUsed}`);
                            }
                            yield {
                                content: '',
                                done: true,
                                metadata: {
                                    tokensUsed,
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
                                    // Sum prompt and completion tokens
                                    const newTokens = (json.usage.prompt_tokens || 0) + (json.usage.completion_tokens || 0);
                                    if (newTokens > 0) {
                                        tokensUsed = newTokens;
                                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                            console.log(`[LMStudioProvider] Token usage updated: ${tokensUsed} (prompt: ${json.usage.prompt_tokens || 0}, completion: ${json.usage.completion_tokens || 0})`);
                                        }
                                    }
                                } else if (json.usage.total_tokens) {
                                    // Fallback to total_tokens if available
                                    tokensUsed = json.usage.total_tokens;
                                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.log(`[LMStudioProvider] Token usage from total_tokens: ${tokensUsed}`);
                                    }
                                }
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
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[LMStudioProvider] Final chunk: tokensUsed=${tokensUsed}, latency=${latency}ms`);
            }
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed,
                    latency,
                    error: false,
                },
            };
        } catch (error: any) {
            const latency = Date.now() - startTime;
            
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
        }
    }

    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig
    ): Promise<AIResponse> {
        const startTime = Date.now();

        try {
            const endpoint = `${config.endpoint}/v1/chat/completions`;
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;

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
            const latency = Date.now() - startTime;

            return {
                content,
                tokensUsed,
                latency,
                error: false,
            };
        } catch (error: any) {
            const latency = Date.now() - startTime;

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
    }
}

