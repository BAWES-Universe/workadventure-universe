/**
 * OpenAI Provider Implementation
 * 
 * OpenAI uses standard API format
 * Endpoint: https://api.openai.com/v1/chat/completions (default)
 * Supports custom endpoints (e.g., Azure OpenAI, proxies)
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse } from '../types';
import { decryptApiKey } from '../encryption';

export class OpenAIProvider implements AIProvider {
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
     * Reasoning models (o1, o3) use max_completion_tokens
     */
    private requiresMaxCompletionTokens(model: string): boolean {
        const modelLower = model.toLowerCase();
        return modelLower.startsWith('o1') || modelLower.startsWith('o3');
    }

    /**
     * Build request body with correct token limit parameter
     */
    private buildRequestBody(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        stream: boolean
    ): Record<string, any> {
        const body: Record<string, any> = {
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            stream,
            temperature: config.temperature,
        };

        // Use correct parameter based on model type
        if (config.maxTokens) {
            if (this.requiresMaxCompletionTokens(config.model)) {
                body.max_completion_tokens = config.maxTokens;
            } else {
                body.max_tokens = config.maxTokens;
            }
        }

        return body;
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
            const endpoint = this.getEndpoint(config);
            const apiKey = this.getApiKey(config);
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, true);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
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

                            if (delta?.content) {
                                yield {
                                    content: delta.content,
                                    done: false,
                                };
                            }

                            // Extract token usage from final chunk
                            if (json.usage?.total_tokens) {
                                tokensUsed = json.usage.total_tokens;
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn('[OpenAIProvider] Invalid JSON in stream:', line);
                            }
                        }
                    }
                }
            }

            // Final chunk
            const latency = Date.now() - startTime;
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
                throw new Error(`OpenAI request timeout after ${timeout}ms`);
            }

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[OpenAIProvider] Stream error:', error);
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
            const endpoint = this.getEndpoint(config);
            const apiKey = this.getApiKey(config);
            const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, false);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
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
        }
    }
}

