/**
 * A Brick with Gmail and Google Calendar on it: the link's search and schemas are asked of every App that allows them, and the answers
 * are one, so Calendar's actions are found (asking only Gmail's link never finds them). Writes stay as they were: each action of a
 * batch goes to its own App and asks first there. The gate here is the real one, on policies Orbit would answer for the two Apps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector, type ToolServerEntry } from '../mcp/MCPConnector';
import { ToolGate } from '../mcp/ToolGate';
import type { PolicyTool, ServerPolicy, ToolSetting } from '../mcp/ToolPolicy';
import type { ToolHeading } from '../mcp/ToolCatalog';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

const BATCH = 'COMPOSIO_MULTI_EXECUTE_TOOL';
const SEARCH = 'COMPOSIO_SEARCH_TOOLS';
const SCHEMAS = 'COMPOSIO_GET_TOOL_SCHEMAS';
const GMAIL: ToolServerEntry = {
    botId: 'b1',
    serverId: 'g1',
    serverUrl: 'https://link.example',
    authType: 'none',
    serverName: 'Gmail',
    connectionId: 'c1',
    readyMade: true,
    orbitUrl: 'https://orbit.example',
    fingerprint: 'fp-gmail',
};
const CALENDAR: ToolServerEntry = { ...GMAIL, serverId: 'cal1', serverName: 'Google Calendar', connectionId: 'c2', fingerprint: 'fp-cal' };
const DEFAULTS: Record<ToolHeading, ToolSetting> = { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' };

function policyOf(serverId: string, rows: Array<[string, ToolHeading, string]>, settings = DEFAULTS, own: Record<string, ToolSetting> = {}): ServerPolicy {
    const tools = new Map<string, PolicyTool>(rows.map(([name, heading, title]) => [name, { name, title, heading, fingerprint: `row-${name}`, suggestedHeading: heading, confirmed: true, setting: own[name] ?? null }]));
    return { serverId, kind: 'appActions', state: 'confirmed', policyRevision: 4, settings, tools };
}
const gmailPolicy = (settings = DEFAULTS, own: Record<string, ToolSetting> = {}) =>
    policyOf('g1', [['GMAIL_FETCH_EMAILS', 'looksUp', 'Fetch emails'], ['GMAIL_DELETE_MESSAGE', 'deletesOrSends', 'Delete message']], settings, own);
const calendarPolicy = (settings = DEFAULTS, own: Record<string, ToolSetting> = {}) =>
    policyOf(
        'cal1',
        [
            ['GOOGLECALENDAR_EVENTS_LIST', 'looksUp', 'List events'],
            ['GOOGLECALENDAR_CREATE_EVENT', 'changesThings', 'Create event'],
            ['GOOGLECALENDAR_UPDATE_EVENT', 'changesThings', 'Update event'],
            ['GOOGLECALENDAR_DELETE_EVENT', 'deletesOrSends', 'Delete event'],
        ],
        settings,
        own
    );

const text = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];
const wrote = (result: unknown) => JSON.parse(((result as Array<{ text: string }>)[0]).text) as Record<string, any>;

/** Each App's link answers a search with the actions it knows, as the real links do: its own only. */
function twoApps(gmail: ServerPolicy, calendar: ServerPolicy, options: { failing?: string } = {}) {
    const service = new AIService({ getMemory: () => ({ userUuid: 'uuid-khalid', dmRoomId: '!dm:matrix.test', playerName: 'Khalid' }) } as never, null!, '');
    const check = vi.fn(async () => ({ kind: 'allowed', allowed: true }));
    const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? calendar : gmail));
    service['toolGate'] = new ToolGate({ read } as never, { check } as never, { canManageBotTools: async () => false });
    service.useAppUse(vi.fn(async () => ({ allowed: true })) as never);
    service['noteBrick']('b1', { isDefault: false, ownerId: 'o1' }, 'Sam');
    const propose = vi.fn(async () => ({ kind: 'waiting', result: { status: 'waiting_for_ok', message: 'A card was shown.' } }));
    service.useApprovals({ propose, remembered: vi.fn(async () => false), settings: async () => ({ askBeforeMaking: null }) } as never);
    const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockImplementation(async (...args: unknown[]) => {
        const [serverId, , name, input] = args as [string, string, string, Record<string, any>];
        if (serverId === options.failing) return { error: 'The link is not answering.' } as never;
        const mine = serverId === 'cal1' ? 'GOOGLECALENDAR_EVENTS_LIST' : 'GMAIL_FETCH_EMAILS';
        if (name === SEARCH) {
            return text({ successful: true, data: { results: [{ index: 1, use_case: input.queries?.[0]?.use_case, primary_tool_slugs: [mine, serverId === 'cal1' ? 'GOOGLECALENDAR_DELETE_EVENT' : 'GMAIL_DELETE_MESSAGE'] }], session: { id: `sess-${serverId}` } } }) as never;
        }
        if (name === SCHEMAS) return text({ successful: true, data: { tool_schemas: Object.fromEntries((input.tool_slugs as string[]).map((slug) => [slug, { tool_slug: slug }])) } }) as never;
        return text({ ran: (input.tools as Array<{ tool_slug: string }>).map((tool) => tool.tool_slug) }) as never;
    });
    const servers = new Map<string, ToolServerEntry>([
        [BATCH, { ...GMAIL, otherApps: [CALENDAR] }],
        [SEARCH, { ...GMAIL, otherApps: [CALENDAR] }],
        [SCHEMAS, { ...GMAIL, otherApps: [CALENDAR] }],
    ]);
    const callTool = (name: string, args: unknown) => service['executeToolCalls']([{ id: 'c1', name, arguments: JSON.stringify(args) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
    const askedOf = () => execute.mock.calls.map((args: unknown[]) => args[0]);
    return { service, execute, propose, callTool, askedOf };
}

describe('a search on a Brick with Gmail and Calendar', () => {
    it('is asked of both Apps and finds the actions of both', async () => {
        const { callTool, askedOf } = twoApps(gmailPolicy(), calendarPolicy());
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'see my events this week' }] });
        expect(askedOf()).toEqual(['g1', 'cal1']);
        const data = wrote(searched.result);
        const slugs = data.data.results.flatMap((one: { primary_tool_slugs: string[] }) => one.primary_tool_slugs);
        expect(slugs).toContain('GOOGLECALENDAR_EVENTS_LIST');
        expect(slugs).toContain('GMAIL_FETCH_EMAILS');
        // One answer per question, whichever App found it; the oldest App's own single values stay
        expect(data.data.results).toHaveLength(1);
        expect(data.data.session.id).toBe('sess-g1');
    });

    it('shows each App’s call its own id, so neither counts as the other’s retry', async () => {
        const { callTool, execute } = twoApps(gmailPolicy(), calendarPolicy());
        await callTool(SEARCH, { queries: [{ use_case: 'events' }] });
        const appUse = execute.mock.calls.map((args: unknown[]) => (args[10] as { callId: string }).callId);
        expect(new Set(appUse).size).toBe(2);
    });

    it('never hides one App’s actions because the other has lookups Off', async () => {
        const { callTool, askedOf } = twoApps(gmailPolicy({ ...DEFAULTS, looksUp: 'off' }), calendarPolicy());
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'events' }] });
        expect(askedOf()).toEqual(['cal1']);
        expect(JSON.stringify(searched.result)).toContain('GOOGLECALENDAR_EVENTS_LIST');
    });

    it('takes an action that is Off in either App out of the joined answer', async () => {
        const { callTool } = twoApps(gmailPolicy(DEFAULTS, { GMAIL_DELETE_MESSAGE: 'off' }), calendarPolicy(DEFAULTS, { GOOGLECALENDAR_DELETE_EVENT: 'off' }));
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'delete things' }] });
        const body = JSON.stringify(searched.result);
        expect(body).not.toContain('GMAIL_DELETE_MESSAGE');
        expect(body).not.toContain('GOOGLECALENDAR_DELETE_EVENT');
        expect(body).toContain('GOOGLECALENDAR_EVENTS_LIST');
        expect(body).toContain('GMAIL_FETCH_EMAILS');
    });

    it('names an App that did not answer, and still gives what the other found', async () => {
        const { callTool } = twoApps(gmailPolicy(), calendarPolicy(), { failing: 'g1' });
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'events' }] });
        const data = wrote(searched.result);
        expect(JSON.stringify(data)).toContain('GOOGLECALENDAR_EVENTS_LIST');
        expect(data.apps_that_did_not_answer).toEqual(['Gmail did not answer: The link is not answering.']);
    });

    it('is refused as before when no App allows it', async () => {
        const off = { ...DEFAULTS, looksUp: 'off' as const };
        const { callTool, execute } = twoApps(gmailPolicy(off), calendarPolicy(off));
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'events' }] });
        expect(execute).not.toHaveBeenCalled();
        expect(searched.result.error).toContain('turned off');
    });

    it('shows the card of an App that asks first for lookups before anything is asked, and runs nothing until the person says yes', async () => {
        // The person's own link, whose search was confirmed as Asks first (a ready-made App's lookups never ask)
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My link', fingerprint: 'fp-own' };
        const ownPolicy: ServerPolicy = {
            serverId: 'own1',
            kind: 'tools',
            state: 'confirmed',
            policyRevision: 2,
            settings: DEFAULTS,
            tools: new Map<string, PolicyTool>([[SEARCH, { name: SEARCH, heading: 'looksUp', fingerprint: 'fp-own', suggestedHeading: 'looksUp', confirmed: true, setting: 'asksFirst' }]]),
        };
        const { service, execute, propose } = twoApps(gmailPolicy(), calendarPolicy());
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ownPolicy : serverId === 'cal1' ? calendarPolicy() : gmailPolicy()));
        service['toolGate'] = new ToolGate({ read } as never, { check: vi.fn(async () => ({ kind: 'allowed', allowed: true })) } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([[SEARCH, { ...own, otherApps: [GMAIL, CALENDAR] }]]);
        const [searched] = await service['executeToolCalls']([{ id: 'c1', name: SEARCH, arguments: '{"queries":[{"use_case":"events"}]}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(propose).toHaveBeenCalledTimes(1);
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: SEARCH, entry: expect.objectContaining({ serverId: 'own1' }) }));
        expect(execute).not.toHaveBeenCalled();
        expect(searched.result).toMatchObject({ status: 'waiting_for_ok' });
    });
});

describe('the schemas of actions on a Brick with Gmail and Calendar', () => {
    it('goes for each action to the App that owns it, and joins what they answer', async () => {
        const { callTool, execute } = twoApps(gmailPolicy(), calendarPolicy());
        const [schemas] = await callTool(SCHEMAS, { tool_slugs: ['GOOGLECALENDAR_CREATE_EVENT', 'GMAIL_FETCH_EMAILS'] });
        expect(execute.mock.calls.map((args: unknown[]) => [args[0], (args[3] as { tool_slugs: string[] }).tool_slugs])).toEqual([
            ['g1', ['GMAIL_FETCH_EMAILS']],
            ['cal1', ['GOOGLECALENDAR_CREATE_EVENT']],
        ]);
        expect(Object.keys(wrote(schemas.result).data.tool_schemas).sort()).toEqual(['GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_CREATE_EVENT']);
    });

    it('asks only the App that owns the one action named', async () => {
        const { callTool, askedOf } = twoApps(gmailPolicy(), calendarPolicy());
        await callTool(SCHEMAS, { tool_slugs: ['GOOGLECALENDAR_CREATE_EVENT'] });
        expect(askedOf()).toEqual(['cal1']);
    });

    it('asks every App about an action no App clearly owns, so it is never lost', async () => {
        const { callTool, askedOf } = twoApps(gmailPolicy(), calendarPolicy());
        await callTool(SCHEMAS, { tool_slugs: ['SLACK_SEND_MESSAGE'] });
        expect(askedOf()).toEqual(['g1', 'cal1']);
    });
});

describe('a batch on a Brick with Gmail and Calendar, after its actions were found', () => {
    it('asks first for a calendar create, update and delete on one Calendar card, and runs only the lookup right away', async () => {
        const { callTool, execute, propose } = twoApps(gmailPolicy(), calendarPolicy());
        const [batched] = await callTool(BATCH, {
            tools: [
                { tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', arguments: {} },
                { tool_slug: 'GOOGLECALENDAR_CREATE_EVENT', arguments: { summary: 'Lunch' } },
                { tool_slug: 'GOOGLECALENDAR_UPDATE_EVENT', arguments: { id: 'e1' } },
                { tool_slug: 'GOOGLECALENDAR_DELETE_EVENT', arguments: { id: 'e2' } },
            ],
            thought: 'organising the week',
        });
        // Only the lookup runs, through Calendar; the three writes wait on one card of Calendar's own
        const sent = execute.mock.calls.flatMap((args: unknown[]) => (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((tool) => tool.tool_slug));
        expect(sent).toEqual(['GOOGLECALENDAR_EVENTS_LIST']);
        expect(execute.mock.calls.every((args: unknown[]) => args[0] === 'cal1')).toBe(true);
        expect(propose).toHaveBeenCalledTimes(1);
        const asked = (propose.mock.calls[0] as unknown[])[0] as { args: { tools: Array<{ tool_slug: string }> }; entry: ToolServerEntry };
        expect(asked.entry.serverId).toBe('cal1');
        expect(asked.args.tools.map((tool) => tool.tool_slug)).toEqual(['GOOGLECALENDAR_CREATE_EVENT', 'GOOGLECALENDAR_UPDATE_EVENT', 'GOOGLECALENDAR_DELETE_EVENT']);
        expect(batched.result).toMatchObject({ status: 'waiting_for_ok' });
    });

    it('never runs a calendar delete right away because Gmail’s delete is on, or the other way round', async () => {
        const gmail = gmailPolicy({ ...DEFAULTS, deletesOrSends: 'rightAway' });
        const { callTool, execute, propose } = twoApps(gmail, calendarPolicy());
        await callTool(BATCH, { tools: [{ tool_slug: 'GOOGLECALENDAR_DELETE_EVENT', arguments: { id: 'e2' } }, { tool_slug: 'GMAIL_DELETE_MESSAGE', arguments: { id: 'm1' } }] });
        expect(execute.mock.calls.map((args: unknown[]) => [args[0], (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((tool) => tool.tool_slug)])).toEqual([['g1', ['GMAIL_DELETE_MESSAGE']]]);
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'GOOGLECALENDAR_DELETE_EVENT' }));
    });
});

describe('a session id that Calendar’s link does not know', () => {
    it('never sends a batch of actions again, whatever the refusal says: the answer is the refusal', async () => {
        const { service, execute, propose } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockImplementation(async (...args: unknown[]) => ((args[3] as Record<string, unknown>).session_id ? { error: 'Invalid session id: sess-g1' } : text({ successful: true, data: { ran: true } })) as never);
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...GMAIL, otherApps: [CALENDAR] }]]);
        const [batched] = await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify({ tools: [{ tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', arguments: {} }], session_id: 'sess-g1' }) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls.every((args: unknown[]) => args[0] === 'cal1')).toBe(true);
        expect(JSON.stringify(batched.result)).toContain('Invalid session');
        expect(propose).not.toHaveBeenCalled();
    });

    it('never retries a write that was not approved: it asks first, and nothing is sent', async () => {
        const { service, execute, propose } = twoApps(gmailPolicy(), calendarPolicy());
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...GMAIL, otherApps: [CALENDAR] }]]);
        await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify({ tools: [{ tool_slug: 'GOOGLECALENDAR_DELETE_EVENT', arguments: { id: 'e2' } }], session_id: 'sess-g1' }) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(propose).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not retry a failure that is not about the session', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockResolvedValue({ error: 'The link is not answering.' } as never);
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...GMAIL, otherApps: [CALENDAR] }]]);
        await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify({ tools: [{ tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', arguments: {} }], session_id: 'sess-g1' }) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('is never tried again when the call may have run some of its actions, or threw, or is a person’s own server', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...GMAIL, otherApps: [CALENDAR] }]]);
        const two = JSON.stringify({ tools: [{ tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', arguments: {} }, { tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', arguments: { id: 'again' } }], session_id: 'sess-g1' });
        // Two actions, one ran, and the top-level error says "session": a second try would run the first again
        execute.mockResolvedValue(text({ successful: false, error: 'Invalid session for one action', data: { results: [{ index: 0, tool_slug: 'GOOGLECALENDAR_EVENTS_LIST', response: { successful: true } }, { index: 1, error: 'Invalid session' }] } }) as never);
        await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: two }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
        // A thrown error comes back as "MCP tool error": it may have been sent
        execute.mockClear();
        execute.mockRejectedValue(new Error('Invalid session in the transport'));
        await service['executeToolCalls']([{ id: 'c2', name: BATCH, arguments: two }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
        // A person's own server first under the name: session_id may be a real input, so it is never taken away
        execute.mockClear();
        execute.mockResolvedValue({ error: 'Invalid session id sess-g1' } as never);
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My link', fingerprint: 'fp-own' };
        const ownRead = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ({ serverId: 'own1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() } as ServerPolicy) : gmailPolicy()));
        service['toolGate'] = new ToolGate({ read: ownRead } as never, { check: vi.fn(async () => ({ kind: 'allowed', allowed: true })) } as never, { canManageBotTools: async () => false });
        await service['executeToolCalls']([{ id: 'c3', name: SEARCH, arguments: JSON.stringify({ queries: [], session_id: 'sess-g1' }) }], undefined, undefined, new Map([[SEARCH, { ...own, otherApps: [] }]]) as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('is tried again without the session for a search too', async () => {
        const { callTool, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockImplementation(async (...args: unknown[]) => {
            const input = args[3] as { session_id?: string };
            return (input.session_id && args[0] === 'cal1' ? { error: 'Session not found' } : text({ successful: true, data: { results: [] } })) as never;
        });
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'events' }], session_id: 'sess-g1' });
        // Gmail knew it; Calendar did not and was asked again without it
        expect(execute.mock.calls.map((args: unknown[]) => [args[0], 'session_id' in (args[3] as object)])).toEqual([['g1', true], ['cal1', true], ['cal1', false]]);
        expect(JSON.stringify(searched.result)).not.toContain('did not answer');
    });
});

describe('a write approved on its card, when the link refuses the session id', () => {
    const refused = { error: 'Invalid session id sess-g1' };

    it('runs the approved batch once, even when the link refuses its session id: a repeated write is worse than a refused one', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockResolvedValueOnce(refused as never).mockResolvedValueOnce(text({ successful: true, data: { ran: true } }) as never);
        const batch = { tools: [{ tool_slug: 'GOOGLECALENDAR_CREATE_EVENT', arguments: { summary: 'Lunch' } }, { tool_slug: 'GOOGLECALENDAR_UPDATE_EVENT', arguments: { id: 'e1' } }], session_id: 'sess-g1', thought: 'week' };
        const answer = await service.runApprovedTool('b1', CALENDAR, BATCH, batch, 'uuid-khalid', undefined, { heading: 'changesThings', callId: 'card-1' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect((execute.mock.calls[0][3] as { session_id?: string }).session_id).toBe('sess-g1');
        expect(JSON.stringify(answer)).toContain('Invalid session');
    });

    it('runs one approved action once: it carries no session id to refuse', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockResolvedValue(text({ successful: true, data: { ran: true } }) as never);
        const actionEntry = { ...CALENDAR, appAction: { slug: 'GOOGLECALENDAR_CREATE_EVENT', batchTool: BATCH } };
        await service.runApprovedTool('b1', actionEntry, 'GOOGLECALENDAR_CREATE_EVENT', { summary: 'Lunch' }, 'uuid-khalid', undefined, { heading: 'changesThings', callId: 'card-2' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect('session_id' in (execute.mock.calls[0][3] as object)).toBe(false);
    });

    it('never runs a second time', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockResolvedValue(refused as never);
        await service.runApprovedTool('b1', CALENDAR, BATCH, { tools: [{ tool_slug: 'GOOGLECALENDAR_CREATE_EVENT', arguments: {} }], session_id: 'sess-g1' }, 'uuid-khalid', undefined, { heading: 'changesThings', callId: 'card-3' });
        expect(execute).toHaveBeenCalledTimes(1);
    });
});

describe('what the review of #2152 found', () => {
    it('keeps an Off action out of a structured answer even when another App answers in prose', async () => {
        const { callTool, execute } = twoApps(gmailPolicy(DEFAULTS, { GMAIL_DELETE_MESSAGE: 'off' }), calendarPolicy());
        execute.mockImplementation(async (...args: unknown[]) => (args[0] === 'g1' ? text({ data: { results: [{ index: 1, primary_tool_slugs: ['GMAIL_DELETE_MESSAGE', 'GMAIL_FETCH_EMAILS'] }] } }) : 'Calendar found nothing.') as never);
        const [searched] = await callTool(SEARCH, { queries: [{ use_case: 'clean up' }] });
        const body = JSON.stringify(searched.result);
        expect(body).not.toContain('GMAIL_DELETE_MESSAGE');
        expect(body).toContain('GMAIL_FETCH_EMAILS');
        expect(body).toContain('Calendar found nothing.');
    });

    it('tries a single App’s search again without the session id of another App’s link', async () => {
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        execute.mockImplementation(async (...args: unknown[]) => ((args[3] as { session_id?: string }).session_id ? { error: 'Invalid session id sess-g1' } : text({ successful: true, data: { results: [] } })) as never);
        const servers = new Map<string, ToolServerEntry>([[SEARCH, CALENDAR]]);
        await service['executeToolCalls']([{ id: 'c1', name: SEARCH, arguments: JSON.stringify({ queries: [], session_id: 'sess-g1' }) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute.mock.calls.map((args: unknown[]) => 'session_id' in (args[3] as object))).toEqual([true, false]);
    });

    it('counts a person’s own link search that makes things toward the Brick’s limit, as on the ordinary path', async () => {
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My link', fingerprint: 'fp-own' };
        const ownPolicy: ServerPolicy = {
            serverId: 'own1',
            kind: 'tools',
            state: 'confirmed',
            policyRevision: 2,
            settings: DEFAULTS,
            tools: new Map<string, PolicyTool>([[SEARCH, { name: SEARCH, heading: 'makesNew', fingerprint: 'fp-own', suggestedHeading: 'makesNew', confirmed: true, setting: 'rightAway' }]]),
        };
        const { service, execute } = twoApps(gmailPolicy(), calendarPolicy());
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ownPolicy : serverId === 'cal1' ? calendarPolicy() : gmailPolicy()));
        service['toolGate'] = new ToolGate({ read } as never, { check: vi.fn(async () => ({ kind: 'allowed', allowed: true })) } as never, { canManageBotTools: async () => false });
        const check = vi.spyOn(service as never, 'checkHowMany' as never).mockResolvedValue({ kind: 'result', result: { status: 'waiting_for_ok' } } as never);
        const servers = new Map<string, ToolServerEntry>([[SEARCH, { ...own, otherApps: [GMAIL, CALENDAR] }]]);
        const [searched] = await service['executeToolCalls']([{ id: 'c1', name: SEARCH, arguments: '{"queries":[{"use_case":"events"}]}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(check).toHaveBeenCalledTimes(1);
        expect(searched.result).toMatchObject({ status: 'waiting_for_ok' });
        expect(execute).not.toHaveBeenCalled();
    });
});
