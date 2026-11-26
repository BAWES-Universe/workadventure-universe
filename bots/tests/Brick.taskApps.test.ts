/**
 * The Apps a goal's, watch's or briefing's run may use (game #2002, G3b). Setting one grants nothing: a run uses an App as the owner's own chat
 * would, under the same headings and the same check right before every call, and is stricter where nobody is watching: a step that makes
 * something new, sends or deletes asks on a card for this occurrence whatever the setting says, and an App nobody reviewed is not used.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolServerEntry } from '../mcp/MCPConnector';
import { ToolGate, type GateDecision } from '../mcp/ToolGate';
import type { ToolHeading } from '../mcp/ToolCatalog';
import type { PolicyTool, ServerPolicy, ToolSetting } from '../mcp/ToolPolicy';
import type { DueRun } from '../server/BrickRunner';
import { TaskApps, type TaskAppsDeps } from '../server/BrickTaskApps';
import { ModelTaskRunner } from '../server/BrickTaskModel';
import type { AIService } from '../ai/AIService';
import { FINISH_CHECK_TOOL, READ_PAGE_TOOL, taskPrompt, type ToolDefinition } from '../server/BrickTaskRun';

const run = (over: Partial<DueRun> = {}): DueRun => ({
    runId: 'run-1',
    itemId: '0b8f067a-df0f-43f8-af12-8f03065ce1d0',
    brickId: 'brick-1',
    userId: 'sara-uuid',
    matrixUserId: '@sara:matrix.test',
    kind: 'goal',
    words: 'Get my visa',
    condition: null,
    outcome: 'Visa issued',
    steps: [],
    statusLine: null,
    timeZone: 'Asia/Kuwait',
    dueAt: '2026-11-15T09:00:00.000Z',
    late: false,
    fresh: false,
    attempt: 1,
    deliveredEventId: null,
    deliveredReport: null,
    ...over,
});

const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } } });
const entry = (name: string): ToolServerEntry => ({ serverId: `server-${name}`, serverUrl: 'https://mcp.example', authType: 'none', fingerprint: `fp-${name}`, serverName: 'Linear', title: name });
const RUN = (heading: 'looksUp' | 'changesThings' | 'makesNew' | 'deletesOrSends'): GateDecision => ({ kind: 'run', heading, policyRevision: 3, fingerprint: 'fp' });

function setUp(verdicts: Record<string, GateDecision>, over: Partial<TaskAppsDeps> = {}) {
    const names = Object.keys(verdicts);
    const decide = vi.fn(async (call: { toolName: string }) => verdicts[call.toolName]);
    const propose = vi.fn<TaskAppsDeps['approvals']['propose']>(async () => ({ kind: 'waiting' as const, result: { status: 'waiting_for_ok', message: 'A card was put in their chat.' } }));
    const call = vi.fn<TaskAppsDeps['call']>(async () => [{ type: 'text', text: 'Found 3 issues' }]);
    const room = vi.fn<TaskAppsDeps['room']>(async () => ({ ok: true as const, roomId: '!dm:matrix.test' }));
    const deps: TaskAppsDeps = {
        discover: async () => ({ tools: names.map(tool), servers: new Map(names.map((name) => [name, entry(name)])) }),
        gate: { decide } as never,
        approvals: { propose },
        room,
        call,
        ...over,
    };
    return { apps: new TaskApps(deps), decide, propose, call, room };
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('which Apps a run may use', () => {
    it('offers what the gate does not refuse, by name, and never an App nobody reviewed', async () => {
        const { apps } = setUp({
            search: RUN('looksUp'),
            create: RUN('makesNew'),
            zeta: { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 3, fingerprint: 'fp' },
            off: { kind: 'refuse', why: 'off', line: 'off is turned off for this bot.' },
            unreviewedRun: { kind: 'run' },
            tried: { kind: 'ask', heading: 'changesThings', notReviewed: true, policyRevision: 3, fingerprint: 'fp' },
        });
        const session = await apps.open(run());
        expect(session?.definitions.map((one) => one.function.name)).toEqual(['create', 'search', 'zeta']);
        expect(session?.has('search')).toBe(true);
        expect(session?.has('off')).toBe(false);
        expect(session?.has('unreviewedRun')).toBe(false);
        expect(session?.has('tried')).toBe(false);
    });

    it('never lets an App take the name of the run’s own tools', async () => {
        const { apps } = setUp({ [READ_PAGE_TOOL]: RUN('looksUp'), [FINISH_CHECK_TOOL]: RUN('looksUp'), search: RUN('looksUp') });
        expect((await apps.open(run()))?.definitions.map((one) => one.function.name)).toEqual(['search']);
    });

    it('is none when there are no Apps, none can be used, or they cannot be listed just now', async () => {
        expect(await setUp({}).apps.open(run())).toBeNull();
        expect(await setUp({ off: { kind: 'refuse', why: 'off', line: 'Off.' } }).apps.open(run())).toBeNull();
        const down = setUp({ search: RUN('looksUp') }, {
            discover: async () => {
                throw new Error('Orbit down');
            },
        });
        expect(await down.apps.open(run())).toBeNull();
    });

    it('asks the gate about the owner, as a signed-in person, never as a guest or a visitor', async () => {
        const { apps, decide } = setUp({ search: RUN('looksUp') });
        await apps.open(run());
        expect(decide).toHaveBeenCalledWith(expect.objectContaining({ botId: 'brick-1', toolName: 'search', serverId: 'server-search', fingerprint: 'fp-search', person: { signedIn: true, identifier: 'sara-uuid' }, voice: false }));
    });
});

describe('what a run does with an App', () => {
    it('runs a step that only looks up, or changes a thing set to right away, once, with an id that is the same when the run is tried again', async () => {
        const { apps, call, propose } = setUp({ search: RUN('looksUp'), update: RUN('changesThings') });
        const session = (await apps.open(run()))!;
        expect(await session.call('search', { q: 'visa' })).toContain('Found 3 issues');
        await session.call('update', { id: '1' });
        expect(call).toHaveBeenCalledTimes(2);
        expect(call).toHaveBeenCalledWith('brick-1', expect.objectContaining({ serverId: 'server-search' }), 'search', { q: 'visa' }, 'sara-uuid', { heading: 'looksUp', callId: expect.stringMatching(/^run-1:/) });
        expect(propose).not.toHaveBeenCalled();
        const first = call.mock.calls[0][5].callId;
        const again = (await setUp({ search: RUN('looksUp') }, { call }).apps.open(run({ attempt: 2 })))!;
        await again.call('search', { q: 'visa' });
        expect(call.mock.calls[2][5].callId).toBe(first);
        await again.call('search', { q: 'passport' });
        expect(call.mock.calls[3][5].callId).not.toBe(first);
    });

    it('lets the gate see what a step asks for, so reconnecting an App asks first while a plain check runs', async () => {
        const { apps, decide } = setUp({ connect: RUN('changesThings') });
        const session = (await apps.open(run()))!;
        await session.call('connect', { reinitiate_all: true });
        expect(decide).toHaveBeenLastCalledWith(expect.objectContaining({ toolName: 'connect', args: { reinitiate_all: true } }));
    });

    it('asks on a card, never runs, for a step that makes something new or sends or deletes, even when it is set to right away', async () => {
        for (const heading of ['makesNew', 'deletesOrSends'] as const) {
            const { apps, call, propose, room } = setUp({ act: RUN(heading) });
            const text = await (await apps.open(run()))!.call('act', { to: 'consulate' });
            expect(call).not.toHaveBeenCalled();
            expect(room).toHaveBeenCalledWith('brick-1', '@sara:matrix.test');
            expect(propose).toHaveBeenCalledTimes(1);
            expect(propose).toHaveBeenCalledWith(
                expect.objectContaining({
                    botId: 'brick-1',
                    roomId: '!dm:matrix.test',
                    person: expect.objectContaining({ uuid: 'sara-uuid', matrixUserId: '@sara:matrix.test', isGuest: false }),
                    toolName: 'act',
                    args: { to: 'consulate' },
                    decision: { kind: 'ask', heading, notReviewed: false, policyRevision: 3, fingerprint: 'fp' },
                    task: { itemId: '0b8f067a-df0f-43f8-af12-8f03065ce1d0' },
                })
            );
            expect(JSON.parse(text)).toMatchObject({ status: 'waiting_for_ok' });
        }
    });

    it('asks on a card for a step that is set to ask first, and does not run it', async () => {
        const { apps, call, propose } = setUp({ update: { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 5, fingerprint: 'fp-u' } });
        await (await apps.open(run()))!.call('update', { id: '1' });
        expect(call).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ decision: { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 5, fingerprint: 'fp-u' } }));
    });

    it('does not run a step the gate now refuses, or one whose App changed since it was offered, and says so', async () => {
        const verdicts: Record<string, GateDecision> = { search: RUN('looksUp') };
        const { apps, call, propose } = setUp(verdicts);
        const session = (await apps.open(run()))!;
        verdicts.search = { kind: 'refuse', why: 'off', line: 'search is turned off for this bot.' };
        expect(JSON.parse(await session.call('search', {})).error).toMatch(/turned off/);
        verdicts.search = { kind: 'run' };
        expect(JSON.parse(await session.call('search', {})).error).toMatch(/not been reviewed/);
        expect(call).not.toHaveBeenCalled();
        expect(propose).not.toHaveBeenCalled();
        expect(JSON.parse(await session.call('nothing_like_it', {})).error).toMatch(/not something a check can do/);
    });

    it('does not make a card where there is no chat to show it in, or while that cannot be told', async () => {
        const noChat = setUp({ act: RUN('makesNew') });
        expect(JSON.parse(await (await noChat.apps.open(run({ matrixUserId: null })))!.call('act', {})).error).toMatch(/no chat/);
        expect(noChat.propose).not.toHaveBeenCalled();
        for (const reason of ['no_chat', 'not_allowed', 'unsure'] as const) {
            const refused = setUp({ act: RUN('makesNew') }, { room: async () => ({ ok: false as const, reason }) });
            expect(JSON.parse(await (await refused.apps.open(run()))!.call('act', {})).error).toBeDefined();
            expect(refused.propose).not.toHaveBeenCalled();
            expect(refused.call).not.toHaveBeenCalled();
        }
    });

    it('answers a step that fails with a plain error and never throws', async () => {
        const broken = setUp({ search: RUN('looksUp') }, {
            call: async () => {
                throw new Error('boom');
            },
        });
        expect(JSON.parse(await (await broken.apps.open(run()))!.call('search', {})).error).toMatch(/did not work/);
    });

    it('gives a run the room a chat reply has, and says when it cut what an App gave back', async () => {
        const sentence = 'The quick brown fox jumps over the lazy dog. ';
        const words = (n: number) => sentence.repeat(Math.ceil(n / sentence.length)).slice(0, n);
        // 50,000 characters used to be cut at 12,000 with no word of it
        const fits = setUp({ search: RUN('looksUp') }, { call: async () => words(50_000) });
        expect(await (await fits.apps.open(run()))!.call('search', {})).toBe(words(50_000));
        const big = setUp({ search: RUN('looksUp') }, { call: async () => words(200_000) });
        const cut = await (await big.apps.open(run()))!.call('search', {});
        expect(cut.startsWith(words(72_000))).toBe(true);
        expect(cut).toContain('Only the first 72,000 of 200,000 characters fit');
    });
});

describe('a mail answer through a run', () => {
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
    const mail = (n: number, body: number) => ({
        messageId: `m${n}`,
        sender: `Sender ${n} <s${n}@example.com>`,
        subject: `Subject ${n}`,
        messageTimestamp: '2026-11-25T09:00:00Z',
        preview: { body: `Snippet ${n}` },
        payload: { parts: [{ mimeType: 'text/html', body: { data: b64(`<html><body>${'<p>Hello there, a paragraph.</p>'.repeat(body)}</body></html>`) } }] },
    });
    const answerOf = (messages: unknown[]) => [{ type: 'text', text: JSON.stringify({ data: { messages }, successful: true }) }];

    it('shows the Brick every message of a list whose bodies were what made it long (it used to stop at 12,000 characters, mid-message)', async () => {
        // About 30,000 characters of encoded body each: five of them were 150,000 characters, and the Brick saw a third of the first
        const messages = [1, 2, 3, 4, 5].map((n) => mail(n, 900));
        const { apps } = setUp({ search: RUN('looksUp') }, { call: async () => answerOf(messages) });
        const text = await (await apps.open(run()))!.call('search', {});
        expect(text.length).toBeLessThan(12_000);
        const read = JSON.parse(text)[0].text.data.messages as ReturnType<typeof mail>[];
        expect(read.map((one) => [one.sender, one.subject, one.preview.body])).toEqual(messages.map((one) => [one.sender, one.subject, one.preview.body]));
    });

    it('takes the routing headers out only for a mail App, by the tool it called', async () => {
        const part = { payload: { mimeType: 'text/plain', body: { size: 3, data: 'abc' }, headers: [{ name: 'Subject', value: 'Hi' }, { name: 'Received', value: 'from x' }] } };
        const blocks = [{ type: 'text', text: JSON.stringify(part) }];
        const names = (text: string) => {
            const inner = JSON.parse(text)[0].text;
            return ((typeof inner === 'string' ? JSON.parse(inner) : inner).payload.headers as { name: string }[]).map((header) => header.name);
        };
        const gmail = setUp({ GMAIL_FETCH_EMAILS: RUN('looksUp') }, { call: async () => blocks });
        const other = setUp({ search: RUN('looksUp') }, { call: async () => blocks });
        expect(names(await (await gmail.apps.open(run()))!.call('GMAIL_FETCH_EMAILS', {}))).toEqual(['Subject']);
        expect(names(await (await other.apps.open(run()))!.call('search', {}))).toEqual(['Subject', 'Received']);
    });

    it('says "Showing 20 of 50" when even without the bodies there is more than fits, and never cuts a message in half', async () => {
        const messages = Array.from({ length: 50 }, (_, n) => ({ ...mail(n + 1, 10), messageText: `Message ${n + 1}. `.repeat(200) }));
        const { apps } = setUp({ search: RUN('looksUp') }, { call: async () => answerOf(messages) });
        const text = await (await apps.open(run()))!.call('search', {});
        expect(text.length).toBeLessThanOrEqual(80_000);
        const data = JSON.parse(text)[0].text.data;
        expect(data.messages.length).toBeLessThan(50);
        expect(data.messages_note).toMatch(new RegExp(`^Showing ${data.messages.length} of 50:`));
        for (const read of data.messages) expect(read.messageText.endsWith('. ')).toBe(true);
    });

    it('still gives the Brick a plain error, not a throw, for an answer that cannot be written', async () => {
        const circular: Record<string, unknown> = {};
        circular.me = circular;
        const { apps } = setUp({ search: RUN('looksUp') }, { call: async () => circular });
        expect(JSON.parse(await (await apps.open(run()))!.call('search', {})).error).toMatch(/cannot be read/);
    });
});

describe('the model of a check with Apps', () => {
    const brick = { name: 'Brick', instructions: 'You are Brick.', providerId: 'universe-ai', deleted: false };

    it('offers the Apps beside its own two tools, runs them, and tells the model what a card means', async () => {
        const { apps, call } = setUp({ search: RUN('looksUp') });
        const ai = {
            runBrickTask: vi.fn(async (opts: any) => {
                expect(opts.tools.map((one: ToolDefinition) => one.function.name)).toEqual([READ_PAGE_TOOL, FINISH_CHECK_TOOL, 'search']);
                expect(await opts.runTool('search', { q: 'visa' })).toContain('Found 3 issues');
                expect(await opts.runTool(FINISH_CHECK_TOOL, { result: 'nothing_new' })).toContain('ok');
                return { ended: 'final' };
            }),
        };
        const runner = new ModelTaskRunner({ ai: ai as never, brick: async () => brick, readPage: vi.fn(), apps });
        expect(await runner.run(run(), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'nothing_new' } });
        expect(call).toHaveBeenCalledTimes(1);
        const system = ai.runBrickTask.mock.calls[0][0].system as string;
        expect(system).toMatch(/Apps in your tools/);
        expect(system).toMatch(/waiting_for_ok/);
        expect(system).not.toMatch(/cannot send anything to anyone, use an app/);
    });

    it('stops at the first card: the next steps of the round are not done, and the card is not said again', async () => {
        const { apps, call, propose } = setUp({ create: RUN('makesNew'), update: RUN('changesThings') });
        const finish = { result: 'tell_them', message: 'I asked you on a card.', needs_you: true, status_line: 'Waiting for your OK' };
        const ai = {
            runBrickTask: vi.fn(async (opts: any) => {
                expect(JSON.parse(await opts.runTool('create', { title: 'x' }))).toMatchObject({ status: 'waiting_for_ok' });
                // Same round, a step that would have run by itself: it is held
                expect(JSON.parse(await opts.runTool('update', { id: 1 }))).toMatchObject({ error: expect.stringMatching(/already waiting/) });
                await opts.runTool(FINISH_CHECK_TOOL, finish);
                return { ended: 'final' };
            }),
        };
        const runner = new ModelTaskRunner({ ai: ai as never, brick: async () => brick, readPage: vi.fn(), apps });
        // A goal and a watch do not say it again in chat
        expect(await runner.run(run({ kind: 'goal' }), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'nothing_new', progress: { statusLine: 'Waiting for your OK' } } });
        expect(await runner.run(run({ kind: 'watch' }), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'nothing_new' } });
        expect(call).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalledTimes(2);
        // A briefing is always delivered
        expect(await runner.run(run({ kind: 'schedule' }), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'tell' } });
    });

    it('speaks as usual when no card waits', async () => {
        const { apps } = setUp({ search: RUN('looksUp') });
        const ai = {
            runBrickTask: vi.fn(async (opts: any) => {
                await opts.runTool('search', {});
                await opts.runTool(FINISH_CHECK_TOOL, { result: 'tell_them', message: 'Found it.' });
                return { ended: 'final' };
            }),
        };
        const runner = new ModelTaskRunner({ ai: ai as never, brick: async () => brick, readPage: vi.fn(), apps });
        expect(await runner.run(run({ kind: 'goal' }), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'tell', message: 'Found it.' } });
    });

    it('is the web alone, as before, when there are no Apps or they cannot be listed', async () => {
        const ai = { runBrickTask: vi.fn<AIService['runBrickTask']>(async () => ({ ended: 'final' }) as never) };
        for (const apps of [undefined, { open: async () => null }, { open: async () => Promise.reject(new Error('down')) }]) {
            const runner = new ModelTaskRunner({ ai: ai as never, brick: async () => brick, readPage: vi.fn(), apps: apps as never });
            await runner.run(run(), async () => true);
            const opts = ai.runBrickTask.mock.calls.at(-1)![0] as any;
            expect(opts.tools.map((one: ToolDefinition) => one.function.name)).toEqual([READ_PAGE_TOOL, FINISH_CHECK_TOOL]);
            expect(opts.system).toMatch(/cannot send anything to anyone, use an app/);
            expect(await opts.runTool('search', {})).toMatch(/not something a check can do/);
        }
    });

    it('keeps the old rules text when no Apps are offered', () => {
        const text = taskPrompt(run(), { name: 'Brick', instructions: '' }, new Date('2026-11-15T06:00:00Z'));
        expect(text).toMatch(/cannot send anything to anyone, use an app/);
    });
});

describe("a person's own App in a goal or briefing (own Apps first)", () => {
    // The real gate, with Orbit's answer for the person's own Exa: its tool confirmed by Universe under Looks things up (Orbit sorts and confirms
    // an own App's tools by itself), or under a heading that asks first with the tool's own choice set to Right away
    function ownExa(row: Partial<PolicyTool>) {
        const settings = { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' } as const;
        const policy = {
            serverId: 'server-web_search_exa',
            kind: 'tools' as const,
            state: 'confirmed' as const,
            policyRevision: 4,
            settings,
            tools: new Map([['web_search_exa', { name: 'web_search_exa', fingerprint: 'fp-web_search_exa', heading: 'looksUp' as const, suggestedHeading: null, confirmed: true, setting: null, ...row }]]),
        };
        const gate = new ToolGate({ read: async () => policy } as never, { check: async () => ({ allowed: true, kind: 'allowed' }) } as never, { canManageBotTools: async () => false });
        const propose = vi.fn<TaskAppsDeps['approvals']['propose']>(async () => ({ kind: 'waiting' as const, result: { status: 'waiting_for_ok' } }));
        const call = vi.fn<TaskAppsDeps['call']>(async () => [{ type: 'text', text: '3 results' }]);
        const apps = new TaskApps({
            discover: async () => ({ tools: [tool('web_search_exa')], servers: new Map([['web_search_exa', { ...entry('web_search_exa'), serverName: 'Exa', connectionId: 'conn-own-exa' }]]) }),
            gate,
            approvals: { propose },
            room: async () => ({ ok: true as const, roomId: '!dm:matrix.test' }),
            call,
        });
        return { apps, propose, call };
    }

    it('uses a search of their own Exa right away, with no card', async () => {
        const { apps, propose, call } = await ownExa({});
        const session = await apps.open(run());
        expect(session?.has('web_search_exa')).toBe(true);
        expect(await session!.call('web_search_exa', { query: 'visa' })).toContain('3 results');
        expect(call).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
    });

    it("takes the tool's own Right away over a heading that asks first", async () => {
        const { apps, propose, call } = await ownExa({ heading: 'changesThings', setting: 'rightAway' });
        const session = await apps.open(run());
        await session!.call('web_search_exa', { query: 'visa' });
        expect(call).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
    });

    it('leaves out a tool turned off on its own', async () => {
        const { apps } = await ownExa({ setting: 'off' });
        expect(await apps.open(run())).toBeNull();
    });
});

describe('a ready-made App’s lookups in a goal or task', () => {
    it('never show an action that is Off in any of the Brick’s Apps', async () => {
        const gmail: ToolServerEntry = { ...entry('COMPOSIO_SEARCH_TOOLS'), serverId: 'g1', serverName: 'Gmail', readyMade: true, orbitUrl: 'https://orbit.example' };
        const calendar: ToolServerEntry = { ...gmail, serverId: 'cal1', serverName: 'Google Calendar' };
        const off = (serverId: string, slug: string) => ({ serverId, kind: 'appActions', state: 'confirmed', policyRevision: 1, settings: { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' }, tools: new Map([[slug, { name: slug, title: slug, heading: 'deletesOrSends', fingerprint: 'r', suggestedHeading: 'deletesOrSends', confirmed: true, setting: 'off' }]]) });
        const appPolicy = vi.fn(async (_bot: string, serverId: string) => (serverId === 'g1' ? off('g1', 'GMAIL_DELETE_MESSAGE') : off('cal1', 'GOOGLECALENDAR_DELETE_EVENT')));
        const { apps } = setUp(
            { COMPOSIO_SEARCH_TOOLS: RUN('looksUp') },
            {
                discover: async () => ({ tools: [tool('COMPOSIO_SEARCH_TOOLS')], servers: new Map([['COMPOSIO_SEARCH_TOOLS', { ...gmail, otherApps: [calendar] }]]) }),
                gate: { decide: async () => RUN('looksUp'), appPolicy } as never,
                call: async () => [{ type: 'text', text: '{"results":[{"tool_slug":"GMAIL_DELETE_MESSAGE"},{"tool_slug":"GOOGLECALENDAR_DELETE_EVENT"},{"tool_slug":"GMAIL_FETCH_EMAILS"}]}' }],
            }
        );
        const session = await apps.open(run());
        const answer = await session!.call('COMPOSIO_SEARCH_TOOLS', {});
        expect(answer).toContain('GMAIL_FETCH_EMAILS');
        expect(answer).not.toContain('GMAIL_DELETE_MESSAGE');
        expect(answer).not.toContain('GOOGLECALENDAR_DELETE_EVENT');
    });
});

describe('a ready-made App’s batch of actions in a run', () => {
    const BATCH = 'COMPOSIO_MULTI_EXECUTE_TOOL';
    const gmail: ToolServerEntry = { serverId: 'g1', serverUrl: 'https://link.example', authType: 'none', serverName: 'Gmail', readyMade: true, orbitUrl: 'https://orbit.example', fingerprint: 'fp-batch', title: 'Run actions' };
    const calendar: ToolServerEntry = { ...gmail, serverId: 'cal1', serverName: 'Google Calendar', fingerprint: 'fp-cal' };
    type Row = [string, ToolHeading, ToolSetting | null];
    const policyOf = (serverId: string, rows: Row[]): ServerPolicy => ({
        serverId,
        kind: 'appActions',
        state: 'confirmed',
        policyRevision: 4,
        settings: { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' },
        tools: new Map<string, PolicyTool>(rows.map(([name, heading, setting]) => [name, { name, title: name, heading, fingerprint: `row-${name}`, suggestedHeading: heading, confirmed: true, setting }])),
    });
    const GMAIL_ROWS: Row[] = [
        ['GMAIL_FETCH_EMAILS', 'looksUp', null],
        ['GMAIL_CREATE_EMAIL_DRAFT', 'makesNew', null],
        ['GMAIL_SEND_EMAIL', 'deletesOrSends', null],
        ['GMAIL_DELETE_MESSAGE', 'deletesOrSends', 'off'],
    ];
    const CALENDAR_ROWS: Row[] = [['GOOGLECALENDAR_FIND_EVENT', 'looksUp', null]];
    const actions = (...slugs: string[]) => ({ tools: slugs.map((slug) => ({ tool_slug: slug, arguments: JSON.stringify({ id: slug.toLowerCase() }) })), thought: 'x' });

    function withGate(entry: ToolServerEntry) {
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS)));
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const made = setUp({}, { discover: async () => ({ tools: [tool(BATCH)], servers: new Map([[BATCH, entry]]) }), gate });
        return made;
    }

    it('is offered, and a batch of lookups runs once through its App with only the actions as they were read', async () => {
        const { apps, call, propose } = withGate(gmail);
        const session = (await apps.open(run()))!;
        expect(session.definitions.map((definition) => definition.function.name)).toEqual([BATCH]);
        expect(await session.call(BATCH, actions('GMAIL_FETCH_EMAILS'))).toContain('Found 3 issues');
        expect(call).toHaveBeenCalledWith('brick-1', expect.objectContaining({ serverId: 'g1' }), BATCH, { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { id: 'gmail_fetch_emails' } }], thought: 'x' }, 'sara-uuid', { heading: 'looksUp', callId: expect.any(String) });
        expect(propose).not.toHaveBeenCalled();
    });

    it('never sends a batch with an action that is Off, and asks on a card for one that makes, sends or deletes', async () => {
        const { apps, call, propose } = withGate(gmail);
        const session = (await apps.open(run()))!;
        expect(await session.call(BATCH, actions('GMAIL_FETCH_EMAILS', 'GMAIL_DELETE_MESSAGE'))).toContain('off for');
        expect(call).not.toHaveBeenCalled();
        await session.call(BATCH, actions('GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL'));
        expect(call).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolName: BATCH, entry: expect.objectContaining({ serverId: 'g1' }), decision: expect.objectContaining({ kind: 'ask', heading: 'deletesOrSends' }), task: { itemId: run().itemId } }));
    });

    it('asks on a card for a batch that makes something new, even when that is set to right away', async () => {
        const { apps, call, propose } = withGate(gmail);
        const session = (await apps.open(run()))!;
        await session.call(BATCH, actions('GMAIL_CREATE_EMAIL_DRAFT'));
        expect(call).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ decision: expect.objectContaining({ kind: 'ask', heading: 'makesNew' }) }));
    });

    it('offers and runs a link tool the Apps share through the first App that lets it be used', async () => {
        const LOOKUP = 'COMPOSIO_SEARCH_TOOLS';
        const read = vi.fn(async (_bot: string, serverId: string) => {
            const policy = serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS);
            return serverId === 'g1' ? { ...policy, settings: { ...policy.settings, looksUp: 'off' as const } } : policy;
        });
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const { apps, call } = setUp({}, { discover: async () => ({ tools: [tool(LOOKUP)], servers: new Map([[LOOKUP, { ...gmail, otherApps: [calendar] }]]) }), gate });
        const session = (await apps.open(run()))!;
        expect(session.definitions.map((definition) => definition.function.name)).toEqual([LOOKUP]);
        await session.call(LOOKUP, { queries: ['events'] });
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][1]).toMatchObject({ serverId: 'cal1' });
    });

    it('asks a search of every App that lets it be used and joins what they find, so Calendar’s actions are found beside Gmail’s', async () => {
        const LOOKUP = 'COMPOSIO_SEARCH_TOOLS';
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS)));
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const found = (serverId: string) => [{ type: 'text', text: JSON.stringify({ data: { results: [{ index: 1, primary_tool_slugs: [serverId === 'cal1' ? 'GOOGLECALENDAR_FIND_EVENT' : 'GMAIL_FETCH_EMAILS'] }] } }) }];
        const asked: string[] = [];
        const { apps } = setUp({}, { discover: async () => ({ tools: [tool(LOOKUP)], servers: new Map([[LOOKUP, { ...gmail, otherApps: [calendar] }]]) }), gate, call: async (_brick, app) => (asked.push(app.serverId), found(app.serverId)) });
        const session = (await apps.open(run()))!;
        const answer = await session.call(LOOKUP, { queries: ['events this week'] });
        expect(answer).toContain('GOOGLECALENDAR_FIND_EVENT');
        expect(answer).toContain('GMAIL_FETCH_EMAILS');
        expect(asked).toEqual(['g1', 'cal1']);
    });

    it('gives each App’s lookup its own call id, and names an App that did not answer without losing what the other found', async () => {
        const LOOKUP = 'COMPOSIO_SEARCH_TOOLS';
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS)));
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const calls: string[] = [];
        const { apps } = setUp({}, {
            discover: async () => ({ tools: [tool(LOOKUP)], servers: new Map([[LOOKUP, { ...gmail, otherApps: [calendar] }]]) }),
            gate,
            call: async (_brick, app, _name, _args, _owner, use) => {
                calls.push(use.callId);
                if (app.serverId === 'g1') throw new Error('down');
                return [{ type: 'text', text: '{"data":{"results":[{"index":1,"primary_tool_slugs":["GOOGLECALENDAR_FIND_EVENT"]}]}}' }];
            },
        });
        const session = (await apps.open(run()))!;
        const answer = await session.call(LOOKUP, { queries: ['events'] });
        expect(new Set(calls).size).toBe(2);
        expect(answer).toContain('GOOGLECALENDAR_FIND_EVENT');
        expect(answer).toContain('Gmail did not answer');
    });

    it('tries an App’s step again without the session id its link refused, once, as its own try', async () => {
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS)));
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const seen: Array<{ args: Record<string, unknown>; callId: string }> = [];
        const { apps } = setUp({}, {
            discover: async () => ({ tools: [tool(BATCH)], servers: new Map([[BATCH, { ...gmail, otherApps: [calendar] }]]) }),
            gate,
            call: async (_brick, _app, _name, args, _owner, use) => {
                seen.push({ args, callId: use.callId });
                return args.session_id ? { error: 'Invalid session id sess-g1' } : [{ type: 'text', text: '{"successful":true,"data":{"ran":true}}' }];
            },
        });
        const session = (await apps.open(run()))!;
        const answer = await session.call(BATCH, { ...actions('GOOGLECALENDAR_FIND_EVENT') as Record<string, unknown>, session_id: 'sess-g1' });
        expect(seen.map((one) => 'session_id' in one.args)).toEqual([true, false]);
        expect(new Set(seen.map((one) => one.callId)).size).toBe(2);
        expect(answer).toContain('successful');
        expect(answer).not.toContain('Invalid session');
    });

    it('never tries a failure again that is not about the session, and never a write that asks first', async () => {
        const { apps, call, propose } = withGate({ ...gmail, otherApps: [calendar] });
        call.mockResolvedValue({ error: 'The link is not answering.' } as never);
        const session = (await apps.open(run()))!;
        await session.call(BATCH, { ...actions('GOOGLECALENDAR_FIND_EVENT') as Record<string, unknown>, session_id: 'sess-g1' });
        expect(call).toHaveBeenCalledTimes(1);
        call.mockClear();
        await session.call(BATCH, { ...actions('GMAIL_REPLY_TO_THREAD') as Record<string, unknown>, session_id: 'sess-g1' });
        expect(call).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalled();
    });

    it('does not offer or run a link tool the Apps share when every one of them has it Off', async () => {
        const LOOKUP = 'COMPOSIO_SEARCH_TOOLS';
        const read = vi.fn(async (_bot: string, serverId: string) => {
            const policy = serverId === 'cal1' ? policyOf('cal1', CALENDAR_ROWS) : policyOf(serverId, GMAIL_ROWS);
            return { ...policy, settings: { ...policy.settings, looksUp: 'off' as const } };
        });
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const entries = new Map([[LOOKUP, { ...gmail, otherApps: [calendar] }]]);
        const { apps, call } = setUp({}, { discover: async () => ({ tools: [tool(LOOKUP)], servers: entries }), gate });
        expect(await apps.open(run())).toBeNull();
        // Turned off while a run was going: the step is refused, and nothing is sent
        const allowed = setUp({}, { discover: async () => ({ tools: [tool(LOOKUP)], servers: entries }), gate: new ToolGate({ read: async (_bot: string, serverId: string) => policyOf(serverId, GMAIL_ROWS) } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false }) });
        const session = (await allowed.apps.open(run()))!;
        (allowed.apps as unknown as { deps: TaskAppsDeps }).deps.gate = gate;
        expect(await session.call(LOOKUP, { queries: ['events'] })).toContain('turned off');
        expect(allowed.call).not.toHaveBeenCalled();
        expect(call).not.toHaveBeenCalled();
    });

    it('sends a batch through the App its actions belong to, and refuses one that mixes Apps or names none clearly', async () => {
        const { apps, call } = withGate({ ...gmail, otherApps: [calendar] });
        const session = (await apps.open(run()))!;
        await session.call(BATCH, actions('GOOGLECALENDAR_FIND_EVENT'));
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][1]).toMatchObject({ serverId: 'cal1' });
        expect(await session.call(BATCH, actions('GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_FIND_EVENT'))).toContain('in a step of its own');
        expect(await session.call(BATCH, actions('SLACK_SEND_MESSAGE'))).toContain("isn't clear which of your Apps");
        expect(call).toHaveBeenCalledTimes(1);
    });

    it("offers and runs the ready-made App's search and batch when the person's own App first under those names has them Off (own Apps first)", async () => {
        const LOOKUP = 'COMPOSIO_SEARCH_TOOLS';
        const own: ToolServerEntry = { serverId: 'own1', serverUrl: 'https://own.example/mcp', authType: 'none', serverName: 'My link', fingerprint: 'fp-own' };
        const ownOff: ServerPolicy = {
            serverId: 'own1',
            kind: 'tools',
            state: 'confirmed',
            policyRevision: 2,
            settings: { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' },
            tools: new Map<string, PolicyTool>([LOOKUP, BATCH].map((name) => [name, { name, heading: 'looksUp', fingerprint: 'fp-own', suggestedHeading: 'looksUp', confirmed: true, setting: 'off' }])),
        };
        const read = vi.fn(async (_bot: string, serverId: string) => (serverId === 'own1' ? ownOff : policyOf(serverId, GMAIL_ROWS)));
        const gate = new ToolGate({ read } as never, { check: async () => ({ kind: 'allowed', allowed: true }) } as never, { canManageBotTools: async () => false });
        const servers = new Map([
            [LOOKUP, { ...own, otherApps: [gmail] }],
            [BATCH, { ...own, otherApps: [gmail] }],
        ]);
        const { apps, call } = setUp({}, { discover: async () => ({ tools: [tool(LOOKUP), tool(BATCH)], servers }), gate });
        const session = (await apps.open(run()))!;
        expect(session.definitions.map((definition) => definition.function.name)).toEqual([BATCH, LOOKUP]);
        await session.call(LOOKUP, { queries: ['mail'] });
        await session.call(BATCH, actions('GMAIL_FETCH_EMAILS'));
        expect(call.mock.calls.map((args) => args[1].serverId)).toEqual(['g1', 'g1']);
        // An action no ready-made App owns goes to their own App, where it is Off: nothing is sent
        expect(await session.call(BATCH, actions('NOTION_SEARCH'))).toContain('turned off');
        expect(call).toHaveBeenCalledTimes(2);
    });

    it("never sends an action of an App the person has their own copy of through another App's link, even with one App left (own Apps first)", async () => {
        // Universe's ready-made Exa was left out because the owner has their own Exa: its search is refused here, and Gmail's own actions still run
        const { apps, call } = withGate({ ...gmail, ownCopyApps: ['Exa'] });
        const session = (await apps.open(run()))!;
        const line = await session.call(BATCH, actions('EXA_SEARCH'));
        expect(line).toContain("use your owner's own Exa App");
        expect(await session.call(BATCH, actions('GMAIL_FETCH_EMAILS', 'EXA_SEARCH'))).toContain("use your owner's own Exa App");
        expect(call).not.toHaveBeenCalled();
        await session.call(BATCH, actions('GMAIL_FETCH_EMAILS'));
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][1]).toMatchObject({ serverId: 'g1' });
    });

    it('still sends an action a remaining App lists, though a left-out App shares the start of its name', async () => {
        const { apps, call } = withGate({ ...gmail, otherApps: [calendar], ownCopyApps: ['Google'] });
        const session = (await apps.open(run()))!;
        await session.call(BATCH, actions('GOOGLECALENDAR_FIND_EVENT'));
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][1]).toMatchObject({ serverId: 'cal1' });
    });
});
