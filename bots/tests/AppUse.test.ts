/**
 * The check right before an App on a connection is used (game #2001, Orbit `/use`): the bot server sends the call's id on
 * every lent or team use and the tool's heading on every lent one, asks again for every call, and never runs a use Orbit
 * did not allow (`incomplete` included). The person is never refused: the bot is told to carry on without the App.
 */
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { appNotUsedLine, askOrbitAboutAppUse, orbitHeadingOf, useBody, type AppUseCheck } from '../mcp/AppUse';
import { MCPConnector } from '../mcp/MCPConnector';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const SIDE = { adminApiUrl: 'https://orbit.example', serviceToken: 'svc' };

describe('what Orbit is sent', () => {
    it('names the four headings the way Orbit does', () => {
        expect(orbitHeadingOf('looksUp')).toBe('lookUp');
        expect(orbitHeadingOf('makesNew')).toBe('make');
        expect(orbitHeadingOf('changesThings')).toBe('change');
        expect(orbitHeadingOf('deletesOrSends')).toBe('deleteSend');
        expect(orbitHeadingOf(undefined)).toBeUndefined();
    });

    it('sends the call id and the heading, and only what it has', () => {
        expect(useBody({ callId: 'c1', heading: 'makesNew', requesterKey: 'u-1' })).toEqual({ callId: 'c1', heading: 'make', requesterKey: 'u-1' });
        expect(useBody({ callId: 'c1' })).toEqual({ callId: 'c1' });
        expect(useBody({ callId: 'c1', forOwner: true })).toEqual({ callId: 'c1', forOwner: true });
    });
});

describe('asking Orbit', () => {
    it('posts to the App\'s use route with the service token', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { allowed: true, viaConnection: true } });
        const answer = await askOrbitAboutAppUse(() => SIDE)('bot 1', 'srv/1', { callId: 'c9', heading: 'looksUp' });
        expect(answer).toEqual({ allowed: true });
        expect(post.mock.calls[0][0]).toBe('https://orbit.example/api/bots/bot%201/mcp-servers/srv%2F1/use');
        expect(post.mock.calls[0][1]).toEqual({ callId: 'c9', heading: 'lookUp' });
        expect((post.mock.calls[0][2] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer svc');
    });

    it('hands back each reason Orbit gives, `incomplete` too', async () => {
        for (const reason of ['gone', 'off', 'not_owner', 'not_lent', 'limit_reached', 'incomplete']) {
            vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: false, reason } });
            expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason });
        }
    });

    it('takes a missing App (404) and a reason it does not know as no', async () => {
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 404, data: { allowed: false, reason: 'gone' } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'gone' });
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: false, reason: 'something new' } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'gone' });
    });

    it('lets nothing through when Orbit cannot be asked', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(axios, 'post').mockRejectedValue(new Error('down'));
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'unavailable' });
        expect(await askOrbitAboutAppUse(() => null)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'unavailable' });
    });
});

describe('what the bot is told', () => {
    it('says it in plain words, never "tool", prices or whose App it is', () => {
        for (const reason of ['gone', 'off', 'not_owner', 'not_lent', 'limit_reached', 'incomplete', 'unavailable'] as const) {
            const line = appNotUsedLine(reason);
            expect(line).toContain('App');
            expect(line).not.toMatch(/\btool\b|MCP|connector|\$/i);
        }
        expect(appNotUsedLine('limit_reached')).toContain('today');
        expect(appNotUsedLine('limit_reached')).toContain('Carry on without it');
    });
});

const LENT = new Map([['search', { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp', connectionId: 'conn-1' }]]);
const OWN = new Map([['search', { serverId: 's2', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp' }]]);

function service(check?: AppUseCheck, heading: string | null = 'looksUp') {
    const ai = new AIService(null!, null!, '');
    ai['toolGate'] = { decide: async () => ({ kind: 'run', ...(heading ? { heading } : {}) }), offers: async () => true } as never;
    if (check) ai.useAppUse(check);
    return ai;
}

const signedIn = { isVoiceBot: () => false, getPersonForArtifacts: () => ({ signedIn: true, identifier: 'u-sara', name: 'Sara' }) };
const call = (ai: AIService, servers: Map<string, object> = LENT, id = 'call-7') =>
    ai['executeToolCalls']([{ id, name: 'search', arguments: '{}' }], signedIn as never, undefined, servers as never, undefined, 'room', 'b1', 7);

describe('every use of an App on a connection', () => {
    it('asks Orbit with the call id, the heading and who is asking, then runs it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true }));
        const [result] = await call(service(check));
        expect(result.result).toBe('done');
        expect(check).toHaveBeenCalledWith('b1', 's1', { botId: 'b1', callId: 'call-7', heading: 'looksUp', requesterKey: 'u-sara' });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('asks again for each call, with its own id', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true }));
        const ai = service(check);
        await call(ai, LENT, 'a');
        await call(ai, LENT, 'b');
        expect(check.mock.calls.map((c) => c[2].callId)).toEqual(['a', 'b']);
    });

    it('never runs a use Orbit did not allow, and tells the bot to carry on without it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        for (const reason of ['limit_reached', 'not_lent', 'incomplete', 'gone'] as const) {
            const [result] = await call(service(async () => ({ allowed: false, reason })));
            expect(result.result.error).toContain('Carry on without it');
            expect(result.result.outcome).toBe('not_sent');
        }
        expect(execute).not.toHaveBeenCalled();
    });

    it('sends no heading when the tool has none, so Orbit answers `incomplete` and the use does not run', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async (_b, _s, request) => (request.heading ? { allowed: true } : { allowed: false, reason: 'incomplete' }));
        const [result] = await call(service(check, null));
        expect(check.mock.calls[0][2]).not.toHaveProperty('heading');
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('App');
    });

    it('does not run an App on a connection when nothing can ask Orbit', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const [result] = await call(service());
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain("can't check that App");
    });

    it('does not ask for an App set up on the bot itself, as before', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: false, reason: 'gone' }));
        const [result] = await call(service(check), OWN);
        expect(check).not.toHaveBeenCalled();
        expect(result.result).toBe('done');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('asks for a use a person approved on a card too, with the saved heading and the attempt id', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true }));
        const ai = service(check);
        const entry = LENT.get('search') as never;
        expect(await ai.runApprovedTool('b1', entry, 'search', {}, 'u-sara', 60, { heading: 'deletesOrSends', callId: 'attempt-3' })).toBe('done');
        expect(check).toHaveBeenCalledWith('b1', 's1', { botId: 'b1', requesterKey: 'u-sara', heading: 'deletesOrSends', callId: 'attempt-3' });
        expect(execute).toHaveBeenCalledTimes(1);
        // With no heading and call id it cannot be asked about: not run
        execute.mockClear();
        const refused = (await ai.runApprovedTool('b1', entry, 'search', {}, 'u-sara', 60)) as { error: string };
        expect(refused.error).toContain("can't check that App");
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('a ready-made App', () => {
    const READY = new Map([['send_email', { serverId: 's3', serverUrl: 'https://stored.link/mcp', authType: 'none', fingerprint: 'fp', connectionId: 'conn-2', readyMade: true, orbitUrl: 'https://orbit.example' }]]);
    const json = (body: unknown) => ({ jsonrpc: '2.0', id: '2', result: body });

    it('is sent through Orbit\'s link route, never to the stored link, with the call id', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        const messages: Array<{ url: string; body: any; auth: string }> = [];
        vi.spyOn(axios, 'post').mockImplementation(async (url: string, body: any, config: any) => {
            messages.push({ url, body, auth: config?.headers?.Authorization });
            if (body.message.method === 'initialize') return { data: { status: 200, contentType: 'application/json', sessionId: 'sess-1', body: '{}' } };
            if (body.message.method === 'notifications/initialized') return { data: { status: 202, contentType: null, sessionId: null, body: '' } };
            return { data: { status: 200, contentType: 'application/json', sessionId: null, body: JSON.stringify(json({ content: [{ type: 'text', text: 'sent' }] })) } };
        });
        const ai = service(async () => ({ allowed: true }));
        const [result] = await ai['executeToolCalls']([{ id: 'call-9', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-x', 7);
        expect(result.result).toEqual([{ type: 'text', text: 'sent' }]);
        expect(messages.every((m) => m.url === 'https://orbit.example/api/ready-made/link' && m.auth === 'Bearer svc')).toBe(true);
        expect(messages.map((m) => m.body.message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
        const sent = messages[2].body;
        expect(sent).toMatchObject({ botId: 'bot-x', serverId: 's3', requesterKey: 'u-sara', callId: 'call-9', sessionId: 'sess-1' });
        expect(sent.message.params.name).toBe('send_email');
        // The stored link was never called
        expect(messages.some((m) => m.url.includes('stored.link'))).toBe(false);
    });

    it('lists its tools through Orbit for the Brick\'s owner, without a call id', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        const sent: any[] = [];
        vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
            sent.push(body);
            const list = { jsonrpc: '2.0', id: '1', result: { tools: [{ name: 'send_email', description: 'Send', inputSchema: { type: 'object' } }] } };
            return { data: { status: 200, contentType: 'application/json', sessionId: body.message.method === 'initialize' ? 's' : null, body: JSON.stringify(list) } };
        });
        const read = await MCPConnector['listAllTools']({ id: 's4', botId: 'bot-y', name: 'Gmail', serverUrl: 'https://stored.link/mcp', authType: 'none', enabled: true, readyMade: true, orbitUrl: 'https://orbit.example' });
        expect(read?.tools.map((t) => t.name)).toEqual(['send_email']);
        const listing = sent.find((b) => b.message.method === 'tools/list');
        expect(listing).toMatchObject({ botId: 'bot-y', serverId: 's4', forOwner: true });
        expect(listing).not.toHaveProperty('callId');
    });

    it('is not taken as never sent when the turn is cancelled after the call went to Orbit', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        const controller = new AbortController();
        vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
            if (body.message.method === 'initialize') return { data: { status: 200, contentType: 'application/json', sessionId: 'sess-2', body: '{}' } };
            if (body.message.method === 'notifications/initialized') return { data: { status: 202, contentType: null, sessionId: null, body: '' } };
            // The call is out: the turn is cancelled while Orbit may still be running it
            controller.abort();
            throw new axios.CanceledError('canceled');
        });
        const ai = service(async () => ({ allowed: true }));
        const [result] = await ai['executeToolCalls']([{ id: 'call-10', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-x', 7, controller.signal);
        expect(result.result).toMatchObject({ outcome: 'uncertain' });
    });

    describe('a kept session that went idle', () => {
        const callWith = async (ai: ReturnType<typeof service>, id: string) =>
            (await ai['executeToolCalls']([{ id, name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-idle', 7))[0];
        const link = (sessions: { live: Set<string>; made: string[] }, sent: any[]) => async (_url: string, body: any) => {
            sent.push(body);
            const method = body.message.method;
            if (method === 'initialize') {
                const id = `sess-${sessions.made.length + 1}`;
                sessions.made.push(id);
                sessions.live.add(id);
                return { data: { status: 200, contentType: 'application/json', sessionId: id, body: '{}' } };
            }
            if (method === 'notifications/initialized') return { data: { status: 202, contentType: null, sessionId: null, body: '' } };
            // The link answers 404 to a session it no longer knows
            if (!sessions.live.has(body.sessionId)) return { data: { status: 404, contentType: null, sessionId: null, body: '' } };
            if (method === 'tools/list') return { data: { status: 200, contentType: 'application/json', sessionId: null, body: JSON.stringify({ jsonrpc: '2.0', id: 'check', result: { tools: [] } }) } };
            return { data: { status: 200, contentType: 'application/json', sessionId: null, body: JSON.stringify(json({ content: [{ type: 'text', text: 'sent' }] })) } };
        };

        it('is checked before the call and replaced when the link dropped it, so the call goes out once', async () => {
            vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
            MCPConnector.clearCache();
            vi.useFakeTimers({ toFake: ['Date'] });
            try {
                const sessions = { live: new Set<string>(), made: [] as string[] };
                const sent: any[] = [];
                vi.spyOn(axios, 'post').mockImplementation(link(sessions, sent) as never);
                const ai = service(async () => ({ allowed: true }));
                expect((await callWith(ai, 'first')).result).toEqual([{ type: 'text', text: 'sent' }]);
                // A minute later the link has forgotten the session
                vi.setSystemTime(Date.now() + 60_000);
                sessions.live.clear();
                sent.length = 0;
                expect((await callWith(ai, 'second')).result).toEqual([{ type: 'text', text: 'sent' }]);
                expect(sent.map((b) => b.message.method)).toEqual(['tools/list', 'initialize', 'notifications/initialized', 'tools/call']);
                // Exactly one call for this id reached Orbit, and on the new session
                const calls = sent.filter((b) => b.message.method === 'tools/call');
                expect(calls).toHaveLength(1);
                expect(calls[0]).toMatchObject({ callId: 'second', sessionId: 'sess-2' });
                // The check is a listing, which carries no call id
                expect(sent[0]).not.toHaveProperty('callId');
            } finally {
                vi.useRealTimers();
            }
        });

        it('is not checked again while it is in use', async () => {
            vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
            MCPConnector.clearCache();
            const sessions = { live: new Set<string>(), made: [] as string[] };
            const sent: any[] = [];
            vi.spyOn(axios, 'post').mockImplementation(link(sessions, sent) as never);
            const ai = service(async () => ({ allowed: true }));
            await callWith(ai, 'one');
            sent.length = 0;
            await callWith(ai, 'two');
            expect(sent.map((b) => b.message.method)).toEqual(['tools/call']);
        });

        it('sends no call and keeps no session when the check is refused for another reason than a gone session', async () => {
            vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
            MCPConnector.clearCache();
            vi.useFakeTimers({ toFake: ['Date'] });
            try {
                const sessions = { live: new Set<string>(), made: [] as string[] };
                const sent: any[] = [];
                const spy = vi.spyOn(axios, 'post').mockImplementation(link(sessions, sent) as never);
                const ai = service(async () => ({ allowed: true }));
                await callWith(ai, 'first');
                vi.setSystemTime(Date.now() + 60_000);
                sent.length = 0;
                // The link now refuses everything: its key is no longer good
                spy.mockImplementation((async (_url: string, body: any) => {
                    sent.push(body);
                    return { data: { status: 401, contentType: null, sessionId: null, body: '' } };
                }) as never);
                const result = (await callWith(ai, 'second')).result as { outcome: string };
                expect(result.outcome).toBe('not_sent');
                expect(sent.map((b) => b.message.method)).toEqual(['tools/list']);
            } finally {
                vi.useRealTimers();
            }
        });

        it('sends no call and says nothing ran when the check cannot reach Orbit', async () => {
            vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            MCPConnector.clearCache();
            vi.useFakeTimers({ toFake: ['Date'] });
            try {
                const sessions = { live: new Set<string>(), made: [] as string[] };
                const sent: any[] = [];
                const spy = vi.spyOn(axios, 'post').mockImplementation(link(sessions, sent) as never);
                const ai = service(async () => ({ allowed: true }));
                await callWith(ai, 'first');
                vi.setSystemTime(Date.now() + 60_000);
                sent.length = 0;
                spy.mockRejectedValue(Object.assign(new Error('timeout of 60000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' }));
                const result = (await callWith(ai, 'second')).result as { outcome: string };
                expect(result.outcome).toBe('not_sent');
                expect(sent.some((b) => b.message.method === 'tools/call')).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    it('sends no call and says nothing ran when the link will not open a session', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        MCPConnector.clearCache();
        const sent: any[] = [];
        vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
            sent.push(body);
            // Orbit answers 200 with what the link said: 401, its key is no longer good
            return { data: { status: 401, contentType: null, sessionId: null, body: '' } };
        });
        const ai = service(async () => ({ allowed: true }));
        const [result] = await ai['executeToolCalls']([{ id: 'c-401', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-401', 7);
        expect(result.result.outcome).toBe('not_sent');
        expect(sent.map((b) => b.message.method)).toEqual(['initialize']);
        // Nothing was kept: the next call opens a session again
        sent.length = 0;
        await ai['executeToolCalls']([{ id: 'c-401b', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-401', 7);
        expect(sent.map((b) => b.message.method)).toEqual(['initialize']);
    });

    it('sends no call and keeps no session when the link refuses the "initialized" message', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        MCPConnector.clearCache();
        const sent: any[] = [];
        vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
            sent.push(body);
            if (body.message.method === 'initialize') return { data: { status: 200, contentType: 'application/json', sessionId: 'sess-r', body: '{}' } };
            return { data: { status: 500, contentType: null, sessionId: null, body: '' } };
        });
        const ai = service(async () => ({ allowed: true }));
        const [result] = await ai['executeToolCalls']([{ id: 'c-init', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-init', 7);
        expect(result.result.outcome).toBe('not_sent');
        expect(sent.map((b) => b.message.method)).toEqual(['initialize', 'notifications/initialized']);
        sent.length = 0;
        await ai['executeToolCalls']([{ id: 'c-init2', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-init', 7);
        expect(sent[0].message.method).toBe('initialize');
    });

    it('is not run when Orbit says no, and tells the bot nothing about why', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('forbidden'), { isAxiosError: true, response: { status: 403 } }));
        const ai = service(async () => ({ allowed: true }));
        const [result] = await ai['executeToolCalls']([{ id: 'c', name: 'send_email', arguments: '{}' }], signedIn as never, undefined, READY as never, undefined, 'room', 'bot-x', 7);
        expect(result.result.outcome).toBe('not_sent');
    });
});
