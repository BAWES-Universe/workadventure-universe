/**
 * Anthropic (Claude) Provider Implementation
 *
 * Claude speaks its own format, not the OpenAI one:
 *   - the key goes in `x-api-key` (with an `anthropic-version`), not `Authorization: Bearer`
 *   - the system prompt is a top-level `system` field
 *   - tools are `{name, description, input_schema}` and come back as `tool_use` blocks
 *   - images are `{type: 'image', source: {type: 'url', url}}` blocks
 *   - a stream is SSE events (`content_block_delta`, `message_delta`, ...), not `choices[0].delta`
 *   - caching is explicit: a block carrying `cache_control` marks the end of a prefix Claude keeps for 5 minutes, and a
 *     second reply that starts with the same prefix reads it back at a tenth of the price (see `cacheMarks`)
 * Endpoint: https://api.anthropic.com/v1/messages (default). The caller keeps handing us OpenAI-shaped tool definitions and
 * expects `{id, name, arguments}` tool calls back, so this file does that translation and nothing else changes upstream.
 */

import type { AIProvider } from '../AIProvider';
import type { AIProviderConfig, AIStreamChunk, AIResponse, ToolCall } from '../types';
import { decryptApiKey } from '../encryption';
import { fetchFor, providerErrorText, statusFromError } from './ownKeyHttp';
import { statedOutputCeiling } from './OpenAIProvider';
import { linkExternalAbort } from './abortUtils';
import { withStepsAsText, type ReplySteps } from '../replySteps';
import { resolveVisionSupport } from './visionModels';
import * as Sentry from '@sentry/node';

const ANTHROPIC_VERSION = '2023-06-01';

/** The 5-minute cache only (never the 1-hour one: 91% of follow-up replies arrive within 5 minutes), and at most 4 markers. */
const CACHE_CONTROL = { type: 'ephemeral' } as const;
const MAX_CACHE_MARKS = 4;

/**
 * The smallest prefix, in tokens, Claude will cache. A marker below it is not an error: Claude just doesn't cache, and
 * the write premium is not charged either, but we send no marker we know cannot work. A model not listed here gets no
 * markers (unknown minimums are not worth a guess). Names are matched without a date suffix.
 */
const CACHE_MIN_TOKENS: Record<string, number> = {
    'claude-fable-5-1': 512, 'claude-mythos-5-1': 512, 'claude-opus-5-5': 512, 'claude-opus-5': 512,
    'claude-sonnet-5-5': 512, 'claude-fable-5': 512, 'claude-mythos-5': 512, 'claude-haiku-5-5': 512,
    'claude-opus-4-8': 1024, 'claude-sonnet-5': 1024, 'claude-sonnet-4-6': 1024, 'claude-sonnet-4-5': 1024,
    'claude-opus-4-1': 1024, 'claude-opus-4': 1024, 'claude-sonnet-4': 1024,
    'claude-mythos-preview': 2048, 'claude-opus-4-7': 2048, 'claude-haiku-3-5': 2048, 'claude-3-5-haiku': 2048,
    'claude-opus-4-6': 4096, 'claude-opus-4-5': 4096, 'claude-haiku-4-5': 4096,
};

function cacheMinimumTokens(model: string): number | undefined {
    return CACHE_MIN_TOKENS[(model || '').toLowerCase().replace(/-(?:\d{8}|latest)$/, '')];
}

/** Tokens in a piece of text, counted low on purpose (4 characters each; prompts run nearer 3), so a marker is only sent when the part really is big enough. */
function estimateTokens(text: string): number {
    return Math.floor(text.length / 4);
}

/** The offsets the caller gave, kept only when they are usable: whole numbers inside the prompt, rising. */
function usableEnds(ends: number[] | undefined, length: number): number[] {
    const kept: number[] = [];
    for (const end of ends ?? []) {
        if (Number.isInteger(end) && end > (kept[kept.length - 1] ?? 0) && end <= length) kept.push(end);
    }
    return kept;
}

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

/** Cache reads and writes of a reply: both are inside promptTokens (Claude reports them next to `input_tokens`, not in it). */
function cacheTokensOf(usage: ClaudeUsage | undefined): { read?: number; write?: number } {
    return {
        ...(typeof usage?.cache_read_input_tokens === 'number' ? { read: usage.cache_read_input_tokens } : {}),
        ...(typeof usage?.cache_creation_input_tokens === 'number' ? { write: usage.cache_creation_input_tokens } : {}),
    };
}

export class AnthropicProvider implements AIProvider {
    /** The output cap each model stated once it refused more (endpoint and model), so it is asked within it from then on: one failed request, not one per reply. */
    private static readonly outputCeilings = new Map<string, number>();

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

    /**
     * Claude takes tool names of 1-64 letters, digits, underscores and hyphens. A tool server may use dots or longer
     * names (the tool spec allows both), which Claude would refuse with a 400 that silences every reply. Each name
     * is sent in a safe form and turned back when Claude calls it. Names that are already fine stay as they are.
     */
    private toolNames(tools: any[] | undefined): Map<string, string> {
        const safeByOriginal = new Map<string, string>();
        const taken = new Set<string>();
        const names = (tools ?? []).map((tool) => (tool?.function ?? tool)?.name).filter((name): name is string => !!name);
        // Names that need no change keep their spelling first, so another tool's cleaned-up name can never take it
        for (const name of names) {
            if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
                safeByOriginal.set(name, name);
                taken.add(name);
            }
        }
        for (const name of names) {
            if (safeByOriginal.has(name)) continue;
            const base = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'tool';
            let safe = base.slice(0, 64);
            for (let n = 2; taken.has(safe); n++) safe = `${base}_${n}`;
            safeByOriginal.set(name, safe);
            taken.add(safe);
        }
        return safeByOriginal;
    }

    /** OpenAI-shaped tool definitions (what the whole bot server builds) in Claude's shape. */
    private convertTools(tools: any[]): Array<Record<string, unknown>> {
        const converted: Array<Record<string, unknown>> = [];
        const safeNames = this.toolNames(tools);
        for (const tool of tools) {
            const definition = tool?.function ?? tool;
            if (!definition?.name) continue;
            // Claude insists on an object schema. A tool server that leaves its schema out (the connector then passes
            // {}) or leaves out the type would otherwise be refused with a 400 that silences every reply.
            const schema = definition.parameters ?? definition.input_schema;
            const hasObjectSchema = schema && typeof schema === 'object' && !Array.isArray(schema);
            converted.push({
                name: safeNames.get(definition.name) ?? definition.name,
                description: definition.description || '',
                input_schema: hasObjectSchema ? { type: 'object', ...schema } : { type: 'object', properties: {} },
            });
        }
        return converted;
    }

    /**
     * Mark what repeats from one reply to the next, so a later reply reads it from Claude's cache. A request is read as
     * tools, then system, then messages, and a cached prefix is everything up to a marked block, so the order matters:
     *   1. the last tool (the tools are the same for every reply of a bot)
     *   2. each end the caller named in the system prompt (the instructions, the room): the part that stays put
     * A marker goes on a part only when the prefix up to it reaches Claude's minimum size, and never more than 4. The
     * system prompt becomes blocks only when at least one block is marked; otherwise the request is exactly what it
     * was before caching (and the other providers never get here at all).
     */
    private cacheMarks(body: Record<string, any>, systemPrompt: string, config: AIProviderConfig): void {
        const minimum = cacheMinimumTokens(config.model);
        if (!minimum) return;

        let marks = 0;
        let prefix = 0; // estimated tokens in front of the next candidate
        if (Array.isArray(body.tools) && body.tools.length > 0) {
            prefix = estimateTokens(JSON.stringify(body.tools));
            if (prefix >= minimum) {
                body.tools[body.tools.length - 1].cache_control = CACHE_CONTROL;
                marks++;
            }
        }

        const ends = usableEnds(config.promptCacheEnds, systemPrompt.length);
        if (ends.length === 0) return;
        const blocks: Array<Record<string, unknown>> = [];
        let from = 0;
        for (const end of ends) {
            const text = systemPrompt.slice(from, end);
            from = end;
            const block: Record<string, unknown> = { type: 'text', text };
            prefix += estimateTokens(text);
            if (prefix >= minimum && marks < MAX_CACHE_MARKS) {
                block.cache_control = CACHE_CONTROL;
                marks++;
            }
            blocks.push(block);
        }
        // What follows the fixed part changes with every reply: it is never marked
        if (from < systemPrompt.length) blocks.push({ type: 'text', text: systemPrompt.slice(from) });
        if (blocks.some((block) => block.cache_control)) body.system = blocks;
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

        this.cacheMarks(body, systemPrompt, config);

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
        const ceilingKey = `${endpoint} ${config.model}`;
        const known = AnthropicProvider.outputCeilings.get(ceilingKey);
        let body = known !== undefined && requestBody.max_tokens > known ? { ...requestBody, max_tokens: known } : requestBody;
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
            if (response.status === 400 && attempt < 3) {
                const retry = { ...body };
                let changed = false;
                // Asked for more output than the model gives (Orbit's recommended 32,000 is above older models): ask again within its cap
                const ceiling = statedOutputCeiling(400, errorText, retry.max_tokens);
                if (ceiling) {
                    if (ceiling.lasting) AnthropicProvider.outputCeilings.set(ceilingKey, ceiling.tokens);
                    retry.max_tokens = ceiling.tokens;
                    changed = true;
                }
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
        images?: string[],
        steps?: ReplySteps
    ): AsyncGenerator<AIStreamChunk> {
        const startTime = Date.now();
        const timeout = config.settings?.timeout || this.DEFAULT_TIMEOUT;
        let promptTokens = 0;
        let completionTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
        let streamEnded = false;
        let stopReason: string | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const cleanups: Array<() => void> = [];
        // Tool calls arrive as JSON fragments per content block; they are handed on whole when their block closes
        const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
        // The names Claude was given, back to the names the tool servers know
        const originalNames = new Map<string, string>();
        for (const [original, safe] of this.toolNames(tools)) originalNames.set(safe, original);

        try {
            const endpoint = this.getEndpoint(config);
            const apiKey = this.getApiKey(config);
            // The reply's earlier steps go in as text after the message, so a later round still sees what the first ones found
            const requestBody = this.buildRequestBody(systemPrompt, withStepsAsText(userMessage, steps), config, true, tools, images);
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
                            const cache = cacheTokensOf(event.message?.usage);
                            cacheReadTokens = cache.read ?? cacheReadTokens;
                            cacheWriteTokens = cache.write ?? cacheWriteTokens;
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
                                const call: ToolCall = { id: block.id, name: originalNames.get(block.name) ?? block.name, arguments: block.json || '{}' };
                                yield { content: '', done: false, toolCalls: [call] };
                            }
                            break;
                        }
                        case 'message_delta': {
                            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
                            const prompt = promptTokensOf(event.usage);
                            if (prompt !== undefined) promptTokens = prompt;
                            const cache = cacheTokensOf(event.usage);
                            cacheReadTokens = cache.read ?? cacheReadTokens;
                            cacheWriteTokens = cache.write ?? cacheWriteTokens;
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
                    cacheReadTokens,
                    // The name the price ledger and the traces read (Claude's cache reads are inside promptTokens, like OpenAI's cached ones)
                    ...(cacheReadTokens > 0 ? { cachedPromptTokens: cacheReadTokens } : {}),
                    cacheWriteTokens,
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
                    ...(externallyCancelled ? { cancelled: true } : {}),
                    errorStatus: statusFromError(error),
                    ...(externallyCancelled ? {} : { errorText: providerErrorText(error) }),
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
                    // Sentry's input_tokens counts the cached ones too; the two cache figures are parts of it
                    const cache = cacheTokensOf(data.usage);
                    if (cache.read) span.setAttribute('gen_ai.usage.cache_read.input_tokens', cache.read);
                    if (cache.write) span.setAttribute('gen_ai.usage.cache_creation.input_tokens', cache.write);
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
