/**
 * What a voice bot says for a reply it wrote (#1665): the same words, with markup and the things that stay in the chat
 * left out, and no more than the limit.
 */
import { describe, expect, it } from 'vitest';
import { SPOKEN_PHRASES, spokenVersion } from '../voice/SpokenText';

const LIMIT = 600;

describe('a plain reply', () => {
    it('is said as it is written', () => {
        expect(spokenVersion('Hi! What should we build?', LIMIT)).toBe('Hi! What should we build?');
        expect(spokenVersion('Sorry, I could not save it.', LIMIT)).toBe('Sorry, I could not save it.');
    });

    it('keeps its words in any language', () => {
        expect(spokenVersion('مرحبا، كيف أساعدك؟', LIMIT)).toBe('مرحبا، كيف أساعدك؟');
    });

    it('says nothing when there is nothing to say', () => {
        expect(spokenVersion('', LIMIT)).toBe('');
        expect(spokenVersion('  \n ', LIMIT)).toBe('');
        expect(spokenVersion('...', LIMIT)).toBe('');
    });
});

describe('markup', () => {
    it('is not read out', () => {
        expect(spokenVersion('# Plan\n\nI will do **two** things:\n- read the file\n- write _a note_ in `notes.md`\n1. then stop', LIMIT)).toBe(
            'Plan I will do two things: read the file write a note in notes.md then stop'
        );
    });

    it('keeps the words of a link and leaves its address to the chat', () => {
        expect(spokenVersion('See [the board](https://example.test/board/1) for the details.', LIMIT)).toBe('See the board for the details.');
        expect(spokenVersion('The board is at https://example.test/board/1', LIMIT)).toBe(`The board is at ${SPOKEN_PHRASES.linkInSentence}`);
    });

    it('lets a sentence go on around a web address, and says the short line when the address stands alone', () => {
        expect(spokenVersion('The booking page is https://example.test/rooms and it opens at 9.', LIMIT)).toBe(
            `The booking page is ${SPOKEN_PHRASES.linkInSentence} and it opens at 9.`
        );
        expect(spokenVersion('See https://example.test/rooms. It opens at 9.', LIMIT)).toBe(
            `See ${SPOKEN_PHRASES.linkInSentence}. It opens at 9.`
        );
        expect(spokenVersion('Here it is:\nhttps://example.test/rooms', LIMIT)).toBe(`Here it is: ${SPOKEN_PHRASES.link}`);
        expect(spokenVersion('https://example.test/rooms', LIMIT)).toBe(SPOKEN_PHRASES.link);
    });
});

describe('tables, code and links stay in the chat', () => {
    it('says a short line where a table was', () => {
        const reply = 'Here is the week:\n\n| Day | Done |\n| --- | --- |\n| Mon | 3 |\n| Tue | 5 |\n\nBusiest was Tuesday.';
        expect(spokenVersion(reply, LIMIT)).toBe(`Here is the week: ${SPOKEN_PHRASES.table} Busiest was Tuesday.`);
    });

    it('says a short line where code was, closed or not', () => {
        expect(spokenVersion('Try this:\n```js\nconsole.log(1)\n```\nThen reload.', LIMIT)).toBe(`Try this: ${SPOKEN_PHRASES.code} Then reload.`);
        expect(spokenVersion('Try this:\n```js\nconsole.log(1)', LIMIT)).toBe(`Try this: ${SPOKEN_PHRASES.code}`);
    });

    it('says it once for the same kind in a row, and a reply that is only code is only that line', () => {
        expect(spokenVersion('```a```\n```b```', LIMIT)).toBe(SPOKEN_PHRASES.code);
        expect(spokenVersion('| a | b |\n| --- | --- |\n| 1 | 2 |', LIMIT)).toBe(SPOKEN_PHRASES.table);
    });
});

describe('the limit', () => {
    const sentence = 'This is one sentence of about forty characters. ';

    it('keeps whole sentences, then says where the rest is, all within the limit', () => {
        const long = sentence.repeat(30).trim();
        const spoken = spokenVersion(long, LIMIT);
        expect(spoken.length).toBeLessThanOrEqual(LIMIT);
        expect(spoken.endsWith(` ${SPOKEN_PHRASES.rest}`)).toBe(true);
        expect(spoken.slice(0, -SPOKEN_PHRASES.rest.length - 1).trim().endsWith('.')).toBe(true);
        expect(long.startsWith(spoken.slice(0, -SPOKEN_PHRASES.rest.length - 1))).toBe(true);
    });

    it('is exactly as long as the limit allows, and not shortened at it', () => {
        const exact = 'a'.repeat(LIMIT);
        expect(spokenVersion(exact, LIMIT)).toBe(exact);
        expect(spokenVersion(`${exact}b`, LIMIT)).toBe(SPOKEN_PHRASES.rest);
    });

    it('cuts at a word when there is no sentence to end on', () => {
        const spoken = spokenVersion('word '.repeat(300).trim(), LIMIT);
        expect(spoken.length).toBeLessThanOrEqual(LIMIT);
        expect(spoken.endsWith(SPOKEN_PHRASES.rest)).toBe(true);
        expect(spoken).not.toMatch(/wor [A-Z]/);
    });

    it('follows the limit it is given', () => {
        const spoken = spokenVersion(sentence.repeat(10).trim(), 120);
        expect(spoken.length).toBeLessThanOrEqual(120);
        expect(spoken.endsWith(SPOKEN_PHRASES.rest)).toBe(true);
    });
});
