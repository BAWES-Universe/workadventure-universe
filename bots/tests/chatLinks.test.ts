/**
 * Tests for chatLinks — finding the links people type in chat, with or without https://.
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeLink, extractChatLinks, normalizeWebUrl } from '../utils/chatLinks';

describe('extractChatLinks', () => {
    it('keeps full URLs as before, trailing punctuation removed', () => {
        expect(extractChatLinks('see https://example.com/a?b=1, and https://x.org/y.', 10)).toEqual([
            'https://example.com/a?b=1',
            'https://x.org/y',
        ]);
    });

    it('finds bare site names and adds https://', () => {
        expect(extractChatLinks('check out bawes.net!', 10)).toEqual(['https://bawes.net']);
        expect(extractChatLinks('pricing is on www.example.com/pricing.', 10)).toEqual([
            'https://www.example.com/pricing',
        ]);
        expect(extractChatLinks('try docs.bawes.kw', 10)).toEqual(['https://docs.bawes.kw']);
        expect(extractChatLinks('try areyou.online or bawes.live', 10)).toEqual([
            'https://areyou.online',
            'https://bawes.live',
        ]);
    });

    it('does not treat file names, code, e-mails or words as sites', () => {
        expect(extractChatLinks('edit index.ts and node.js, see readme.md', 10)).toEqual([]);
        expect(extractChatLinks('mail me at khalid@bawes.net', 10)).toEqual([]);
        expect(extractChatLinks('ok.so what now, tell.me', 10)).toEqual([]);
        expect(extractChatLinks('version 3.14 is out', 10)).toEqual([]);
    });

    it('does not count the host of a full URL twice', () => {
        expect(extractChatLinks('https://bawes.net/about and bawes.net', 10)).toEqual([
            'https://bawes.net/about',
            'https://bawes.net',
        ]);
        expect(extractChatLinks('https://bawes.net and bawes.net', 10)).toEqual(['https://bawes.net']);
    });

    it('keeps message order and the cap', () => {
        expect(extractChatLinks('a.com then https://b.com then c.io', 2)).toEqual([
            'https://a.com',
            'https://b.com',
        ]);
    });

    it('turns YouTube embed links into watch links', () => {
        expect(extractChatLinks('https://www.youtube.com/embed/kkJ7wWidnp8?feature=oembed', 10)).toEqual([
            'https://www.youtube.com/watch?v=kkJ7wWidnp8',
        ]);
    });
});

describe('canonicalizeLink', () => {
    it('leaves other links alone', () => {
        expect(canonicalizeLink('https://www.youtube.com/watch?v=abc123xyz')).toBe(
            'https://www.youtube.com/watch?v=abc123xyz'
        );
        expect(canonicalizeLink('https://example.com/embed/thing')).toBe('https://example.com/embed/thing');
    });
});

describe('normalizeWebUrl', () => {
    it('adds https:// to bare addresses', () => {
        expect(normalizeWebUrl('bawes.net')).toBe('https://bawes.net/');
        expect(normalizeWebUrl(' www.bawes.net/about ')).toBe('https://www.bawes.net/about');
        expect(normalizeWebUrl('http://bawes.net')).toBe('http://bawes.net/');
    });

    it('rejects what is not a web address', () => {
        expect(normalizeWebUrl('')).toBeNull();
        expect(normalizeWebUrl('localhost')).toBeNull();
        expect(normalizeWebUrl('ftp://bawes.net')).toBeNull();
        expect(normalizeWebUrl('javascript:alert(1)')).toBeNull();
    });
});
