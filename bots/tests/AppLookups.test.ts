/** The link's search and schemas answers of several Apps joined into one (bots/mcp/AppLookups.ts). Pure. */
import { describe, expect, it } from 'vitest';
import { isJoinedLookup, joinLookupAnswers, retryWithoutSession, sessionRefused, withoutSession } from '../mcp/AppLookups';

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
                { app: 'Gmail', answer: text({ successful: true, data: { results: [{ index: 1, primary_tool_slugs: ['A'] }], statuses: ['x'], session: { id: 's1' } } }) },
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

    it('reads a failure the link reports inside its answer, as text or as an MCP part, not only the server’s own error', () => {
        const joined = read(joinLookupAnswers([{ app: 'Gmail', answer: text({ successful: false, error: 'token expired', data: {} }) }, { app: 'Calendar', answer: text({ successful: true, data: { results: [] } }) }]));
        expect(joined.apps_that_did_not_answer).toEqual(['Gmail did not answer: token expired']);
        expect(joined.successful).toBe(true);
        const silent = read(joinLookupAnswers([{ app: 'Gmail', answer: JSON.stringify({ successful: false, data: {} }) }, { app: 'Calendar', answer: text({ successful: true, data: { results: [] } }) }]));
        expect(silent.apps_that_did_not_answer).toEqual(['Gmail did not answer: it reported a failure.']);
    });

    it('counts an App that answered nothing at all as one that did not answer, never as "null" text', () => {
        const joined = read(joinLookupAnswers([{ app: 'Gmail', answer: text({ data: { results: [] } }) }, { app: 'Calendar', answer: null }]));
        expect(joined.apps_that_did_not_answer).toEqual(['Calendar did not answer: it gave no answer.']);
        // An answer with an empty list is still an answer
        expect(joinLookupAnswers([{ app: 'Gmail', answer: text({ data: { results: [] } }) }, { app: 'Calendar', answer: text({ data: { results: [] } }) }])).toBeDefined();
    });

    it('gives the first failure when every App failed', () => {
        expect(joinLookupAnswers([{ app: 'Gmail', answer: { error: 'one' } }, { app: 'Calendar', answer: { error: 'two' } }])).toEqual({ error: 'one' });
    });
});

describe('a session the App’s link refused', () => {
    const sent = { tools: [{ tool_slug: 'GOOGLECALENDAR_CREATE_EVENT', arguments: {} }], session_id: 'sess-g1' };

    it('is told only from a refusal of the whole call that names the session id', () => {
        expect(sessionRefused({ error: 'Invalid session id sess-g1' }, sent)).toBe(true);
        expect(sessionRefused(text({ successful: false, error: 'Session not found' }), sent)).toBe(true);
        expect(sessionRefused(text({ successful: false, error: 'Unknown session' }), sent)).toBe(true);
        // The refusal quotes the id that was sent
        expect(sessionRefused({ error: 'Tool error: Invalid session id sess-g1', outcome: 'failed' }, sent)).toBe(true);
        expect(sessionRefused({ error: 'The link is not answering.' }, sent)).toBe(false);
        expect(sessionRefused(text({ successful: true, data: { note: 'a session started' } }), sent)).toBe(false);
    });

    it('is never told from the word session alone, a thrown error, an unsure outcome or an answer with results of actions', () => {
        expect(sessionRefused({ error: 'Strategy session could not be created' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'MCP tool error: invalid session in the transport' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Invalid session', outcome: 'uncertain' }, sent)).toBe(false);
        expect(sessionRefused(text({ successful: false, error: 'Invalid session', data: { results: [{ index: 0, tool_slug: 'A', response: { successful: true } }] } }), sent)).toBe(false);
        // Another session than the one sent says nothing about this one; the id alone, in another field, is no refusal
        expect(sessionRefused({ error: 'Invalid session id sess-other' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Event note mentions sess-g1' }, sent)).toBe(false);
        // Results at the root, or signs that actions ran in the error's own words
        expect(sessionRefused(text({ successful: false, error: 'Invalid session', results: [{ index: 0, tool_slug: 'A' }] }), sent)).toBe(false);
        expect(sessionRefused({ error: 'Tool error: {"successful":true,"data":{"results":[{"tool_slug":"A"}]}} then Invalid session', outcome: 'failed' }, sent)).toBe(false);
        // Only a bare refusal: words about what was done make it a call that may have run
        expect(sessionRefused({ error: 'Tool error: Invalid session. Action 1 completed.', outcome: 'failed' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Invalid session id sess-g1 after the event was created', outcome: 'failed' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Tool error: Invalid session id sess-g1', outcome: 'failed' }, sent)).toBe(true);
        // A named id is exactly the one sent, even when it is also a word of a refusal, and in its own case
        expect(sessionRefused({ error: 'Invalid session id new', outcome: 'failed' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Invalid session id SESS-G1', outcome: 'failed' }, sent)).toBe(false);
        expect(sessionRefused({ error: 'Invalid session id new', outcome: 'failed' }, { tools: sent.tools, session_id: 'new' })).toBe(true);
        expect(sessionRefused({ error: 'Invalid session. It was sess-g1', outcome: 'failed' }, sent)).toBe(false);
        // Nothing was sent with a session: nothing to take away
        expect(sessionRefused({ error: 'Invalid session' }, { tools: [] })).toBe(false);
    });

    it('is tried again only on a ready-made App’s own lookups, never on the batch that runs actions', () => {
        const refused = { error: 'Invalid session id sess-g1' };
        // A repeated write (a second calendar event) is worse than a refused one: the batch is never sent again, whatever the refusal says
        expect(retryWithoutSession({ readyMade: true }, 'COMPOSIO_MULTI_EXECUTE_TOOL', sent, refused)).toBeUndefined();
        expect(retryWithoutSession({ readyMade: true }, ' composio_multi_execute_tool ', sent, refused)).toBeUndefined();
        expect(retryWithoutSession({ readyMade: true }, 'COMPOSIO_GET_TOOL_SCHEMAS', { tool_slugs: [], session_id: 'sess-g1' }, refused)).toEqual({ tool_slugs: [] });
        expect(retryWithoutSession({ readyMade: true }, 'composio_search_tools', { queries: [], session_id: 'sess-g1' }, refused)).toEqual({ queries: [] });
        // A person's own server: session_id can be a real input of the tool
        expect(retryWithoutSession({}, 'COMPOSIO_SEARCH_TOOLS', { queries: [], session_id: 'sess-g1' }, refused)).toBeUndefined();
        expect(retryWithoutSession({ readyMade: true }, 'end_session', { session_id: 'sess-g1' }, refused)).toBeUndefined();
    });

    it('drops only the session from the inputs, and says when there was none', () => {
        expect(withoutSession({ tools: [1], thought: 't', session_id: 's' })).toEqual({ tools: [1], thought: 't' });
        expect(withoutSession({ queries: [], session: { id: 's', generate_id: false } })).toEqual({ queries: [], session: { generate_id: false } });
        expect(withoutSession({ queries: [], session: { id: 's' } })).toEqual({ queries: [] });
        expect(withoutSession({ queries: [], session: { generate_id: true } })).toBeUndefined();
        expect(withoutSession({ tools: [] })).toBeUndefined();
    });
});
