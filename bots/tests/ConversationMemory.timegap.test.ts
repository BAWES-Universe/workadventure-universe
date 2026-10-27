/**
 * Tests for ConversationMemory time-gap awareness (issues #268 and #1333).
 *
 * The recent-conversation lines carry the UTC date and time they were written,
 * not "N minutes ago". A line written once never changes, so the provider can
 * keep serving it from its prompt cache; the bot compares the dates with the
 * current time at the end of the prompt to see a multi-day gap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';

describe('ConversationMemory time rendering', () => {
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
        // addMessage uses Date.now() (frozen), so seed a message then backdate it.
        mem.addMessage('bot-1', 1, 'Old message', 'person', 'space');
        const m = (mem as any).getMemory('bot-1', 1);
        m.conversationHistory[0].timestamp = NOW - secondsAgo * 1000;
        return mem;
    }

    it('renders a multi-day gap with the date it happened, so the gap is visible', () => {
        // Friday July 3, 12:00 -> Monday July 6 = 3 days
        const ctx = memoryWithMessage(3 * 86400).getConversationContext('bot-1', 1);
        expect(ctx).toContain('They: "Old message" (Jul 3, 2026, 12:00)');
    });

    it('renders same-day messages with the clock time', () => {
        expect(memoryWithMessage(30 * 60).getConversationContext('bot-1', 1)).toContain('(Jul 6, 2026, 11:30)');
        expect(memoryWithMessage(5 * 3600).getConversationContext('bot-1', 1)).toContain('(Jul 6, 2026, 07:00)');
    });

    it('never says "ago" for a history line', () => {
        for (const secs of [10, 600, 7200, 2 * 86400]) {
            const ctx = memoryWithMessage(secs).getConversationContext('bot-1', 1);
            const line = ctx.split('\n').find((l) => l.startsWith('They: "Old message"'));
            expect(line).toBeDefined();
            expect(line).not.toMatch(/ago|just now/);
        }
    });

    it('renders a line identically however much later it is read (cacheable)', () => {
        const mem = memoryWithMessage(10 * 60);
        const first = mem.getConversationContext('bot-1', 1);
        vi.setSystemTime(NOW + 3 * 60_000);
        const later = mem.getConversationContext('bot-1', 1);
        const historyOf = (c: string) => c.slice(c.indexOf('Recent conversation:'));
        expect(historyOf(later)).toBe(historyOf(first));
    });

    it('keeps midnight as 00:xx, not 24:xx', () => {
        const mem = new ConversationMemory();
        mem.addMessage('bot-1', 1, 'late', 'person', 'space');
        const m = (mem as any).getMemory('bot-1', 1);
        m.conversationHistory[0].timestamp = new Date('2026-07-06T00:05:00Z').getTime();
        expect(mem.getConversationContext('bot-1', 1)).toContain('(Jul 6, 2026, 00:05)');
    });
});

describe('ConversationMemory pending-media notice', () => {
    function memoryWithPending(pending: any[]): ConversationMemory {
        const mem = new ConversationMemory();
        mem.addMessage('bot-1', 1, 'hi', 'person', 'space');
        (mem as any).getMemory('bot-1', 1).pendingMedia = pending;
        return mem;
    }

    it('is a separate notice, not part of the memory context', () => {
        const mem = memoryWithPending([{ url: 'u', retryCount: 0 }]);
        expect(mem.getPendingMediaNotice('bot-1', 1)).toContain('1 media item(s)');
        expect(mem.getConversationContext('bot-1', 1)).not.toContain('media item');
    });

    it('is empty when nothing is deliverable', () => {
        expect(memoryWithPending([]).getPendingMediaNotice('bot-1', 1)).toBe('');
        expect(memoryWithPending([{ url: 'u', retryCount: 3 }]).getPendingMediaNotice('bot-1', 1)).toBe('');
        expect(new ConversationMemory().getPendingMediaNotice('nobody', 9)).toBe('');
    });
});
