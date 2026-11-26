/** The link's search and schemas answers of several Apps joined into one (bots/mcp/AppLookups.ts). Pure. */
import { describe, expect, it } from 'vitest';
import { isJoinedLookup, joinLookupAnswers, retryWithoutSession, SessionOwners, sessionOfAnswer, sessionRefused, withoutSession } from '../mcp/AppLookups';

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

    const refusal = (error: string, id = 'sess-g1', outcome = 'failed') => sessionRefused({ error, outcome }, { tools: sent.tools, session_id: id });

    it('is told only when the whole error line is one of the known refusal shapes, with the id that was sent where an id is named', () => {
        const refused: Array<[string, string?]> = [
            ['Invalid session'],
            ['Unknown session'],
            ['Expired session'],
            ['Invalid session id'],
            ['Invalid session id sess-g1'],
            ['Invalid session id: sess-g1'],
            ['Invalid session id `sess-g1`'],
            ['Invalid session id "sess-g1".'],
            ["Invalid session id 'sess-g1'!"],
            ['Tool error: Invalid session id sess-g1'],
            ['Error: invalid session id sess-g1'],
            ['INVALID SESSION ID sess-g1'],
            ['Session not found'],
            ['Session is not found'],
            ['Session is invalid'],
            ['Session was expired'],
            ['Session id is not found'],
            ['Session id was expired'],
            ['Session id sess-g1 not found'],
            ['Session id sess-g1 is not found'],
            ['Session sess-g1 was not found'],
            ['Tool error: Invalid session id sess-g1 {"results":[{"tool_slug":"A"}],"note":"x"}'],
            ['Tool error: Invalid session   id  sess-g1 .'],
            // A named id that is also a word of a refusal, when that is the id that was sent
            ['Invalid session id unknown', 'unknown'],
            ['Invalid session id "unknown"', 'unknown'],
            ['Invalid session id new', 'new'],
        ];
        for (const [error, id] of refused) expect([error, refusal(error, id)]).toEqual([error, true]);
        expect(sessionRefused(text({ successful: false, error: 'Session not found' }), sent)).toBe(true);
        expect(sessionRefused(text({ successful: false, error: 'Unknown session' }), sent)).toBe(true);
    });

    it('is never told from any other line: another id, an id in another case, another word, words about what was done, or an id where a refusal word stands', () => {
        const not: Array<[string, string?]> = [
            ['The link is not answering.'],
            ['Strategy session could not be created'],
            ['Event note mentions sess-g1'],
            ['Invalid session id sess-other'],
            ['Invalid session id SESS-G1'],
            ['Invalid session id new'],
            ['Invalid session id unknown'],
            ['Invalid session id "unknown"'],
            ["Invalid session id 'expired'"],
            ['Invalid session id sess-g1x'],
            ['Invalid session id sess-g'],
            ['Invalid session. It was sess-g1'],
            ['Invalid session. Action 1 completed.'],
            ['Tool error: Invalid session. Action 1 completed.'],
            ['Invalid session id sess-g1 after the event was created'],
            ['Invalid session, please start a new one'],
            ['Session id expired'],
            ['Tool error: Session id expired'],
            ['Session id unknown'],
            ['Session sess-other not found'],
            ['Session expired for sess-other'],
            ['Your session id sess-g1 is invalid'],
            ['Invalid  session id sess-g1 and sess-other'],
            ['Tool error: Boom {"message":"Invalid session id sess-g1"}'],
            ['Tool error: {"successful":true,"data":{"results":[{"tool_slug":"A"}]}} then Invalid session'],
            ['MCP tool error: invalid session in the transport'],
            ['Invalid session id sess-g1', 'sess-other'],
            ['Invalid session id', ''],
        ];
        for (const [error, id] of not) expect([error, refusal(error, id)]).toEqual([error, false]);
        // A thrown error, an unsure outcome, an answer that carries results of actions (in data or at the root), a success: no refusal
        expect(refusal('Invalid session', 'sess-g1', 'uncertain')).toBe(false);
        expect(sessionRefused(text({ successful: false, error: 'Invalid session', data: { results: [{ index: 0, tool_slug: 'A', response: { successful: true } }] } }), sent)).toBe(false);
        expect(sessionRefused(text({ successful: false, error: 'Invalid session', results: [{ index: 0, tool_slug: 'A' }] }), sent)).toBe(false);
        expect(sessionRefused(text({ successful: true, data: { note: 'a session started' } }), sent)).toBe(false);
        expect(sessionRefused(null, sent)).toBe(false);
        // Nothing was sent with a session: nothing to take away
        expect(sessionRefused({ error: 'Invalid session' }, { tools: [] })).toBe(false);
    });

    it('holds for variants of one shape: the fixed words in any case and spacing, the sent id only as it was sent', () => {
        const ids = ['sess-g1', 'a.b+c', 'X_9', 'unknown', 'not', 'id'];
        for (const id of ids) {
            for (const shape of ['Invalid session id <ID>', 'invalid SESSION ID <ID>.', 'Unknown session id: <ID>', 'Session ID <ID> is not found', 'Session id <ID> was invalid']) {
                const line = shape.split('<ID>').join(id);
                expect([line, id, refusal(line, id)]).toEqual([line, id, true]);
                // The same line for another id, or for the id in another case, is no refusal of this one
                expect(refusal(line, id + 'x')).toBe(false);
                // (An id that is itself one of the fixed words, like "id", reads as that word in another case: the line is then a refusal without an id)
                if (id.toUpperCase() !== id && !['unknown', 'not', 'id'].includes(id)) {
                    const other = shape.split('<ID>').join(id.toUpperCase());
                    expect([other, id, refusal(other, id)]).toEqual([other, id, false]);
                }
            }
        }
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

describe('which App’s link gave a session id', () => {
    it('reads the session id a lookup handed out, never from a failed answer', () => {
        expect(sessionOfAnswer(text({ successful: true, data: { session: { id: 's1' } } }))).toBe('s1');
        expect(sessionOfAnswer({ session_id: 's2' })).toBe('s2');
        expect(sessionOfAnswer(text({ successful: false, error: 'down', data: { session: { id: 's3' } } }))).toBeUndefined();
        expect(sessionOfAnswer('Found mail actions.')).toBeUndefined();
        expect(sessionOfAnswer(null)).toBeUndefined();
    });

    it('remembers the App per session id and bot, and forgets the oldest past its limit', () => {
        const owners = new SessionOwners(2);
        owners.note('b1', { session_id: 's1' }, 'gmail');
        owners.note('b1', { session_id: 's2' }, 'calendar');
        expect(owners.ownerOf('b1', { session_id: 's1' })).toBe('gmail');
        expect(owners.ownerOf('b1', { session: { id: 's2' } })).toBe('calendar');
        expect(owners.ownerOf('b2', { session_id: 's1' })).toBeUndefined();
        expect(owners.ownerOf('b1', { tools: [] })).toBeUndefined();
        owners.note('b1', { session_id: 's3' }, 'gmail');
        expect(owners.ownerOf('b1', { session_id: 's1' })).toBeUndefined();
        expect(owners.ownerOf('b1', { session_id: 's3' })).toBe('gmail');
    });
});
