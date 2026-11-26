/**
 * "Send to the Universe team" (mock "Brick reports inbox"): every Brick has the tool in its direct messages, its notes are product-only and filled
 * from what the reply ran, the person's own words go only as a draft they send themselves, a note asked again carries the same reference, Orbit is
 * asked with the bot server's own token, and in a direct message the note rides on the words of the answer so the game shows "Sent to the
 * Universe team" under it with what was sent and Take it back.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: (error: any) => !!error?.isAxiosError },
    isAxiosError: (error: any) => !!error?.isAxiosError,
}));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AdminApiService } from '../server/AdminApiService';
import { BRICK_REPORTS_KEY, MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { REPORT_TOOL, failureOf, isReportTool, newReportTurn, noteWhatRan, reportSentText, reportToolDefinition, runReportTool, type ReportToolContext } from '../ai/ReportTools';
import type { BrickNote, ReportSentNote } from '../ai/BrickTools';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const request = axios.request as unknown as ReturnType<typeof vi.fn>;

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const BRICK_USER = `@bot_${BRICK}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';

afterEach(() => {
    vi.restoreAllMocks();
});

const kept = (over: Record<string, unknown> = {}) => ({
    sent: true as const,
    id: 'note-1',
    takeBackKey: 'key-1234567890abcdef',
    note: { kind: 'problem' as const, area: 'pages' as const, effect: 'stopped' as const, title: 'Failed: read_page', operation: 'read_page', failure: 'failed' as const, retried: false },
    ...over,
});

const CONNECTION = '5d1c2b3a-1111-4222-8333-944455556666';
/** A reply that read a page (it failed), then used an App that signed out, twice. */
function ranTurn(eventId = '$event-1') {
    const turn = newReportTurn(eventId);
    const sources = { apps: new Map([['Blue_Plover_binder_open', { connectionId: CONNECTION }]]), offered: new Set(['read_page', 'Blue_Plover_binder_open']) };
    noteWhatRan(turn, [{ name: 'read_page', result: { error: 'The page did not open' } }], sources);
    noteWhatRan(turn, [{ name: 'Blue_Plover_binder_open', result: { success: false, error: 'Unauthorized: sign in again' } }], sources);
    noteWhatRan(turn, [{ name: 'Blue_Plover_binder_open', result: { success: false, error: 'Unauthorized: sign in again' } }], sources);
    return turn;
}

const context = (over: Partial<ReportToolContext> = {}): ReportToolContext & { admin: { sendBrickReport: ReturnType<typeof vi.fn> } } =>
    ({
        admin: { sendBrickReport: vi.fn(async () => kept()) },
        botId: BRICK,
        personKey: 'person:uuid-alice',
        turn: ranTurn(),
        notes: [],
        context: { ownKey: false },
        ...over,
    }) as never;

const args = { kind: 'problem', area: 'pages', effect: 'stopped', step: 'read_page' };
const sentOf = (ctx: { admin: { sendBrickReport: ReturnType<typeof vi.fn> } }, call = 0) => ctx.admin.sendBrickReport.mock.calls[call][0] as Record<string, unknown>;

describe('The send_to_universe_team tool', () => {
    it('is one tool that says when to use it, that it replaces making a page as a report, and that it holds no words', () => {
        const tool = reportToolDefinition();
        expect(tool.function.name).toBe(REPORT_TOOL);
        expect(isReportTool('send_to_universe_team')).toBe(true);
        expect(isReportTool('offer_app')).toBe(false);
        expect(tool.function.description).toContain('Never make a page, document or file as a report instead.');
        expect(tool.function.description).toContain('The note holds no words');
        const parameters = tool.function.parameters as { required: string[]; properties: Record<string, unknown> };
        expect(parameters.required).toEqual(['kind', 'area', 'effect']);
        expect(Object.keys(parameters.properties).sort()).toEqual(['area', 'effect', 'kind', 'step', 'words']);
    });

    it('sends only fixed fields, filled from what the reply ran, and keeps the note for the line under the answer', async () => {
        const ctx = context();
        const result = await runReportTool({ ...args, title: 'Cannot open Blue Plover binder', tried: 'Alice asked about the Blue Plover binder' }, ctx);
        expect(result).toMatchObject({ sent: true, title: 'Failed: read_page' });
        const sent = sentOf(ctx);
        expect(sent).toEqual({
            botId: BRICK,
            personKey: 'person:uuid-alice',
            ref: expect.stringMatching(/^[0-9a-f]{64}$/),
            kind: 'problem',
            area: 'pages',
            operation: 'read_page',
            failure: 'failed',
            retried: false,
            effect: 'stopped',
            context: { ownKey: false },
        });
        // Nothing the model wrote and nothing a tool gave back goes
        expect(JSON.stringify(sent)).not.toMatch(/Blue Plover|asked about|did not open/i);
        expect(ctx.notes).toEqual([expect.objectContaining({ kind: 'report', id: 'note-1', key: 'key-1234567890abcdef', title: 'Failed: read_page', ref: sent.ref })]);
    });

    it('an App is only "app" with its connection, never its tool name; signed out and tried again come from what it answered', async () => {
        const ctx = context();
        await runReportTool({ kind: 'problem', area: 'apps', effect: 'stopped' }, ctx);
        const sent = sentOf(ctx);
        expect(sent).toMatchObject({ operation: 'app', appConnectionId: CONNECTION, failure: 'signed_out', retried: true });
        expect(JSON.stringify(sent)).not.toMatch(/Plover|binder|Unauthorized/i);
    });

    it('a step the reply was not offered (a name the model made up) is never what a note is about', async () => {
        const turn = newReportTurn('$e');
        noteWhatRan(turn, [{ name: 'cannot_open_blue_plover_binder', result: { error: 'x' } }], { apps: new Map(), offered: new Set(['read_page']) });
        expect(turn.steps).toEqual([]);
        const ctx = context({ turn });
        await runReportTool({ kind: 'problem', area: 'other', effect: 'slowed', step: 'cannot_open_blue_plover_binder' }, ctx);
        expect(sentOf(ctx)).toMatchObject({ operation: 'none', failure: 'failed' });
    });

    it('an Instant App is "app" too: its tool name (maker and id) never goes', async () => {
        const turn = newReportTurn('$e');
        noteWhatRan(turn, [{ name: 'instant_app_exa_search_1a2b3c4d', result: { error: 'Request timed out' } }], { apps: new Map(), offered: new Set(['instant_app_exa_search_1a2b3c4d']) });
        expect(turn.steps).toEqual([{ name: 'instant_app_exa_search_1a2b3c4d', operation: 'app', failure: 'timed_out' }]);
        const ctx = context({ turn });
        await runReportTool({ kind: 'problem', area: 'apps', effect: 'stopped' }, ctx);
        expect(sentOf(ctx)).toMatchObject({ operation: 'app', failure: 'timed_out' });
        expect(JSON.stringify(sentOf(ctx))).not.toMatch(/exa|1a2b/);
    });

    it('a short exact phrase from the chat never reaches Orbit, in any field the model fills (GPT G1)', async () => {
        const phrase = 'meet Sam at noon';
        const ctx = context();
        await runReportTool({ kind: 'problem', area: 'chat', effect: 'slowed', title: phrase, tried: phrase, stopped: phrase, idea: phrase, step: phrase }, ctx);
        expect(JSON.stringify(sentOf(ctx))).not.toContain('Sam');
    });

    it('with no step, how it failed comes from the kind', async () => {
        for (const [kind, failure] of [['cant_do', 'missing_ability'], ['friction', 'corrected'], ['idea', 'idea']] as const) {
            const ctx = context();
            await runReportTool({ kind, area: 'chat', effect: 'slowed' }, ctx);
            expect(sentOf(ctx)).toMatchObject({ operation: 'none', failure });
        }
    });

    it('reads how a step ended from its answer, never from its content', () => {
        expect(failureOf({ text: 'Your meeting with Dr. Smith was not allowed to move' })).toBeNull();
        expect(failureOf('All good')).toBeNull();
        expect(failureOf(undefined)).toBe('no_result');
        expect(failureOf([])).toBe('no_result');
        expect(failureOf({ error: 'Request timed out' })).toBe('timed_out');
        expect(failureOf({ success: false, error: 'Unauthorized' })).toBe('signed_out');
        expect(failureOf({ success: false, error: 'Forbidden' })).toBe('not_allowed');
        expect(failureOf({ success: false, error: 'Something broke' })).toBe('failed');
        expect(failureOf('Error: boom')).toBe('failed');
    });

    it('two Apps that failed the same way in one reply are two notes, and the same App again is one', async () => {
        const turn = newReportTurn('$event-1');
        const other = '6e2d3c4b-2222-4333-8444-a55566667777';
        const sources = {
            apps: new Map([
                ['Blue_Plover_binder_open', { connectionId: CONNECTION }],
                ['Red_Kite_sheet_read', { connectionId: other }],
            ]),
            offered: new Set(['Blue_Plover_binder_open', 'Red_Kite_sheet_read']),
        };
        noteWhatRan(turn, [{ name: 'Blue_Plover_binder_open', result: { success: false, error: 'Something broke' } }], sources);
        noteWhatRan(turn, [{ name: 'Red_Kite_sheet_read', result: { success: false, error: 'Something broke' } }], sources);
        const ctx = context({ turn });
        ctx.admin.sendBrickReport.mockResolvedValueOnce(kept({ id: 'note-a' })).mockResolvedValueOnce(kept({ id: 'note-b' }));
        await runReportTool({ ...args, area: 'apps', step: 'Blue_Plover_binder_open' }, ctx);
        expect(await runReportTool({ ...args, area: 'apps', step: 'Red_Kite_sheet_read' }, ctx)).toMatchObject({ sent: true, title: expect.any(String) });
        expect(sentOf(ctx, 1).ref).not.toBe(sentOf(ctx, 0).ref);
        expect(sentOf(ctx, 1)).toMatchObject({ operation: 'app', appConnectionId: other });
        expect(await runReportTool({ ...args, area: 'apps', step: 'Blue_Plover_binder_open' }, ctx)).toMatchObject({ note: expect.stringContaining('Already sent') });
        expect(ctx.admin.sendBrickReport).toHaveBeenCalledTimes(2);
    });

    it('a problem with no step named is about the last step that failed, not a later one that only came back empty', async () => {
        const turn = newReportTurn('$event-1');
        const sources = { apps: new Map(), offered: new Set(['read_page', 'list_files']) };
        noteWhatRan(turn, [{ name: 'read_page', result: { error: 'Request timed out' } }], sources);
        noteWhatRan(turn, [{ name: 'list_files', result: [] }], sources);
        const ctx = context({ turn });
        await runReportTool({ kind: 'problem', area: 'pages', effect: 'stopped' }, ctx);
        expect(sentOf(ctx)).toMatchObject({ operation: 'read_page', failure: 'timed_out' });
        // With nothing that failed, an empty answer is still what it is about
        const emptyOnly = newReportTurn('$event-1');
        noteWhatRan(emptyOnly, [{ name: 'list_files', result: [] }], sources);
        const quiet = context({ turn: emptyOnly });
        await runReportTool({ kind: 'problem', area: 'pages', effect: 'stopped' }, quiet);
        expect(sentOf(quiet)).toMatchObject({ operation: 'list_files', failure: 'no_result' });
    });

    it('the same note again in this reply with words gets the words: the same receipt, nothing new kept, words shown with Send', async () => {
        const ctx = context();
        await runReportTool(args, ctx);
        ctx.admin.sendBrickReport.mockResolvedValueOnce(kept({ again: true, wordsPreview: 'The page stays blank' }));
        const result = await runReportTool({ ...args, words: 'The page stays blank' }, ctx);
        expect(result).toMatchObject({ sent: true, note: expect.stringContaining('press Send') });
        expect(sentOf(ctx, 1)).toMatchObject({ ref: sentOf(ctx, 0).ref, draftWords: 'The page stays blank' });
        expect(ctx.notes).toEqual([expect.objectContaining({ id: 'note-1', wordsDraft: 'The page stays blank' })]);
        // Once it has words, the same note again is only "already sent"
        expect(await runReportTool({ ...args, words: 'Something else' }, ctx)).toMatchObject({ note: expect.stringContaining('Already sent') });
        expect(ctx.admin.sendBrickReport).toHaveBeenCalledTimes(2);
    });

    it('words for a note sent beside them wait for it, then go with the same reference', async () => {
        const ctx = context();
        let release: () => void = () => undefined;
        ctx.admin.sendBrickReport.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(kept()))));
        ctx.admin.sendBrickReport.mockResolvedValueOnce(kept({ again: true, wordsPreview: 'It never loads' }));
        const first = runReportTool(args, ctx);
        const withWords = runReportTool({ ...args, words: 'It never loads' }, ctx);
        release();
        expect(await first).toMatchObject({ sent: true });
        expect(await withWords).toMatchObject({ sent: true, note: expect.stringContaining('press Send') });
        expect(ctx.notes).toEqual([expect.objectContaining({ wordsDraft: 'It never loads' })]);
    });

    it('words that could not be added never make a second note, and the Brick is told', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const ctx = context();
        await runReportTool(args, ctx);
        ctx.admin.sendBrickReport.mockRejectedValue(new Error('down'));
        expect(await runReportTool({ ...args, words: 'The page stays blank' }, ctx)).toMatchObject({ sent: true, note: expect.stringContaining('could not be added') });
        expect(ctx.notes).toHaveLength(1);
        expect(ctx.notes?.[0]).not.toHaveProperty('wordsDraft');
    });

    it('the person\'s words go only as a draft: Orbit answers them cleaned, and the chat shows them with Send', async () => {
        const ctx = context({ admin: { sendBrickReport: vi.fn(async () => kept({ wordsPreview: 'The share button does nothing' })) } as never });
        const result = await runReportTool({ ...args, words: 'The share button does nothing, call me on +965 5555 1234' }, ctx);
        expect(sentOf(ctx).draftWords).toBe('The share button does nothing, call me on +965 5555 1234');
        expect(result).toMatchObject({ sent: true, note: expect.stringContaining('press Send') });
        expect(ctx.notes).toEqual([expect.objectContaining({ wordsDraft: 'The share button does nothing' })]);
        // Without words asked for, none go
        const plain = context();
        await runReportTool(args, plain);
        expect(sentOf(plain)).not.toHaveProperty('draftWords');
    });

    it('the same note carries the same reference: from the chat\'s message and what it is about, not when it is sent', async () => {
        const first = context();
        const again = context();
        await runReportTool(args, first);
        await runReportTool(args, again);
        expect(sentOf(again).ref).toBe(sentOf(first).ref);
        const otherMessage = context({ turn: ranTurn('$event-2') });
        await runReportTool(args, otherMessage);
        expect(sentOf(otherMessage).ref).not.toBe(sentOf(first).ref);
        const otherKind = context();
        await runReportTool({ ...args, kind: 'friction', step: undefined }, otherKind);
        expect(sentOf(otherKind).ref).not.toBe(sentOf(first).ref);
    });

    it('asks Orbit once more with the same reference when the answer is lost, and says "could not confirm" if it never comes', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const lostOnce = context();
        lostOnce.admin.sendBrickReport.mockRejectedValueOnce(new Error('socket hang up'));
        expect(await runReportTool(args, lostOnce)).toMatchObject({ sent: true });
        expect(lostOnce.admin.sendBrickReport).toHaveBeenCalledTimes(2);
        expect(sentOf(lostOnce, 1).ref).toBe(sentOf(lostOnce, 0).ref);

        const lost = context();
        lost.admin.sendBrickReport.mockRejectedValue(new Error('socket hang up'));
        const result = await runReportTool(args, lost);
        expect(result).toMatchObject({ sent: false, uncertain: true });
        expect(String(result.note)).toContain('never say it was sent');
        expect(lost.notes).toEqual([]);
    });

    it('sends one note per problem and at most two in a reply', async () => {
        const ctx = context();
        await runReportTool(args, ctx);
        expect(await runReportTool(args, ctx)).toMatchObject({ sent: true, note: expect.stringContaining('Already sent') });
        ctx.admin.sendBrickReport.mockResolvedValueOnce(kept({ id: 'note-2' }));
        await runReportTool({ kind: 'idea', area: 'chat', effect: 'idea' }, ctx);
        expect(await runReportTool({ kind: 'cant_do', area: 'voice', effect: 'stopped' }, ctx)).toMatchObject({ sent: false, note: expect.stringContaining('Enough notes') });
        expect(ctx.admin.sendBrickReport).toHaveBeenCalledTimes(2);
    });

    it('counts a note being sent beside it: calls of one round never pass the limit or send one note twice', async () => {
        const ctx = context();
        let release: () => void = () => undefined;
        ctx.admin.sendBrickReport.mockImplementation(() => new Promise((resolve) => (release = () => resolve(kept()))));
        const first = runReportTool(args, ctx);
        const twin = runReportTool(args, ctx);
        release();
        expect(await first).toMatchObject({ sent: true });
        expect(await twin).toMatchObject({ sent: true, note: expect.stringContaining('Already sent') });
        expect(ctx.admin.sendBrickReport).toHaveBeenCalledTimes(1);
    });

    it('a call beside one whose answer never came says "could not confirm" too, never sent', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const ctx = context();
        let fail: () => void = () => undefined;
        ctx.admin.sendBrickReport.mockImplementation(() => new Promise((_, reject) => (fail = () => reject(new Error('down')))));
        const first = runReportTool(args, ctx);
        const twin = runReportTool(args, ctx);
        fail();
        await new Promise((resolve) => setTimeout(resolve, 0));
        fail();
        expect(await first).toMatchObject({ sent: false, uncertain: true });
        expect(await twin).toMatchObject({ sent: false, uncertain: true });
    });

    it('never says it was sent when Orbit said no, or the note was taken back', async () => {
        const limit = context({ admin: { sendBrickReport: vi.fn(async () => ({ sent: false, reason: 'limit' })) } as never });
        expect(await runReportTool(args, limit)).toMatchObject({ sent: false, note: expect.stringContaining('Do not say it was sent') });
        const brick = context({ admin: { sendBrickReport: vi.fn(async () => ({ sent: false, reason: 'unknown_brick' })) } as never });
        expect(await runReportTool(args, brick)).toMatchObject({ sent: false });
        const taken = context({ admin: { sendBrickReport: vi.fn(async () => kept({ again: true, takenBack: true })) } as never });
        expect(await runReportTool(args, taken)).toMatchObject({ sent: false, note: expect.stringContaining('took this note back') });
        expect(taken.notes).toEqual([]);
        expect(await runReportTool({ area: 'pages' }, context())).toMatchObject({ sent: false, error: expect.any(String) });
    });

    it('a reply with no words of its own says what it sent', () => {
        const one = { kind: 'report', title: 'Failed: read_page' } as ReportSentNote;
        expect(reportSentText([one])).toBe('Sent to the Universe team: Failed: read_page.');
    });
});

describe('What the bot server asks Orbit', () => {
    const tokenBefore = process.env.BOT_SERVICE_TOKEN;
    beforeEach(() => {
        request.mockReset();
        process.env.BOT_SERVICE_TOKEN = 'service-token';
    });
    afterAll(() => {
        if (tokenBefore === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = tokenBefore;
    });

    it('sends the note with its own token and reads the note as Orbit kept it, with its draft words cleaned', async () => {
        request.mockResolvedValue({
            status: 200,
            data: { sent: true, id: 'n1', takeBackKey: 'k1', again: true, wordsPreview: 'Links fail', note: { title: 'Failed: read_page', operation: 'read_page', retried: true } },
        });
        const service = new AdminApiService('http://orbit.test', 'admin-token');
        const send = { botId: BRICK, ref: 'a'.repeat(64), kind: 'problem' as const, area: 'pages' as const, operation: 'read_page', failure: 'failed' as const, retried: true, effect: 'stopped' as const, draftWords: 'Links fail for x@y.com' };
        expect(await service.sendBrickReport(send)).toEqual({
            sent: true,
            id: 'n1',
            takeBackKey: 'k1',
            again: true,
            wordsPreview: 'Links fail',
            note: { kind: 'problem', area: 'pages', effect: 'stopped', title: 'Failed: read_page', operation: 'read_page', failure: 'failed', retried: true },
        });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'post', url: expect.stringContaining('api/bricks/reports'), data: send, headers: expect.objectContaining({ Authorization: 'Bearer service-token' }) })
        );
        request.mockResolvedValue({ status: 200, data: { sent: false, reason: 'limit' } });
        expect(await service.sendBrickReport(send)).toEqual({ sent: false, reason: 'limit' });
        // An answer it does not know may be a note Orbit kept: it throws, and asked again with the same reference Orbit answers its receipt
        request.mockResolvedValue({ status: 200, data: { ok: true } });
        await expect(service.sendBrickReport(send)).rejects.toThrow();
    });

    it('tells Orbit the receipts went out, with its own token', async () => {
        request.mockResolvedValue({ status: 200, data: { confirmed: 2 } });
        const service = new AdminApiService('http://orbit.test', 'admin-token');
        expect(await service.confirmBrickReports(BRICK, ['n1', 'n2'])).toBe(2);
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'post', url: expect.stringContaining('api/bricks/reports/delivered'), data: { botId: BRICK, ids: ['n1', 'n2'] }, headers: expect.objectContaining({ Authorization: 'Bearer service-token' }) })
        );
    });
});

function makeClient(): any {
    return {
        ensureRegistered: vi.fn(async () => undefined),
        setDisplayName: vi.fn(async () => undefined),
        getDisplayName: vi.fn(async (): Promise<string | null> => 'Brick'),
        joinRoom: vi.fn(async () => undefined),
        leaveRoom: vi.fn(async () => undefined),
        sendText: vi.fn(async () => '$evt'),
        sendMessage: vi.fn(async () => '$evt'),
        setTyping: vi.fn(async () => undefined),
        getJoinedMembers: vi.fn(async () => [ALICE, BRICK_USER]),
        getRecentMessages: vi.fn(async (): Promise<MatrixEvent[]> => []),
    };
}

function makeBridge() {
    const rooms = new Map<string, string>();
    const roomsOf = new Map<string, string>();
    const client = makeClient();
    const deps: any = {
        getBotConfig: vi.fn(async () => ({ botId: BRICK, name: 'Brick', enabled: true, aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } })),
        checkAccess: vi.fn(async (): Promise<any> => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
        reply: vi.fn(async (): Promise<any> => ({ text: 'Hello Alice!', media: [] })),
        rooms: {
            rememberDmRoom: vi.fn(async (r: string, b: string) => void rooms.set(r, b)),
            getDmRoomBot: vi.fn(async (r: string) => rooms.get(r) ?? null),
            forgetDmRoom: vi.fn(async (r: string) => void rooms.delete(r)),
            rememberDmRoomOf: vi.fn(async (b: string, u: string, r: string) => void roomsOf.set(`${b}|${u}`, r)),
            getDmRoomOf: vi.fn(async (b: string, u: string) => roomsOf.get(`${b}|${u}`) ?? null),
            forgetDmRoomOf: vi.fn(async (b: string, u: string) => void roomsOf.delete(`${b}|${u}`)),
        },
    };
    return { client, deps, bridge: new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps) };
}

const invite = (): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BRICK_USER, content: { membership: 'invite', is_direct: true },
});
const message = (body: string): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body },
});

describe('A note in a Brick\'s direct message', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });
    const note: BrickNote = { kind: 'report', id: 'note-1', key: 'key-1', ref: 'r'.repeat(64), noteKind: 'problem', area: 'pages', title: 'Failed: read_page', failure: 'failed', retried: false, wordsDraft: 'Links inside pages do not open', sentAt: 1764150000000 };
    // The reference stays on the bot server; the chat gets the note as kept and the draft words to send
    const field = [{ id: 'note-1', key: 'key-1', kind: 'problem', area: 'pages', title: 'Failed: read_page', failure: 'failed', retried: false, wordsDraft: 'Links inside pages do not open', sentAt: 1764150000000 }];

    it('rides on the words of the answer, in the same event', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: 'Sent to the Universe team: Failed: read_page.', media: [], bricks: [note] });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Draft an issue about what is blocking you'));
        expect(client.sendText).not.toHaveBeenCalled();
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        expect(client.sendMessage.mock.calls[0].slice(0, 3)).toEqual([BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Sent to the Universe team: Failed: read_page.', [BRICK_REPORTS_KEY]: field }]);
    });

    it('rides along with Bricks the answer made, on the same event', async () => {
        const { bridge, client, deps } = makeBridge();
        const made: BrickNote = { kind: 'made', id: 'b2', name: 'Recipes', line: null, look: null, made: true };
        deps.reply.mockResolvedValue({ text: 'Done, and I told the team.', media: [], bricks: [made, note] });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Make a recipe Brick'));
        expect(client.sendMessage.mock.calls[0][2]).toMatchObject({ body: 'Done, and I told the team.', [BRICK_REPORTS_KEY]: field });
    });

    it('tells Orbit once that the receipt got out, only after Matrix took the event', async () => {
        const { bridge, client, deps } = makeBridge();
        const reportsDelivered = vi.fn(async () => undefined);
        deps.reply.mockResolvedValue({ text: 'Sent to the Universe team: Failed: read_page.', media: [], bricks: [note], reportsDelivered });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Draft an issue about what is blocking you'));
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        expect(reportsDelivered).toHaveBeenCalledTimes(1);
    });

    it('a receipt that did not get out is never confirmed, so Orbit withdraws the note', async () => {
        const { bridge, client, deps } = makeBridge();
        const reportsDelivered = vi.fn(async () => undefined);
        // Matrix gave no event id: the person was told nothing
        client.sendMessage.mockResolvedValue(undefined);
        deps.reply.mockResolvedValue({ text: 'Sent to the Universe team: Failed: read_page.', media: [], bricks: [note], reportsDelivered });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Draft an issue'));
        expect(reportsDelivered).not.toHaveBeenCalled();
        // A failed reply never carries it either
        const failed = makeBridge();
        const notTold = vi.fn(async () => undefined);
        failed.deps.reply.mockResolvedValue({ text: '', media: [], failed: true, bricks: [note], reportsDelivered: notTold });
        await failed.bridge.onEvent(invite());
        await failed.bridge.onEvent(message('Draft an issue'));
        expect(notTold).not.toHaveBeenCalled();
    });

    it('an answer with no note sends plain words, as before', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: 'Hello!', media: [] });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Hi'));
        expect(client.sendText).toHaveBeenCalledWith(BRICK_USER, ROOM, 'Hello!');
        expect(client.sendMessage).not.toHaveBeenCalled();
    });
});
