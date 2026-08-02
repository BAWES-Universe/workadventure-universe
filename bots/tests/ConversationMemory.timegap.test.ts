/**
 * Tests for ConversationMemory time-gap awareness (issue #268).
 *
 * Covers the recent-conversation timestamp rendering: multi-day gaps must
 * render as day-level deltas ("3 days ago") so the bot can acknowledge the
 * time gap instead of treating an old conversation as "just happened".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';

describe('ConversationMemory time-gap rendering', () => {
    const NOW = new Date('2026-07-06T12:00:00Z').getTime(); // Monday July 6

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function memoryWithMessage(secondsAgo: number): ConversationMemory {
        const mem = new ConversationMemory();
        // Directly seed a history entry at the desired age (addMessage uses
        // Date.now() which is frozen, so seed via a message then backdate).
        const botId = 'bot-1';
        const playerId = 1;
        mem.addMessage(botId, playerId, 'Old message', 'person', 'space');
        const m = (mem as any).getMemory(botId, playerId);
        m.conversationHistory[0].timestamp = NOW - secondsAgo * 1000;
        return mem;
    }

    it('renders a multi-day gap as days ago, not hours', () => {
        // Friday July 3 -> Monday July 6 = 3 days
        const mem = memoryWithMessage(3 * 86400);
        const ctx = mem.getConversationContext('bot-1', 1);
        expect(ctx).toContain('(3 days ago)');
        expect(ctx).not.toContain('(72 hours ago)');
    });

    it('still renders sub-day gaps in minutes/hours', () => {
        const mem = memoryWithMessage(30 * 60); // 30 minutes
        expect(mem.getConversationContext('bot-1', 1)).toContain('(30 minutes ago)');

        const mem2 = memoryWithMessage(5 * 3600); // 5 hours
        expect(mem2.getConversationContext('bot-1', 1)).toContain('(5 hours ago)');
    });

    it('renders a single day gap as 1 day ago', () => {
        const mem = memoryWithMessage(1 * 86400);
        expect(mem.getConversationContext('bot-1', 1)).toContain('(1 day ago)');
    });
});
