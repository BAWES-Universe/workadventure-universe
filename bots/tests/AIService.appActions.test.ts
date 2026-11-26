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

    it('refuses a batch whose inputs are not an object (the card could not show them), and sends nothing', async () => {
        const { service, execute, propose } = brickService(gmailPolicy());
        const [result] = await call(service, { tools: [{ tool_slug: 'GMAIL_REPLY_TO_THREAD', arguments: '{"to":"boss@x","body":"I quit"}' }] });
        expect(execute).not.toHaveBeenCalled();
        expect(propose).not.toHaveBeenCalled();
        expect(result.result.error).toBeTruthy();
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
});
