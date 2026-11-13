/**
 * Reminders, on the bot server (game #2002). Orbit is the only scheduler: it hands out what fell due, once for each due time. A
 * reminder is fixed text with no model: it is said once in its owner's own chat with their Brick, under the run's own id as its
 * Matrix transaction id, kept in Orbit before the run is reported, and never said again when the run is handed out again.
 */
import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { AdminApiService } from '../server/AdminApiService';
import { BrickRunner, RUNNABLE_KINDS, dueRunOf, reminderText, transactionIdOfRun, type BrickRunnerApi, type BrickSpeaker, type DueRun, type RunReport } from '../server/BrickRunner';

const run = (over: Partial<DueRun> = {}): DueRun => ({
    runId: 'run-1',
    itemId: 'item-1',
    brickId: 'brick-1',
    userId: 'sara-uuid',
    matrixUserId: '@sara:matrix.test',
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

    it('reports a failure only when it is certain: the person has no chat, or may not message the Brick', async () => {
        const noChat = setUp([run({ matrixUserId: null })]);
        await noChat.runner.tick();
        expect(noChat.say).not.toHaveBeenCalled();
        expect(noChat.reports[0].report).toMatchObject({ attempt: 1, state: 'failed', error: expect.stringContaining('no chat') });

        for (const reason of ['no_chat', 'not_allowed'] as const) {
            const { runner, reports, api } = setUp([run()], { say: async () => ({ ok: false, reason }) });
            await runner.tick();
            expect(reports).toHaveLength(1);
            expect(reports[0].report.state).toBe('failed');
            expect(api.keepDelivered).not.toHaveBeenCalled();
        }
    });

    it('reports nothing when it could not tell (a blip), so the lease hands the run out again; the second try says it once, under the same transaction id', async () => {
        const say = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, reason: 'unsure' })
            .mockResolvedValueOnce({ ok: true, eventId: '$e1' });
        const first = setUp([run()], { say });
        expect(await first.runner.tick()).toBe(0);
        expect(first.reports).toEqual([]);
        expect(first.api.keepDelivered).not.toHaveBeenCalled();
        expect(first.warn).toHaveBeenCalled();
        // Handed out again with a later attempt
        const second = setUp([run({ attempt: 2 })], { say });
        expect(await second.runner.tick()).toBe(1);
        expect(second.reports).toEqual([{ runId: 'run-1', report: { attempt: 2, state: 'done', outcome: 'spoke', result: 'Reminder: Pick up the car' } }]);
        expect(say.mock.calls[0][3]).toBe('brick-run:run-1');
        expect(say.mock.calls[1][3]).toBe('brick-run:run-1');
        expect(say).toHaveBeenCalledTimes(2);
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
        expect(dueRunOf({ ...run(), matrixUserId: undefined })?.matrixUserId).toBeNull();
        // Orbit names the owner's Matrix user id as matrixUserId
        expect(dueRunOf({ ...run(), matrixUserId: '@omar:matrix.test' })?.matrixUserId).toBe('@omar:matrix.test');
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
        const sendMessage = vi.fn(async (..._args: unknown[]) => {
            if (opts.sendFails) throw new Error('homeserver down');
            return '$said';
        });
        const client = {
            sendMessage,
            getJoinedMembers: vi.fn(async (..._args: unknown[]) => opts.members ?? [SARA, BRICK_USER]),
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
        return { bridge, sendMessage, deps, client };
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

    it('says not_allowed only when Orbit answered no, and nothing is sent', async () => {
        const denied = bridgeWith({ access: { allowed: false, reason: 'not_allowed', user: null } });
        expect(await denied.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(denied.sendMessage).not.toHaveBeenCalled();
    });

    it('answers unsure, and sends nothing, when Orbit could not be asked, or its answer failed', async () => {
        const down = bridgeWith({ access: { allowed: false, reason: 'admin_api_unreachable', user: null } });
        expect(await down.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        expect(down.sendMessage).not.toHaveBeenCalled();
        const throws = bridgeWith({});
        throws.deps.checkAccess.mockRejectedValueOnce(new Error('boom'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await throws.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        expect(throws.sendMessage).not.toHaveBeenCalled();
    });

    it('answers unsure, never no_chat, when the stored chat or who is in it could not be looked at', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        // The store of known chats could not be read: "none" is not certain
        const store = bridgeWith({});
        store.deps.rooms.getDmRoomOf.mockRejectedValueOnce(new Error('store down'));
        expect(await store.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        expect(store.sendMessage).not.toHaveBeenCalled();
        // Who is in the room could not be read
        const members = bridgeWith({});
        members.client.getJoinedMembers.mockRejectedValueOnce(new Error('homeserver down'));
        expect(await members.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        expect(members.sendMessage).not.toHaveBeenCalled();
    });

    it('answers unsure, never throws, when the homeserver does not take it; the same transaction id covers a second try', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const failing = bridgeWith({ sendFails: true });
        expect(await failing.bridge.speakInDirectChat(BRICK, SARA, 'x', 'brick-run:run-1')).toEqual({ ok: false, reason: 'unsure' });
        // Second try (a lease later): sent under the very same transaction id, which Matrix takes as one message
        const second = bridgeWith({});
        expect(await second.bridge.speakInDirectChat(BRICK, SARA, 'x', 'brick-run:run-1')).toEqual({ ok: true, eventId: '$said' });
        expect(failing.sendMessage.mock.calls[0][3]).toBe(second.sendMessage.mock.calls[0][3]);
    });

    it('speaks to the owner Orbit names, by the Matrix user id in an Orbit-shaped run, in that user’s direct room, once', async () => {
        const { bridge, sendMessage, deps } = bridgeWith({});
        const orbitRun = dueRunOf({ runId: 'run-9', itemId: 'item-9', brickId: BRICK, userId: 'sara-uuid', matrixUserId: SARA, kind: 'reminder', words: 'Pick up the car', timeZone: 'Asia/Kuwait', dueAt: '2026-11-15T13:00:00.000Z', late: false, attempt: 1 })!;
        const runner = new BrickRunner(
            {
                claimDue: async () => [orbitRun],
                checkRun: async () => ({ ok: true }),
                keepDelivered: async () => true,
                report: async () => true,
            },
            { say: (brickId, matrixUserId, text, transactionId) => bridge.speakInDirectChat(brickId, matrixUserId, text, transactionId) },
            { warn: () => undefined }
        );
        expect(await runner.tick()).toBe(1);
        expect(deps.rooms.getDmRoomOf).toHaveBeenCalledWith(BRICK, SARA);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Reminder: Pick up the car' }, 'brick-run:run-9');
    });
});

describe('the bot server asks Orbit only for what it can run', () => {
    it('sends the kinds it runs with the due call, so a watch or a goal is never handed out here', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({ data: { runs: [] } } as never);
        vi.stubEnv('BOT_SERVICE_TOKEN', 'token');
        const service = new AdminApiService('https://orbit.test/', 'admin-token');
        await service.claimDueItems();
        expect(RUNNABLE_KINDS).toEqual(['reminder']);
        expect(request).toHaveBeenCalledTimes(1);
        const sent = request.mock.calls[0][0] as { method: string; url: string; data: unknown };
        expect(sent.method).toBe('post');
        expect(sent.url).toContain('api/bricks/items/due');
        expect(sent.data).toEqual({ kinds: ['reminder'] });
        request.mockRestore();
        vi.unstubAllEnvs();
    });
});
