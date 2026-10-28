/**
 * The steps line of a reply (#1545): plain words for each call, what it was about, how it ended, and the one-line summary.
 */
import { describe, expect, it } from 'vitest';
import { ReplySteps, describeStep, resultOf, showsAsStep, summaryOf, tidyName } from '../ai/ToolSteps';

describe('ToolSteps', () => {
    it('tidies a tool name into words when its server gave no title', () => {
        expect(tidyName('generate_music')).toBe('Generate music');
        expect(tidyName('generateMusic')).toBe('Generate music');
        expect(tidyName('list-imagines.v2')).toBe('List imagines v2');
        expect(tidyName('__')).toBe('Use a tool');
    });

    it("uses the tool server's own title, and the prompt as the detail", () => {
        expect(describeStep({ id: 'a', name: 'generate_music', arguments: '{"prompt":"upbeat  8-bit\\nfunk","seconds":90}' }, 'Make a song')).toEqual({
            id: 'a',
            doing: 'Make a song',
            done: 'Make a song',
            detail: 'upbeat 8-bit funk',
            group: 'tool:generate_music',
        });
    });

    it('never shows a private field, and cuts a long detail to one short line', () => {
        expect(describeStep({ id: 'a', name: 'search', arguments: { api_key: 'sk-1', token: 't' } }).detail).toBeUndefined();
        expect(describeStep({ id: 'a', name: 'send', arguments: { email: 'a@b.c', text: 'hi' } }).detail).toBe('hi');
        const long = describeStep({ id: 'a', name: 'search', arguments: { query: 'x'.repeat(200) } }).detail!;
        expect(Array.from(long)).toHaveLength(60);
        expect(long.endsWith('…')).toBe(true);
        // Others in the chat may see the detail: a link keeps only where it goes, and an email or a token-like value
        // is not shown at all
        expect(describeStep({ id: 'a', name: 'read_web_page', arguments: { url: 'https://me:pw@x.test/a/b?token=abc#top' } }).detail).toBe(
            'https://x.test/a/b'
        );
        expect(describeStep({ id: 'a', name: 'search', arguments: { query: 'invoices for sam@example.test' } }).detail).toBeUndefined();
        expect(describeStep({ id: 'a', name: 'search', arguments: { query: 'use sk_live_51HxYzAbCdEfGhIjKlMnOp' } }).detail).toBeUndefined();
        expect(describeStep({ id: 'a', name: 'search', arguments: { query: 'pixel-world lounge funk, 112 BPM' } }).detail).toBe(
            'pixel-world lounge funk, 112 BPM'
        );
        // Broken arguments are no detail, not an error
        expect(describeStep({ id: 'a', name: 'search', arguments: '{oops' }).detail).toBeUndefined();
    });

    it('words our own work tools, and leaves moving around the map out', () => {
        expect(describeStep({ id: 'a', name: 'read_web_page', arguments: { url: 'https://www.workadventu.re/pricing' } })).toMatchObject({
            doing: 'Reading workadventu.re',
            done: 'Read a page',
            detail: 'https://www.workadventu.re/pricing',
        });
        expect(describeStep({ id: 'a', name: 'make_artifact', arguments: { title: 'Song page', content: '<h1>' } })).toMatchObject({
            doing: 'Making an artifact',
            detail: 'Song page',
        });
        expect(showsAsStep('read_web_page', false)).toBe(true);
        expect(showsAsStep('make_artifact', false)).toBe(true);
        expect(showsAsStep('navigate_to', false)).toBe(false);
        expect(showsAsStep('get_people_on_map', false)).toBe(false);
        expect(showsAsStep('generate_music', true)).toBe(true);
    });

    it('reads a failure from the shapes tools answer with, without links', () => {
        expect(resultOf('a', { content: [] })).toEqual({ id: 'a', ok: true });
        expect(resultOf('a', [{ type: 'text' }])).toEqual({ id: 'a', ok: true });
        expect(resultOf('a', { success: false, message: 'Not allowed' })).toEqual({ id: 'a', ok: false, note: 'Not allowed' });
        expect(resultOf('a', { isError: true })).toEqual({ id: 'a', ok: false });
        expect(resultOf('a', { error: 'MCP tool error: quota at https://x.test/?key=abc reached' })).toEqual({
            id: 'a',
            ok: false,
            note: 'quota at reached',
        });
        expect(resultOf('a', { error: 'Tool error: daily limit reached' })).toEqual({ id: 'a', ok: false, note: 'daily limit reached' });
    });

    it('sums up what worked, grouped, in the order it first ran', () => {
        const step = (group: string, done: string, state: 'done' | 'failed' = 'done') => ({ group, done, state });
        expect(
            summaryOf([step('page', 'Read a page'), ...Array(6).fill(step('tool:generate_music', 'Generate music')), step('page', 'Read a page')])
        ).toBe('Read 2 pages · Generate music 6 times');
        expect(summaryOf([step('page', 'Read a page')])).toBe('Read 1 page');
        expect(summaryOf([step('tool:x', 'Search', 'failed')])).toBe('1 step');
        expect(summaryOf([step('tool:x', 'Search', 'failed'), step('tool:y', 'Fetch', 'failed')])).toBe('2 steps');
    });

    it('follows a reply: live while it works, a summary once it answers', () => {
        const steps = new ReplySteps(1000);
        steps.start([
            describeStep({ id: 'p', name: 'read_web_page', arguments: { url: 'https://workadventu.re' } }),
        ]);
        expect(steps.field()).toMatchObject({ v: 1, state: 'working', line: 'Reading workadventu.re', startedAt: 1000 });
        expect(steps.text()).toBe('Reading workadventu.re…');
        expect(steps.finish([{ id: 'p', ok: true }])).toBe(true);
        // A result for a step it doesn't know changes nothing
        expect(steps.finish([{ id: 'zzz', ok: true }])).toBe(false);
        steps.start([
            describeStep({ id: 'm1', name: 'generate_music', arguments: { prompt: 'funk' } }),
            describeStep({ id: 'm2', name: 'generate_music', arguments: { prompt: 'funk' } }),
        ]);
        expect(steps.field().line).toBe('Generate music');
        steps.finish([{ id: 'm1', ok: true }, { id: 'm2', ok: false, note: 'daily limit reached' }]);
        steps.end();
        const field = steps.field();
        expect(field.state).toBe('done');
        expect(field.line).toBe('Read 1 page · Generate music');
        expect(field.steps.map((s) => [s.state, s.again ?? false])).toEqual([
            ['done', false],
            ['done', false],
            ['failed', true],
        ]);
        expect(field.steps[2].note).toBe('daily limit reached');
        expect(steps.text()).toBe("Read 1 page · Generate music · 1 didn't work");
    });

    it('marks what never finished as failed when the reply stops part-way', () => {
        const steps = new ReplySteps();
        steps.start([describeStep({ id: 'a', name: 'search', arguments: { query: 'x' } })]);
        steps.stop();
        expect(steps.field()).toMatchObject({ state: 'stopped', steps: [{ state: 'failed' }] });
    });
});
