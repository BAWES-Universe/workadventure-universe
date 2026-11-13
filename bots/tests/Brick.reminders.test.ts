/**
 * Reminders, on the bot server (game #2002). Orbit is the only scheduler: it hands out what fell due, once for each due time. A
 * reminder is fixed text with no model: it is said once in its owner's own chat with their Brick, under the run's own id as its
 * Matrix transaction id, kept in Orbit before the run is reported, and never said again when the run is handed out again.
 */
import { describe, expect, it, vi } from 'vitest';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { BrickRunner, dueRunOf, reminderText, transactionIdOfRun, type BrickRunnerApi, type BrickSpeaker, type DueRun, type RunReport } from '../server/BrickRunner';

const run = (over: Partial<DueRun> = {}): DueRun => ({
    runId: 'run-1',
    itemId: 'item-1',
    brickId: 'brick-1',
    userId: 'sara-uuid',
    chatId: '@sara:matrix.test',
    kind: 'reminder',
    words: 'Pick up the car',
    timeZone: 'Asia/Kuwait',
    dueAt: '2026-11-15T13:00:00.000Z',
    late: false,
    attempt: 1,
    deliveredEventId: null,
    ...over,
});

function setUp(due: DueRun[] | Error, over: { check?: () => Promise<{ ok: boolean; reason?: string }>; say?: BrickSpeaker['say']; kept?: boolean } = {}) {
    const reports: Array<{ runId: string; report: RunReport }> = [];
    const api: BrickRunnerApi = {
        claimDue: vi.fn(async () => {
            if (due instanceof Error) throw due;
            return due;
        }),
        checkRun: vi.fn((over.check ?? (async () => ({ ok: true }))) as BrickRunnerApi['checkRun']),
        keepDelivered: vi.fn(async () => over.kept ?? true),
        report: vi.fn(async (runId, report) => {
            reports.push({ runId, report });
            return true;
        }),
    };
    const say = vi.fn(over.say ?? (async () => ({ ok: true as const, eventId: '$event-1' })));
    const warn = vi.fn();
    return { api, say, reports, warn, runner: new BrickRunner(api, { say }, { warn }) };
}

describe('a reminder is fixed text', () => {
    it('says what the person asked, and says when it was due only when it came late', () => {
        expect(reminderText(run())).toBe('Reminder: Pick up the car');
        expect(reminderText(run({ late: true, dueAt: '2026-11-15T13:00:00.000Z' }))).toBe('Late (due 4:00 PM): Pick up the car');
        // In the zone it was set in, not the server's
        expect(reminderText(run({ late: true, timeZone: 'America/New_York' }))).toBe('Late (due 8:00 AM): Pick up the car');
        // A zone this server does not know is still said, not dropped
        expect(reminderText(run({ late: true, timeZone: 'Nowhere/Land' }))).toBe('Late (due 1:00 PM UTC): Pick up the car');
    });
});

describe('the reminder is said once in its owner’s own chat', () => {
    it('checks the run, says it under the run’s own id, keeps where it went, then reports it done', async () => {
        const { runner, api, say, reports } = setUp([run()]);
        expect(await runner.tick()).toBe(1);
        expect(api.checkRun).toHaveBeenCalledWith('run-1', 1);
        expect(say).toHaveBeenCalledTimes(1);
        expect(say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', 'Reminder: Pick up the car', transactionIdOfRun('run-1'));
        expect(transactionIdOfRun('run-1')).toBe('brick-run:run-1');
        expect(api.keepDelivered).toHaveBeenCalledWith('run-1', '$event-1');
        expect(reports).toEqual([{ runId: 'run-1', report: { attempt: 1, state: 'done', outcome: 'spoke', result: 'Reminder: Pick up the car' } }]);
        // Kept before it was reported
        const order = [(api.keepDelivered as any).mock.invocationCallOrder[0], (api.report as any).mock.invocationCallOrder[0]];
        expect(order[0]).toBeLessThan(order[1]);
    });

    it('does not say it again when the run is handed out again after it was said', async () => {
        const { runner, api, say, reports } = setUp([run({ attempt: 2, deliveredEventId: '$event-1' })]);
        await runner.tick();
        expect(say).not.toHaveBeenCalled();
        expect(api.checkRun).not.toHaveBeenCalled();
        expect(reports).toEqual([{ runId: 'run-1', report: { attempt: 2, state: 'done', outcome: 'spoke', result: 'Reminder: Pick up the car' } }]);
    });

    it('says it again under the same transaction id when a crash lost where it went, so Matrix keeps one message', async () => {
        const first = setUp([run()]);
        await first.runner.tick();
        const second = setUp([run({ attempt: 2 })]);
        await second.runner.tick();
        expect(first.say.mock.calls[0][3]).toBe(second.say.mock.calls[0][3]);
    });

    it('says nothing, and reports nothing, for a run that was paused, finished, deleted or changed, or its Brick turned off', async () => {
        const { runner, say, reports } = setUp([run()], { check: async () => ({ ok: false, reason: 'paused' }) });
        await runner.tick();
        expect(say).not.toHaveBeenCalled();
        expect(reports).toEqual([]);
    });

    it('reports a failure when the person has no chat or may not message the Brick, and when the message did not go out', async () => {
        const noChat = setUp([run({ chatId: null })]);
        await noChat.runner.tick();
        expect(noChat.say).not.toHaveBeenCalled();
        expect(noChat.reports[0].report).toMatchObject({ attempt: 1, state: 'failed', error: expect.stringContaining('no chat') });

        for (const reason of ['not_allowed', 'failed'] as const) {
            const { runner, reports, api } = setUp([run()], { say: async () => ({ ok: false, reason }) });
            await runner.tick();
            expect(reports).toHaveLength(1);
            expect(reports[0].report.state).toBe('failed');
            expect(api.keepDelivered).not.toHaveBeenCalled();
        }
    });

    it('still reports a run done when Orbit did not keep where it went: it is said, and the same transaction id covers a second try', async () => {
        const { runner, reports, warn } = setUp([run()], { kept: false });
        await runner.tick();
        expect(reports[0].report.state).toBe('done');
        expect(warn).toHaveBeenCalled();
    });
});

describe('what it leaves alone', () => {
    it('does not run a watch, a briefing or a goal here: they need a model, and are never reported as failed', async () => {
        const { runner, say, reports } = setUp([run({ kind: 'watch' }), run({ runId: 'run-2', kind: 'goal' }), run({ runId: 'run-3', kind: 'schedule' })]);
        expect(await runner.tick()).toBe(0);
        expect(say).not.toHaveBeenCalled();
        expect(reports).toEqual([]);
    });

    it('goes on to the next run when one breaks', async () => {
        const say = vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ ok: true, eventId: '$e2' });
        const { runner, reports, warn } = setUp([run(), run({ runId: 'run-2' })], { say });
        expect(await runner.tick()).toBe(1);
        expect(reports.map((one) => one.runId)).toEqual(['run-2']);
        expect(warn).toHaveBeenCalled();
    });

    it('does nothing when Orbit cannot be asked, and asks again next time', async () => {
        const { runner, say, warn } = setUp(new Error('down'));
        expect(await runner.tick()).toBe(0);
        expect(say).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });

    it('never runs two rounds at once', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const { runner, api } = setUp([run()], { say: async () => (await gate, { ok: true as const, eventId: '$e' }) });
        const first = runner.tick();
        expect(await runner.tick()).toBe(0);
        expect(api.claimDue).toHaveBeenCalledTimes(1);
        release();
        expect(await first).toBe(1);
    });
});

describe('what Orbit hands out is read with care', () => {
    it('keeps a run with what it needs and drops one without', () => {
        expect(dueRunOf({ ...run(), steps: [], extra: 1 })).toEqual(run());
        expect(dueRunOf({ ...run(), chatId: undefined })?.chatId).toBeNull();
        expect(dueRunOf({ ...run(), kind: 'quest' })).toBeNull();
        expect(dueRunOf({ ...run(), runId: '' })).toBeNull();
        expect(dueRunOf({ ...run(), attempt: '1' })).toBeNull();
        expect(dueRunOf(null)).toBeNull();
    });
});

describe('the Brick speaks in the owner’s own chat, on its own account', () => {
    const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
    const BRICK_USER = `@bot_${BRICK}:matrix.test`;
    const SARA = '@sara:matrix.test';
    const ROOM = '!dm:matrix.test';

    function bridgeWith(opts: { room?: string | null; members?: string[]; access?: any; sendFails?: boolean }) {
        const sendMessage = vi.fn(async () => {
            if (opts.sendFails) throw new Error('homeserver down');
            return '$said';
        });
        const client = {
            sendMessage,
            getJoinedMembers: vi.fn(async () => opts.members ?? [SARA, BRICK_USER]),
        };
        const deps: any = {
            getBotConfig: vi.fn(async () => ({ botId: BRICK, name: 'Brick', enabled: true })),
            checkAccess: vi.fn(async () => opts.access ?? { allowed: true, reason: null, user: { uuid: 'sara-uuid', name: 'Sara', isGuest: false } }),
            reply: vi.fn(),
            rooms: {
                rememberDmRoom: vi.fn(async () => undefined),
                getDmRoomBot: vi.fn(async () => BRICK),
                forgetDmRoom: vi.fn(async () => undefined),
                rememberDmRoomOf: vi.fn(async () => undefined),
                getDmRoomOf: vi.fn(async () => (opts.room === undefined ? ROOM : opts.room)),
                forgetDmRoomOf: vi.fn(async () => undefined),
            },
        };
        const bridge = new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps);
        return { bridge, sendMessage, deps };
    }

    it('sends the text as the Brick into the chat the two share alone, under the run’s transaction id', async () => {
        const { bridge, sendMessage } = bridgeWith({});
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'Reminder: Pick up the car', 'brick-run:run-1')).toEqual({ ok: true, eventId: '$said' });
        expect(sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Reminder: Pick up the car' }, 'brick-run:run-1');
    });

    it('makes no chat for a person who has none', async () => {
        const { bridge, sendMessage } = bridgeWith({ room: null });
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'no_chat' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('says nothing in a room someone else is in', async () => {
        const { bridge, sendMessage } = bridgeWith({ members: [SARA, BRICK_USER, '@omar:matrix.test'] });
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'no_chat' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('says nothing to someone Orbit says may not message the Brick, or when Orbit cannot say', async () => {
        const denied = bridgeWith({ access: { allowed: false, reason: 'not_allowed', user: null } });
        expect(await denied.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(denied.sendMessage).not.toHaveBeenCalled();
        const unknown = bridgeWith({ access: { allowed: false, reason: 'admin_api_unreachable', user: null } });
        expect(await unknown.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toMatchObject({ ok: false });
        expect(unknown.sendMessage).not.toHaveBeenCalled();
    });

    it('answers failed, never throws, when the homeserver does not take it', async () => {
        const { bridge } = bridgeWith({ sendFails: true });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'failed' });
    });
});
