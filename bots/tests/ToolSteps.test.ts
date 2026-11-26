/**
 * The steps line of a reply (#1545): plain words for each call, what it was about, how it ended, and the one-line summary.
 */
import { describe, expect, it } from 'vitest';
import { ReplySteps, describeStep, resultOf, showsAsStep, stepDetails, summaryOf, tidyName } from '../ai/ToolSteps';

describe('a forget that removed nothing, as the line shows it (CodeRabbit)', () => {
    it('does not read "Forgot" once it ended without forgetting', () => {
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'f', name: 'forget_memory', arguments: { about: 'coffee' } })]);
        expect(steps.field().steps[0].done).toBe('Forgot');
        steps.finish([resultOf('f', { forgotten: [], unclear: true })]);
        const step = steps.field().steps[0];
        // Asking which memory is meant changed nothing, and is not a failed step
        expect(step).toMatchObject({ state: 'done', done: 'Forgot nothing yet' });
        expect(step.note).toContain('Nothing forgotten');
        steps.end(1000);
        expect(steps.text()).not.toContain("didn't work");
        // Forgot for real: the label stays
        const again = new ReplySteps(0);
        again.start([describeStep({ id: 'g', name: 'forget_memory', arguments: { about: 'coffee' } })]);
        again.finish([resultOf('g', { forgotten: ['x'], count: 1 })]);
        expect(again.field().steps[0]).toMatchObject({ state: 'done', done: 'Forgot' });
    });
});

describe('the summary of forgets that ended in different words (Sentry)', () => {
    it('counts a forget that removed something apart from one that found nothing, instead of one label over both', () => {
        const steps = new ReplySteps(0);
        steps.start([
            describeStep({ id: 'a', name: 'forget_memory', arguments: { about: 'coffee' } }),
            describeStep({ id: 'b', name: 'forget_memory', arguments: { about: 'tea' } }),
        ]);
        steps.finish([resultOf('a', { forgotten: ['x'], count: 1 }), resultOf('b', { forgotten: [], unclear: true })]);
        steps.end(1000);
        const line = steps.field().line;
        expect(line).toBe('Forgot · Forgot nothing yet');
        expect(line).not.toMatch(/2 times/);
    });
});

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
            doing: 'Using Make a song',
            done: 'Used Make a song',
            detail: 'upbeat 8-bit funk',
            group: 'tool:generate_music',
            kind: 'write',
        });
    });

    it('tells reading, searching and writing apart for the emoji beside the Woka (#1667)', () => {
        expect(describeStep({ id: 'a', name: 'read_web_page', arguments: { url: 'https://x.test' } }).kind).toBe('read');
        expect(describeStep({ id: 'a', name: 'web_search' }).kind).toBe('search');
        expect(describeStep({ id: 'a', name: 'doc_lookup' }).kind).toBe('search');
        expect(describeStep({ id: 'a', name: 'fetch_page' }, 'Open a page').kind).toBe('read');
        expect(describeStep({ id: 'a', name: 'generate_music' }).kind).toBe('write');
        // Listing and getting are reading (game #2131: "Fetch emails and list labels" is not a write)
        expect(describeStep({ id: 'a', name: 'GMAIL_LIST_LABELS' }).kind).toBe('read');
        expect(describeStep({ id: 'a', name: 'get_weather' }).kind).toBe('read');
        // The first verb decides: a list being made is a write, and a provider whose name starts with "get" is not a reader
        expect(describeStep({ id: 'a', name: 'GMAIL_CREATE_LIST' }).kind).toBe('write');
        expect(describeStep({ id: 'a', name: 'add_to_list' }).kind).toBe('write');
        expect(describeStep({ id: 'a', name: 'GETRESPONSE_CREATE_CONTACT' }).kind).toBe('write');
        expect(describeStep({ id: 'a', name: 'GETRESPONSE_LIST_CONTACTS' }, undefined, 'GetResponse').kind).toBe('read');
        expect(describeStep({ id: 'a', name: 'webSearch' }).kind).toBe('search');
        // Whole words only: these merely contain "read" or "load"
        expect(describeStep({ id: 'a', name: 'upload_file' }).kind).toBe('write');
        expect(describeStep({ id: 'a', name: 'make_spreadsheet' }).kind).toBe('write');
        expect(describeStep({ id: 'a', name: 'send_payload' }).kind).toBe('write');
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'a', name: 'web_search' })]);
        expect(steps.field().steps[0].kind).toBe('search');
    });

    it('says "Using" while it runs and "Used" once done, so a name never reads as an order', () => {
        expect(describeStep({ id: 'a', name: 'generate_music' })).toMatchObject({ doing: 'Using Generate music', done: 'Used Generate music' });
        expect(describeStep({ id: 'a', name: '__' })).toMatchObject({ doing: 'Using a tool', done: 'Used a tool' });
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
        expect(resultOf('a', { status: 'waiting_for_ok', message: 'A card was shown.' })).toEqual({ id: 'a', ok: false, waiting: true, note: 'Waiting for your OK. Nothing ran yet' });
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
            summaryOf([step('page', 'Read a page'), ...Array(6).fill(step('tool:generate_music', 'Used Generate music')), step('page', 'Read a page')])
        ).toBe('Read 2 pages · Used Generate music 6 times');
        expect(summaryOf([step('page', 'Read a page')])).toBe('Read 1 page');
        expect(summaryOf([step('tool:x', 'Search', 'failed')])).toBe('1 step');
        expect(summaryOf([step('tool:x', 'Search', 'failed'), step('tool:y', 'Fetch', 'failed')])).toBe('2 steps');
    });

    it("shows a tool server's own title whole, with no \"…\" where there is room (#1723)", () => {
        const title = 'Hugging Face Hub: Find, use and view models, datasets, spaces and papers';
        expect(title.length).toBeGreaterThan(60);
        expect(describeStep({ id: 'a', name: 'hf_fs' }, title)).toMatchObject({ doing: `Using ${title}`, done: `Used ${title}` });
        // Only a runaway title is stopped, well past anything a person reads as a name
        const runaway = describeStep({ id: 'a', name: 'x' }, 'w'.repeat(400));
        expect(Array.from(runaway.done).length).toBeLessThan(200);
    });

    it('says it is writing the answer once every call has finished, not "Using" (#1723)', () => {
        const steps = new ReplySteps(1000);
        steps.start([describeStep({ id: 'a', name: 'generate_music', arguments: { prompt: 'funk' } }), describeStep({ id: 'b', name: 'generate_music', arguments: { prompt: 'jazz' } })]);
        steps.finish([{ id: 'a', ok: true }]);
        expect(steps.field().line).toBe('Using Generate music');
        steps.finish([{ id: 'b', ok: true }]);
        expect(steps.field()).toMatchObject({ state: 'working', line: 'Writing the answer' });
        expect(steps.text()).toBe('Writing the answer…');
        // Before any call there is no line to write
        expect(new ReplySteps(1).field().line).toBe('');
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
        expect(steps.field().line).toBe('Using Generate music');
        steps.finish([{ id: 'm1', ok: true }, { id: 'm2', ok: false, note: 'daily limit reached' }]);
        steps.end();
        const field = steps.field();
        expect(field.state).toBe('done');
        expect(field.line).toBe('Read 1 page · Used Generate music');
        expect(field.steps.map((s) => [s.state, s.again ?? false])).toEqual([
            ['done', false],
            ['done', false],
            ['failed', true],
        ]);
        expect(field.steps[2].note).toBe('daily limit reached');
        expect(steps.text()).toBe("Read 1 page · Used Generate music · 1 didn't work");
    });

    it('marks what never finished as failed when the reply stops part-way', () => {
        const steps = new ReplySteps();
        steps.start([describeStep({ id: 'a', name: 'search', arguments: { query: 'x' } })]);
        steps.stop();
        expect(steps.field()).toMatchObject({ state: 'stopped', steps: [{ state: 'failed' }] });
    });

    it('shows a call that may have run as no answer, not as a failure (#1692)', () => {
        const noAnswer = { error: 'No answer. May have finished', outcome: 'uncertain', hint: 'Do not call this tool again' };
        const notSent = { error: "Couldn't reach it. Nothing ran", outcome: 'not_sent', hint: 'Trying again is safe' };
        const cancelled = { error: 'Tool call cancelled: generate_music', outcome: 'uncertain', cancelled: true };
        expect(resultOf('a', noAnswer)).toEqual({ id: 'a', ok: false, unknown: true, note: 'No answer. May have finished' });
        expect(resultOf('b', notSent)).toEqual({ id: 'b', ok: false, note: "Couldn't reach it. Nothing ran" });
        expect(resultOf('c', cancelled)).toEqual({ id: 'c', ok: false, note: 'Tool call cancelled: generate_music' });

        const steps = new ReplySteps();
        steps.start([
            describeStep({ id: 'a', name: 'generate_music', arguments: { prompt: 'lofi' } }),
            describeStep({ id: 'b', name: 'generate_music', arguments: { prompt: 'jazz' } }),
        ]);
        steps.finish([resultOf('a', noAnswer), resultOf('b', notSent)]);
        steps.end();
        const field = steps.field();
        expect(field.steps.map((s) => s.state)).toEqual(['unknown', 'failed']);
        expect(field.steps[0].note).toBe('No answer. May have finished');
        expect(field.line).toBe('2 steps');
        expect(steps.text()).toBe("2 steps · 1 didn't work · 1 no answer");
    });

    it('shows a call once when it is announced as it begins and again with its arguments, filling in what it is about', () => {
        const steps = new ReplySteps(0);
        steps.start([{ id: 'a', doing: 'Making an artifact', done: 'Made an artifact', group: 'make_artifact', kind: 'write' }]);
        steps.start([{ id: 'a', doing: 'Making an artifact', done: 'Made an artifact', detail: 'Moon base', group: 'make_artifact', kind: 'write' }]);
        expect(steps.size).toBe(1);
        expect(steps.field().steps).toMatchObject([{ doing: 'Making an artifact', detail: 'Moon base', state: 'running' }]);
        // A later call with the same id, once the first ended, is a new call
        steps.finish([{ id: 'a', ok: true }]);
        steps.start([{ id: 'a', doing: 'Making an artifact', done: 'Made an artifact', detail: 'Moon base', group: 'make_artifact' }]);
        expect(steps.size).toBe(2);
    });
});

describe('waiting, times and what a step did (#2061)', () => {
    it('shows a step that waits for an OK as waiting, not as one that did not work', () => {
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'a', name: 'get_draft' }), describeStep({ id: 'b', name: 'update_draft' })], 0);
        steps.finish([resultOf('a', { ok: true }), resultOf('b', { status: 'waiting_for_ok' })], 1000);
        steps.end(2000);
        const field = steps.field();
        expect(field.steps[1]).toMatchObject({ state: 'waiting', note: 'Waiting for your OK. Nothing ran yet' });
        expect(steps.text()).toContain('1 waiting for your OK');
        expect(steps.text()).not.toContain("didn't work");
    });

    it('gives each finished step its time, and the whole reply its time once it ends', () => {
        const steps = new ReplySteps(1000);
        steps.start([describeStep({ id: 'a', name: 'get_draft' })], 1000);
        expect(steps.field().steps[0].secs).toBeUndefined();
        expect(steps.field().took).toBeUndefined();
        steps.finish([resultOf('a', { ok: true })], 2340);
        expect(steps.field().steps[0].secs).toBe(1.3);
        steps.end(10_020);
        expect(steps.field().took).toBe(9);
    });

    it('times each call by when it settled, not by when the slowest one beside it did', () => {
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'a', name: 'get_draft' }), describeStep({ id: 'b', name: 'get_draft' })], 0);
        steps.finish([{ ...resultOf('a', { ok: true }), at: 200 }, { ...resultOf('b', { ok: true }), at: 30_000 }], 30_500);
        expect(steps.field().steps.map((step) => step.secs)).toEqual([0.2, 30]);
    });

    it('times a step the answer or a failure ended before its result came', () => {
        const ended = new ReplySteps(0);
        ended.start([describeStep({ id: 'a', name: 'get_draft' })], 0);
        ended.end(4200);
        expect(ended.field().steps[0]).toMatchObject({ state: 'done', secs: 4.2 });
        const stopped = new ReplySteps(0);
        stopped.start([describeStep({ id: 'a', name: 'get_draft' })], 0);
        stopped.stop(7000);
        expect(stopped.field().steps[0]).toMatchObject({ state: 'failed', secs: 7 });
    });

    it('lists what a call sent as plain lines, keeping an address but never a key, a token or data', () => {
        const lines = stepDetails(
            { to: 'info@meetingcpp.com', subject: 'Review draft', api_key: 'abc', note: 'x'.repeat(30) + '1', options: { a: 1 }, tags: ['a', 'b'], link: 'https://x.test/p?token=zz#h' },
            [{ type: 'text', text: 'Draft updated' }],
            true
        );
        expect(lines).toEqual([
            { label: 'To', text: 'info@meetingcpp.com' },
            { label: 'Subject', text: 'Review draft' },
            { label: 'Tags', text: 'a, b' },
            { label: 'Link', text: 'https://x.test/p' },
            { label: 'Result', text: 'Draft updated' },
        ]);
    });

    it('never shows JSON held in an argument, so a password under a key it cannot see stays hidden', () => {
        expect(stepDetails({ payload: '{"password":"hunter2"}', list: ['[1,2]', 'ok'], note: 'fine' })).toEqual([{ label: 'Note', text: 'fine' }]);
    });

    it('shows no result that is data, and nothing when there is nothing to show', () => {
        expect(stepDetails({}, [{ type: 'text', text: '{"data":{"id":"r1"}}' }], true)).toBeUndefined();
        expect(stepDetails('{"subject":"Hi"}', undefined)).toEqual([{ label: 'Subject', text: 'Hi' }]);
    });

    it('leaves out what a tool answered unless its answer is known to be a safe summary, so a password in plain text never reaches a step', () => {
        const answer = [{ type: 'text', text: 'Your new password is correct horse battery' }];
        expect(stepDetails({ subject: 'Hi' }, answer)).toEqual([{ label: 'Subject', text: 'Hi' }]);
        expect(stepDetails({}, answer)).toBeUndefined();
        expect(stepDetails({ subject: 'Hi' }, answer, true)).toEqual([{ label: 'Subject', text: 'Hi' }, { label: 'Result', text: 'Your new password is correct horse battery' }]);
    });

    it('carries what a step did into the field it sends', () => {
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'a', name: 'update_draft' })], 0);
        steps.finish([{ ...resultOf('a', { ok: true }), shows: [{ label: 'To', text: 'a@b.co' }] }], 500);
        expect(steps.field().steps[0].shows).toEqual([{ label: 'To', text: 'a@b.co' }]);
    });
});

describe('a batch call by what its tools do (game #2131)', () => {
    const fetch = { tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { query: 'is:unread', label_ids: ['INBOX'] } };
    const labels = { tool_slug: 'GMAIL_LIST_LABELS', arguments: {} };
    const call = (tools: unknown[], extra: Record<string, unknown> = {}) => ({ id: 'c1', name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: JSON.stringify({ tools, ...extra }) });

    it('tells a write from a read by its action, not by the App name or a list noun', () => {
        const make = { tool_slug: 'GETRESPONSE_CREATE_LIST', arguments: {} };
        expect(describeStep(call([make]), undefined, 'GetResponse').kind).toBe('write');
        expect(describeStep(call([labels, make]), undefined, 'GetResponse').kind).toBe('write');
        expect(describeStep(call([labels]), undefined, 'Gmail').kind).toBe('read');
    });

    it('names the step by its action, in the same words as the card', () => {
        const one = describeStep(call([fetch]), 'Multi Execute Composio Tools', 'Gmail');
        expect(one).toMatchObject({ doing: 'Using Fetch emails', done: 'Used Fetch emails', kind: 'read' });
        expect(describeStep(call([fetch, labels]), 'Multi Execute Composio Tools', 'Gmail').done).toBe('Used Fetch emails and list labels');
        expect(describeStep(call([fetch, labels, labels]), undefined, 'Gmail').done).toBe('Used Fetch emails and 2 more');
    });

    it('is a write when any of its tools writes, a search when any searches, else a read', () => {
        expect(describeStep(call([fetch, { tool_slug: 'GMAIL_SEND_EMAIL', arguments: {} }]), undefined, 'Gmail').kind).toBe('write');
        expect(describeStep(call([{ tool_slug: 'GMAIL_SEARCH_PEOPLE', arguments: {} }, fetch]), undefined, 'Gmail').kind).toBe('search');
    });

    it('never shows the provider in a tool title', () => {
        expect(describeStep({ id: 'x', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{}' }, 'Search Composio Tools').doing).toBe('Using Search Tools');
        expect(describeStep({ id: 'x', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{}' }).doing).toBe('Using Search tools');
        expect(describeStep({ id: 'x', name: 'x', arguments: '{}' }, 'Composio').doing).toBe('Using a tool');
    });

    it('renames a call announced before its tools were known once they are', () => {
        const steps = new ReplySteps(0);
        steps.start([describeStep({ id: 'c1', name: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: '{"tools":[{"tool_s' }, 'Multi Execute Composio Tools', 'Gmail')]);
        expect(steps.field().steps[0].doing).toBe('Using Multi Execute Tools');
        steps.start([describeStep(call([fetch]), 'Multi Execute Composio Tools', 'Gmail')]);
        expect(steps.field().steps).toHaveLength(1);
        expect(steps.field().steps[0]).toMatchObject({ doing: 'Using Fetch emails', done: 'Used Fetch emails', kind: 'read' });
        steps.finish([resultOf('c1', { successful: true })], 1000);
        steps.end(2000);
        expect(steps.field().line).toBe('Used Fetch emails');
    });

    it('shows what each tool was asked in plain lines, and never the model\'s own notes', () => {
        const lines = stepDetails(call([fetch, labels], { thought: 'Look at the inbox', current_step: 'FETCHING_EMAILS', session_id: 's', sync_response_to_workbench: true }).arguments, undefined, false, 'Gmail');
        expect(lines).toEqual([
            { label: 'Fetch emails', text: 'Query is:unread · Labels Inbox' },
            { label: 'List labels', text: 'Nothing to fill in' },
        ]);
    });

    it('reads labels and capital words plainly in what a step sent', () => {
        expect(stepDetails({ currency: 'USD', status: 'OPEN' })).toEqual([{ label: 'Currency', text: 'USD' }, { label: 'Status', text: 'Open' }]);
        expect(stepDetails({ label_ids: ['INBOX', 'CATEGORY_UPDATES'], user_id: 'me' })).toEqual([
            { label: 'Labels', text: 'Inbox, Category updates' },
            { label: 'User', text: 'me' },
        ]);
    });
});
