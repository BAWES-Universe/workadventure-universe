/**
 * A reply's steps as each provider sends them (#1508): after the person's message, as the chat messages the API knows,
 * with a thinking model's reasoning handed back, and a call turned down for length told apart from other failures.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider';
import { LMStudioProvider } from '../ai/providers/LMStudioProvider';
import { AIProviderRegistry } from '../ai/AIProviderRegistry';
import { stepOf, type ReplySteps } from '../ai/replySteps';
import type { AIProviderConfig } from '../ai/types';

vi.mock('../ai/encryption', () => ({ decryptApiKey: vi.fn(() => 'key') }));

const config = (over: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
    providerId: 'p',
    name: 'Test',
    type: 'openai',
    enabled: true,
    endpoint: 'https://api.deepseek.com',
    apiKeyEncrypted: 'iv:tag:data',
    model: 'deepseek-v4-flash',
    temperature: 0.7,
    maxTokens: 512,
    supportsStreaming: true,
    settings: {},
    ...over,
});

const steps: ReplySteps = {
    steps: [
        stepOf(1, 'Let me look.', [{ id: 'call_a', name: 'get_areas_on_map', arguments: '{}' }], [{ id: 'call_a', name: 'get_areas_on_map', text: 'get_areas_on_map: Library' }], 'They want the areas.'),
    ],
    after: 'Carry on.',
};

function sse(lines: object[]): ReadableStream<Uint8Array> {
    const text = lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
}

function answers(lines: object[]) {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, body: sse(lines), text: async () => '' }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

function refuses(status: number, text: string) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, body: null, text: async () => text })));
}

const sent = (fetch: ReturnType<typeof answers>) => JSON.parse(((fetch.mock.calls[0] as unknown[])[1] as { body: string }).body);

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OpenAI-shaped providers (OpenAI, DeepSeek, OpenRouter)', () => {
    it("send the steps after the person's message, with the reasoning a thinking model gave", async () => {
        const fetch = answers([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
        await drain(new OpenAIProvider().generateStream('system', 'where can I read?', config(), [], undefined, undefined, steps));
        expect(sent(fetch).messages).toEqual([
            { role: 'system', content: 'system' },
            { role: 'user', content: 'where can I read?' },
            {
                role: 'assistant',
                content: 'Let me look.',
                tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'get_areas_on_map', arguments: '{}' } }],
                reasoning_content: 'They want the areas.',
            },
            { role: 'tool', tool_call_id: 'call_a', content: 'get_areas_on_map: Library' },
            { role: 'user', content: 'Carry on.' },
        ]);
    });

    it('send only the two messages without steps, as before', async () => {
        const fetch = answers([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
        await drain(new OpenAIProvider().generateStream('system', 'hi', config()));
        expect(sent(fetch).messages).toEqual([
            { role: 'system', content: 'system' },
            { role: 'user', content: 'hi' },
        ]);
    });

    it("keep a thinking model's reasoning for the next step, never as what it says", async () => {
        answers([
            { choices: [{ delta: { reasoning_content: 'They want ' } }] },
            { choices: [{ delta: { reasoning_content: 'the areas.' } }] },
            { choices: [{ delta: { content: 'Here.' }, finish_reason: 'stop' }] },
        ]);
        const chunks = await drain(new OpenAIProvider().generateStream('system', 'hi', config()));
        expect(chunks.map((chunk) => chunk.content).join('')).toBe('Here.');
        expect(chunks.at(-1)).toMatchObject({ done: true, reasoning: 'They want the areas.' });
    });

    it('say when the call was turned down as longer than the model takes', async () => {
        refuses(400, `{"error":{"message":"This model's maximum context length is 8192 tokens. However, your messages resulted in 9100 tokens."}}`);
        const chunks = await drain(new OpenAIProvider().generateStream('system', 'hi', config(), [], undefined, undefined, steps));
        expect(chunks.at(-1)?.metadata).toMatchObject({ error: true, tooLong: true, errorStatus: 400, context: { limit: 8192, asked: 9100 } });
        refuses(401, '{"error":{"message":"Invalid API key"}}');
        const rejected = await drain(new OpenAIProvider().generateStream('system', 'hi', config()));
        expect(rejected.at(-1)?.metadata).not.toHaveProperty('tooLong');
    });
});

describe('LM Studio', () => {
    const lmstudio = config({ type: 'lmstudio', endpoint: 'http://localhost:1234', apiKeyEncrypted: null, model: 'qwen3-8b' });

    it('sends the steps as chat messages, without reasoning', async () => {
        const fetch = answers([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
        await drain(new LMStudioProvider().generateStream('system', 'where can I read?', lmstudio, [], undefined, undefined, steps));
        const messages = sent(fetch).messages;
        expect(messages.slice(2)).toEqual([
            { role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'get_areas_on_map', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'call_a', content: 'get_areas_on_map: Library' },
            { role: 'user', content: 'Carry on.' },
        ]);
    });

    it('says when a small model turns the steps down for its context length', async () => {
        refuses(400, '{"error":"The number of tokens to keep from the initial prompt is greater than the context length."}');
        const chunks = await drain(new LMStudioProvider().generateStream('system', 'hi', lmstudio, [], undefined, undefined, steps));
        expect(chunks.at(-1)?.metadata).toMatchObject({ error: true, tooLong: true });
    });
});

describe('a provider without streaming', () => {
    it('gets the steps as text in its one message', async () => {
        const generate = vi.fn(async () => ({ content: 'ok', tokensUsed: 1, latency: 1, error: false, truncated: false }));
        const registry = new AIProviderRegistry();
        vi.spyOn(registry as any, 'getOrCreateProvider').mockReturnValue({ isReady: () => true, supportsStreaming: () => false, generate });
        await drain(registry.generateStream('p', 'system', 'where can I read?', config(), [], undefined, undefined, steps));
        expect((generate.mock.calls[0] as unknown[])[1]).toBe('where can I read?\n\n=== Step 1 ===\nget_areas_on_map: Library\n\nCarry on.');
    });
});
