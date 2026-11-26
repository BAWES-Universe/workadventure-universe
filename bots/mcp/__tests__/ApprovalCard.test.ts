/**
 * Tests for the card's words and notice (game #1657): the lines come from the exact arguments, "allow more" is offered only
 * where it can be enforced, the notice carries the field the game reads, and a tap is read for nothing but its id and
 * revision.
 */
import { describe, expect, it } from 'vitest';
import {
    ANSWER_EVENT,
    ASK_KEY,
    argumentLines,
    askBody,
    askEdit,
    askNotice,
    buildAsk,
    cardOptions,
    cardTitle,
    cardWords,
    outcomeOf,
    parseTap,
    rememberOffer,
    resultLine,
    resultText,
    looksLikeData,
    tidyName,
    type CardFacts,
} from '../ApprovalCard';
import type { SavedAction } from '../OrbitActions';

const action = (overrides: Partial<SavedAction> = {}): SavedAction => ({
    id: 'act_1',
    botId: 'b1',
    status: 'waiting',
    closedReason: null,
    revision: 1,
    requesterKey: 'uuid-1',
    conversationKey: 'dm:!room',
    connectionRef: 's1',
    toolName: 'create_issue',
    heading: 'changesThings',
    toolFingerprint: 'fp',
    policyRevision: 3,
    arguments: { team: 'WEB', title: 'Fix login' },
    rememberScope: null,
    reviewExpiresAt: '2026-11-04T12:10:00.000Z',
    ...overrides,
});

const facts = (overrides: Partial<CardFacts> = {}): CardFacts => ({
    action: action(),
    title: 'Create issue',
    lines: [{ label: 'Team', text: 'WEB' }],
    offer: { scope: { fixed: { team: 'WEB' }, varies: ['title'] }, phrase: 'WEB' },
    notReviewed: false,
    waitMinutes: 10,
    ...overrides,
});

describe('words', () => {
    it("reads a tool's name tidily and prefers its own title", () => {
        expect(tidyName('linear_create_issue')).toBe('Linear create issue');
        expect(tidyName('createIssue')).toBe('Create Issue');
        expect(cardTitle('linear_create_issue')).toBe('Linear create issue');
        expect(cardTitle('linear_create_issue', 'Create a Linear issue')).toBe('Create a Linear issue');
    });
});

describe('argumentLines', () => {
    it('never rewrites an id, even in a label-like input', () => {
        const lines = argumentLines({ order_id: 'ORD_12345', label_ids: ['INBOX', 'Label_123'], sort_by: 'CREATED_AT', status: 'ORD_12345' });
        expect(lines).toEqual([
            { label: 'Order', text: 'ORD_12345' },
            { label: 'Labels', text: 'Inbox, Label_123' },
            { label: 'Sort by', text: 'Created at' },
            { label: 'Status', text: 'ORD_12345' },
        ]);
    });

    it('reads a label in capitals as a word, and leaves any other value as it will run', () => {
        const lines = argumentLines({ label_ids: ['INBOX'], status: 'OPEN', currency: 'USD', query: 'SQL', tags: ['API', 'CRM'] });
        expect(lines).toEqual([
            { label: 'Labels', text: 'Inbox' },
            { label: 'Status', text: 'Open' },
            { label: 'Currency', text: 'USD' },
            { label: 'Query', text: 'SQL' },
            { label: 'Tags', text: 'API, CRM' },
        ]);
    });

    it('shows every argument exactly as it will run, in the order the tool names its inputs', () => {
        const lines = argumentLines({ title: 'Fix login', team: 'WEB', priority: 2 }, { properties: { team: {}, title: {}, priority: {} } });
        expect(lines).toEqual([
            { label: 'Team', text: 'WEB' },
            { label: 'Title', text: 'Fix login' },
            { label: 'Priority', text: '2' },
        ]);
    });

    it('puts arguments the schema does not name after the ones it does, and skips empty ones', () => {
        const lines = argumentLines({ extra: true, team: 'WEB', note: '  ', none: null }, { properties: { team: {} } });
        expect(lines.map((line) => line.label)).toEqual(['Team', 'Extra']);
    });

    it('shows nested values whole, as JSON', () => {
        expect(argumentLines({ filter: { a: 1 }, mixed: [{ a: 1 }, 'b'] })).toEqual([
            { label: 'Filter', text: '{"a":1}' },
            { label: 'Mixed', text: '[{"a":1},"b"]' },
        ]);
    });

    it('reads a list of words as words, joined', () => {
        expect(argumentLines({ labels: ['a', 'b'], codes: [1, 2] })).toEqual([
            { label: 'Labels', text: 'a, b' },
            { label: 'Codes', text: '1, 2' },
        ]);
    });

    it('reads labels and capital words plainly and leaves everything else as it will run', () => {
        const lines = argumentLines({
            label_ids: ['INBOX', 'CATEGORY_UPDATES'],
            user_id: 'me',
            message_id: '1a2123335638b975',
            query: 'newer_than:7d (is:unread OR is:important)',
            status: 'IN_PROGRESS',
            code: 'ABC123',
            letter: 'A',
            max_results: 25,
        });
        expect(lines).toEqual([
            { label: 'Labels', text: 'Inbox, Category updates' },
            { label: 'User', text: 'me' },
            { label: 'Message', text: '1a2123335638b975' },
            { label: 'Query', text: 'newer_than:7d (is:unread OR is:important)' },
            { label: 'Status', text: 'In progress' },
            { label: 'Code', text: 'ABC123' },
            { label: 'Letter', text: 'A' },
            { label: 'Max results', text: '25' },
        ]);
    });

    it('keeps to the lines the game shows, and says how many more there are', () => {
        const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`field${i}`, `value ${i}`]));
        const lines = argumentLines(many);
        expect(lines).toHaveLength(20);
        expect(lines[19]).toEqual({ text: '…and 6 more details' });
    });
});

describe('rememberOffer', () => {
    it('lets the words differ and keeps everything else fixed', () => {
        expect(rememberOffer({ team: 'WEB', title: 'Fix login', description: 'It breaks' }, 'changesThings', false)).toEqual({
            scope: { fixed: { team: 'WEB' }, varies: ['title', 'description'] },
            phrase: 'WEB',
        });
    });

    it('is never offered for deleting or sending, nor for a tool nobody confirmed', () => {
        expect(rememberOffer({ team: 'WEB', title: 'x' }, 'deletesOrSends', false)).toBeNull();
        expect(rememberOffer({ team: 'WEB', title: 'x' }, 'changesThings', true)).toBeNull();
    });

    it('is not offered when nothing stays fixed or nothing may differ, since that would be a wildcard or a repeat', () => {
        expect(rememberOffer({ title: 'x', description: 'y' }, 'changesThings', false)).toBeNull();
        expect(rememberOffer({ team: 'WEB' }, 'changesThings', false)).toBeNull();
    });

    it('is not offered when an argument looks like a secret', () => {
        expect(rememberOffer({ team: 'WEB', title: 'x', apiKey: 'k' }, 'changesThings', false)).toBeNull();
    });
});

describe('cardOptions', () => {
    it("words the choices in the tool's own words", () => {
        const options = cardOptions('Create issue', { scope: { fixed: {}, varies: [] }, phrase: 'WEB' });
        expect(options).toEqual([
            { id: 'approve', label: 'Create issue' },
            { id: 'approveAndRemember', label: 'Create issue, and allow more with WEB in this chat' },
            { id: 'decline', label: "Don't create" },
        ]);
    });

    it('has no "allow more" without an offer, and a title with no verb says "Don\'t do it"', () => {
        expect(cardOptions('Create issue', null).map((option) => option.id)).toEqual(['approve', 'decline']);
        expect(cardOptions('Email', null)[1].label).toBe("Don't do it");
    });

    it('stays inside the label length the game shows', () => {
        const options = cardOptions('Create a very long issue title that goes on', { scope: { fixed: {}, varies: [] }, phrase: 'A very long team name here' });
        expect(options.every((option) => option.label.length <= 80)).toBe(true);
    });
});

describe('buildAsk', () => {
    it('carries the card the game reads, with the end time on this clock', () => {
        const ask = buildAsk(facts({ actsAs: 'Sara’s Linear' }), 1_000);
        expect(ask).toMatchObject({
            v: 1,
            kind: 'approval',
            id: 'act_1',
            revision: 1,
            title: 'Create issue',
            actsAs: 'Sara’s Linear',
            expiresAt: Date.parse('2026-11-04T12:10:00.000Z'),
            now: 1_000,
            waitMinutes: 10,
        });
        expect(ask.options.map((option) => option.id)).toEqual(['approve', 'approveAndRemember', 'decline']);
        expect(ask.everyTime).toBeUndefined();
    });

    it('asks every time for deleting or sending, with no "allow more"', () => {
        const ask = buildAsk(facts({ action: action({ heading: 'deletesOrSends' }) }), 1);
        expect(ask.everyTime).toBe(true);
        expect(ask.options.map((option) => option.id)).toEqual(['approve', 'decline']);
    });

    it('says a tool nobody confirmed is not reviewed, and asks every time', () => {
        const ask = buildAsk(facts({ notReviewed: true }), 1);
        expect(ask.notReviewed).toBe(true);
        expect(ask.everyTime).toBe(true);
        expect(ask.options.map((option) => option.id)).toEqual(['approve', 'decline']);
    });

    it('carries how it ended', () => {
        expect(buildAsk(facts(), 1, { closed: true }).answer).toEqual({ closed: true });
    });
});

describe('the notice', () => {
    it('carries the field and says the same in plain words', () => {
        const ask = buildAsk(facts({ lines: [{ label: 'Team', text: 'WEB' }, { label: 'Title', text: 'Fix login' }] }), 1);
        const notice = askNotice(ask);
        expect(notice).toMatchObject({ msgtype: 'm.notice', [ASK_KEY]: ask });
        expect(notice.body).toBe('Create issue: waiting for your OK\nTeam: WEB\nTitle: Fix login');
    });

    it('says how it ended in the body too', () => {
        const options = buildAsk(facts(), 1).options;
        const body = (answer: object) => askBody({ ...buildAsk(facts(), 1), answer });
        expect(body({ typed: true })).toContain('typed something else');
        expect(body({ closed: true })).toContain('closed this card');
        expect(body({ expired: true })).toContain('No answer in time');
        expect(body({ option: 'decline' })).toContain('Nothing was done');
        expect(body({ option: 'approve', unknown: true })).toContain('may or may not');
        expect(body({ option: 'approve', result: 'Created WEB-12' })).toContain('You picked Create issue. Created WEB-12');
        expect(options).toHaveLength(3);
    });

    it('edits the same notice in place', () => {
        const edit = askEdit('$card', buildAsk(facts(), 1, { closed: true }));
        expect(edit['m.relates_to']).toEqual({ rel_type: 'm.replace', event_id: '$card' });
        expect((edit['m.new_content'] as Record<string, unknown>)[ASK_KEY]).toMatchObject({ id: 'act_1', answer: { closed: true } });
        expect(String(edit.body).startsWith('* ')).toBe(true);
    });
});

describe('how a call ended', () => {
    it('reads what the connector proved', () => {
        expect(outcomeOf([{ type: 'text', text: 'ok' }])).toBe('succeeded');
        expect(outcomeOf({ error: 'x', outcome: 'not_sent' })).toBe('notSent');
        expect(outcomeOf({ error: 'x', outcome: 'failed' })).toBe('failed');
        expect(outcomeOf({ error: 'x', outcome: 'uncertain' })).toBe('uncertain');
        // An error that proves nothing may have run
        expect(outcomeOf({ error: 'MCP tool error: boom' })).toBe('uncertain');
    });

    it('takes the first line of text the tool gave back', () => {
        expect(resultLine([{ type: 'image' }, { type: 'text', text: '  Created   WEB-12\nhttps://x  ' }])).toBe('Created WEB-12 https://x');
        expect(resultLine('plain')).toBe('plain');
        expect(resultLine([{ type: 'image' }])).toBeUndefined();
        expect(resultLine({ ok: true })).toBeUndefined();
        // an answer that is data never shows as a line
        expect(resultLine('{"successful":true,"data":{"messages":[]}}')).toBeUndefined();
        expect(resultLine([{ type: 'text', text: '  [1, 2, 3]' }])).toBeUndefined();
        expect(resultLine([{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'Created 2 events' }])).toBe('Created 2 events');
        expect(resultLine([{ type: 'text', text: 'x'.repeat(500) }])!.length).toBeLessThanOrEqual(300);
        // Fenced data is data; a bracketed word before plain text is a sentence
        expect(resultLine('```json\n{"ok":true}\n```')).toBeUndefined();
        expect(resultLine('[Gmail] Message sent successfully.')).toBe('[Gmail] Message sent successfully.');
        expect(resultLine('[]')).toBeUndefined();
        expect(looksLikeData('[{"id":1}]')).toBe(true);
        expect(looksLikeData('["a"]')).toBe(true);
        expect(looksLikeData('[ERROR] no such team')).toBe(false);
        expect(looksLikeData('[1] emails found')).toBe(false);
        expect(looksLikeData('[2024-05-01] Message sent')).toBe(false);
        expect(looksLikeData('[1, 2, 3]')).toBe(true);
        expect(looksLikeData('[1,')).toBe(true);
        expect(resultLine('[2024-05-01] Message sent')).toBe('[2024-05-01] Message sent');
    });

    it('keeps what came back for the bot even when the card does not show it', () => {
        expect(resultText('{"successful":true}')).toBe('{"successful":true}');
        expect(resultText([{ type: 'text', text: 'Created   2 events' }])).toBe('Created 2 events');
        expect(resultText([{ type: 'image' }])).toBeUndefined();
        expect(resultText([{ type: 'text', text: 'x'.repeat(500) }])!.length).toBeLessThanOrEqual(300);
    });
});

describe('parseTap', () => {
    it('reads each tap as only the card, the revision it saw, and what was tapped', () => {
        expect(parseTap({ v: 1, ask: 'act_1', revision: 3, action: 'decide', option: 'approveAndRemember' })).toEqual({
            ask: 'act_1',
            revision: 3,
            tap: { action: 'decide', option: 'approveAndRemember' },
        });
        for (const action of ['close', 'moreTime', 'reviewAgain', 'askAgain'] as const) {
            expect(parseTap({ v: 1, ask: 'act_1', revision: 3, action })?.tap).toEqual({ action });
        }
    });

    it('ignores anything else, including new content a tap might try to carry', () => {
        expect(ANSWER_EVENT).toBe('universe.ask.answer');
        expect(parseTap(null)).toBeNull();
        expect(parseTap({ v: 2, ask: 'a', revision: 1, action: 'close' })).toBeNull();
        expect(parseTap({ v: 1, ask: '', revision: 1, action: 'close' })).toBeNull();
        expect(parseTap({ v: 1, ask: 'a', revision: -1, action: 'close' })).toBeNull();
        expect(parseTap({ v: 1, ask: 'a', revision: 1.5, action: 'close' })).toBeNull();
        expect(parseTap({ v: 1, ask: 'a', revision: 1, action: 'decide', option: 'yes' })).toBeNull();
        expect(parseTap({ v: 1, ask: 'a', revision: 1, action: 'run' })).toBeNull();
        expect(parseTap({ v: 1, ask: 'a', revision: 1, action: 'decide', option: 'approve', arguments: { x: 1 } })?.tap).toEqual({ action: 'decide', option: 'approve' });
    });
});


describe('card words for a batch call', () => {
    const fetch = { tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { query: 'newer_than:7d (is:unread OR is:important)', max_results: 25, label_ids: ['INBOX'] } };
    const labels = { tool_slug: 'GMAIL_LIST_LABELS', arguments: {} };
    const extra = { thought: 'Look at the inbox', current_step: 'FETCHING_EMAILS', session_id: 'abc', sync_response_to_workbench: false };

    it('names one action by what it does and shows its inputs as lines', () => {
        const words = cardWords('COMPOSIO_MULTI_EXECUTE_TOOL', 'Multi Execute Composio Tools', { tools: [fetch], ...extra }, undefined, 'Gmail');
        expect(words.title).toBe('Fetch emails');
        expect(words.lines).toEqual([
            { label: 'Query', text: 'newer_than:7d (is:unread OR is:important)' },
            { label: 'Max results', text: '25' },
            { label: 'Labels', text: 'Inbox' },
        ]);
        expect(words.buttons).toBeUndefined();
        expect(cardOptions(words.title, null, words.buttons).map((o) => o.label)).toEqual(['Fetch emails', "Don't fetch"]);
    });

    it('names two actions, one line each, with "Allow both"', () => {
        const words = cardWords('COMPOSIO_MULTI_EXECUTE_TOOL', 'Multi Execute Composio Tools', { tools: [fetch, labels], ...extra }, undefined, 'Gmail');
        expect(words.title).toBe('Fetch emails and list labels');
        expect(words.lines).toEqual([
            { label: 'Fetch emails', text: 'Query newer_than:7d (is:unread OR is:important) · Max results 25 · Labels Inbox' },
            { label: 'List labels', text: 'Nothing to fill in' },
        ]);
        expect(cardOptions(words.title, null, words.buttons).map((o) => o.label)).toEqual(['Allow both', "Don't do it"]);
    });

    it('names three or more as "and N more" with "Allow all"', () => {
        const words = cardWords('COMPOSIO_MULTI_EXECUTE_TOOL', undefined, { tools: [fetch, labels, labels] }, undefined, 'Gmail');
        expect(words.title).toBe('Fetch emails and 2 more');
        expect(words.lines).toHaveLength(3);
        expect(words.buttons).toEqual({ approve: 'Allow all', decline: "Don't do it" });
    });

    it('keeps an input of the batch itself that people may care about, after the actions, and never the model\'s own notes', () => {
        const words = cardWords('x', undefined, { tools: [fetch, labels], thought: 'note', limit: 5 }, undefined, 'Gmail');
        expect(words.lines.at(-1)).toEqual({ label: 'Limit', text: '5' });
        expect(words.lines.some((line) => /thought|note/i.test(`${line.label} ${line.text}`))).toBe(false);
    });

    it('tidies the whole slug when it does not start with the App\'s name', () => {
        expect(cardWords('x', undefined, { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: {} }] }, undefined, 'Gmail').title).toBe('Slack send message');
        expect(cardWords('x', undefined, { tools: [{ tool_slug: 'GOOGLECALENDAR_FIND_EVENT', arguments: {} }] }, undefined, 'Google Calendar').title).toBe('Find event');
    });

    it('is not a batch unless every tool has a slug', () => {
        expect(cardWords('create_issue', 'Create issue', { tools: [{ tool_slug: '' }] }).title).toBe('Create issue');
        expect(cardWords('create_issue', 'Create issue', { tools: 'nope' }).title).toBe('Create issue');
        expect(cardWords('create_issue', 'Create issue', { tools: [] }).title).toBe('Create issue');
    });

    it('never shows the provider in a title', () => {
        expect(cardTitle('x', 'Multi Execute Composio Tools')).toBe('Multi Execute Tools');
        expect(cardTitle('composio_search_tools')).toBe('Search tools');
        expect(cardTitle('x', 'Composio')).toBe('Use a tool');
    });
});
