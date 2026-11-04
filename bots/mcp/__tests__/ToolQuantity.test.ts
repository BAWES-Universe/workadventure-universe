/**
 * How many things a call makes, what a request has made so far, and the words of the card (game #1662, mock 5).
 */
import { describe, expect, it } from 'vitest';
import { batchWords, MakeCounts, quantityOf, unitNames } from '../ToolQuantity';

const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties });

describe('quantityOf', () => {
    it('reads a count the tool declares', () => {
        const s = schema({ prompt: { type: 'string' }, num_images: { type: 'integer' } });
        expect(quantityOf('generate', undefined, { prompt: 'a', num_images: 12 }, s)).toMatchObject({ known: true, count: 12, unit: 'images', names: { one: 'image', many: 'images' } });
    });

    it('reads a count sent as a string, and names one thing in the singular', () => {
        const s = schema({ n: { type: 'integer' } });
        expect(quantityOf('make_poster', undefined, { n: '1' }, s)).toMatchObject({ known: true, count: 1, unit: 'poster', names: { one: 'poster', many: 'posters' } });
    });

    it('uses the tool\'s own default when the count is left out', () => {
        const s = schema({ prompt: { type: 'string' }, n: { type: 'integer', default: 4 } });
        expect(quantityOf('generate_image', undefined, { prompt: 'a' }, s)).toMatchObject({ known: true, count: 4, unit: 'images' });
    });

    it('does not know when the count is left out and has no default', () => {
        const s = schema({ prompt: { type: 'string' }, n: { type: 'integer' } });
        expect(quantityOf('generate_image', undefined, { prompt: 'a' }, s)).toEqual({ known: false, unit: 'images' });
    });

    it('does not know when the tool declares nothing about how many', () => {
        expect(quantityOf('make_track', 'Make a track', { prompt: 'jazz' }, schema({ prompt: { type: 'string' } }))).toEqual({ known: false, unit: 'tracks' });
        expect(quantityOf('thing', undefined, {}, undefined)).toEqual({ known: false, unit: 'things' });
    });

    it('does not know when the count is not a whole number', () => {
        const s = schema({ n: { type: 'number' } });
        expect(quantityOf('generate_image', undefined, { n: 2.5 }, s).known).toBe(false);
        expect(quantityOf('generate_image', undefined, { n: -3 }, s).known).toBe(false);
        expect(quantityOf('generate_image', undefined, { n: 'many' }, s).known).toBe(false);
    });

    it('counts a list one thing for each entry', () => {
        const s = schema({ prompts: { type: 'array', items: { type: 'string' } } });
        expect(quantityOf('generate_images', undefined, { prompts: ['a', 'b', 'c'] }, s)).toMatchObject({ known: true, count: 3, unit: 'images' });
    });

    it('multiplies a list by the count and the variations of each', () => {
        const s = schema({ prompts: { type: 'array' }, n: { type: 'integer' }, variations: { type: 'integer' } });
        expect(quantityOf('generate_image', undefined, { prompts: ['a', 'b'], n: 2, variations: 3 }, s)).toMatchObject({ known: true, count: 12, unit: 'images', names: { one: 'image', many: 'images' } });
    });

    it('never reads a number out of the words of a prompt', () => {
        const s = schema({ prompt: { type: 'string' } });
        expect(quantityOf('generate_image', undefined, { prompt: 'make 50 posters' }, s).known).toBe(false);
    });

    it('names the things from the tool\'s title when its names do not say', () => {
        expect(unitNames('x', 'run', 'Create a logo')).toEqual({ one: 'logo', many: 'logos' });
        expect(unitNames(undefined, 'run')).toEqual({ one: 'thing', many: 'things' });
    });
});

describe('MakeCounts', () => {
    it('lets things through up to the limit and counts them', () => {
        const counts = new MakeCounts();
        expect(counts.reserve('k', 3, 5)).toEqual({ ok: true });
        expect(counts.reserve('k', 2, 5)).toEqual({ ok: true });
        expect(counts.reserve('k', 1, 5)).toEqual({ ok: false, soFar: 5 });
        expect(counts.soFar('k')).toBe(5);
    });

    it('does not count what did not fit', () => {
        const counts = new MakeCounts();
        expect(counts.reserve('k', 12, 5)).toEqual({ ok: false, soFar: 0 });
        expect(counts.soFar('k')).toBe(0);
    });

    it('finds room for only one of two calls started at the same moment', () => {
        const counts = new MakeCounts();
        const results = [counts.reserve('k', 4, 5), counts.reserve('k', 4, 5)];
        expect(results.filter((result) => result.ok)).toHaveLength(1);
    });

    it('takes back what proved not to be made', () => {
        const counts = new MakeCounts();
        counts.reserve('k', 5, 5);
        counts.release('k', 5);
        expect(counts.soFar('k')).toBe(0);
        counts.release('nobody', 3);
        expect(counts.soFar('nobody')).toBe(0);
    });

    it('starts again for a new request, and keeps requests apart', () => {
        const counts = new MakeCounts();
        counts.add('a', 5);
        counts.add('b', 2);
        counts.reset('a');
        expect(counts.soFar('a')).toBe(0);
        expect(counts.soFar('b')).toBe(2);
    });

    it('forgets what a request made after a long quiet', () => {
        let now = 0;
        const counts = new MakeCounts(() => now);
        counts.add('k', 5);
        now += 7 * 60 * 60_000;
        expect(counts.soFar('k')).toBe(0);
    });
});

describe('batchWords', () => {
    it('says the number in the title and offers one tap for all of them', () => {
        expect(batchWords({ kind: 'over', count: 12, unit: 'images', limit: 5 })).toEqual({ title: 'Make 12 images', approve: 'Make all 12', decline: "Don't make", lines: [] });
    });

    it('pauses part-way with how many were made and what the total would be', () => {
        const words = batchWords({ kind: 'part', count: 2, unit: 'images', limit: 5, soFar: 4, names: { one: 'image', many: 'images' } });
        expect(words).toMatchObject({ title: 'Make 2 more images', approve: 'Make 2 more', decline: 'Stop at 4' });
        expect(words.lines).toEqual([
            { label: 'So far', text: '4 images made for this request' },
            { label: 'With these', text: "6 images, more than the 5 this bot makes without asking" },
        ]);
    });

    it('asks every time for a tool that does not say how many', () => {
        const words = batchWords({ kind: 'unknown', toolTitle: 'Make a track', serverName: 'Suno' });
        expect(words).toMatchObject({ title: 'Make a track', approve: 'Make a track', decline: "Don't make" });
        expect(words.lines).toEqual([{ label: 'How many', text: "Suno doesn't say, so this bot asks every time" }]);
    });
});
