/**
 * The Apps a goal's, watch's or briefing's run may use (game #2002, G3b). Setting one grants nothing: a run uses an App as the owner's own chat
 * would, under the same headings and the same check right before every call, and is stricter where nobody is watching: a step that makes
 * something new, sends or deletes asks on a card for this occurrence whatever the setting says, and an App nobody reviewed is not used.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolServerEntry } from '../mcp/MCPConnector';
import type { GateDecision } from '../mcp/ToolGate';
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

    it('answers a step that fails with a plain error and never throws, and cuts what an App gives back', async () => {
        const broken = setUp({ search: RUN('looksUp') }, {
            call: async () => {
                throw new Error('boom');
            },
        });
        expect(JSON.parse(await (await broken.apps.open(run()))!.call('search', {})).error).toMatch(/did not work/);
        const big = setUp({ search: RUN('looksUp') }, { call: async () => 'x'.repeat(50_000) });
        expect((await (await big.apps.open(run()))!.call('search', {})).length).toBe(12_000);
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
