import { describe, expect, it } from 'vitest';
import { KEY_REDACTED_FIELD, holdsAKey, holdsAKeyAnywhere, keyInChatReply, withoutKeys } from '../matrix/KeyInChat';

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

// CodeRabbit on #2114 (review of d098522a): what the durable inbox may keep
describe('withoutKeys: nothing that holds a key, in a value or in a name, and nothing unchecked, is kept', () => {
    const KEY = ['sk_', 'live_51Habcdefghijklmnop12345'].join('');
    const nested = (levels: number, leaf: unknown): unknown => {
        let value = leaf;
        for (let i = 0; i < levels; i++) value = { next: value };
        return value;
    };

    it('a property NAME that holds a key is left out with its value, and the content says one was there', () => {
        const clean = withoutKeys({ type: 'm.room.message', content: { body: 'hi', [KEY]: 'x', fine: { [`Bearer ${'a'.repeat(30)}`]: 1, ok: 2 } } }) as { content: Record<string, unknown> };
        const text = JSON.stringify(clean);
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('a'.repeat(30));
        expect(clean.content.body).toBe('hi');
        expect(clean.content.fine).toEqual({ ok: 2 });
        expect(clean.content[KEY_REDACTED_FIELD]).toBe(true);
    });

    it('ordinary property names are kept, and an event with no key is returned as it is', () => {
        const event = { type: 'm.room.message', content: { msgtype: 'm.text', body: 'hello', 'm.relates_to': { rel_type: 'x' } } };
        expect(withoutKeys(event)).toBe(event);
    });

    it('a name like __proto__ is data: it is kept as its own property and changes no prototype', () => {
        const event = JSON.parse('{"content":{"body":"hi","__proto__":{"polluted":true}}}');
        const clean = withoutKeys({ ...event, extra: KEY }) as { content: Record<string, unknown> };
        expect(Object.prototype.hasOwnProperty.call(clean.content, '__proto__')).toBe(true);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect((clean.content as { polluted?: unknown }).polluted).toBeUndefined();
    });

    it('a subtree below the depth limit is never kept unchecked: a key hidden down there does not reach the store, and a very deep event cannot blow the stack', () => {
        const deep = { type: 'm.room.message', content: { body: 'hi', extra: nested(20, `here: ${KEY}`) } };
        const clean = withoutKeys(deep);
        expect(JSON.stringify(clean)).not.toContain(KEY);
        // the rest of the event is as it was
        expect((clean as typeof deep).content.body).toBe('hi');
        // a deep subtree with no key in it is left out too (nothing deeper than the limit is kept), and the content is not marked as holding a key
        const quiet = withoutKeys({ type: 'm.room.message', content: { body: 'hi', extra: nested(20, 'plain') } }) as { content: Record<string, unknown> };
        expect(JSON.stringify(quiet)).not.toContain('plain');
        expect(quiet.content[KEY_REDACTED_FIELD]).toBeUndefined();
        // a nesting no real event has
        const huge = nested(100_000, KEY) as object;
        expect(() => withoutKeys({ content: { body: 'x', huge } })).not.toThrow();
        expect(JSON.stringify(withoutKeys({ content: { body: 'x', huge } }))).not.toContain(KEY);
    });

    // CodeRabbit on 27ab3385: the cut subtree is looked at (iteratively), so a key down there still sets the refusal mark
    it('a key below the depth limit sets the refusal mark; clean deep content does not; a key in a deep property NAME or very deep chain is found too', () => {
        const marked = withoutKeys({ type: 'm.room.message', content: { body: 'hi', extra: nested(20, `here: ${KEY}`) } }) as { content: Record<string, unknown> };
        expect(marked.content[KEY_REDACTED_FIELD]).toBe(true);
        expect(marked.content.body).toBe('hi');
        const named = withoutKeys({ type: 'm.room.message', content: { body: 'hi', extra: nested(20, { [KEY]: 1 }) } }) as { content: Record<string, unknown> };
        expect(named.content[KEY_REDACTED_FIELD]).toBe(true);
        const huge = withoutKeys({ type: 'm.room.message', content: { body: 'hi', huge: nested(100_000, KEY) } }) as { content: Record<string, unknown> };
        expect(huge.content[KEY_REDACTED_FIELD]).toBe(true);
        const quiet = withoutKeys({ type: 'm.room.message', content: { body: 'hi', extra: nested(20, 'plain') } }) as { content: Record<string, unknown> };
        expect(quiet.content[KEY_REDACTED_FIELD]).toBeUndefined();
        expect(holdsAKeyAnywhere(nested(50, KEY))).toBe(true);
        expect(holdsAKeyAnywhere(nested(50, 'plain'))).toBe(false);
        // a value too large to be looked at whole is refused (no real event is that large), never passed as clean
        expect(holdsAKeyAnywhere(new Array(250_000).fill(0))).toBe(true);
    });

    it('a list below the limit is cut the same way', () => {
        const list = (levels: number, leaf: unknown): unknown => (levels === 0 ? leaf : [list(levels - 1, leaf)]);
        const clean = withoutKeys({ content: { body: 'x', deep: list(20, KEY) } });
        expect(JSON.stringify(clean)).not.toContain(KEY);
    });
});
