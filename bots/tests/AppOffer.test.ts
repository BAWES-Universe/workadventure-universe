/**
 * Apps from a chat (game #2001): a person's own Brick offers to connect an App ("Connect your calendar?"), the card goes out
 * after the answer, "Not now" is Orbit's, and once the person connected the App from the card the Brick carries on with what
 * they asked and says what it may do with it.
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
import { APP_CONNECTED_EVENT, APP_CONNECTED_KEY, APP_OFFER_KEY, MatrixDmBridge, appConnectedLine, connectedAppOf } from '../matrix/MatrixDmBridge';
import { OFFER_APP_TOOL, appToolDefinitions, appsNote, isAppTool, runAppTool, topicOf } from '../ai/AppTools';
import type { BrickNote } from '../ai/BrickTools';
import type { MatrixEvent } from '../matrix/MatrixAppServiceRouter';

const request = axios.request as unknown as ReturnType<typeof vi.fn>;

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const BRICK_USER = `@bot_${BRICK}:matrix.test`;
const ALICE = '@alice:matrix.test';
const ROOM = '!dm:matrix.test';

const CALENDAR = { key: 'google-calendar', name: 'Google Calendar', blurb: 'See and plan your day', connectionId: null, connected: false, usable: false };
const NOTION = { key: 'notion', name: 'Notion', blurb: 'Notes and docs', connectionId: null, connected: false, usable: false };
const GMAIL = { key: 'gmail', name: 'Gmail', blurb: 'Read, draft and send email', connectionId: 'conn-gmail', connected: true, usable: false };
const GITHUB = { key: 'github', name: 'GitHub', blurb: 'Issues and code', connectionId: 'conn-gh', connected: true, usable: true };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('What the bot server asks Orbit about Apps', () => {
    const tokenBefore = process.env.BOT_SERVICE_TOKEN;
    beforeEach(() => {
        request.mockReset();
        process.env.BOT_SERVICE_TOKEN = 'service-token';
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterAll(() => {
        if (tokenBefore === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = tokenBefore;
    });

    it('reads the Apps a Brick may offer for its owner, with the bot server\'s own token, and keeps only whole rows', async () => {
        request.mockResolvedValue({ status: 200, data: { apps: [CALENDAR, { key: '', name: 'x' }, { name: 'no key' }, GMAIL] } });
        const service = new AdminApiService('http://orbit.test', 'admin-token');

        const apps = await service.appsOfferableFor(BRICK, 'uuid-alice');

        expect(apps).toEqual([CALENDAR, GMAIL]);
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'get', url: expect.stringContaining(`api/bots/${BRICK}/apps/offerable`), params: { userId: 'uuid-alice' }, headers: expect.objectContaining({ Authorization: 'Bearer service-token' }) })
        );
    });
});

describe('The offer_app tool', () => {
    const admin = (apps = [CALENDAR, NOTION, GMAIL, GITHUB], topics: string[] = []) => ({
        appsOfferableFor: vi.fn(async () => apps),
        brickOffersFor: vi.fn(async () => ({ after: 3, topics })),
    });
    const run = (args: Record<string, unknown>, a = admin(), notes: BrickNote[] = []) => runAppTool(args, { admin: a, botId: BRICK, userId: 'uuid-alice', notes }).then((result) => ({ result, notes }));

    it('is one tool, named offer_app', () => {
        expect(appToolDefinitions().map((tool) => tool.function.name)).toEqual([OFFER_APP_TOOL]);
        expect(isAppTool(OFFER_APP_TOOL)).toBe(true);
        expect(isAppTool('make_brick')).toBe(false);
    });

    it('offers an App a job needs, under the card\'s own question and a second choice', async () => {
        const { result, notes } = await run({ app: 'google-calendar', asked: false, ask: 'Connect your calendar?', other_label: 'Another calendar', other_line: 'Outlook, iCloud and more', other_search: 'calendar' });

        expect(result).toMatchObject({ shown: true });
        expect(notes).toEqual([
            {
                kind: 'app', topic: 'app google calendar', app: 'google-calendar', name: 'Google Calendar', state: 'new', connectionId: null,
                ask: 'Connect your calendar?', asked: false, other: { label: 'Another calendar', line: 'Outlook, iCloud and more', search: 'calendar' },
            },
        ]);
    });

    it('offers one asked for by name without a question or a second choice, and even after a "not now"', async () => {
        const a = admin(undefined, ['app notion']);
        const { result, notes } = await run({ app: 'notion', asked: true, ask: 'ignored', other_label: 'Other', other_search: 'notes' }, a);

        expect(result).toMatchObject({ shown: true });
        expect(notes[0]).toMatchObject({ kind: 'app', app: 'notion', asked: true, ask: '', other: null });
        // The topics are not even read: nothing the person said before counts against an ask by name
        expect(a.brickOffersFor).not.toHaveBeenCalled();
    });

    it('says "let it use" for an App they connected that this Brick does not use yet, and never signs in twice', async () => {
        const { notes } = await run({ app: 'gmail', asked: false, ask: 'Use your email?' });
        expect(notes[0]).toMatchObject({ kind: 'app', state: 'connected', connectionId: 'conn-gmail' });
    });

    it('never offers an App the Brick already uses, one that is not on the list, or one the person turned down', async () => {
        expect((await run({ app: 'github', asked: false })).notes).toEqual([]);
        const unknown = await run({ app: 'made-up', asked: false });
        expect(unknown.result).toHaveProperty('error');
        expect(unknown.notes).toEqual([]);
        const turnedDown = await run({ app: 'google-calendar', asked: false, ask: 'Connect your calendar?' }, admin(undefined, ['App Google-Calendar!']));
        expect(turnedDown.notes).toEqual([]);
        expect(JSON.stringify(turnedDown.result)).toContain('not now');
    });

    it('offers at most one App in a reply', async () => {
        const notes: BrickNote[] = [];
        await run({ app: 'google-calendar', asked: false, ask: 'Connect your calendar?' }, admin(), notes);
        const second = await run({ app: 'notion', asked: true }, admin(), notes);
        expect(second.result).toMatchObject({ shown: false });
        expect(notes).toHaveLength(1);
    });

    it('offers one App only when two offers of a reply run at the same time', async () => {
        const notes: BrickNote[] = [];
        const both = await Promise.all([
            run({ app: 'google-calendar', asked: false, ask: 'Connect your calendar?' }, admin(), notes),
            run({ app: 'notion', asked: true }, admin(), notes),
        ]);
        expect(notes).toHaveLength(1);
        expect(both.filter((one) => (one.result as { shown: boolean }).shown)).toHaveLength(1);
    });

    it('still lets them ask for an App by name after the Brick was told not to offer it on its own', () => {
        expect(JSON.stringify(appToolDefinitions())).toContain('ask for it by name');
        expect(appsNote([CALENDAR], [topicOf('google-calendar')])).toContain('if they ask for it by name');
    });

    it('offers nothing, and says nothing about it, when Orbit cannot say what is on the list', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const down = { appsOfferableFor: vi.fn(async () => Promise.reject(new Error('down'))), brickOffersFor: vi.fn(async () => ({ after: 3, topics: [] })) };
        const { result, notes } = await run({ app: 'notion', asked: true }, down as never);
        expect(result).toMatchObject({ shown: false });
        expect(notes).toEqual([]);
    });

    it('lists the Apps it may offer, by key, never the ones it uses, and marks the ones turned down', () => {
        const note = appsNote([CALENDAR, GMAIL, GITHUB], [topicOf('google-calendar')]);
        expect(note).toContain('- google-calendar: Google Calendar, See and plan your day (already offered');
        expect(note).toContain('- gmail: Gmail');
        expect(note).not.toContain('github');
        expect(note).not.toMatch(/MCP|server/i);
        expect(appsNote([GITHUB], [])).toBe('');
        expect(appsNote(null, [])).toBe('');
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

function makeBridge(config: Record<string, unknown> = { botId: BRICK, name: 'Brick', enabled: true, aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } }) {
    const rooms = new Map<string, string>();
    const roomsOf = new Map<string, string>();
    const client = makeClient();
    const deps: any = {
        getBotConfig: vi.fn(async () => config),
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
    return { client, deps, config, bridge: new MatrixDmBridge({ homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as', hsToken: 'hs' }, client as never, deps) };
}

const invite = (): MatrixEvent => ({
    type: 'm.room.member', room_id: ROOM, sender: ALICE, event_id: `$i${Math.random()}`, state_key: BRICK_USER, content: { membership: 'invite', is_direct: true },
});
const message = (body: string, extra: Record<string, unknown> = {}): MatrixEvent => ({
    type: 'm.room.message', room_id: ROOM, sender: ALICE, event_id: `$m${Math.random()}`, content: { msgtype: 'm.text', body, ...extra },
});


const connected = (extra: Record<string, unknown> = {}): MatrixEvent => ({
    type: APP_CONNECTED_EVENT, room_id: ROOM, sender: ALICE, event_id: `$c${Math.random()}`, content: { app: 'google-calendar', name: 'Google Calendar', ...extra },
});

describe('An App offer in a Brick\'s chat', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });
    const offer = { kind: 'app', topic: 'app google calendar', app: 'google-calendar', name: 'Google Calendar', state: 'new', connectionId: null, ask: 'Connect your calendar?', asked: false, other: { label: 'Another calendar', line: 'Outlook, iCloud and more', search: 'calendar' } };

    it('sends the card after the answer, never before it, once Orbit allowed it', async () => {
        const { bridge, client, deps } = makeBridge();
        const order: string[] = [];
        client.sendText.mockImplementation(async () => void order.push('answer'));
        client.sendMessage.mockImplementation(async () => void order.push('card'));
        const claimApp = vi.fn(async () => 'app google calendar');
        deps.reply.mockResolvedValue({ text: "I can't see your calendar yet. Connect it once and I can check it whenever you ask.", media: [], bricks: [offer], claimApp });
        await bridge.onEvent(invite());

        await bridge.onEvent(message("What's on my calendar tomorrow?"));

        expect(order).toEqual(['answer', 'card']);
        const { kind: _kind, ...card } = offer;
        expect(client.sendMessage.mock.calls[0]).toEqual([BRICK_USER, ROOM, { msgtype: 'm.text', body: 'Connect your calendar?', [APP_OFFER_KEY]: card }, expect.any(String)]);
    });

    it('sends no card when Orbit says it was shown before, or when the answer has no words', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: 'Sorry, no.', media: [], bricks: [offer], claimApp: vi.fn(async () => null) });
        await bridge.onEvent(invite());
        await bridge.onEvent(message('calendar?'));
        expect(client.sendMessage.mock.calls.some(([, , content]) => APP_OFFER_KEY in content)).toBe(false);
    });

    it('carries on with what the person asked once the App is connected, from a line of the system, then says what it may do', async () => {
        const { bridge, client, deps } = makeBridge();
        deps.reply.mockResolvedValue({ text: 'Tomorrow: 10:00 standup, 1:30 lunch with Fahad.', media: [] });
        await bridge.onEvent(invite());

        await bridge.onEvent(connected());

        expect(deps.reply).toHaveBeenCalledTimes(1);
        const [botId, person, text, attachments, hooks] = deps.reply.mock.calls[0];
        expect([botId, person.uuid, attachments]).toEqual([BRICK, 'uuid-alice', []]);
        expect(text).toContain('Google Calendar');
        expect(text).toContain('not words they typed');
        // Nothing is learned about the person from it
        expect(hooks).toMatchObject({ roomId: ROOM, note: true });
        expect(client.sendText.mock.calls.map(([, , words]) => words)).toEqual(['Tomorrow: 10:00 standup, 1:30 lunch with Fahad.', appConnectedLine('Google Calendar')]);
        expect(appConnectedLine('Google Calendar')).toContain('[Apps](#apps)');
    });

    it('still tells the line of the system from the person\'s words when the Brick was resting and answers it later', async () => {
        const { bridge, client, deps, config } = makeBridge({ botId: BRICK, name: 'Brick', enabled: false, aiProviderRef: 'universe-ai', roomUrl: '', brick: { ownerId: 'user-alice', isDefault: true } });
        deps.reply.mockResolvedValue({ text: 'Tomorrow: 10:00 standup.', media: [] });
        await bridge.onEvent(invite());
        await bridge.onEvent(connected());
        expect(deps.reply).not.toHaveBeenCalled();

        deps.getBotConfig.mockResolvedValue({ ...config, enabled: true });
        await bridge.checkWaiting();

        expect(deps.reply).toHaveBeenCalledTimes(1);
        expect(deps.reply.mock.calls[0][4]).toMatchObject({ note: true });
        expect(client.sendText.mock.calls.map(([, , words]) => words)).toContain(appConnectedLine('Google Calendar'));
    });

    it('ignores a connected event that is not whole, and one a bot sent', async () => {
        const { bridge, deps } = makeBridge();
        await bridge.onEvent(invite());
        await bridge.onEvent(connected({ name: '' }));
        await bridge.onEvent({ ...connected(), sender: BRICK_USER });
        expect(deps.reply).not.toHaveBeenCalled();
        expect(connectedAppOf({ app: 'x', name: ' Notion  ' })).toEqual({ app: 'x', name: 'Notion' });
        expect(connectedAppOf({ app: 'x' })).toBeNull();
        expect(APP_CONNECTED_KEY).toBe(APP_CONNECTED_EVENT);
    });
});
