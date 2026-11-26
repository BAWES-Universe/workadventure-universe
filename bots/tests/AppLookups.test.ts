/** The link's search and schemas answers of several Apps joined into one (bots/mcp/AppLookups.ts). Pure. */
import { describe, expect, it } from 'vitest';
import { isJoinedLookup, joinLookupAnswers } from '../mcp/AppLookups';

const text = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];
const read = (answer: unknown) => JSON.parse(((answer as Array<{ text: string }>)[0]).text);

describe('which tools are asked of every App', () => {
    it('are the search and the schemas, whatever the case', () => {
        expect(isJoinedLookup('COMPOSIO_SEARCH_TOOLS')).toBe(true);
        expect(isJoinedLookup(' composio_get_tool_schemas ')).toBe(true);
        expect(isJoinedLookup('COMPOSIO_MULTI_EXECUTE_TOOL')).toBe(false);
        expect(isJoinedLookup('COMPOSIO_MANAGE_CONNECTIONS')).toBe(false);
    });
});

describe('joining the answers of several Apps', () => {
    it('returns the one answer exactly as it came when only one App answered and none failed', () => {
        const answer = text({ results: [1] });
        expect(joinLookupAnswers([{ app: 'Gmail', answer }])).toBe(answer);
    });

    it('adds up lists, joins the per-question results by their index, and keeps the oldest App’s single values', () => {
        const joined = read(
            joinLookupAnswers([
                { app: 'Gmail', answer: text({ successful: false, data: { results: [{ index: 1, primary_tool_slugs: ['A'] }], statuses: ['x'], session: { id: 's1' } } }) },
                { app: 'Calendar', answer: text({ successful: true, data: { results: [{ index: 1, primary_tool_slugs: ['B'] }, { index: 2, primary_tool_slugs: ['C'] }], statuses: ['x', 'y'], session: { id: 's2' } } }) },
            ])
        );
        expect(joined.successful).toBe(true);
        expect(joined.data.results).toEqual([{ index: 1, primary_tool_slugs: ['A', 'B'] }, { index: 2, primary_tool_slugs: ['C'] }]);
        expect(joined.data.statuses).toEqual(['x', 'y']);
        expect(joined.data.session.id).toBe('s1');
    });

    it('keeps the shape the first answer came in', () => {
        expect(joinLookupAnswers([{ app: 'A', answer: '{"a":[1]}' }, { app: 'B', answer: '{"a":[2]}' }])).toBe('{"a":[1,2]}');
        expect(joinLookupAnswers([{ app: 'A', answer: { a: [1] } }, { app: 'B', answer: { a: [2] } }])).toEqual({ a: [1, 2] });
    });

    it('puts answers that are not data one after another under each App’s name', () => {
        const joined = joinLookupAnswers([
            { app: 'Gmail', answer: [{ type: 'text', text: 'Found mail actions.' }] },
            { app: 'Calendar', answer: 'Found calendar actions.' },
        ]) as Array<{ text: string }>;
        expect(joined.map((part) => part.text)).toEqual(['Gmail:\nFound mail actions.', 'Calendar:\nFound calendar actions.']);
    });

    it('names an App that failed beside what the others found', () => {
        const joined = read(joinLookupAnswers([{ app: 'Gmail', answer: { error: 'down' } }, { app: 'Calendar', answer: text({ data: { results: [] } }) }]));
        expect(joined.apps_that_did_not_answer).toEqual(['Gmail did not answer: down']);
    });

    it('gives the first failure when every App failed', () => {
        expect(joinLookupAnswers([{ app: 'Gmail', answer: { error: 'one' } }, { app: 'Calendar', answer: { error: 'two' } }])).toEqual({ error: 'one' });
    });
});
