/**
 * "Send to the Universe team" (mock "Brick reports inbox"): every Brick has the tool, it refuses a note that repeats the person, Orbit is
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
import { REPORT_TOOL, isReportTool, repeatsThePerson, reportSentText, reportToolDefinition, runReportTool, type ReportToolContext } from '../ai/ReportTools';
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
    note: { kind: 'problem' as const, area: 'pages' as const, effect: 'stopped' as const, title: "Links inside pages don't open", tried: 'A link on each listing.', stopped: 'Tapping does nothing.', idea: '' },
    ...over,
});

const context = (over: Partial<ReportToolContext> = {}): ReportToolContext & { admin: { sendBrickReport: ReturnType<typeof vi.fn> } } =>
    ({
        admin: { sendBrickReport: vi.fn(async () => kept()) },
        botId: BRICK,
        personKey: 'person:uuid-alice',
        said: ['Draft an issue about what is blocking you, explaining why you cannot add links to the listings'],
        name: 'Alice Brown',
        notes: [],
        context: { ownKey: false },
        ...over,
    }) as never;

const args = { kind: 'problem', area: 'pages', title: "Links inside pages don't open", tried: 'A link on each listing in a shortlist page.', stopped: 'Tapping does nothing in the chat preview.', effect: 'stopped' };

describe('The send_to_universe_team tool', () => {
    it('is one tool that says when to use it, that it replaces making a page as a report, and that it never carries the person', () => {
        const tool = reportToolDefinition();
        expect(tool.function.name).toBe(REPORT_TOOL);
        expect(isReportTool('send_to_universe_team')).toBe(true);
        expect(isReportTool('offer_app')).toBe(false);
        expect(tool.function.description).toContain('Never make a page, document or file as a report instead.');
        expect(tool.function.description).toContain('no names, no quotes of what anyone wrote, no links');
        expect((tool.function.parameters as { required: string[] }).required).toEqual(['kind', 'area', 'title', 'effect']);
    });

    it('sends the note to Orbit and keeps it for the line under the answer', async () => {
        const where = context();
        const result = await runReportTool(args, where);
        expect(result).toMatchObject({ sent: true, title: "Links inside pages don't open" });
        expect(where.admin.sendBrickReport).toHaveBeenCalledWith({ botId: BRICK, personKey: 'person:uuid-alice', kind: 'problem', area: 'pages', title: args.title, tried: args.tried, stopped: args.stopped, idea: '', effect: 'stopped', context: { ownKey: false } });
        expect(where.notes).toEqual([
            { kind: 'report', id: 'note-1', key: 'key-1234567890abcdef', noteKind: 'problem', area: 'pages', title: "Links inside pages don't open", tried: 'A link on each listing.', stopped: 'Tapping does nothing.', idea: '', sentAt: expect.any(Number) },
        ]);
    });

    it('refuses a note that repeats six words of the person, or their name, so the Brick writes it again', async () => {
        const quoting = context();
        const quoted = await runReportTool({ ...args, tried: 'They asked: explaining why you cannot add links to the listings.' }, quoting);
        expect(quoted).toMatchObject({ sent: false, error: expect.stringContaining('repeats the person') });
        expect(quoting.admin.sendBrickReport).not.toHaveBeenCalled();
        const naming = context();
        expect(await runReportTool({ ...args, stopped: 'Alice could not open it.' }, naming)).toMatchObject({ sent: false });
        expect(naming.admin.sendBrickReport).not.toHaveBeenCalled();
    });

    it('reads a quote the same whatever its case and punctuation, and five words in a row are not a quote', () => {
        expect(repeatsThePerson(['WHY, you cannot add LINKS to the listings!'], ['why you cannot add links to the listings'])).toBe(true);
        expect(repeatsThePerson(['you cannot add links to'], ['why you cannot add links to the listings'])).toBe(false);
        // A short name part is not a name ("Al", "Bo")
        expect(repeatsThePerson(['A link on a page'], [], 'Al B')).toBe(false);
    });

    it('sends one note per problem and at most two in a reply', async () => {
        const where = context();
        await runReportTool(args, where);
        expect(await runReportTool(args, where)).toMatchObject({ sent: true, note: expect.stringContaining('Already sent') });
        where.admin.sendBrickReport.mockResolvedValueOnce(kept({ id: 'note-2', note: { ...kept().note, title: 'Voice cuts out' } }));
        await runReportTool({ ...args, title: 'Voice cuts out', area: 'voice' }, where);
        expect(await runReportTool({ ...args, title: 'Something else' }, where)).toMatchObject({ sent: false });
        expect(where.admin.sendBrickReport).toHaveBeenCalledTimes(2);
    });

    it('on the map the Brick says it in words: nothing waits for a direct reply', async () => {
        const where = context({ notes: null });
        expect(await runReportTool(args, where)).toMatchObject({ sent: true });
    });

    it('never says it was sent when Orbit could not take it or said no', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const down = context();
        down.admin.sendBrickReport.mockRejectedValueOnce(new Error('down'));
        expect(await runReportTool(args, down)).toMatchObject({ sent: false, note: expect.stringContaining('Do not say it was sent') });
        expect(down.notes).toEqual([]);
        const full = context();
        full.admin.sendBrickReport.mockResolvedValueOnce({ sent: false, reason: 'limit' });
        expect(await runReportTool(args, full)).toMatchObject({ sent: false, note: expect.stringContaining('enough notes today') });
        expect(await runReportTool({ ...args, title: '' }, context())).toMatchObject({ sent: false, error: expect.any(String) });
        expect(await runReportTool({ ...args, kind: 'rant' }, context())).toMatchObject({ sent: false });
    });

    it('a reply with no words of its own says what it sent', () => {
        const one = { kind: 'report', title: "Links inside pages don't open" } as ReportSentNote;
        expect(reportSentText([one])).toBe("Sent to the Universe team: Links inside pages don't open.");
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

    it('sends the note with its own token and reads the note as Orbit kept it', async () => {
        request.mockResolvedValue({ status: 200, data: { sent: true, id: 'n1', takeBackKey: 'k1', note: { title: 'Links fail', tried: 'Tried', stopped: '', idea: '' } } });
        const service = new AdminApiService('http://orbit.test', 'admin-token');
        const send = { botId: BRICK, kind: 'problem' as const, area: 'pages' as const, title: 'Links fail for x@y.com', tried: 'Tried', stopped: '', idea: '', effect: 'stopped' as const };
        expect(await service.sendBrickReport(send)).toEqual({ sent: true, id: 'n1', takeBackKey: 'k1', note: { kind: 'problem', area: 'pages', effect: 'stopped', title: 'Links fail', tried: 'Tried', stopped: '', idea: '' } });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'post', url: expect.stringContaining('api/bricks/reports'), data: send, headers: expect.objectContaining({ Authorization: 'Bearer service-token' }) })
        );
        request.mockResolvedValue({ status: 200, data: { sent: false, reason: 'limit' } });
        expect(await service.sendBrickReport(send)).toEqual({ sent: false, reason: 'limit' });
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
    const note: BrickNote = { kind: 'report', id: 'note-1', key: 'key-1', noteKind: 'problem', area: 'pages', title: "Links inside pages don't open", tried: 'A link on each listing.', stopped: 'Tapping does nothing.', idea: 'Open links in a new tab.', sentAt: 1764150000000 };
    const field = [{ id: 'note-1', key: 'key-1', kind: 'problem', area: 'pages', title: "Links inside pages don't open", tried: 'A link on each listing.', stopped: 'Tapping does nothing.', idea: 'Open links in a new tab.', sentAt: 1764150000000 }];

    it('rides on the words of the answer, in the same event', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: "Sent to the Universe team: links inside pages don't open.", media: [], bricks: [note] });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Draft an issue about what is blocking you'));
        expect(client.sendText).not.toHaveBeenCalled();
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        expect(client.sendMessage.mock.calls[0].slice(0, 3)).toEqual([BRICK_USER, ROOM, { msgtype: 'm.text', body: "Sent to the Universe team: links inside pages don't open.", [BRICK_REPORTS_KEY]: field }]);
    });

    it('rides along with Bricks the answer made, on the same event', async () => {
        const { bridge, client, deps } = makeBridge();
        const made: BrickNote = { kind: 'made', id: 'b2', name: 'Recipes', line: null, look: null, made: true };
        deps.reply.mockResolvedValue({ text: 'Done, and I told the team.', media: [], bricks: [made, note] });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('Make a recipe Brick'));
        expect(client.sendMessage.mock.calls[0][2]).toMatchObject({ body: 'Done, and I told the team.', [BRICK_REPORTS_KEY]: field });
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
