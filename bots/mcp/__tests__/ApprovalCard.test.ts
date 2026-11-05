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
    outcomeOf,
    parseTap,
    rememberOffer,
    resultLine,
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
        expect(argumentLines({ labels: ['a', 'b'] })).toEqual([{ label: 'Labels', text: '["a","b"]' }]);
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
        expect(resultLine([{ type: 'text', text: 'x'.repeat(500) }])!.length).toBeLessThanOrEqual(300);
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
