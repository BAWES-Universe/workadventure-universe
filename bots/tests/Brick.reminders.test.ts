/**
 * Reminders, on the bot server (game #2002). Orbit is the only scheduler: it hands out what fell due, once for each due time. A
 * reminder is fixed text with no model: it is said once in its owner's own chat with their Brick, under the run's own id as its
 * Matrix transaction id, kept in Orbit before the run is reported, and never said again when the run is handed out again.
 */
import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MatrixDmBridge, chatRefusedForGood, computerFileMsgtype } from '../matrix/MatrixDmBridge';
import type { AttachedFile } from '../server/ComputerReports';
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
    condition: null,
    outcome: null,
    steps: [],
    statusLine: null,
    timeZone: 'Asia/Kuwait',
    dueAt: '2026-11-15T13:00:00.000Z',
    late: false,
    fresh: false,
    attempt: 1,
    deliveredEventId: null,
    deliveredReport: null,
    ...over,
});

function setUp(due: DueRun[] | Error, over: { check?: () => Promise<{ ok: boolean; reason?: string }>; say?: BrickSpeaker['say']; kept?: boolean } = {}) {
    const reports: Array<{ runId: string; report: RunReport }> = [];
    const api: BrickRunnerApi = {
        claimDue: vi.fn(async (_kinds?: unknown) => {
            if (due instanceof Error) throw due;
            return { runs: due, held: [] };
        }),
        checkRun: vi.fn((over.check ?? (async () => ({ ok: true }))) as BrickRunnerApi['checkRun']),
        keepDelivered: vi.fn(async () => over.kept ?? true),
        keepTold: vi.fn(async () => true),
        keepHeldTold: vi.fn(async () => true),
        report: vi.fn(async (runId, report) => {
            reports.push({ runId, report });
            return { tellPerson: false };
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
        expect(noChat.reports[0].report).toMatchObject({ attempt: 1, state: 'failed', error: expect.stringContaining('could not find its chat') });

        for (const reason of ['no_chat', 'not_allowed'] as const) {
            const { runner, reports, api } = setUp([run()], { say: async () => ({ ok: false, reason }) });
            await runner.tick();
            expect(reports).toHaveLength(1);
            expect(reports[0].report.state).toBe('failed');
            expect(api.keepDelivered).not.toHaveBeenCalled();
        }
    });

    it('says nothing and reports nothing when the run may not go on (paused, deleted): Orbit closes it at its lease end', async () => {
        const say = vi.fn();
        const { runner, reports } = setUp([run()], { check: async () => ({ ok: false }), say });
        expect(await runner.tick()).toBe(0);
        expect(say).not.toHaveBeenCalled();
        expect(reports).toEqual([]);
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

    function bridgeWith(opts: { room?: string | null; members?: string[]; membersOf?: Record<string, string[]>; access?: any; sendFails?: boolean }) {
        const sendMessage = vi.fn(async (..._args: unknown[]) => {
            if (opts.sendFails) throw new Error('homeserver down');
            return '$said';
        });
        const uploadMedia = vi.fn(async (..._args: unknown[]) => 'mxc://matrix.test/abc');
        const client = {
            sendMessage,
            uploadMedia,
            getJoinedMembers: vi.fn(async (...args: unknown[]) => opts.membersOf?.[String(args[1])] ?? opts.members ?? [SARA, BRICK_USER]),
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
        return { bridge, sendMessage, uploadMedia, deps, client };
    }

    it('sends the text as the Brick into the chat the two share alone, under the run’s transaction id', async () => {
        const { bridge, sendMessage } = bridgeWith({});
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'Reminder: Pick up the car', 'brick-run:run-1')).toEqual({ ok: true, eventId: '$said' });
        expect(sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Reminder: Pick up the car', 'net.bawes.universe.alone': true }, 'brick-run:run-1');
    });

    it('puts a "Worked on its computer" line above a finished computer job, as a notice under its own transaction id, then says the text', async () => {
        const { bridge, sendMessage } = bridgeWith({});
        const field = { v: 1, state: 'done', line: 'Worked on its computer', startedAt: 1, took: 540, steps: [] } as never;
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'Visa form is done.', 'computer-told:j:done', { steps: { field, text: 'Worked on its computer' } })).toEqual({ ok: true, eventId: '$said' });
        expect(sendMessage).toHaveBeenNthCalledWith(1, BRICK_USER, ROOM, { msgtype: 'm.notice', body: 'Worked on its computer', 'universe.steps': field }, 'computer-told:j:done:steps');
        expect(sendMessage).toHaveBeenNthCalledWith(2, BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Visa form is done.', 'net.bawes.universe.alone': true }, 'computer-told:j:done');
    });

    it('still says the text when the line above it could not be sent', async () => {
        const { bridge, sendMessage } = bridgeWith({});
        sendMessage.mockRejectedValueOnce(new Error('homeserver blip'));
        const field = { v: 1, state: 'done', line: 'Worked on its computer', startedAt: 1, steps: [] } as never;
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'Visa form is done.', 'k', { steps: { field, text: 'Worked on its computer' } } as never)).toEqual({ ok: true, eventId: '$said' });
        expect(sendMessage).toHaveBeenLastCalledWith(BRICK_USER, ROOM, expect.objectContaining({ body: 'Visa form is done.' }), 'k');
    });

    describe('file cards from a finished computer job', () => {
        const marked: string[] = [];
        const file = (id: string, name: string, mime: string, bytes: Buffer | null | Error): AttachedFile => ({
            id,
            name,
            mime,
            bytes: bytes instanceof Buffer ? bytes.length : 0,
            load: async () => {
                if (bytes instanceof Error) throw bytes;
                return bytes;
            },
            delivered: async () => void marked.push(id),
        });

        it('sends each file after the message as a file message under its own transaction id, and says they all went', async () => {
            const { bridge, sendMessage, uploadMedia } = bridgeWith({});
            const answer = await bridge.speakInDirectChat(BRICK, SARA, 'Visa form is done.', 'computer-told:j:done', {
                files: [file('f1', 'visa-receipt.pdf', 'application/pdf', Buffer.from('%PDF')), file('f2', 'photo.png', 'image/png', Buffer.from('png'))],
            });
            expect(answer).toEqual({ ok: true, eventId: '$said', files: { attached: ['f1', 'f2'], missed: [] } });
            expect(sendMessage).toHaveBeenNthCalledWith(1, BRICK_USER, ROOM, expect.objectContaining({ msgtype: 'm.text', body: 'Visa form is done.' }), 'computer-told:j:done');
            expect(uploadMedia).toHaveBeenNthCalledWith(1, BRICK_USER, Buffer.from('%PDF'), 'application/pdf', 'visa-receipt.pdf');
            expect(sendMessage).toHaveBeenNthCalledWith(
                2,
                BRICK_USER,
                ROOM,
                { msgtype: 'm.file', body: 'visa-receipt.pdf', filename: 'visa-receipt.pdf', url: 'mxc://matrix.test/abc', info: { mimetype: 'application/pdf', size: 4 } },
                'computer-told:j:done:file:f1'
            );
            expect(sendMessage).toHaveBeenNthCalledWith(3, BRICK_USER, ROOM, expect.objectContaining({ msgtype: 'm.image', filename: 'photo.png' }), 'computer-told:j:done:file:f2');
        });

        it('says each file is delivered only after the chat took it, so a restart never uploads one twice, and a file that did not go is never marked', async () => {
            marked.length = 0;
            const { bridge, uploadMedia, sendMessage } = bridgeWith({});
            const tooBig = Object.assign(new Error('too large'), { response: { status: 413 } });
            uploadMedia.mockResolvedValueOnce('mxc://matrix.test/one').mockRejectedValueOnce(tooBig);
            sendMessage.mockImplementation(async (..._args: unknown[]) => {
                // The first file is marked before the second one is even tried
                if (_args[3] === 'computer-told:j:done:file:f2') expect(marked).toEqual(['f1']);
                return '$said';
            });
            await bridge.speakInDirectChat(BRICK, SARA, 'done', 'computer-told:j:done', { files: [file('f1', 'a.pdf', 'application/pdf', Buffer.from('a')), file('f2', 'big.zip', 'application/zip', Buffer.from('b'))] });
            expect(marked).toEqual(['f1']);
        });

        it('a mark that cannot be kept never costs the person the file or the report', async () => {
            const { bridge } = bridgeWith({});
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const one = { ...file('f1', 'a.pdf', 'application/pdf', Buffer.from('a')), delivered: async () => Promise.reject(new Error('Orbit down')) };
            expect(await bridge.speakInDirectChat(BRICK, SARA, 'done', 't', { files: [one] })).toMatchObject({ ok: true, files: { attached: ['f1'], missed: [] } });
            warn.mockRestore();
        });

        it('shows a picture, a sound and a video as such, and a page, a script or a vector picture as a file to download', () => {
            expect(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'video/mp4', 'image/svg+xml', 'text/html', 'application/octet-stream', 'application/pdf'].map(computerFileMsgtype)).toEqual([
                'm.image', 'm.image', 'm.image', 'm.image', 'm.audio', 'm.video', 'm.file', 'm.file', 'm.file', 'm.file',
            ]);
        });

        it('says which file could not go and whether another try may work: gone from Orbit and refused by the chat will not, a fetch or send that failed may', async () => {
            const { bridge, sendMessage, uploadMedia } = bridgeWith({});
            const tooBig = Object.assign(new Error('too large'), { response: { status: 413 } });
            uploadMedia.mockResolvedValueOnce('mxc://matrix.test/one').mockRejectedValueOnce(tooBig).mockResolvedValueOnce('mxc://matrix.test/three');
            const answer = await bridge.speakInDirectChat(BRICK, SARA, 'done', 't', {
                files: [
                    file('f1', 'a.pdf', 'application/pdf', Buffer.from('a')),
                    file('f2', 'big.zip', 'application/zip', Buffer.from('b')),
                    file('f3', 'gone.pdf', 'application/pdf', null),
                    file('f4', 'orbit-down.pdf', 'application/pdf', new Error('Orbit down')),
                    file('f5', 'e.pdf', 'application/pdf', Buffer.from('e')),
                ],
            });
            expect(answer).toEqual({
                ok: true,
                eventId: '$said',
                files: {
                    attached: ['f1', 'f5'],
                    missed: [
                        { id: 'f2', name: 'big.zip', again: false },
                        { id: 'f3', name: 'gone.pdf', again: false, gone: true },
                        { id: 'f4', name: 'orbit-down.pdf', again: true },
                    ],
                },
            });
            expect(sendMessage).toHaveBeenCalledTimes(3);
        });

        it('tries again after a refusal that will pass: too many requests, a timeout, a server error, even though axios calls every 4xx a bad request', () => {
            const refused = (status: number) => Object.assign(new Error('refused'), { code: status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE', response: { status } });
            expect([400, 403, 413].map((status) => chatRefusedForGood(refused(status)))).toEqual([true, true, true]);
            expect([408, 429, 500, 502, 503].map((status) => chatRefusedForGood(refused(status)))).toEqual([false, false, false, false, false]);
            expect(chatRefusedForGood(Object.assign(new Error('too big'), { code: 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' }))).toBe(true);
            expect(chatRefusedForGood(new Error('socket hang up'))).toBe(false);
        });

        it('says a chat that did not answer may be tried again, and never says a file’s name in the log', async () => {
            const { bridge, sendMessage } = bridgeWith({});
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            sendMessage.mockResolvedValueOnce('$said').mockRejectedValueOnce(new Error('homeserver down'));
            const answer = await bridge.speakInDirectChat(BRICK, SARA, 'done', 't', { files: [file('f1', 'passport-scan.pdf', 'application/pdf', Buffer.from('a'))] });
            expect(answer).toMatchObject({ ok: true, files: { attached: [], missed: [{ id: 'f1', again: true }] } });
            expect(JSON.stringify(warn.mock.calls)).not.toContain('passport-scan');
            warn.mockRestore();
        });

        it('sends no file when the message itself could not go: the files wait for a try that can', async () => {
            const { bridge, uploadMedia } = bridgeWith({ sendFails: true });
            expect(await bridge.speakInDirectChat(BRICK, SARA, 'done', 't', { files: [file('f1', 'a.pdf', 'application/pdf', Buffer.from('a'))] })).toEqual({ ok: false, reason: 'unsure' });
            expect(uploadMedia).not.toHaveBeenCalled();
        });

        it('refuses a chat that is not the person’s own, with no file sent', async () => {
            const { bridge, uploadMedia } = bridgeWith({ room: null });
            expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { files: [file('f1', 'a.pdf', 'application/pdf', Buffer.from('a'))] })).toEqual({ ok: false, reason: 'no_chat' });
            expect(uploadMedia).not.toHaveBeenCalled();
        });
    });

    describe('what a job made goes back to the conversation it began in, and nowhere else', () => {
        it('speaks in the chat the job began in', async () => {
            const { bridge, sendMessage } = bridgeWith({});
            expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: true, eventId: '$said' });
            expect(sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, expect.anything(), 't');
        });

        it('says origin_gone, and sends nothing, when the chat the two share now is another one and the chat it began in is not theirs any more (never a chat picked or made for it)', async () => {
            const { bridge, sendMessage, uploadMedia } = bridgeWith({ membersOf: { '!old-chat:matrix.test': [SARA] } });
            const answer = await bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: '!old-chat:matrix.test', files: [{ id: 'f1', name: 'a.pdf', mime: 'application/pdf', bytes: 1, load: async () => Buffer.from('a'), delivered: async () => undefined }] });
            expect(answer).toEqual({ ok: false, reason: 'origin_gone' });
            expect(sendMessage).not.toHaveBeenCalled();
            expect(uploadMedia).not.toHaveBeenCalled();
        });

        it('still speaks in the chat the job began in when the chat kept for the person is another one, as long as it is still the two of them alone; a look that failed waits', async () => {
            // The record points at ROOM, the job began in the older chat, which is still the person and the Brick alone
            const both = bridgeWith({});
            expect(await both.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: '!old-chat:matrix.test' })).toEqual({ ok: true, eventId: '$said' });
            expect(both.sendMessage).toHaveBeenCalledWith(BRICK_USER, '!old-chat:matrix.test', expect.anything(), 't');
            // Nothing is said in the chat kept now, and the record never moves to the older chat
            expect(both.sendMessage).not.toHaveBeenCalledWith(BRICK_USER, ROOM, expect.anything(), expect.anything());
            expect(both.deps.rooms.rememberDmRoomOf).not.toHaveBeenCalledWith(BRICK, SARA, '!old-chat:matrix.test');
            // Someone else is in it: gone, not a retry
            const shared = bridgeWith({ membersOf: { '!old-chat:matrix.test': [SARA, BRICK_USER, '@someone:matrix.test'] } });
            expect(await shared.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: '!old-chat:matrix.test' })).toEqual({ ok: false, reason: 'origin_gone' });
            expect(shared.sendMessage).not.toHaveBeenCalled();
            // The look failed: tried again later, never marked gone
            const down = bridgeWith({});
            down.client.getJoinedMembers.mockRejectedValueOnce(new Error('homeserver down'));
            expect(await down.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: '!old-chat:matrix.test' })).toEqual({ ok: false, reason: 'unsure' });
            expect(down.sendMessage).not.toHaveBeenCalled();
        });

        it('uses the chat the job began in when the shared store has lost its record of it, and notes it again; a store that could not be read waits', async () => {
            // Nothing recorded (a restart, a store that was emptied), but the chat the job began in is still the two of them alone
            const lost = bridgeWith({ room: null });
            expect(await lost.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: true, eventId: '$said' });
            expect(lost.sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, expect.anything(), 't');
            expect(lost.deps.rooms.rememberDmRoomOf).toHaveBeenCalledWith(BRICK, SARA, ROOM);
            // The record appears later: the same words are sent into the same chat, once the first try had to wait
            const later = bridgeWith({ room: null });
            later.client.getJoinedMembers.mockRejectedValueOnce(new Error('homeserver down'));
            expect(await later.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: false, reason: 'unsure' });
            expect(later.sendMessage).not.toHaveBeenCalled();
            expect(await later.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: true, eventId: '$said' });
            // The chat it began in is not the two of them any more: gone for good, and nothing is said anywhere else
            const strangers = bridgeWith({ room: null, members: [SARA, BRICK_USER, '@someone:matrix.test'] });
            expect(await strangers.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: false, reason: 'origin_gone' });
            expect(strangers.sendMessage).not.toHaveBeenCalled();
            const left = bridgeWith({ room: null, members: [SARA] });
            expect(await left.bridge.speakInDirectChat(BRICK, SARA, 'x', 't', { room: ROOM })).toEqual({ ok: false, reason: 'origin_gone' });
        });

        it('still says no_chat when there is no chat at all and nothing to say where it began, and keeps the goals’ own room check the same as it was', async () => {
            const none = bridgeWith({ room: null });
            expect(await none.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'no_chat' });
            expect(await none.bridge.roomToSpeakIn(BRICK, SARA)).toEqual({ ok: false, reason: 'no_chat' });
            expect(await bridgeWith({}).bridge.roomToSpeakIn(BRICK, SARA)).toEqual({ ok: true, roomId: ROOM });
        });
    });

    it('says refused, never unsure, when the chat turned the message down for good, and unsure when it only did not answer', async () => {
        const refused = bridgeWith({});
        refused.sendMessage.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await refused.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'refused' });
        const rate = bridgeWith({});
        rate.sendMessage.mockRejectedValueOnce(Object.assign(new Error('slow down'), { response: { status: 429 } }));
        expect(await rate.bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        warn.mockRestore();
    });

    it('makes no chat for a person who has none', async () => {
        const { bridge, sendMessage } = bridgeWith({ room: null });
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'no_chat' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('writes a chat the shared store could not take again the next time it is seen, so a restart does not lose it', async () => {
        const { bridge, deps } = bridgeWith({});
        const remember = deps.rooms.rememberDmRoomOf as ReturnType<typeof vi.fn>;
        remember.mockRejectedValueOnce(new Error('redis down'));
        const note = (bridge as unknown as { noteDirectRoom(b: string, u: string, r: string): Promise<void> }).noteDirectRoom.bind(bridge);
        await note(BRICK, SARA, '!room:matrix.test');
        await note(BRICK, SARA, '!room:matrix.test');
        // The first write failed, so the second sighting wrote it again; a third finds nothing left to do
        await note(BRICK, SARA, '!room:matrix.test');
        expect(remember).toHaveBeenCalledTimes(2);
    });

    it('says nothing, and says it could not tell, when someone joins the room while the access check is pending', async () => {
        const { bridge, deps, sendMessage } = bridgeWith({});
        deps.checkAccess.mockImplementationOnce(async () => {
            (bridge as unknown as { roomMembers: Map<string, Set<string>> }).roomMembers.set(ROOM, new Set([SARA, BRICK_USER, '@omar:matrix.test']));
            return { allowed: true, reason: null, user: { uuid: 'sara-uuid', name: 'Sara', isGuest: false } };
        });
        expect(await bridge.speakInDirectChat(BRICK, SARA, 'x', 't')).toEqual({ ok: false, reason: 'unsure' });
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('writes the room-to-bot record again with the chat, when the store could not take it the first time', async () => {
        const { bridge, deps } = bridgeWith({});
        const rememberRoom = (bridge as unknown as { rememberRoom(r: string, b: string): Promise<void> }).rememberRoom.bind(bridge);
        const note = (bridge as unknown as { noteDirectRoom(b: string, u: string, r: string): Promise<void> }).noteDirectRoom.bind(bridge);
        deps.rooms.rememberDmRoom.mockRejectedValueOnce(new Error('redis down'));
        await rememberRoom(ROOM, BRICK);
        // The chat is noted next: it writes both again, and a later sighting finds nothing left to write
        await note(BRICK, SARA, ROOM);
        await note(BRICK, SARA, ROOM);
        expect(deps.rooms.rememberDmRoom).toHaveBeenCalledTimes(2);
        expect(deps.rooms.rememberDmRoomOf).toHaveBeenCalledTimes(1);
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
                claimDue: async () => ({ runs: [orbitRun], held: [] }),
                checkRun: async () => ({ ok: true }),
                keepDelivered: async () => true,
                keepTold: async () => true,
                keepHeldTold: async () => true,
                report: async () => ({ tellPerson: false }),
            },
            { say: (brickId, matrixUserId, text, transactionId) => bridge.speakInDirectChat(brickId, matrixUserId, text, transactionId) },
            { warn: () => undefined }
        );
        expect(await runner.tick()).toBe(1);
        expect(deps.rooms.getDmRoomOf).toHaveBeenCalledWith(BRICK, SARA);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Reminder: Pick up the car', 'net.bawes.universe.alone': true }, 'brick-run:run-9');
    });
});

describe('the bot server asks Orbit only for what it can run', () => {
    it('sends the kinds it runs with the due call, so a watch or a goal is never handed out here', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({ data: { runs: [] } } as never);
        vi.stubEnv('BOT_SERVICE_TOKEN', 'token');
        const service = new AdminApiService('https://orbit.test/', 'admin-token');
        await service.claimDueItems(RUNNABLE_KINDS);
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
