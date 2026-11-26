/**
 * A ready-made App's batch call on a Brick, judged per action (game "Ask, Do, Ignore" for Bricks): reads run with no card, the
 * actions that ask first go on ONE card holding only them, an Off action is never sent, and the model gets one answer. The gate
 * here is the real one, on a policy Orbit would answer for a Brick's Gmail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService, sharedLineOf } from '../ai/AIService';
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
const GMAIL: ToolServerEntry = {
    botId: 'b1',
    serverId: 'g1',
    serverUrl: 'https://link.example',
    authType: 'none',
    serverName: 'Gmail',
    connectionId: 'c1',
    readyMade: true,
    orbitUrl: 'https://orbit.example',
    fingerprint: 'fp-batch',
    title: 'Multi Execute Composio Tools',
};
const SERVERS = new Map<string, ToolServerEntry>([
    [BATCH, GMAIL],
    ['COMPOSIO_SEARCH_TOOLS', { ...GMAIL, fingerprint: 'fp-search', title: 'Search tools' }],
]);

const DEFAULTS: Record<ToolHeading, ToolSetting> = { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' };

function gmailPolicy(own: Record<string, ToolSetting> = {}, settings = DEFAULTS): ServerPolicy {
    const rows: Array<[string, ToolHeading, string]> = [
        ['GMAIL_FETCH_EMAILS', 'looksUp', 'Fetch emails'],
        ['GMAIL_LIST_LABELS', 'looksUp', 'List labels'],
        ['GMAIL_CREATE_EMAIL_DRAFT', 'makesNew', 'Create email draft'],
        ['GMAIL_ADD_LABEL_TO_EMAIL', 'changesThings', 'Add label to email'],
        ['GMAIL_REPLY_TO_THREAD', 'deletesOrSends', 'Reply to thread'],
        ['GMAIL_DELETE_MESSAGE', 'deletesOrSends', 'Delete message'],
    ];
    const tools = new Map<string, PolicyTool>(
        rows.map(([name, heading, title]) => [name, { name, title, heading, fingerprint: `row-${name}`, suggestedHeading: heading, confirmed: true, setting: own[name] ?? null }])
    );
    return { serverId: 'g1', kind: 'appActions', state: 'confirmed', policyRevision: 9, settings, tools };
}

const DM_MEMORY = { getMemory: () => ({ userUuid: 'uuid-khalid', dmRoomId: '!dm:matrix.test', playerName: 'Khalid' }) };

function brickService(policy: ServerPolicy, options: { memory?: unknown; approvals?: Record<string, unknown>; allowed?: (action: string) => boolean } = {}) {
    const service = new AIService((options.memory ?? DM_MEMORY) as never, null!, '');
    const check = vi.fn(async (_bot: string, action: string) => ((options.allowed ?? (() => true))(action) ? { kind: 'allowed', allowed: true } : { kind: 'refused', allowed: false, line: `You can't ${action} here.` }));
    service['toolGate'] = new ToolGate({ read: async () => policy } as never, { check } as never, { canManageBotTools: async () => false });
    const appUse = vi.fn(async () => ({ allowed: true }));
    service.useAppUse(appUse as never);
    service['noteBrick']('b1', { isDefault: false, ownerId: 'o1' }, 'Sam');
    const propose = vi.fn(async () => ({ kind: 'waiting', result: { status: 'waiting_for_ok', message: 'A card was shown.' } }));
    const remembered = vi.fn(async () => false);
    service.useApprovals({ propose, remembered, settings: async () => ({ askBeforeMaking: null }), ...(options.approvals ?? {}) } as never);
    const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockImplementation(async (...args: unknown[]) => [{ type: 'text', text: `ran ${JSON.stringify((args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug))}` }] as never);
    return { service, propose, remembered, appUse, execute, check };
}

const batchArgs = (...slugs: string[]) => ({ tools: slugs.map((slug) => ({ tool_slug: slug, arguments: { id: slug.toLowerCase() } })), thought: 'reading mail', session_id: 'sess-1' });

const call = (service: AIService, args: unknown, botClient?: unknown, spaceName?: string) =>
    service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(args) }], botClient as never, undefined, SERVERS as never, 'uuid-khalid', spaceName, 'b1', 7);

const sentSlugs = (execute: ReturnType<typeof vi.spyOn>) => execute.mock.calls.map((args: unknown[]) => (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((tool) => tool.tool_slug));

describe('a batch of reads', () => {
    it('runs with no card, as one batch, and answers exactly as before', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS'));
        expect(propose).not.toHaveBeenCalled();
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS']]);
        // The batch's other inputs are kept as they were
        expect(execute.mock.calls[0][3]).toMatchObject({ thought: 'reading mail', session_id: 'sess-1' });
        expect(result.result).toEqual([{ type: 'text', text: 'ran ["GMAIL_FETCH_EMAILS","GMAIL_LIST_LABELS"]' }]);
    });
});

describe('a batch with a part that asks first', () => {
    it('runs the reads now and puts only the asking part on a card', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_REPLY_TO_THREAD'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).toHaveBeenCalledTimes(1);
        expect(propose).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'GMAIL_REPLY_TO_THREAD',
                args: { id: 'gmail_reply_to_thread' },
                decision: expect.objectContaining({ kind: 'ask', heading: 'deletesOrSends', fingerprint: 'fp-batch', policyRevision: 9 }),
                entry: expect.objectContaining({ serverId: 'g1', title: 'Reply to thread', appAction: { slug: 'GMAIL_REPLY_TO_THREAD', batchTool: BATCH } }),
            })
        );
        expect(result.result).toMatchObject({ status: 'waiting_for_ok', done: [{ type: 'text', text: 'ran ["GMAIL_FETCH_EMAILS"]' }] });
        expect(result.result.summary).toContain('Done now: Fetch emails.');
        expect(result.result.summary).toContain("Waiting for the person's OK on a card: Reply to thread.");
    });

    it('puts several asking parts on ONE card that holds only them', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        await call(service, batchArgs('GMAIL_ADD_LABEL_TO_EMAIL', 'GMAIL_FETCH_EMAILS', 'GMAIL_REPLY_TO_THREAD'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).toHaveBeenCalledTimes(1);
        const asked = (propose.mock.calls[0] as unknown[])[0] as { toolName: string; args: { tools: Array<{ tool_slug: string }>; thought: string }; decision: { heading: string } };
        expect(asked.toolName).toBe(BATCH);
        expect(asked.args.tools.map((tool) => tool.tool_slug)).toEqual(['GMAIL_ADD_LABEL_TO_EMAIL', 'GMAIL_REPLY_TO_THREAD']);
        expect(asked.args.thought).toBe('reading mail');
        expect(asked.decision.heading).toBe('deletesOrSends');
    });

    it('runs an asking action that an "allow more" in this chat covers, with the reads', async () => {
        const remembered = vi.fn(async (input: { toolName: string }) => input.toolName === 'GMAIL_ADD_LABEL_TO_EMAIL');
        const { service, execute, propose } = brickService(gmailPolicy(), { approvals: { remembered } });
        await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_ADD_LABEL_TO_EMAIL', 'GMAIL_REPLY_TO_THREAD'));
        // Remembered per action, by its own slug and inputs
        expect(remembered).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'GMAIL_ADD_LABEL_TO_EMAIL', args: { id: 'gmail_add_label_to_email' } }));
        // Two headings run: one batch each, so a lent App's check sees both
        expect(sentSlugs(execute).sort()).toEqual([['GMAIL_ADD_LABEL_TO_EMAIL'], ['GMAIL_FETCH_EMAILS']]);
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'GMAIL_REPLY_TO_THREAD' }));
    });

    it('runs the asking part at once when the card says a remembered approval covers it', async () => {
        const { service, execute } = brickService(gmailPolicy(), { approvals: { propose: vi.fn(async () => ({ kind: 'run' })) } });
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_ADD_LABEL_TO_EMAIL'));
        expect(sentSlugs(execute).sort()).toEqual([['GMAIL_ADD_LABEL_TO_EMAIL'], ['GMAIL_FETCH_EMAILS']]);
        expect(result.result.summary).toContain('Done now: Fetch emails, Add label to email.');
    });

    it('tells the model a part was not done when its card could not be shown, without failing the reads', async () => {
        const { service } = brickService(gmailPolicy(), { approvals: { propose: vi.fn(async () => ({ kind: 'failed', result: { error: 'The card could not be shown.' } })) } });
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_REPLY_TO_THREAD'));
        expect(result.result.error).toBeUndefined();
        expect(result.result.summary).toContain('The card could not be shown.');
    });
});

describe('an Off part', () => {
    it('is never sent, is named in the answer, and the rest runs', async () => {
        const { service, execute, propose } = brickService(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }));
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_DELETE_MESSAGE'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).not.toHaveBeenCalled();
        expect(result.result.notDone).toEqual(['Delete message is off for Sam in Gmail.']);
    });

    it('alone: nothing is sent and the call did not happen', async () => {
        const { service, execute } = brickService(gmailPolicy({}, { ...DEFAULTS, deletesOrSends: 'off' }));
        const [result] = await call(service, batchArgs('GMAIL_DELETE_MESSAGE', 'GMAIL_SEND_SOMETHING_NEW'));
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.outcome).toBe('not_sent');
        expect(result.result.error).toContain('Delete message');
        expect(result.result.error).toContain('off for Sam in Gmail');
    });

    it('is taken out of what the App’s search answers', async () => {
        const { service, execute } = brickService(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }));
        execute.mockResolvedValue([{ type: 'text', text: JSON.stringify({ results: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'GMAIL_DELETE_MESSAGE' }], labels: ['CATEGORY_UPDATES'] }) }] as never);
        const [result] = await service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{"queries":[{"use_case":"clean inbox"}]}' }], undefined, undefined, SERVERS as never, 'uuid-khalid', undefined, 'b1', 7);
        const text = JSON.parse(result.result[0].text);
        expect(text.results).toEqual([{ tool_slug: 'GMAIL_FETCH_EMAILS' }]);
        // Only a known action is taken out: a label that looks like one stays
        expect(text.labels).toEqual(['CATEGORY_UPDATES']);
    });

    it('is told to the Brick per App, so it says so and offers what it may do', async () => {
        const { service } = brickService(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }, { ...DEFAULTS, makesNew: 'off' }));
        const note = await service['appsOffNote']('b1', SERVERS);
        expect(note).toContain('Off in Gmail: Create email draft, Delete message; anything else that makes new things.');
        const quiet = brickService(gmailPolicy());
        expect(await quiet.service['appsOffNote']('b1', SERVERS)).toBe('');
    });
});

describe('the per-use check', () => {
    it('is asked once for each heading that runs, never for what waits or is off', async () => {
        const { service, appUse } = brickService(gmailPolicy({ GMAIL_ADD_LABEL_TO_EMAIL: 'rightAway' }));
        await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_ADD_LABEL_TO_EMAIL', 'GMAIL_REPLY_TO_THREAD'));
        const headings = appUse.mock.calls.map((args: unknown[]) => (args[2] as { heading: string }).heading).sort();
        expect(headings).toEqual(['changesThings', 'looksUp']);
    });
});

describe('the same gate on every surface', () => {
    const bubble = (voice: boolean) => ({
        isVoiceBot: () => voice,
        getPersonForArtifacts: () => ({ signedIn: true, identifier: 'uuid-khalid', name: 'Khalid' }),
        getFullConfig: () => ({ name: 'Sam' }),
    });

    for (const [surface, botClient, spaceName] of [
        ['nearby chat on a map', bubble(false), 'room-1'],
        ['voice', bubble(true), 'room-1'],
    ] as const) {
        it(`${surface}: the card goes to the asker alone and the bubble reads one line`, async () => {
            const propose = vi.fn(async () => ({ kind: 'waiting', result: { status: 'waiting_for_ok', message: 'Shown to them alone.', sharedLine: 'Sam needs Khalid’s OK first.' } }));
            const { service, execute } = brickService(gmailPolicy(), { memory: null, approvals: { propose } });
            service['askForOk'] = vi.fn(async (...args: unknown[]) => {
                const proposed = await propose(...(args as []));
                return { kind: 'result', result: proposed.result };
            }) as never;
            const results = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_REPLY_TO_THREAD'), botClient, spaceName);
            expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
            // Asked for the person in the bubble (their player id): a card only they see
            expect((service['askForOk'] as ReturnType<typeof vi.fn>).mock.calls[0][5]).toBe(7);
            expect(sharedLineOf(results)).toBe('Sam needs Khalid’s OK first.');
        });
    }

    it('brought along or in direct messages: the same split', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_REPLY_TO_THREAD'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ roomId: '!dm:matrix.test', person: { uuid: 'uuid-khalid', name: 'Khalid' } }));
    });

    it('someone else never gets a ready-made App’s tool, even one marked as a shared job', async () => {
        const { service, execute } = brickService(gmailPolicy());
        const shared = new Map<string, ToolServerEntry>([['COMPOSIO_SEARCH_TOOLS', { ...GMAIL, sharedJob: { inputs: ['query'] } }]]);
        const results = await service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: JSON.stringify({ query: 'x' }) }], undefined, undefined, shared as never, 'uuid-guest', undefined, 'b1', 8, undefined, undefined, false, undefined, undefined, undefined, false, true);
        expect(execute).not.toHaveBeenCalled();
        expect(results[0].result.error).toBeTruthy();
    });

    it('someone else is never offered the owner’s App, and a forged call is not run', async () => {
        const { service, execute } = brickService(gmailPolicy());
        const results = await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(batchArgs('GMAIL_FETCH_EMAILS')) }], undefined, undefined, SERVERS as never, 'uuid-guest', undefined, 'b1', 8, undefined, undefined, false, undefined, undefined, undefined, false, true);
        expect(execute).not.toHaveBeenCalled();
        expect(results[0].result.error).toBeTruthy();
    });
});

describe('the actions that make new things', () => {
    it('count toward the bot’s limit one by one', async () => {
        const checkHowMany = vi.fn(async () => ({ kind: 'result', result: { status: 'waiting_for_ok', message: 'Over the limit: a card.' } }));
        const { service, execute } = brickService(gmailPolicy());
        service['checkHowMany'] = checkHowMany as never;
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_CREATE_EMAIL_DRAFT'));
        expect(checkHowMany).toHaveBeenCalledTimes(1);
        expect((checkHowMany.mock.calls[0] as unknown[])[1]).toBe('GMAIL_CREATE_EMAIL_DRAFT');
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(result.result.status).toBe('waiting_for_ok');
    });
});

describe('several batches that run right away', () => {
    it('run one after another, in the order they were asked, so a later action can use what an earlier one made', async () => {
        const { service, execute } = brickService(gmailPolicy());
        const events: string[] = [];
        execute.mockImplementation((async (...args: unknown[]) => {
            const slugs = (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((tool) => tool.tool_slug).join(',');
            events.push(`start ${slugs}`);
            await new Promise<void>((resolve) => queueMicrotask(resolve));
            await new Promise<void>((resolve) => queueMicrotask(resolve));
            events.push(`end ${slugs}`);
            return [{ type: 'text', text: `ran ${slugs}` }];
        }) as never);
        const [result] = await call(service, batchArgs('GMAIL_CREATE_EMAIL_DRAFT', 'GMAIL_FETCH_EMAILS'));
        expect(events).toEqual(['start GMAIL_CREATE_EMAIL_DRAFT', 'end GMAIL_CREATE_EMAIL_DRAFT', 'start GMAIL_FETCH_EMAILS', 'end GMAIL_FETCH_EMAILS']);
        expect(result.result.summary).toContain('Done now: Create email draft, Fetch emails.');
    });
});

describe('the App’s connection', () => {
    it('is checked right away, and reconnected only after the person’s OK on a card', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        execute.mockResolvedValue([{ type: 'text', text: 'connected' }] as never);
        const servers = new Map<string, ToolServerEntry>([['COMPOSIO_MANAGE_CONNECTIONS', { ...GMAIL, fingerprint: 'fp-connect', title: 'Connections' }]]);
        const manage = (args: unknown) => service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_MANAGE_CONNECTIONS', arguments: JSON.stringify(args) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        await manage({ toolkits: ['gmail'] });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
        const [asked] = await manage({ toolkits: ['gmail'], reinitiate_all: true });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(propose).toHaveBeenCalledTimes(1);
        expect(asked.result.status).toBe('waiting_for_ok');
    });
});

describe('what runs is what the card showed', () => {
    it('sends each action as its slug and its inputs only, never other keys the model added', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const args = { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { id: 'a' }, parameters: { to: 'boss@x' } }, { tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: { body: 'hi' }, extra: 1 }, { tool_slug: 'GMAIL_ADD_LABEL_TO_EMAIL', arguments: { label: 'x' } }] };
        await call(service, args);
        expect(execute.mock.calls[0][3]).toEqual({ tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { id: 'a' } }] });
        // Several wait: the card's batch holds only what it shows
        expect((propose.mock.calls[0] as unknown[])[0]).toMatchObject({
            args: { tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: { body: 'hi' } }, { tool_slug: 'GMAIL_ADD_LABEL_TO_EMAIL', arguments: { label: 'x' } }] },
        });
    });

    it('reads inputs written as JSON text as the object they hold: the card shows it and only it is sent', async () => {
        const { service, execute, propose } = brickService(gmailPolicy({}, { ...DEFAULTS, deletesOrSends: 'rightAway' }));
        await call(service, { tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: '{"to":"boss@x","body":"hi"}' }] });
        expect((execute.mock.calls[0] as unknown[])[3]).toMatchObject({ tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: { to: 'boss@x', body: 'hi' } }] });
        const asking = brickService(gmailPolicy());
        await call(asking.service, { tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: '{"to":"boss@x","body":"I quit"}' }] });
        expect(asking.execute).not.toHaveBeenCalled();
        expect((asking.propose.mock.calls[0] as unknown[])[0]).toMatchObject({ toolName: 'GMAIL_REPLY_TO_THREAD', args: { to: 'boss@x', body: 'I quit' } });
        expect(propose).not.toHaveBeenCalled();
    });

    it('judges actions with inputs written as JSON text one by one: an Off one is never sent and the rest runs', async () => {
        const { service, execute } = brickService(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }));
        const [result] = await call(service, {
            tools: [
                { tool_slug: 'GMAIL_FETCH_EMAILS', arguments: '{"max":5}' },
                { tool_slug: 'GMAIL_DELETE_MESSAGE', arguments: '{"id":"m1"}' },
            ],
        });
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect((execute.mock.calls[0] as unknown[])[3]).toMatchObject({ tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { max: 5 } }] });
        expect(result.result.summary).toContain('Delete message is off');
    });

    it('refuses a batch whose inputs can’t be read as an object (the card could not show them), and sends nothing', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        for (const inputs of ['to boss: I quit', '["I quit"]', 42]) {
            const [result] = await call(service, { tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: inputs }] });
            expect(result.result.error).toBeTruthy();
        }
        expect(execute).not.toHaveBeenCalled();
        expect(propose).not.toHaveBeenCalled();
    });
});

describe('what the model is told was done', () => {
    it('never says a part was done when its call failed, or proved it made nothing', async () => {
        const { service, execute } = brickService(gmailPolicy({}, { ...DEFAULTS, changesThings: 'rightAway' }));
        execute.mockImplementation((async (...args: unknown[]) => {
            const slugs = (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug);
            if (slugs.includes('GMAIL_ADD_LABEL_TO_EMAIL')) throw new Error('boom');
            return [{ type: 'text', text: 'ok' }];
        }) as never);
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_ADD_LABEL_TO_EMAIL'));
        expect(result.result.summary).toContain('Done now: Fetch emails.');
        expect(result.result.summary).not.toContain('Done now: Fetch emails, Add label');
        expect(result.result.summary).toMatch(/Add label to email/);
    });

    it('says from each action’s own result whether it was done', async () => {
        const { service, execute } = brickService(gmailPolicy());
        execute.mockResolvedValue([
            {
                type: 'text',
                text: JSON.stringify({
                    successful: true,
                    data: { results: [{ index: 0, tool_slug: 'GMAIL_FETCH_EMAILS', response: { data: {} } }, { index: 1, tool_slug: 'GMAIL_LIST_LABELS', error: 'Label list not found' }], total_count: 2, success_count: 1, error_count: 1 },
                }),
            },
        ] as never);
        const [result] = await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS', 'GMAIL_REPLY_TO_THREAD'));
        expect(result.result.summary).toContain('Done now: Fetch emails.');
        expect(result.result.summary).toContain('Not sure it was done, the App answered with an error: List labels.');
        expect(result.result.summary).not.toContain('Done now: Fetch emails, List labels.');
    });

    it('gives the things it would have made back to the limit when only their call made nothing', async () => {
        const release = vi.fn();
        const { service, execute } = brickService(gmailPolicy());
        service['checkHowMany'] = vi.fn(async () => ({ kind: 'run', release })) as never;
        execute.mockImplementation((async (...args: unknown[]) => {
            const slugs = (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug);
            return slugs.includes('GMAIL_CREATE_EMAIL_DRAFT') ? { error: 'refused', outcome: 'not_sent' } : [{ type: 'text', text: 'ok' }];
        }) as never);
        await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_CREATE_EMAIL_DRAFT'));
        expect(release).toHaveBeenCalledTimes(1);
    });
});

describe('a Brick with several ready-made Apps', () => {
    const CALENDAR: ToolServerEntry = { ...GMAIL, serverId: 'cal1', serverName: 'Google Calendar', connectionId: 'c2', fingerprint: 'fp-cal' };
    function calendarPolicy(own: Record<string, ToolSetting> = {}): ServerPolicy {
        const rows: Array<[string, ToolHeading, string]> = [
            ['GOOGLECALENDAR_FIND_EVENT', 'looksUp', 'Find event'],
            ['GOOGLECALENDAR_DELETE_EVENT', 'deletesOrSends', 'Delete event'],
        ];
        const tools = new Map<string, PolicyTool>(rows.map(([name, heading, title]) => [name, { name, title, heading, fingerprint: `row-${name}`, suggestedHeading: heading, confirmed: true, setting: own[name] ?? null }]));
        return { serverId: 'cal1', kind: 'appActions', state: 'confirmed', policyRevision: 3, settings: { ...DEFAULTS, deletesOrSends: 'rightAway' }, tools };
    }
    function twoApps(gmail: ServerPolicy, calendar: ServerPolicy) {
        const made = brickService(gmail);
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? calendar : gmail));
        made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...GMAIL, otherApps: [CALENDAR] }], ['COMPOSIO_SEARCH_TOOLS', { ...GMAIL, fingerprint: 'fp-search', otherApps: [{ ...CALENDAR, fingerprint: 'fp-cal-search' }] }]]);
        const run = (args: unknown) => made.service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(args) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        const sentTo = () => made.execute.mock.calls.map((args: unknown[]) => [args[0], (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug)]);
        return { ...made, run, sentTo, servers };
    }

    it('sends each action through its own App and judges it by that App’s choices', async () => {
        const { run, sentTo } = twoApps(gmailPolicy({}, { ...DEFAULTS, deletesOrSends: 'off' }), calendarPolicy());
        const [result] = await run(batchArgs('GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_FIND_EVENT', 'GOOGLECALENDAR_DELETE_EVENT'));
        // Gmail's "Off" for deleting never reaches Calendar's own actions, and Calendar's "Right away" never reaches Gmail's
        expect(sentTo()).toEqual(expect.arrayContaining([['g1', ['GMAIL_FETCH_EMAILS']], ['cal1', ['GOOGLECALENDAR_FIND_EVENT']], ['cal1', ['GOOGLECALENDAR_DELETE_EVENT']]]));
        expect(sentTo()).toHaveLength(3);
        expect(result.result.summary).toContain('Done now: Fetch emails, Find event, Delete event.');
    });

    it('never lets another App’s looser choice run an action that is Off in its own App', async () => {
        const { run, execute } = twoApps(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }), calendarPolicy());
        const [result] = await run(batchArgs('GMAIL_DELETE_MESSAGE'));
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('Delete message is off for Sam in Gmail.');
    });

    it('sends nothing for an action no App says is its own', async () => {
        const { run, execute } = twoApps(gmailPolicy(), calendarPolicy());
        const [result] = await run(batchArgs('SLACK_SEND_MESSAGE', 'GMAIL_FETCH_EMAILS'));
        expect(execute.mock.calls.map((args: unknown[]) => args[0])).toEqual(['g1']);
        expect(result.result.summary).toContain("isn't clear which of your Apps it belongs to");
    });

    it('sends a lookup through the App that allows it when the first App has lookups Off', async () => {
        const { service, execute, servers } = twoApps(gmailPolicy({}, { ...DEFAULTS, looksUp: 'off' }), calendarPolicy());
        execute.mockResolvedValue([{ type: 'text', text: '{"results":[]}' }] as never);
        const [result] = await service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{"queries":[{"use_case":"find my events"}]}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute.mock.calls.map((args: unknown[]) => args[0])).toEqual(['cal1']);
        expect(result.result).not.toHaveProperty('error');
    });

    it('still refuses a lookup when no App allows it', async () => {
        const off = { ...DEFAULTS, looksUp: 'off' as const };
        const { service, execute, servers } = twoApps(gmailPolicy({}, off), { ...calendarPolicy(), settings: off });
        const [result] = await service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('turned off');
    });

    it('judges an App with no action list yet on its own, and keeps the other App’s refusals', async () => {
        const classic: ServerPolicy = { serverId: 'cal1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() };
        const { run, sentTo } = twoApps(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }), classic);
        const [result] = await run(batchArgs('GMAIL_DELETE_MESSAGE', 'GOOGLECALENDAR_FIND_EVENT'));
        // Gmail's Off action is never sent, through Gmail or through Calendar; Calendar's own action runs on Calendar's own rules
        expect(sentTo()).toEqual([['cal1', ['GOOGLECALENDAR_FIND_EVENT']]]);
        expect(result.result.summary).toContain('Delete message is off for Sam in Gmail.');
    });

    it('asks about an App with no action list yet as that App’s one batch', async () => {
        const classic: ServerPolicy = {
            serverId: 'cal1',
            kind: 'tools',
            state: 'confirmed',
            policyRevision: 2,
            settings: DEFAULTS,
            tools: new Map([[BATCH, { name: BATCH, title: 'Run actions', heading: 'deletesOrSends', fingerprint: 'fp-cal', suggestedHeading: 'deletesOrSends', confirmed: true, setting: null }]]),
        };
        const { run, sentTo, propose } = twoApps(gmailPolicy(), classic);
        await run(batchArgs('GOOGLECALENDAR_FIND_EVENT', 'GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_DELETE_EVENT'));
        expect(sentTo()).toEqual([['g1', ['GMAIL_FETCH_EMAILS']]]);
        expect(propose).toHaveBeenCalledTimes(1);
        const asked = (propose.mock.calls[0] as unknown[])[0] as { toolName: string; entry: ToolServerEntry; args: { tools: Array<{ tool_slug: string }> } };
        expect(asked.toolName).toBe(BATCH);
        expect(asked.entry.serverId).toBe('cal1');
        expect(asked.args.tools.map((tool) => tool.tool_slug)).toEqual(['GOOGLECALENDAR_FIND_EVENT', 'GOOGLECALENDAR_DELETE_EVENT']);
    });

    it('never sends an action two grants of an App could own to the owner’s own server, so an Off in either holds', async () => {
        const made = brickService(gmailPolicy());
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My tools', fingerprint: 'fp-own' };
        const off = gmailPolicy({ GMAIL_REPLY_TO_THREAD: 'off' });
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ({ serverId: 'own1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() } as ServerPolicy) : { ...off, serverId }));
        made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...own, otherApps: [GMAIL, { ...GMAIL, serverId: 'g2', connectionId: 'c9' }] }]]);
        const [result] = await made.service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(batchArgs('GMAIL_REPLY_TO_THREAD')) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(made.execute).not.toHaveBeenCalled();
        expect(JSON.stringify(result.result)).not.toContain('Done now');
    });

    it('hides an action Off in a ready-made App when the owner’s own server answered the lookup', async () => {
        const made = brickService(gmailPolicy());
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My tools', fingerprint: 'fp-own' };
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ({ serverId: 'own1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() } as ServerPolicy) : gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' })));
        made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([['COMPOSIO_SEARCH_TOOLS', { ...own, otherApps: [GMAIL] }]]);
        made.execute.mockResolvedValue([{ type: 'text', text: '{"results":[{"tool_slug":"GMAIL_DELETE_MESSAGE"},{"tool_slug":"NOTION_SEARCH"}]}' }] as never);
        const [result] = await made.service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(JSON.stringify(result.result)).not.toContain('GMAIL_DELETE_MESSAGE');
        expect(JSON.stringify(result.result)).toContain('NOTION_SEARCH');
    });

    it('keeps the ready-made Apps when the owner’s own server has the same tool name first', async () => {
        const made = brickService(gmailPolicy());
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My tools', fingerprint: 'fp-own' };
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ({ serverId: 'own1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() } as ServerPolicy) : gmailPolicy()));
        made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...own, otherApps: [GMAIL] }]]);
        await made.service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(batchArgs('GMAIL_FETCH_EMAILS', 'NOTION_SEARCH', 'GMAIL_REPLY_TO_THREAD')) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        const sent = made.execute.mock.calls.map((args: unknown[]) => [args[0], (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug)]);
        // Gmail's actions go through Gmail on Gmail's rules (its reply asks first); what no App owns goes to the owner's own server
        expect(sent).toEqual(expect.arrayContaining([['g1', ['GMAIL_FETCH_EMAILS']], ['own1', ['NOTION_SEARCH']]]));
        expect(sent).toHaveLength(2);
        expect(made.propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'GMAIL_REPLY_TO_THREAD', entry: expect.objectContaining({ serverId: 'g1' }) }));
    });

    describe("the person's own App first under a link tool's name, with its tools Off (own Apps first)", () => {
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My link', fingerprint: 'fp-own' };
        const SEARCH = 'COMPOSIO_SEARCH_TOOLS';
        const ownOff = (): ServerPolicy => ({
            serverId: 'own1',
            kind: 'tools',
            state: 'confirmed',
            policyRevision: 2,
            settings: DEFAULTS,
            tools: new Map<string, PolicyTool>(
                [SEARCH, BATCH].map((name) => [name, { name, heading: 'looksUp', fingerprint: name === SEARCH ? 'fp-own-search' : 'fp-own', suggestedHeading: 'looksUp', confirmed: true, setting: 'off' }])
            ),
        });
        function ownFirst() {
            const made = brickService(gmailPolicy());
            const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ownOff() : gmailPolicy()));
            made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
            const servers = new Map<string, ToolServerEntry>([
                [BATCH, { ...own, otherApps: [GMAIL] }],
                [SEARCH, { ...own, fingerprint: 'fp-own-search', otherApps: [{ ...GMAIL, fingerprint: 'fp-search' }] }],
            ]);
            return { ...made, servers };
        }

        it('still offers the ready-made App’s search and batch', async () => {
            const { service, servers } = ownFirst();
            const defs = [SEARCH, BATCH].map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }));
            vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: defs, toolServerMap: servers } as never);
            const { tools } = await service['buildTools']('b1', undefined, { isConfigured: () => true, adminApiToken: 't' } as never, 'dm', undefined, { signedIn: true, identifier: 'uuid-khalid' });
            expect(tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(expect.arrayContaining([SEARCH, BATCH]));
        });

        it('sends a search through the ready-made App that allows it, and a batch action through its own App', async () => {
            const { service, execute, servers } = ownFirst();
            execute.mockResolvedValue([{ type: 'text', text: '{"results":[]}' }] as never);
            const [searched] = await service['executeToolCalls']([{ id: 'c1', name: SEARCH, arguments: '{"queries":[{"use_case":"read mail"}]}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
            expect(searched.result).not.toHaveProperty('error');
            await service['executeToolCalls']([{ id: 'c2', name: BATCH, arguments: JSON.stringify(batchArgs('GMAIL_FETCH_EMAILS')) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
            expect(execute.mock.calls.map((args: unknown[]) => args[0])).toEqual(['g1', 'g1']);
        });

        it('never sends an action no ready-made App owns to their own App when it is Off there', async () => {
            const { service, execute, servers } = ownFirst();
            const [result] = await service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(batchArgs('NOTION_SEARCH')) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
            expect(execute).not.toHaveBeenCalled();
            expect(JSON.stringify(result.result)).toContain('turned off');
        });
    });

    it('hides an action Off in any App from a lookup that went through another App', async () => {
        const { service, execute, servers } = twoApps(gmailPolicy({ GMAIL_DELETE_MESSAGE: 'off' }, { ...DEFAULTS, looksUp: 'off' }), calendarPolicy());
        execute.mockResolvedValue([{ type: 'text', text: '{"results":[{"tool_slug":"GMAIL_DELETE_MESSAGE"},{"tool_slug":"GMAIL_FETCH_EMAILS"},{"tool_slug":"GOOGLECALENDAR_FIND_EVENT"}]}' }] as never);
        const [result] = await service['executeToolCalls']([{ id: 'c1', name: 'COMPOSIO_SEARCH_TOOLS', arguments: '{}' }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);
        expect(execute.mock.calls.map((args: unknown[]) => args[0])).toEqual(['cal1']);
        expect(JSON.stringify(result.result)).not.toContain('GMAIL_DELETE_MESSAGE');
        expect(JSON.stringify(result.result)).toContain('GOOGLECALENDAR_FIND_EVENT');
    });

    it('tells the Brick what is Off in every App, and finds a saved action in the App it was saved for', async () => {
        const { service, servers } = twoApps(gmailPolicy(), calendarPolicy({ GOOGLECALENDAR_DELETE_EVENT: 'off' }));
        const note = await service['appsOffNote']('b1', servers);
        expect(note).toContain('Off in Google Calendar: Delete event.');
    });
});

describe('an action approved on its own card', () => {
    it('runs as its App’s batch of one', async () => {
        const { service, execute } = brickService(gmailPolicy());
        const entry = (await import('../mcp/AppActions')).appActionEntry(GMAIL, 'GMAIL_REPLY_TO_THREAD', 'Reply to thread');
        await service.runApprovedTool('b1', entry, 'GMAIL_REPLY_TO_THREAD', { thread_id: 't1', body: 'Thanks' }, 'uuid-khalid', undefined, { heading: 'deletesOrSends', callId: 'att-1' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][2]).toBe(BATCH);
        expect(execute.mock.calls[0][3]).toEqual({ tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: { thread_id: 't1', body: 'Thanks' } }] });
    });

    it('is found again in its own App by the server it was saved for', async () => {
        const service = new AIService(null!, { adminApiToken: 't' } as never, '');
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: SERVERS } as never);
        expect(await service.findToolEntry('b1', 'GMAIL_REPLY_TO_THREAD', 'g1')).toMatchObject({ serverId: 'g1', appAction: { slug: 'GMAIL_REPLY_TO_THREAD', batchTool: BATCH }, title: 'Reply to thread' });
        expect(await service.findToolEntry('b1', 'GMAIL_REPLY_TO_THREAD', 'other')).toBeNull();
        expect(await service.findToolEntry('b1', BATCH, 'other')).toBeNull();
        expect(await service.findToolEntry('b1', BATCH, 'g1')).toBe(GMAIL);
    });

    it('is found in the Brick’s other ready-made App it was saved for, alone or on a card of several', async () => {
        const service = new AIService(null!, { adminApiToken: 't' } as never, '');
        const calendar: ToolServerEntry = { ...GMAIL, serverId: 'cal1', serverName: 'Google Calendar' };
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: new Map([[BATCH, { ...GMAIL, otherApps: [calendar] }]]) } as never);
        expect(await service.findToolEntry('b1', 'GOOGLECALENDAR_DELETE_EVENT', 'cal1')).toMatchObject({ serverId: 'cal1', appAction: { slug: 'GOOGLECALENDAR_DELETE_EVENT', batchTool: BATCH } });
        expect(await service.findToolEntry('b1', BATCH, 'cal1')).toBe(calendar);
    });

    it('finds a link tool saved on the Brick’s other ready-made App as that App’s own tool, never as an action in a batch', async () => {
        const service = new AIService(null!, { adminApiToken: 't' } as never, '');
        const calendar: ToolServerEntry = { ...GMAIL, serverId: 'cal1', serverName: 'Google Calendar', fingerprint: 'fp-cal-connections' };
        const connections = { ...GMAIL, fingerprint: 'fp-connections', otherApps: [calendar] };
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: new Map([['COMPOSIO_MANAGE_CONNECTIONS', connections], [BATCH, { ...GMAIL, otherApps: [calendar] }]]) } as never);
        const found = await service.findToolEntry('b1', 'COMPOSIO_MANAGE_CONNECTIONS', 'cal1');
        expect(found).toBe(calendar);
        expect(found).not.toHaveProperty('appAction');
    });
});

describe('reading each action’s outcome from a batch answer', () => {
    const slugs = ['GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS'];
    const text = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];
    it('reads the provider’s documented shape, by index and by name', async () => {
        const { batchOutcomes } = await import('../mcp/AppActions');
        expect(batchOutcomes(text({ successful: true, data: { results: [{ index: 1, tool_slug: 'GMAIL_LIST_LABELS', error: 'nope' }, { index: 0, tool_slug: 'GMAIL_FETCH_EMAILS', response: {} }] } }), slugs, 'succeeded')).toEqual(['succeeded', 'uncertain']);
        expect(batchOutcomes(text({ results: [{ tool_slug: 'GMAIL_LIST_LABELS', response: {} }] }), slugs, 'succeeded')).toEqual(['uncertain', 'succeeded']);
    });
    it('keeps the call’s own outcome when the call failed or the answer has no list', async () => {
        const { batchOutcomes } = await import('../mcp/AppActions');
        expect(batchOutcomes({ error: 'x', outcome: 'failed' }, slugs, 'failed')).toEqual(['failed', 'failed']);
        // A tool's own error may follow work that ran, in any words: never "nothing was done" (the call that never got to the tool stays failed)
        expect(batchOutcomes({ error: 'Tool error: Invalid session. Action 1 completed.', outcome: 'failed' }, slugs, 'failed')).toEqual(['uncertain', 'uncertain']);
        expect(batchOutcomes({ error: 'Tool error: Boom {"results":[{"tool_slug":"GMAIL_FETCH_EMAILS","response":{"successful":true}}]}', outcome: 'failed' }, slugs, 'failed')).toEqual(['uncertain', 'uncertain']);
        expect(batchOutcomes({ error: 'The link did not answer.', outcome: 'failed' }, slugs, 'failed')).toEqual(['failed', 'failed']);
        expect(batchOutcomes(text({ successful: true, data: {} }), slugs, 'succeeded')).toEqual(['succeeded', 'succeeded']);
        expect(batchOutcomes('done', slugs, 'succeeded')).toEqual(['succeeded', 'succeeded']);
        expect(batchOutcomes(text({ successful: false, error: 'partial' }), slugs, 'succeeded')).toEqual(['uncertain', 'uncertain']);
    });
});

describe('an action not sorted yet that its owner turned Off', () => {
    it('is named in the Off note and taken out of lookups, as the gate refuses it', async () => {
        const { offNote, isOffRow, judgeAction } = await import('../mcp/AppActions');
        const policy = gmailPolicy();
        policy.tools.set('GMAIL_ARCHIVE_THREAD', { name: 'GMAIL_ARCHIVE_THREAD', title: 'Archive thread', heading: null, fingerprint: 'row-a', suggestedHeading: null, confirmed: false, setting: 'off' } as never);
        expect(judgeAction(policy, 'GMAIL_ARCHIVE_THREAD').setting).toBe('off');
        expect(isOffRow(policy, 'gmail_archive_thread')).toBe(true);
        expect(offNote(policy, 'Gmail')).toContain('Archive thread');
        // One left to its heading still follows it
        expect(isOffRow(policy, 'GMAIL_FETCH_EMAILS')).toBe(false);
    });
});

describe("an action of an App the person has their own copy of (own Apps first)", () => {
    // Universe's ready-made Exa was left out because the person has their own Exa: Gmail's link must never carry an Exa action
    const withOwnExa = () => new Map<string, ToolServerEntry>([...SERVERS].map(([name, entry]) => [name, { ...entry, ownCopyApps: ['Exa'] }]));
    const callWith = (service: AIService, servers: Map<string, ToolServerEntry>, args: unknown) =>
        service['executeToolCalls']([{ id: 'c1', name: BATCH, arguments: JSON.stringify(args) }], undefined, undefined, servers as never, 'uuid-khalid', undefined, 'b1', 7);

    it('is never sent through another ready-made App, and the Brick is sent to their own copy; the rest runs', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const [result] = await callWith(service, withOwnExa(), batchArgs('GMAIL_FETCH_EMAILS', 'EXA_SEARCH'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).not.toHaveBeenCalled();
        expect(result.result.notDone).toEqual(["Search wasn't done here: use your owner's own Exa App for it."]);
    });

    it('alone: nothing is sent and no card is shown', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const [result] = await callWith(service, withOwnExa(), batchArgs('EXA_SEARCH', 'EXA_ANSWER'));
        expect(execute).not.toHaveBeenCalled();
        expect(propose).not.toHaveBeenCalled();
        expect(result.result.outcome).toBe('not_sent');
        expect(result.result.error).toContain("use your owner's own Exa App");
    });

    it("never takes a remaining App's own action, by its list or by its name, even when the left-out App's name starts it", async () => {
        // "Google" was left out for the person's own copy; "Google Calendar" is still on. A Google Calendar action is never taken for Google's
        const { service, execute, propose } = brickService(gmailPolicy());
        const servers = new Map<string, ToolServerEntry>([...SERVERS].map(([name, entry]) => [name, { ...entry, serverName: 'Google Calendar', ownCopyApps: ['Google'] }]));
        const [result] = await callWith(service, servers, batchArgs('GMAIL_FETCH_EMAILS', 'GOOGLE_CALENDAR_DELETE_EVENT', 'GOOGLE_SEARCH'));
        // Listed in the remaining App: runs. Named after it: judged by it (asks first). Only Google's own is refused
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS']]);
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'GOOGLE_CALENDAR_DELETE_EVENT' }));
        expect(result.result.notDone).toEqual(["Search wasn't done here: use your owner's own Google App for it."]);
    });

    it("sends it to the owner's own server when that server holds the link tool first: that is their own account, not one Universe pays for", async () => {
        const made = brickService(gmailPolicy());
        const own: ToolServerEntry = { botId: 'b1', serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My tools', fingerprint: 'fp-own' };
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ({ serverId: 'own1', kind: 'tools', state: 'notCheckedYet', policyRevision: 1, settings: DEFAULTS, tools: new Map() } as ServerPolicy) : gmailPolicy()));
        made.service['toolGate'] = new ToolGate({ read } as never, { check: made.check } as never, { canManageBotTools: async () => false });
        const servers = new Map<string, ToolServerEntry>([[BATCH, { ...own, otherApps: [{ ...GMAIL, ownCopyApps: ['Exa'] }] }]]);
        await callWith(made.service, servers, batchArgs('GMAIL_FETCH_EMAILS', 'EXA_SEARCH'));
        const sent = made.execute.mock.calls.map((args: unknown[]) => [args[0], (args[3] as { tools: Array<{ tool_slug: string }> }).tools.map((t) => t.tool_slug)]);
        expect(sent).toEqual(expect.arrayContaining([['g1', ['GMAIL_FETCH_EMAILS']], ['own1', ['EXA_SEARCH']]]));
        expect(sent).toHaveLength(2);
    });

    it('changes nothing when no App was left out', async () => {
        const { service, execute } = brickService(gmailPolicy());
        await call(service, batchArgs('GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS'));
        expect(sentSlugs(execute)).toEqual([['GMAIL_FETCH_EMAILS', 'GMAIL_LIST_LABELS']]);
    });
});
