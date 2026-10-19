/**
 * Anthropic (Claude) Provider Implementation
 *
 * Claude speaks its own format, not the OpenAI one:
 *   - the key goes in `x-api-key` (with an `anthropic-version`), not `Authorization: Bearer`
 *   - the system prompt is a top-level `system` field
 *   - tools are `{name, description, input_schema}` and come back as `tool_use` blocks
 *   - images are `{type: 'image', source: {type: 'url', url}}` blocks
 *   - a stream is SSE events (`content_block_delta`, `message_delta`, ...), not `choices[0].delta`
 * Endpoint: https://api.anthropic.com/v1/messages (default). The caller keeps handing us OpenAI-shaped tool definitions and
 * expects `{id, name, arguments}` tool calls back, so this file does that translation and nothing else changes upstream.
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse, ToolCall } from '../types';
import { decryptApiKey } from '../encryption';
import { fetchFor, statusFromError } from './ownKeyHttp';
import { linkExternalAbort } from './abortUtils';
import { resolveVisionSupport } from './visionModels';
import * as Sentry from '@sentry/node';

const ANTHROPIC_VERSION = '2023-06-01';

/** Models released after Claude Opus 4.6 answer 400 to any temperature but 1, so it is left out for them. */
const FIXED_TEMPERATURE_MODEL = /^claude-(?:opus-4-[7-9]|(?:opus|sonnet|haiku|fable|mythos)-[5-9])/i;
/** Models that take `output_config.effort`. Chat replies ask for the lowest: a bot answers in a sentence or two. */
const EFFORT_MODEL = /^claude-(?:opus-(?:4-[5-9]|[5-9])|sonnet-(?:4-6|[5-9])|haiku-[5-9]|fable|mythos)/i;
/** Thinking counts toward `max_tokens`, so a model that thinks needs room beyond a short reply cap. */
const THINKING_ROOM = 1024;

/** The HTTP status an error stands for. Anthropic reports "out of credit" and "spend limit reached" as a plain 400. */
function effectiveStatus(status: number, errorText: string): number {
    if (status === 400 && /credit balance|usage limits|billing/i.test(errorText)) return 402;
    return status;
}

const STREAM_ERROR_STATUS: Record<string, number> = {
    authentication_error: 401,
    permission_error: 403,
    not_found_error: 404,
    rate_limit_error: 429,
    overloaded_error: 529,
    api_error: 500,
};

interface ClaudeContentBlock {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
}

interface ClaudeUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

/** Input tokens as Anthropic bills them: the fresh ones plus what was written to or read from the cache. */
function promptTokensOf(usage: ClaudeUsage | undefined): number | undefined {
    if (!usage || typeof usage.input_tokens !== 'number') return undefined;
    return usage.input_tokens + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

export class AnthropicProvider implements AIProvider {
    private readonly DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1';
    private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

    getName(): string {
        return 'Anthropic';
    }

    isReady(): boolean {
        return true; // Always ready (cloud provider)
    }

    supportsStreaming(): boolean {
        return true;
    }

    /** Same tri-state as every provider: null/undefined = by model name (any `claude-` model), true = force, false = text-only. */
    supportsVision(config: AIProviderConfig): boolean {
        return resolveVisionSupport(config.model || '', config.supportsVision);
    }

    private getApiKey(config: AIProviderConfig): string {
        if (!config.apiKeyEncrypted) {
            throw new Error('Anthropic requires an API key');
        }
        try {
            const decrypted = decryptApiKey(config.apiKeyEncrypted);
            if (!decrypted) {
                throw new Error('Failed to decrypt API key');
            }
            return decrypted;
        } catch (error) {
            throw new Error(`Failed to decrypt Anthropic API key: ${error}`);
        }
    }

    private getEndpoint(config: AIProviderConfig): string {
        const clean = (config.endpoint || this.DEFAULT_ENDPOINT).replace(/\/+$/, '');
        return clean.endsWith('/messages') ? clean : `${clean}/messages`;
    }

    private headers(apiKey: string): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
        };
    }

    /** OpenAI-shaped tool definitions (what the whole bot server builds) in Claude's shape. */
    private convertTools(tools: any[]): Array<Record<string, unknown>> {
        const converted: Array<Record<string, unknown>> = [];
        for (const tool of tools) {
            const definition = tool?.function ?? tool;
            if (!definition?.name) continue;
            // Claude insists on an object schema. A tool server that leaves its schema out (the connector then passes
            // {}) or leaves out the type would otherwise be refused with a 400 that silences every reply.
            const schema = definition.parameters ?? definition.input_schema;
            const hasObjectSchema = schema && typeof schema === 'object' && !Array.isArray(schema);
            converted.push({
                name: definition.name,
                description: definition.description || '',
                input_schema: hasObjectSchema ? { type: 'object', ...schema } : { type: 'object', properties: {} },
            });
        }
        return converted;
    }

    private buildRequestBody(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        stream: boolean,
        tools?: any[],
        images?: string[]
    ): Record<string, any> {
        const model = config.model;
        const body: Record<string, any> = {
            model,
            max_tokens: config.maxTokens || 1024,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            stream,
        };

        // Images go before the text, as Claude recommends. Text-only models keep the plain string: the caller
        // puts the image URLs in the message text instead.
        if (images && images.length > 0 && this.supportsVision(config)) {
            body.messages[0].content = [
                ...images.map((url) => ({ type: 'image', source: { type: 'url', url } })),
                { type: 'text', text: userMessage },
            ];
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AnthropicProvider] Sending ${images.length} image(s) to vision-capable model ${model}`);
            }
        }

        if (tools && tools.length > 0) {
            const converted = this.convertTools(tools);
            if (converted.length > 0) {
                body.tools = converted;
                body.tool_choice = { type: 'auto' };
            }
        }

        if (!FIXED_TEMPERATURE_MODEL.test(model || '') && typeof config.temperature === 'number') {
            body.temperature = Math.min(1, Math.max(0, config.temperature));
        }

        if (EFFORT_MODEL.test(model || '')) {
            body.output_config = { effort: 'low' };
            body.max_tokens = Math.max(body.max_tokens, THINKING_ROOM);
        }

        return body;
    }

    /**
     * POST the request. A model that refuses a setting we guessed wrong (a temperature, the effort) is asked again
     * without it, once each: the answer says which one in its message.
     */
    private async post(
        endpoint: string,
        apiKey: string,
        requestBody: Record<string, any>,
        config: AIProviderConfig,
        timeout: number,
        externalSignal: AbortSignal | undefined,
        cleanups: Array<() => void>
    ): Promise<{ response: Response; controller: AbortController }> {
        let body = requestBody;
        for (let attempt = 0; ; attempt++) {
            const controller = new AbortController();
            cleanups.push(linkExternalAbort(externalSignal, controller));
            const timer = setTimeout(() => controller.abort(), timeout);
            let response: Response;
            try {
                response = await fetchFor(config)(endpoint, {
                    method: 'POST',
                    headers: this.headers(apiKey),
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            if (response.ok) return { response, controller };

            const errorText = await response.text();
            if (response.status === 400 && attempt < 2) {
                const retry = { ...body };
                let changed = false;
                if ('temperature' in retry && /temperature/i.test(errorText)) {
                    delete retry.temperature;
                    changed = true;
                }
                if ('output_config' in retry && /output_config|effort/i.test(errorText)) {
                    delete retry.output_config;
                    changed = true;
                }
                if (changed) {
                    body = retry;
                    continue;
                }
            }
            throw new Error(`Anthropic API error: ${effectiveStatus(response.status, errorText)} ${errorText}`);
        }
    }

    async *generateStream(
        systemPrompt: string,
        userMessage: string,
        config: AIProviderConfig,
        tools?: any[],
        externalSignal?: AbortSignal,
        images?: string[]
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
        let promptTokens = 0;
        let completionTokens = 0;
        let streamEnded = false;
        let stopReason: string | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const cleanups: Array<() => void> = [];
        // Tool calls arrive as JSON fragments per content block; they are handed on whole when their block closes
        const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

        try {
            const endpoint = this.getEndpoint(config);
            const apiKey = this.getApiKey(config);
            const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, true, tools, images);
            const { response, controller } = await this.post(endpoint, apiKey, requestBody, config, timeout, externalSignal, cleanups);

            if (!response.body) {
                throw new Error('No response body');
            }

            // Per-chunk idle timeout
            idleTimer = setTimeout(() => controller.abort(), timeout);
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => controller.abort(), timeout);

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (data === '') continue;

                    let event: any;
                    try {
                        event = JSON.parse(data);
                    } catch (e) {
                        // Skip invalid JSON lines
                        continue;
                    }

                    switch (event.type) {
                        case 'message_start': {
                            const prompt = promptTokensOf(event.message?.usage);
                            if (prompt !== undefined) promptTokens = prompt;
                            break;
                        }
                        case 'content_block_start': {
                            const block: ClaudeContentBlock | undefined = event.content_block;
                            if (block?.type === 'tool_use') {
                                toolBlocks.set(event.index, { id: block.id || '', name: block.name || '', json: '' });
                            }
                            break;
                        }
                        case 'content_block_delta': {
                            const delta = event.delta;
                            if (delta?.type === 'text_delta' && delta.text) {
                                // Event-loop yield so the frontend can render each token before the next arrives
                                yield { content: delta.text, done: false };
                                await new Promise((resolve) => setTimeout(resolve, 0));
                            } else if (delta?.type === 'input_json_delta') {
                                const block = toolBlocks.get(event.index);
                                if (block) block.json += delta.partial_json || '';
                            }
                            break;
                        }
                        case 'content_block_stop': {
                            const block = toolBlocks.get(event.index);
                            if (block) {
                                toolBlocks.delete(event.index);
                                const call: ToolCall = { id: block.id, name: block.name, arguments: block.json || '{}' };
                                yield { content: '', done: false, toolCalls: [call] };
                            }
                            break;
                        }
                        case 'message_delta': {
                            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
                            const prompt = promptTokensOf(event.usage);
                            if (prompt !== undefined) promptTokens = prompt;
                            if (typeof event.usage?.output_tokens === 'number') completionTokens = event.usage.output_tokens;
                            break;
                        }
                        case 'message_stop':
                            streamEnded = true;
                            break;
                        case 'error': {
                            const status = STREAM_ERROR_STATUS[event.error?.type] ?? 500;
                            throw new Error(`Anthropic API error: ${status} ${event.error?.message || ''}`);
                        }
                        default:
                            // ping and event types added later
                            break;
                    }
                }

                if (streamEnded) break;
            }

            const refused = stopReason === 'refusal';
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed: promptTokens + completionTokens,
                    promptTokens,
                    completionTokens,
                    latency: Date.now() - startTime,
                    error: !streamEnded || refused,
                    // A refusal is Claude's answer to one message, not a problem with the key, so it is a 400 (not counted against the key)
                    ...(refused ? { errorStatus: 400 } : {}),
                    truncated: stopReason === 'max_tokens',
                },
            };
        } catch (error: any) {
            // An external cancellation (stop/correction or quick-call deadline)
            // is not a provider failure — don't publish an error for it.
            const externallyCancelled = externalSignal?.aborted === true;
            yield {
                content: '',
                done: true,
                metadata: {
                    tokensUsed: 0,
                    latency: Date.now() - startTime,
                    error: !externallyCancelled,
                    errorStatus: statusFromError(error),
                },
            };
        } finally {
            clearTimeout(idleTimer);
            cleanups.forEach((cleanup) => cleanup());
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

        return Sentry.startSpan(
            {
                op: 'gen_ai.chat',
                name: `LLM ${config.model}`,
                attributes: {
                    'gen_ai.request.model': config.model,
                    'gen_ai.system': 'anthropic',
                    'gen_ai.agent.name': config.name || '',
                },
            },
            async (span) => {
                const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
                const cleanups: Array<() => void> = [];
                try {
                    const endpoint = this.getEndpoint(config);
                    const apiKey = this.getApiKey(config);
                    const requestBody = this.buildRequestBody(systemPrompt, userMessage, config, false, tools, images);
                    const { response } = await this.post(endpoint, apiKey, requestBody, config, timeout, externalSignal, cleanups);

                    const data = (await response.json()) as {
                        content?: ClaudeContentBlock[];
                        stop_reason?: string;
                        usage?: ClaudeUsage;
                        model?: string;
                    };
                    const content = (data.content || [])
                        .filter((block) => block.type === 'text' && block.text)
                        .map((block) => block.text)
                        .join('');
                    const promptTokens = promptTokensOf(data.usage) || 0;
                    const completionTokens = data.usage?.output_tokens || 0;

                    span.setAttribute('gen_ai.response.model', data.model || config.model);
                    span.setAttribute('gen_ai.usage.input_tokens', promptTokens);
                    span.setAttribute('gen_ai.usage.output_tokens', completionTokens);
                    span.setAttribute('gen_ai.agent.name', config.name || '');

                    return {
                        content,
                        tokensUsed: promptTokens + completionTokens,
                        latency: Date.now() - startTime,
                        error: false,
                        truncated: data.stop_reason === 'max_tokens',
                    };
                } catch (error: any) {
                    span.setStatus({ code: 2, message: error.message || 'Unknown error' });

                    // External cancellation is not a provider failure — propagate it so callers treat it as a clean stop
                    if (externalSignal?.aborted) {
                        throw error;
                    }
                    if (error.name === 'AbortError') {
                        throw new Error(`Anthropic request timeout after ${timeout}ms`);
                    }
                    if (process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.error('[AnthropicProvider] Generate error:', error);
                    }
                    return {
                        content: '',
                        tokensUsed: 0,
                        latency: Date.now() - startTime,
                        error: true,
                    };
                } finally {
                    cleanups.forEach((cleanup) => cleanup());
                }
            }
        );
    }
}
