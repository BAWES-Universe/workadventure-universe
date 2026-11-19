/**
 * An answer from Orbit that came back after the Brick moved rooms (or changed hands) serves its one reply only: it never sets the
 * limits or the history window the next replies read.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ startSpanManual: vi.fn(), startInactiveSpan: vi.fn(), getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })), getActiveSpan: vi.fn(() => null), setConversationId: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/core', () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock('../ai/PostHogClient', () => ({ captureAiGeneration: vi.fn(), captureAiTrace: vi.fn(), flushPostHog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ai/encryption', () => ({ decryptApiKey: vi.fn(() => 'decrypted-key') }));
vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

import { AIService } from '../ai/AIService';

const answer = (messages: number) => ({
    providerId: 'deepseek-flash', name: 'DeepSeek', type: 'openai', enabled: true, endpoint: 'https://api.deepseek.com', apiKeyEncrypted: 'iv:tag:data', model: 'm',
    temperature: 0.7, maxTokens: 1000, supportsStreaming: true, supportsVision: null, visionModel: null, defaultVision: false, settings: {}, source: 'universe-ai',
    limits: { messages, files: false },
});

describe('an answer from Orbit that came back after the Brick moved', () => {
    const build = (onAsk: (service: AIService) => void, messages: number) => {
        const setHistoryWindow = vi.fn();
        const admin: any = { isConfigured: () => true, getBotAiCredentials: vi.fn(async () => (onAsk(service), answer(messages))) };
        const service: AIService = new AIService({ setHistoryWindow } as never, admin, 'http://admin.local');
        return { service, setHistoryWindow };
    };

    it('does not set the limits or the history window the next replies read', async () => {
        const { service, setHistoryWindow } = build((s) => s.noteRoomBrick('brick-1', { ownerUuid: 'u', ownerName: 'O', roomUrl: 'https://play.test/_/a/b/c.tmj' }), 7);
        const before = service.botLimitsFor('brick-1');
        const resolved = await service['resolveProvider']('universe-ai', 'brick-1');
        expect(resolved.resting).toBe(false);
        expect(service.botLimitsFor('brick-1')).toEqual(before);
        expect(setHistoryWindow).not.toHaveBeenCalled();
    });

    it('still sets them when nothing moved meanwhile', async () => {
        const { service, setHistoryWindow } = build(() => undefined, 7);
        await service['resolveProvider']('universe-ai', 'brick-1');
        expect(service.botLimitsFor('brick-1')).toMatchObject({ messages: 7 });
        expect(setHistoryWindow).toHaveBeenCalledWith('brick-1', 7);
    });
});
