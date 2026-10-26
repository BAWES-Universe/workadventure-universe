/**
 * Tests for the system prompt layout (issue #1333, prompt caching stage 1).
 *
 * Providers cache by exact prefix, so everything shared between chats must
 * come first and everything that changes per person or per day must come last.
 * The date line (issue #268) must survive the reorder.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildTodayLine } from '../ai/systemPrompt';

const INSTRUCTIONS = 'You are Zed, a grumpy guard.';
const MAP = `\n\nCurrent Location Context (you are always here):\n- Universe: BAWES\n- World: Hub\n- Room: Lobby`;
const ALICE = 'Relationship: friends\nWhat you know about them: They mentioned they\'re hungry right now.\nRecent conversation:\nThey: "hi" (just now)';
const BOB = 'Relationship: new\nRecent conversation:\nThey: "yo" (2 minutes ago)';
const NOW = new Date('2026-10-24T11:30:00Z'); // Saturday

function commonPrefixLength(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
}

describe('buildSystemPrompt layout', () => {
    it('puts instructions, rules, location, memory and date in that order', () => {
        const p = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        const at = (s: string) => p.indexOf(s);
        expect(at(INSTRUCTIONS)).toBe(0);
        expect(at('**HOW TO BE HUMAN-LIKE AND REALISTIC:**')).toBeGreaterThan(at('**YOUR PERSONALITY:**'));
        expect(at('**HOW TO CONVERSE NATURALLY')).toBeGreaterThan(at('**HOW TO BE HUMAN-LIKE AND REALISTIC:**'));
        expect(at(MAP)).toBeGreaterThan(at('FINAL REMINDER - YOUR PERSONALITY'));
        expect(at('\n\nConversation Context:')).toBeGreaterThan(at(MAP));
        expect(at("**TODAY'S DATE:**")).toBeGreaterThan(at('\nRecent conversation:'));
        expect(at('**BEFORE YOU ANSWER:**')).toBeGreaterThan(at("**TODAY'S DATE:**"));
    });

    it('ends with the personality and emotion-block reminder, after the memory and the date', () => {
        const withMemory = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        const firstMessage = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: '', now: NOW });
        for (const p of [withMemory, firstMessage]) {
            expect(p.trimEnd().endsWith('end every reply with the [EMOTION_UPDATE] block exactly as described in the rules above.')).toBe(true);
            expect(p.indexOf('**BEFORE YOU ANSWER:**')).toBeGreaterThan(p.indexOf("**TODAY'S DATE:**"));
        }
    });

    it('shares everything down to the memory between two people in the same room', () => {
        const a = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        const b = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: BOB, now: NOW });
        const shared = commonPrefixLength(a, b);
        expect(shared).toBeGreaterThanOrEqual(a.indexOf('\n\nConversation Context:'));
        // The fixed rules (the bulk of the prompt) sit inside the shared part.
        expect(shared).toBeGreaterThan(a.indexOf('FINAL REMINDER - YOUR PERSONALITY'));
    });

    it('includes the rules on a first message with no memory, so the prefix matches later messages', () => {
        const first = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: '', now: NOW });
        const later = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        expect(first).toContain('**HOW TO BE HUMAN-LIKE AND REALISTIC:**');
        expect(commonPrefixLength(first, later)).toBeGreaterThanOrEqual(first.indexOf(MAP) + MAP.length);
    });

    it('a new day changes only the tail', () => {
        const day1 = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        const day2 = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: new Date('2026-10-25T09:00:00Z') });
        expect(commonPrefixLength(day1, day2)).toBeGreaterThanOrEqual(day1.indexOf("**TODAY'S DATE:**"));
    });

    it('falls back to a plain default without instructions, rules still present', () => {
        const p = buildSystemPrompt({ chatInstructions: '  ', now: NOW });
        expect(p.startsWith('You are a friendly bot.')).toBe(true);
        expect(p).toContain('**HOW TO CONVERSE NATURALLY');
        expect(p).not.toContain('**YOUR PERSONALITY:**');
    });

    it('keeps the direct-message rules inside the fixed part, so direct messages share a prefix too', () => {
        const a = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, channel: 'dm', now: NOW });
        const b = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: BOB, channel: 'dm', now: NOW });
        expect(a).toContain('**DIRECT MESSAGE (You are chatting by direct message, not on the map):**');
        expect(a).toContain('end that reply with [ROOM_CARD]');
        expect(a).toContain('attached to your reply automatically');
        expect(a).not.toContain('**LOCATION & SPACE QUESTIONS');
        expect(a).not.toContain('You have send_image, send_file');
        expect(a.indexOf('**DIRECT MESSAGE')).toBeLessThan(a.indexOf('FINAL REMINDER - YOUR PERSONALITY'));
        expect(commonPrefixLength(a, b)).toBeGreaterThanOrEqual(a.indexOf('\n\nConversation Context:'));
    });

    it('uses the map rules when no channel is given', () => {
        const p = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, now: NOW });
        expect(p).toBe(buildSystemPrompt({ chatInstructions: INSTRUCTIONS, mapContextInfo: MAP, conversationContext: ALICE, channel: 'world', now: NOW }));
        expect(p).toContain('**LOCATION & SPACE QUESTIONS');
        expect(p).not.toContain('**DIRECT MESSAGE');
    });

    it('words the memory rules so they hold with and without a memory section', () => {
        for (const conversationContext of [ALICE, '']) {
            const p = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, conversationContext, now: NOW });
            expect(p).toContain('If a "Conversation Context" section appears below, it is YOUR MEMORY');
            expect(p).toContain("you have not talked with this person before - don't invent shared history");
            expect(p).not.toContain('The context below is YOUR MEMORY');
            expect(p).not.toContain('The context above is YOUR MEMORY');
        }
    });
});

describe("today's date line (issue #268)", () => {
    it('gives the bot the weekday and full date', () => {
        const p = buildSystemPrompt({ chatInstructions: INSTRUCTIONS, conversationContext: ALICE, now: NOW });
        expect(p).toContain("**TODAY'S DATE:** Saturday, October 24, 2026");
    });

    it('uses UTC, so the date does not follow the host timezone near midnight', () => {
        expect(buildTodayLine(new Date('2026-10-24T23:59:00Z'))).toContain('Saturday, October 24, 2026');
        expect(buildTodayLine(new Date('2026-10-25T00:01:00Z'))).toContain('Sunday, October 25, 2026');
    });

    it('is present even when there is no memory and no location', () => {
        const p = buildSystemPrompt({ chatInstructions: '', now: NOW });
        expect(p).toContain("**TODAY'S DATE:**");
    });
});
