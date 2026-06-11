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
import * as Sentry from '@sentry/node';

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
        tools?: any[]
    ): Record<string, any> {
        const body: Record<string, any> = {
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            stream,
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
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

        // Use correct parameter based on model type
        if (config.maxTokens) {
            const requiresMaxCompletion = this.requiresMaxCompletionTokens(config.model);
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[OpenAIProvider] Model: ${config.model}, requiresMaxCompletionTokens: ${requiresMaxCompletion}`);
            }
            if (requiresMaxCompletion) {
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
        config: AIProviderConfig,
        tools?: any[]
    ): AsyncGenerator<AIStreamChunk> {
        // Collect all chunks first, then yield them after the span ends.
        // This ensures the gen_ai.chat span is properly created as a child
        // of the parent gen_ai.agent span and its end() is called before
        // the parent ends. startSpanManual with identity callback was the
        // root cause of 0 child spans — it never called end() or scope
        // cleanup properly across async generator yield points.
        const chunks: AIStreamChunk[] = [];
        await Sentry.startSpan(
            {
                op: "gen_ai.chat",
                name: `LLM ${config.model}`,
                parentSpan: (config as any).__sentryParentSpan,
                attributes: {
                    "gen_ai.request.model": config.model,
                    "gen_ai.system": config.endpoint?.includes('deepseek') ? 'deepseek' : 'openai',
                    "gen_ai.agent.name": config.name || '',
                },
            },
            async (span) => {
                const startTime = Date.now();
                let tokensUsed = 0;
                let promptTokens = 0;
                let completionTokens = 0;
                let responseModel = '';
                let streamEnded = false;
                const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
                let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

                try {
                    const endpoint = this.getEndpoint(config);
                    const apiKey = this.getApiKey(config);

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, true, tools);

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

                    let finalResponse = response;
                    if (!response.ok) {
                        const errorText = await response.text();
                        let errorData: any = null;
                        try {
                            errorData = JSON.parse(errorText);
                        } catch (e) {
                            // Not JSON, use as-is
                        }

                        // If error is about temperature, retry without temperature (use default)
                        if (errorData?.error?.code === 'unsupported_value' && 
                            errorData?.error?.param === 'temperature' &&
                            errorData?.error?.message?.includes('Only the default')) {
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[OpenAIProvider] Retrying without temperature parameter for model: ${config.model}`);
                            }
                            // Retry without temperature parameter
                            const retryBody = { ...requestBody };
                            delete retryBody.temperature;

                            const retryController = new AbortController();
                            const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                            const retryResponse = await fetch(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: retryController.signal,
                            });

                            clearTimeout(retryTimeoutId);

                            if (!retryResponse.ok) {
                                const retryErrorText = await retryResponse.text();
                                throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                            }

                            // Use retry response instead
                            finalResponse = retryResponse;
                        }
                        // If error is about max_tokens, retry with max_completion_tokens
                        else if (errorData?.error?.code === 'unsupported_parameter' && 
                            errorData?.error?.param === 'max_tokens' &&
                            errorData?.error?.message?.includes('max_completion_tokens')) {
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[OpenAIProvider] Retrying with max_completion_tokens for model: ${config.model}`);
                            }
                            // Retry with max_completion_tokens
                            const retryBody = { ...requestBody };
                            delete retryBody.max_tokens;
                            retryBody.max_completion_tokens = config.maxTokens;

                            const retryController = new AbortController();
                            const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                            const retryResponse = await fetch(endpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                },
                                body: JSON.stringify(retryBody),
                                signal: retryController.signal,
                            });

                            clearTimeout(retryTimeoutId);

                            if (!retryResponse.ok) {
                                const retryErrorText = await retryResponse.text();
                                throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                            }

                            // Use retry response instead
                            finalResponse = retryResponse;
                        } else {
                            throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
                        }
                    }

                    if (!finalResponse.body) {
                        throw new Error('No response body');
                    }

                    // Per-chunk idle timeout — only after confirming a successful stream response
                    clearTimeout(timeoutId);
                    const streamTimeoutId = setTimeout(() => controller.abort(), timeout);

                    reader = finalResponse.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        // Reset idle timeout on each chunk
                        clearTimeout(streamTimeoutId);
                        const newStreamTimeoutId = setTimeout(() => controller.abort(), timeout);

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
                                        const usage = json.usage;
                                        if (usage.prompt_tokens !== undefined) {
                                            promptTokens = usage.prompt_tokens;
                                        }
                                        if (usage.completion_tokens !== undefined) {
                                            completionTokens = usage.completion_tokens;
                                        }
                                        tokensUsed = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
                                    }

                                    // Track response model
                                    if (json.model) {
                                        responseModel = json.model;
                                    }

                                    // Track content
                                    if (delta?.content) {
                                        chunks.push({
                                            content: delta.content,
                                            done: false,
                                        });
                                    }

                                    // Handle tool calls
                                    if (delta?.tool_calls) {
                                        const toolCalls = delta.tool_calls.map((tc: any) => ({
                                            id: tc.id,
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || '',
                                        }));
                                        chunks.push({
                                            content: '',
                                            done: false,
                                            toolCalls,
                                        });
                                    }
                                } catch (e) {
                                    // Skip invalid JSON lines
                                }
                            }
                        }

                        if (streamEnded) break;
                    }

                    clearTimeout(streamTimeoutId);

                    // Set span attributes
                    const latency = Date.now() - startTime;
                    span.setAttribute("gen_ai.request.model", config.model);
                    span.setAttribute("gen_ai.response.model", responseModel || config.model);
                    span.setAttribute("gen_ai.system", config.endpoint?.includes('deepseek') ? 'deepseek' : 'openai');
                    span.setAttribute("gen_ai.usage.input_tokens", promptTokens || 0);
                    span.setAttribute("gen_ai.usage.output_tokens", completionTokens || 0);
                    span.setAttribute("gen_ai.agent.name", config.name || '');

                    // Push final done chunk with metadata
                    chunks.push({
                        content: '',
                        done: true,
                        metadata: {
                            tokensUsed,
                            promptTokens,
                            completionTokens,
                            latency,
                            error: !streamEnded,
                        },
                    });

                } catch (error: any) {
                    const latency = Date.now() - startTime;

                    span.setAttribute("gen_ai.request.model", config.model);
                    span.setAttribute("gen_ai.system", config.endpoint?.includes('deepseek') ? 'deepseek' : 'openai');
                    span.setAttribute("gen_ai.agent.name", config.name || '');
                    span.setStatus({ code: 2, message: error.message || 'Unknown error' });

                    if (error.name === 'AbortError') {
                        throw new Error(`OpenAI request timeout after ${timeout}ms`);
                    }

                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.error('[OpenAIProvider] Stream error:', error);
                    }

                    chunks.push({
                        content: '',
                        done: true,
                        metadata: {
                            tokensUsed: 0,
                            latency,
                            error: true,
                        },
                    });
                } finally {
                    reader?.cancel();
                }
            }
        );
        yield* chunks;
    }

    async generate(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[]
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
            try {
                const endpoint = this.getEndpoint(config);
                const apiKey = this.getApiKey(config);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, false, tools);

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

                let finalResponse = response;
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorData: any = null;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (e) {
                        // Not JSON, use as-is
                    }

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
                        const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                        const retryResponse = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify(retryBody),
                            signal: retryController.signal,
                        });

                        clearTimeout(retryTimeoutId);

                        if (!retryResponse.ok) {
                            const retryErrorText = await retryResponse.text();
                            throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                        }

                        finalResponse = retryResponse;
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
                        retryBody.max_completion_tokens = config.maxTokens;

                        const retryController = new AbortController();
                        const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

                        const retryResponse = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                            },
                            body: JSON.stringify(retryBody),
                            signal: retryController.signal,
                        });

                        clearTimeout(retryTimeoutId);

                        if (!retryResponse.ok) {
                            const retryErrorText = await retryResponse.text();
                            throw new Error(`OpenAI API error: ${retryResponse.status} ${retryErrorText}`);
                        }

                        finalResponse = retryResponse;
                    } else {
                        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
                    }
                }

                const data = await finalResponse.json();
                const content = data.choices?.[0]?.message?.content || '';
                const tokensUsed = data.usage?.total_tokens || 0;
                const promptTokens = data.usage?.prompt_tokens || 0;
                const completionTokens = data.usage?.completion_tokens || 0;
                const latency = Date.now() - startTime;

                span.setAttribute("gen_ai.response.model", data.model || config.model);
                span.setAttribute("gen_ai.usage.input_tokens", promptTokens);
                span.setAttribute("gen_ai.usage.output_tokens", completionTokens);
                span.setAttribute("gen_ai.agent.name", config.name || '');

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
        });
    }
}
