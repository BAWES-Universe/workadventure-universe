import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderRegistry } from '../ai/AIProviderRegistry';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider';
import { LMStudioProvider } from '../ai/providers/LMStudioProvider';
import type { AIStreamChunk, AIProviderConfig } from '../ai/types';

vi.mock('../ai/encryption', () => ({ decryptApiKey: () => 'test-key' }));
afterEach(() => vi.unstubAllGlobals());

describe('provider behaviour without bot setting changes', () => {
    it.each([
        {
            type: 'openai' as const,
            model: 'deepseek-v4-flash',
            endpoint: 'https://api.deepseek.com/v1',
            Provider: OpenAIProvider,
            url: 'https://api.deepseek.com/v1/chat/completions',
        },
        {
            type: 'lmstudio' as const,
            model: 'local-model',
            endpoint: 'http://localhost:1234',
            Provider: LMStudioProvider,
            url: 'http://localhost:1234/v1/chat/completions',
        },
    ])('keeps $type routing, model, tools and streamed text', async ({ type, model, endpoint, Provider, url }) => {
        const config: AIProviderConfig = {
            providerId: type,
            name: type,
            type,
            enabled: true,
            model,
            endpoint,
            apiKeyEncrypted: 'test-encrypted-key',
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        };
        const original = structuredClone(config);
        const registry = new AIProviderRegistry();
        const provider = registry.getOrCreateProvider(config);
        expect(provider).toBeInstanceOf(Provider);
        expect(registry.getOrCreateProvider(config)).toBe(provider);
        const tools = [
            {
                type: 'function',
                function: { name: 'get_areas', description: 'Areas', parameters: { type: 'object', properties: {} } },
            },
        ];
        const sse =
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}],"usage":{"total_tokens":3,"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const chunks: AIStreamChunk[] = [];
        for await (const chunk of registry.generateStream(type, 'Be helpful', 'Hi', config, tools)) chunks.push(chunk);
        expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST' }));
        const request = fetchMock.mock.calls[0][1];
        if (!request || typeof request.body !== 'string') throw new Error('Missing JSON request body');
        expect(JSON.parse(request.body) as unknown).toMatchObject({
            model,
            tools,
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 512,
            stream: true,
        });
        expect(new Headers(request.headers).get('Authorization')).toBe(type === 'openai' ? 'Bearer test-key' : null);
        expect(chunks.map((chunk) => chunk.content).join('')).toContain('Hello');
        expect(chunks[chunks.length - 1]?.done).toBe(true);
        expect(config).toEqual(original);
    });
});
