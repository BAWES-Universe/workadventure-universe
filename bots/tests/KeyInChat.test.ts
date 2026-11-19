import { describe, expect, it } from 'vitest';
import { holdsAKey, keyInChatReply } from '../matrix/KeyInChat';

describe('holdsAKey', () => {
    it.each([
        ['sk_', 'live_51Habcdefghijklmnop12345'].join(''),
        ['my key is sk_', 'test_abcdefghijklmnopqrstuvwx ok?'].join(''),
        ['pk_', 'live_abcdefghijklmnop'].join(''),
        ['sk-', 'proj-abcdefghijklmnopqrstuvwxyz0123'].join(''),
        ['gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789'].join(''),
        ['xo', 'xb-1234567890-abcdefghij'].join(''),
        ['AK', 'IAABCDEFGHIJKLMNOP'].join(''),
        'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    ])('catches %s', (words) => {
        expect(holdsAKey(words)).toBe(true);
    });

    it.each([
        'hello',
        'sk_live_ is how Example keys start',
        'what is a key?',
        'the sk-ill is good',
        'bearer of bad news',
        '',
    ])('lets %j through', (words) => {
        expect(holdsAKey(words)).toBe(false);
    });

    it('answers nothing for no words', () => {
        expect(holdsAKey(undefined)).toBe(false);
        expect(holdsAKey(null)).toBe(false);
    });
});

describe('keyInChatReply', () => {
    it('speaks every language the notes do, and never repeats a key', () => {
        for (const language of ['en', 'ar', 'ca', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pt', 'zh'] as const) {
            expect(keyInChatReply(language).length).toBeGreaterThan(10);
        }
    });

    it('says what the Brick did not keep, that the message is still in the chat, and to delete it and change the key, in every language', () => {
        const english = keyInChatReply('en');
        expect(english).toMatch(/didn't read it or keep it/);
        expect(english).toMatch(/still in this chat/);
        expect(english).toMatch(/delete it and change that key/);
        // It no longer says the key "isn't saved" as if nothing of it remained
        expect(english).not.toMatch(/isn't saved/);
        const seen = new Set<string>([english]);
        for (const language of ['ar', 'ca', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pt', 'zh'] as const) {
            const words = keyInChatReply(language);
            // Its own words, longer than the old notice, which only said it was not read or saved
            expect(seen.has(words)).toBe(false);
            seen.add(words);
            expect(words.length).toBeGreaterThan(80);
        }
    });
});
