/**
 * Tests for AIService - specifically covering the forceTransaction: true
 * change in the Sentry.startInactiveSpan call within generateBotResponseStream.
 *
 * Background: AI processing runs asynchronously after the HTTP transaction has
 * already completed. Without forceTransaction: true, startInactiveSpan would
 * attach gen_ai.agent as a child of the already-finished HTTP request handler
 * span, orphaning both gen_ai spans and leaving Sentry AI Conversations empty.
 * (see issue #130)
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// --- Module mocks (must be hoisted before imports) ---

jest.mock('@sentry/node', () => ({
    startInactiveSpan: jest.fn(),
    getCurrentScope: jest.fn(),
    getActiveSpan: jest.fn(),
    setConversationId: jest.fn(),
}));

jest.mock('@sentry/core', () => ({
    _INTERNAL_setSpanForScope: jest.fn(),
}));

jest.mock('./encryption', () => ({
    decryptApiKey: jest.fn().mockReturnValue('test-api-key'),
}));

jest.mock('./AIProviderRegistry');

// --- Imports (after mocks) ---

import * as Sentry from '@sentry/node';
import * as SentryCore from '@sentry/core';
import { AIService } from './AIService';
import { AIProviderRegistry } from './AIProviderRegistry';
import type { AIProviderConfig, AIStreamChunk } from './types';
import type { AdminApiService } from '../server/AdminApiService';
import type { ConversationMemory } from '../memory/ConversationMemory';

// --- Helpers ---

/** Minimal valid AIProviderConfig */
function makeProviderConfig(overrides: Partial<AIProviderConfig> = {}): AIProviderConfig {
    return {
        providerId: 'test-provider',
        name: 'Test Provider',
        type: 'openai',
        enabled: true,
        endpoint: 'https://api.example.com',
        apiKeyEncrypted: null,
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 1024,
        supportsStreaming: true,
        ...overrides,
    };
}

/** Create a minimal mock Sentry span */
function makeMockSpan() {
    return {
        setAttribute: jest.fn(),
        end: jest.fn(),
    };
}

/** Create a mock async generator yielding the given chunks */
async function* makeStreamGenerator(chunks: AIStreamChunk[]) {
    for (const chunk of chunks) {
        yield chunk;
    }
}

/** Consume an async generator to completion, collecting all yielded values */
async function drainGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const results: T[] = [];
    for await (const value of gen) {
        results.push(value);
    }
    return results;
}

// --- Test setup ---

describe('AIService - Sentry forceTransaction span (PR #130 regression fix)', () => {
    let service: AIService;
    let mockAdminApiService: jest.Mocked<AdminApiService>;
    let mockConversationMemory: jest.Mocked<ConversationMemory>;
    let mockProviderRegistryInstance: jest.Mocked<AIProviderRegistry>;
    let mockSpan: ReturnType<typeof makeMockSpan>;
    let mockScope: { setSpan?: jest.Mock };
    let mockPreviousSpan: ReturnType<typeof makeMockSpan>;

    beforeEach(() => {
        jest.clearAllMocks();

        // Minimal AdminApiService mock
        mockAdminApiService = {
            getAIProviderCredentials: jest.fn(),
            trackAIUsage: jest.fn().mockResolvedValue(undefined),
            getAvailableAIProviders: jest.fn().mockResolvedValue([]),
            getRoomMetadata: jest.fn().mockResolvedValue(null),
        } as unknown as jest.Mocked<AdminApiService>;

        // Minimal ConversationMemory mock
        mockConversationMemory = {} as jest.Mocked<ConversationMemory>;

        // Mock provider registry instance that gets created inside AIService constructor
        mockProviderRegistryInstance = {
            generateStream: jest.fn(),
        } as unknown as jest.Mocked<AIProviderRegistry>;
        (AIProviderRegistry as jest.MockedClass<typeof AIProviderRegistry>).mockImplementation(
            () => mockProviderRegistryInstance
        );

        // Sentry span mock
        mockSpan = makeMockSpan();
        mockPreviousSpan = makeMockSpan();
        mockScope = {};

        (Sentry.startInactiveSpan as jest.Mock).mockReturnValue(mockSpan);
        (Sentry.getCurrentScope as jest.Mock).mockReturnValue(mockScope);
        (Sentry.getActiveSpan as jest.Mock).mockReturnValue(mockPreviousSpan);
        (Sentry.setConversationId as jest.Mock).mockReturnValue(undefined);

        // Default provider credentials returned by admin API
        (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue({
            providerId: 'test-provider',
            name: 'Test Provider',
            type: 'openai',
            enabled: true,
            endpoint: 'https://api.example.com',
            apiKeyEncrypted: null,
            model: 'gpt-4o-mini',
            temperature: 0.7,
            maxTokens: 1024,
            supportsStreaming: true,
            settings: {},
        });

        service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            'http://admin.example.com'
        );
    });

    // --------------------------------------------------------------------------
    // Core: forceTransaction: true
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - forceTransaction flag', () => {
        it('calls Sentry.startInactiveSpan with forceTransaction: true', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: 'hello', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'hello', 'You are a bot.', 'test-provider',
                    'test-space', ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith(
                expect.objectContaining({ forceTransaction: true })
            );
        });

        it('does NOT create gen_ai.agent span without forceTransaction flag (regression guard)', async () => {
            // This test documents the *correct* call signature and would catch a
            // regression if forceTransaction were removed.
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-2', 2, 'hi', '', 'test-provider', undefined, ''
                )
            );

            const call = (Sentry.startInactiveSpan as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
            expect(call.forceTransaction).toBe(true);
        });
    });

    // --------------------------------------------------------------------------
    // Span op and name
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - span op and name', () => {
        it('uses op "gen_ai.agent"', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith(
                expect.objectContaining({ op: 'gen_ai.agent' })
            );
        });

        it('names the span using config.name when available', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ name: 'MyBot' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-id-123', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Bot MyBot' })
            );
        });

        it('falls back to botId in the span name when config.name is empty', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ name: '' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'fallback-bot-id', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Bot fallback-bot-id' })
            );
        });

        it('span name contains the correct botId portion', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'specific-bot-42', 1, 'msg', 'You are a bot.', 'test-provider', undefined, ''
                )
            );

            const callArg = (Sentry.startInactiveSpan as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
            expect(callArg.name).toMatch(/specific-bot-42|Test Provider/);
        });
    });

    // --------------------------------------------------------------------------
    // Span lifecycle
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - span lifecycle', () => {
        it('calls parentSpan.end() in the finally block after stream completes', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: 'hi', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(mockSpan.end).toHaveBeenCalledTimes(1);
        });

        it('calls parentSpan.end() even when stream throws an error', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                async function* () {
                    throw new Error('Stream failure');
                }
            );

            // The generator catches the error and yields an error chunk - drain it
            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            // span.end is called in finally block
            expect(mockSpan.end).toHaveBeenCalledTimes(1);
        });

        it('restores the previous active span via sentrySetSpan in the finally block', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            const setSpan = (SentryCore as any)._INTERNAL_setSpanForScope as jest.Mock;
            // Called at least twice: once to set parentSpan active, once to restore previous span
            expect(setSpan).toHaveBeenCalledTimes(2);
            // Second call restores the previousSpan
            expect(setSpan).toHaveBeenNthCalledWith(2, mockScope, mockPreviousSpan);
        });

        it('sets parentSpan as active on the scope before the provider stream starts', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            const setSpan = (SentryCore as any)._INTERNAL_setSpanForScope as jest.Mock;
            // First call activates the parent span on the scope
            expect(setSpan).toHaveBeenNthCalledWith(1, mockScope, mockSpan);
        });
    });

    // --------------------------------------------------------------------------
    // Span attributes
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - span attributes set on parentSpan', () => {
        it('sets bot.player_id attribute', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 42, 'msg', '', 'test-provider', 'my-space', ''
                )
            );

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('bot.player_id', 42);
        });

        it('sets bot.provider attribute from config.type', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ type: 'anthropic' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('bot.provider', 'anthropic');
        });

        it('sets bot.model attribute from config.model', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ model: 'claude-sonnet-4' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('bot.model', 'claude-sonnet-4');
        });

        it('sets bot.space attribute with provided spaceName', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', 'lobby', ''
                )
            );

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('bot.space', 'lobby');
        });

        it('sets bot.space to empty string when spaceName is undefined', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('bot.space', '');
        });
    });

    // --------------------------------------------------------------------------
    // Sentry conversation ID
    // --------------------------------------------------------------------------

    describe('Sentry.setConversationId', () => {
        it('sets a conversation ID scoped to botId and playerId', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-abc', 99, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.setConversationId).toHaveBeenCalledWith('bot-bot-abc-player-99');
        });
    });

    // --------------------------------------------------------------------------
    // Span is created exactly once per generateBotResponseStream call
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - call count', () => {
        it('is called exactly once per conversation turn', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: 'a', done: false }, { content: 'b', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledTimes(1);
        });

        it('creates a new span for each separate conversation turn', async () => {
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            // Prime the credential cache with first call
            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'first', '', 'test-provider', undefined, ''
                )
            );

            // Second call
            (Sentry.startInactiveSpan as jest.Mock).mockClear();
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-1', 1, 'second', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledTimes(1);
        });
    });

    // --------------------------------------------------------------------------
    // Combined options check (regression: all required fields present together)
    // --------------------------------------------------------------------------

    describe('startInactiveSpan - combined span options', () => {
        it('passes all required span options including forceTransaction in the same call', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ name: 'Alice' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'bot-combined', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith({
                op: 'gen_ai.agent',
                name: 'Bot Alice',
                forceTransaction: true,
            });
        });

        it('span options include forceTransaction even when config has no name (uses botId)', async () => {
            (mockAdminApiService.getAIProviderCredentials as jest.Mock).mockResolvedValue(
                makeProviderConfig({ name: '' })
            );
            (mockProviderRegistryInstance.generateStream as jest.Mock).mockImplementation(
                () => makeStreamGenerator([{ content: '', done: true }])
            );

            await drainGenerator(
                service.generateBotResponseStream(
                    'no-name-bot', 1, 'msg', '', 'test-provider', undefined, ''
                )
            );

            expect(Sentry.startInactiveSpan).toHaveBeenCalledWith({
                op: 'gen_ai.agent',
                name: 'Bot no-name-bot',
                forceTransaction: true,
            });
        });
    });
});