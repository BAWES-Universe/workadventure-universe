/**
 * Tests for vision-description persistence in conversation memory (issue #384).
 *
 * Covers:
 *  - appendVisionDescription annotates the last person message
 *  - Multiple images/descriptions append without clobbering
 *  - No-op when there is no person message to annotate
 *  - PersistentMemory override triggers a debounced save (persistence mirror)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationMemory } from '../memory/ConversationMemory';
import { PersistentMemory } from '../memory/PersistentMemory';

describe('ConversationMemory.appendVisionDescription', () => {
    let mem: ConversationMemory;

    beforeEach(() => {
        mem = new ConversationMemory();
    });

    it('appends the description to the last person message', () => {
        mem.addMessage('bot-1', 1, 'what is this design?', 'person', 'space');
        mem.addMessage('bot-1', 1, 'Let me look at that for you.', 'bot', 'space');

        mem.appendVisionDescription('bot-1', 1, 'A landing page with a blue hero section');

        const history = (mem as any).getMemory('bot-1', 1).conversationHistory;
        expect(history[0].message).toContain('[Image description: A landing page with a blue hero section]');
        // The bot message must be untouched
        expect(history[1].message).toBe('Let me look at that for you.');
    });

    it('appends multiple descriptions without clobbering earlier ones', () => {
        mem.addMessage('bot-1', 1, 'check these two', 'person', 'space');
        mem.appendVisionDescription('bot-1', 1, 'first image: a cat');
        mem.appendVisionDescription('bot-1', 1, 'second image: a dog');

        const history = (mem as any).getMemory('bot-1', 1).conversationHistory;
        expect(history[0].message).toContain('[Image description: first image: a cat]');
        expect(history[0].message).toContain('[Image description: second image: a dog]');
    });

    it('is a no-op when there is no person message to annotate', () => {
        mem.addMessage('bot-1', 1, 'greeting from bot', 'bot', 'space');

        mem.appendVisionDescription('bot-1', 1, 'should not appear');

        const history = (mem as any).getMemory('bot-1', 1).conversationHistory;
        expect(history[0].message).not.toContain('should not appear');
        expect(history[0].message).toBe('greeting from bot');
    });

    it('annotates the most recent person message when bot replies interleave', () => {
        mem.addMessage('bot-1', 1, 'first question', 'person', 'space');
        mem.addMessage('bot-1', 1, 'first answer', 'bot', 'space');
        mem.addMessage('bot-1', 1, 'second question with image', 'person', 'space');

        mem.appendVisionDescription('bot-1', 1, 'a chart');

        const history = (mem as any).getMemory('bot-1', 1).conversationHistory;
        expect(history[2].message).toContain('[Image description: a chart]');
        expect(history[0].message).not.toContain('a chart');
    });
});

describe('PersistentMemory.appendVisionDescription', () => {
    it('persists via debounced save (scheduleDebouncedSave is exercised)', () => {
        const persistent = new PersistentMemory({
            maxHistorySize: 50,
            maxMemories: 1000,
            adminApiUrl: 'http://admin.test',
            adminApiToken: 'token',
            debounceInterval: 1000,
            immediateSaveEnabled: false,
        });
        const saveSpy = vi.spyOn(persistent as any, 'scheduleDebouncedSave');

        persistent.addMessage('bot-1', 1, 'what is this?', 'person', 'space');
        persistent.appendVisionDescription('bot-1', 1, 'a sunset photo');

        // Base annotation happened
        const history = (persistent as any).getMemory('bot-1', 1).conversationHistory;
        expect(history[0].message).toContain('[Image description: a sunset photo]');
        // Persistence mirror triggered
        expect(saveSpy).toHaveBeenCalledWith('bot-1', 1);
    });
});
