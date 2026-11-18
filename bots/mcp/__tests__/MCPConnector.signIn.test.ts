/**
 * A tool server that refuses the bot's sign-in (game #1819): the bot server stops calling it, tells Orbit once, hands the
 * reply the list of what is down, tries again after the wait or at once for a new sign-in, and clears the mark when the
 * server answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { MCPConnector, signInRefusalOf } from '../MCPConnector';

vi.mock('../../ai/encryption', () => ({ decryptApiKey: (val: string | null | undefined) => val || null }));
vi.mock('dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isCancel: vi.fn(), isAxiosError: vi.fn() } }));
const http = vi.mocked(axios, true);
http.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);

const ORBIT = 'https://orbit.test';
const base = { id: 'srv-1', botId: 'bot-1', name: 'Tavily', serverUrl: 'https://tavily.example/mcp', authType: 'oauth', enabled: true };
const TOKEN_A = JSON.stringify({ accessToken: 'a' });
const TOKEN_B = JSON.stringify({ accessToken: 'b' });
const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
const listed = { data: { jsonrpc: '2.0', id: '1', result: { tools: [tool('search')] } } };

function httpError(status?: number, code?: string): unknown {
    const err: any = new Error(status ? `HTTP ${status}` : String(code));
    if (status) err.response = { status, data: 'nope' };
    if (code) err.code = code;
    err.isAxiosError = true;
    return err;
}

let servers: Array<Record<string, unknown>>;
let listAnswer: () => unknown;
let listCalls: number;
let reports: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
    // The waits the tests expect, whatever the environment they run in
    vi.stubEnv('BOT_TOOL_SIGNIN_RECHECK_MINUTES', '30');
    vi.stubEnv('BOT_TOOL_NOANSWER_RETRY_MINUTES', '5');
    vi.clearAllMocks();
    MCPConnector.clearCache();
    servers = [{ ...base, authConfig: TOKEN_A }];
    listCalls = 0;
    reports = [];
    listAnswer = () => listed;
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/mcp-servers')) return { data: servers };
        if (url.endsWith('/tools')) return { data: { tools: [] } };
        throw new Error(`Unexpected GET ${url}`);
    });
    http.put.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith('/sign-in')) {
            reports.push({ url, body });
            // Orbit keeps what it is told, and its server list shows it (as the real one does)
            const id = decodeURIComponent(url.split('/mcp-servers/')[1].split('/')[0]);
            for (const held of servers) {
                if (held.id !== id) continue;
                if (body.state === 'ok') {
                    delete held.signInLostAt;
                    delete held.noAnswerAt;
                } else if (body.state === 'expired') held.signInLostAt = body.at;
                else held.noAnswerAt = body.at;
            }
            return { data: { changed: true } };
        }
        return { data: { added: [], changed: [], removed: [] } };
    });
    http.post.mockImplementation(async (_url: string, body: { method: string }) => {
        if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
        if (body.method === 'tools/list') {
            listCalls += 1;
            const next = listAnswer();
            if (next instanceof Error || (next as { isAxiosError?: boolean })?.isAxiosError) throw next;
            return next;
        }
        throw httpError(401);
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    MCPConnector.clearCache();
});

const discover = () => MCPConnector.discoverToolsWithMapping('bot-1', ORBIT, 'admin', 'svc');
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('a refused sign-in', () => {
    it('gives the reply no tools from that server, lists it as expired, and tells Orbit once', async () => {
        listAnswer = () => {
            throw httpError(401);
        };
        const { tools, issues } = await discover();
        await flush();
        expect(tools).toEqual([]);
        expect(issues).toEqual([expect.objectContaining({ serverId: 'srv-1', name: 'Tavily', state: 'expired', kind: 'oauth' })]);
        expect(reports).toHaveLength(1);
        expect(reports[0].url).toBe(`${ORBIT}/api/bots/bot-1/mcp-servers/srv-1/sign-in`);
        expect(reports[0].body).toMatchObject({ state: 'expired', status: 401, at: issues[0].since });
    });

    it('counts a 403 the same way', async () => {
        listAnswer = () => {
            throw httpError(403);
        };
        expect((await discover()).issues[0].state).toBe('expired');
    });

    it('does not call the server again on the next replies', async () => {
        listAnswer = () => {
            throw httpError(401);
        };
        await discover();
        await flush();
        const callsAfterFirst = listCalls;
        await discover();
        await discover();
        expect(listCalls).toBe(callsAfterFirst);
        expect(reports).toHaveLength(1);
        expect((await discover()).issues).toHaveLength(1);
    });

    it('does not offer tools it had read before the sign-in ran out', async () => {
        expect((await discover()).tools).toHaveLength(1);
        MCPConnector.noteRefused({ botId: 'bot-1', serverId: 'srv-1', serverName: 'Tavily', authType: 'oauth', authConfig: TOKEN_A }, { adminApiUrl: ORBIT, adminApiToken: 'admin' }, 401);
        const again = await discover();
        expect(again.tools).toEqual([]);
        expect(again.issues[0].state).toBe('expired');
    });

    it('tries again after 30 minutes, and clears the mark and tells Orbit when the server answers', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
        listAnswer = () => {
            throw httpError(401);
        };
        await discover();
        vi.setSystemTime(new Date('2026-11-05T10:29:00Z'));
        await discover();
        expect(listCalls).toBe(1);
        vi.setSystemTime(new Date('2026-11-05T10:31:00Z'));
        listAnswer = () => listed;
        const { tools, issues } = await discover();
        expect(listCalls).toBe(2);
        expect(tools).toHaveLength(1);
        expect(issues).toEqual([]);
        expect(reports.map((r) => r.body.state)).toEqual(['expired', 'ok']);
    });

    it('keeps the mark when the second try is refused too, without telling Orbit again', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
        listAnswer = () => {
            throw httpError(401);
        };
        const first = await discover();
        await vi.advanceTimersByTimeAsync(0);
        vi.setSystemTime(new Date('2026-11-05T10:31:00Z'));
        const second = await discover();
        expect(listCalls).toBe(2);
        expect(second.issues[0].since).toBe(first.issues[0].since);
        expect(reports).toHaveLength(1);
    });

    it('tries a new sign-in at once', async () => {
        listAnswer = () => {
            throw httpError(401);
        };
        await discover();
        servers = [{ ...base, authConfig: TOKEN_B }];
        listAnswer = () => listed;
        const { tools, issues } = await discover();
        expect(tools).toHaveLength(1);
        expect(issues).toEqual([]);
    });

    it('carries on from the mark Orbit holds after the bot server restarted, and tells Orbit when the server answers', async () => {
        servers = [{ ...base, authConfig: TOKEN_A, signInLostAt: '2026-11-05T09:54:00.000Z' }];
        const { tools, issues } = await discover();
        await flush();
        expect(tools).toHaveLength(1);
        expect(issues).toEqual([]);
        expect(reports.map((r) => r.body.state)).toEqual(['ok']);
    });

    it('tells Orbit again at the next read when it did not hear that the server answers', async () => {
        servers = [{ ...base, authConfig: TOKEN_A, signInLostAt: '2026-11-05T09:54:00.000Z' }];
        let orbitUp = false;
        http.put.mockImplementation(async (url: string, body: Record<string, unknown>) => {
            if (!url.endsWith('/sign-in')) return { data: { added: [], changed: [], removed: [] } };
            if (!orbitUp) throw new Error('Orbit is down');
            reports.push({ url, body });
            return { data: { changed: true } };
        });
        await discover();
        await flush();
        expect(reports).toEqual([]);
        orbitUp = true;
        await discover();
        await flush();
        // The list was read from the server again (not from the cache), and Orbit has it now
        expect(listCalls).toBe(2);
        expect(reports.map((r) => r.body.state)).toEqual(['ok']);
    });

    it('does not list a server as down from a mark Orbit has not cleared yet, when its tools were just read', async () => {
        servers = [{ ...base, authConfig: TOKEN_A, signInLostAt: '2026-11-05T09:54:00.000Z' }];
        await discover();
        // Orbit still shows the mark (its `ok` is on the way): the next reply reads it from Orbit's list again
        const { tools, issues } = await discover();
        expect(listCalls).toBe(1);
        expect(tools).toHaveLength(1);
        expect(issues).toEqual([]);
    });

    it('says nothing is known when the server list could not be read, and none when no servers are set', async () => {
        http.get.mockImplementation(async () => {
            throw httpError(502);
        });
        expect((await discover()).issues).toBeUndefined();
        http.get.mockImplementation(async () => {
            throw httpError(404);
        });
        expect((await discover()).issues).toEqual([]);
    });

    it('leaves other servers working', async () => {
        servers = [
            { ...base, authConfig: TOKEN_A },
            { ...base, id: 'srv-2', name: 'Attio', authType: 'bearer', authConfig: 'k', serverUrl: 'https://attio.example/mcp' },
        ];
        http.post.mockImplementation(async (url: string, body: { method: string }) => {
            if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
            if (url.includes('tavily')) throw httpError(401);
            return { data: { jsonrpc: '2.0', id: '1', result: { tools: [tool('lookup')] } } };
        });
        const { tools, issues } = await discover();
        expect(tools.map((t) => t.function.name)).toEqual(['lookup']);
        expect(issues.map((i) => i.name)).toEqual(['Tavily']);
    });

    it('marks the kind of sign-in: a pasted key for a bearer token', async () => {
        servers = [{ ...base, authType: 'bearer', authConfig: 'k' }];
        listAnswer = () => {
            throw httpError(401);
        };
        expect((await discover()).issues[0].kind).toBe('key');
    });
});

describe('a server that does not answer', () => {
    it('is listed as not answering, with no sign-in mark, and tried again after 5 minutes', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
        listAnswer = () => {
            throw httpError(undefined, 'ECONNRESET');
        };
        const first = await discover();
        await vi.advanceTimersByTimeAsync(0);
        expect(first.issues).toEqual([expect.objectContaining({ state: 'no-answer' })]);
        expect(reports[0].body.state).toBe('no-answer');
        vi.setSystemTime(new Date('2026-11-05T10:04:00Z'));
        await discover();
        expect(listCalls).toBe(1);
        vi.setSystemTime(new Date('2026-11-05T10:06:00Z'));
        await discover();
        expect(listCalls).toBe(2);
    });

    it('counts a 500 as no answer', async () => {
        listAnswer = () => {
            throw httpError(502);
        };
        expect((await discover()).issues[0].state).toBe('no-answer');
    });

    it('does not mark a server that answered with something we cannot use, or a 404', async () => {
        listAnswer = () => {
            throw httpError(404);
        };
        expect((await discover()).issues).toEqual([]);
        MCPConnector.clearCache();
        listAnswer = () => ({ data: { jsonrpc: '2.0', id: '1', error: { message: 'boom' } } });
        expect((await discover()).issues).toEqual([]);
    });
});

describe('a call refused while a reply runs', () => {
    it('says nothing ran and the sign-in expired, and does not send it again', async () => {
        http.post.mockImplementation(async (_url: string, body: { method: string }) => {
            if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
            throw httpError(401);
        });
        const result = await MCPConnector.executeToolCall('srv-1', base.serverUrl, 'search', {}, 'oauth', TOKEN_A);
        expect(result).toMatchObject({ error: 'Sign-in expired. Nothing ran', outcome: 'failed' });
        expect(result).not.toHaveProperty('signInRefused');
        expect(signInRefusalOf(result)).toBe(401);
        expect(result.hint).toContain('Do not call this tool again');
        expect(http.post.mock.calls.filter(([, b]: any) => b.method === 'tools/call')).toHaveLength(1);
    });

    it('a 403 on one call is told as not run, but is not taken for the whole sign-in being gone', async () => {
        http.post.mockImplementation(async (_url: string, body: { method: string }) => {
            if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
            throw httpError(403);
        });
        const result = await MCPConnector.executeToolCall('srv-1', base.serverUrl, 'search', {}, 'oauth', TOKEN_A);
        expect(result).toMatchObject({ error: 'Sign-in expired. Nothing ran', outcome: 'failed' });
        expect(signInRefusalOf(result)).toBeUndefined();
    });

    it('is marked and told to Orbit', async () => {
        MCPConnector.noteRefused({ botId: 'bot-1', serverId: 'srv-1', serverName: 'Tavily', authType: 'oauth', authConfig: TOKEN_A }, { adminApiUrl: ORBIT, adminApiToken: 'admin' }, 403);
        await flush();
        expect(reports).toHaveLength(1);
        expect(reports[0].body).toMatchObject({ state: 'expired', status: 403 });
    });
});

describe('Test server and Connect (#1654)', () => {
    const test = () => MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin');

    it('marks a refused sign-in the way a reply does, and tells Orbit', async () => {
        listAnswer = () => {
            throw httpError(401);
        };
        expect(await test()).toMatchObject({ read: false });
        await flush();
        expect(reports.map((r) => r.body.state)).toEqual(['expired']);
        expect((await discover()).issues).toHaveLength(1);
    });

    it('clears the mark and tells Orbit when the server answers', async () => {
        servers = [{ ...base, authConfig: TOKEN_A, signInLostAt: '2026-11-05T09:54:00.000Z' }];
        expect(await test()).toMatchObject({ read: true });
        await flush();
        expect(reports.map((r) => r.body.state)).toEqual(['ok']);
    });

    it('says nothing to Orbit about a server that was never marked', async () => {
        expect(await test()).toMatchObject({ read: true });
        await flush();
        expect(reports).toEqual([]);
    });
});

describe('the tool server list cannot be read (#1819)', () => {
    const keyApp = {
        serverId: 'key-1',
        connectionId: 'conn-1',
        name: 'Attio',
        short: 'Attio',
        definitionHash: 'h1',
        enabled: true,
        working: true,
        operations: [{ id: 'op1', label: 'Find people', heading: 'looksUp', verified: true, tool: 'find_people', fingerprint: 'f1', inputSchema: { type: 'object', properties: {} } }],
    };
    const failListWith = (error: unknown) => {
        const normal = http.get.getMockImplementation()!;
        http.get.mockImplementation(async (url: string, ...rest: unknown[]) => {
            if (url.endsWith('/mcp-servers')) throw error;
            if (url.endsWith('/key-apps')) return { status: 200, data: { apps: [keyApp], services: [] } };
            return (normal as (...args: unknown[]) => Promise<unknown>)(url, ...rest);
        });
    };
    const names = (found: { tools: Array<{ function: { name: string } }> }) => found.tools.map((t) => t.function.name);

    it('keeps the Apps with a key, and says nothing of the servers (so a shown card stays)', async () => {
        failListWith(httpError(500));
        const found = await discover();
        expect(found.issues).toBeUndefined();
        expect(names(found).some((n) => n.includes('find_people'))).toBe(true);
    });

    it('keeps the Apps with a key for a Brick with no servers (404), with nothing down', async () => {
        failListWith(httpError(404));
        const found = await discover();
        expect(found.issues).toEqual([]);
        expect(names(found).some((n) => n.includes('find_people'))).toBe(true);
    });
});

describe('a ready-made App whose link refuses the sign-in (#1819)', () => {
    const gmail = { id: 'srv-rm', botId: 'bot-1', name: 'Gmail', serverUrl: 'https://stored.link/mcp', authType: 'none', enabled: true, readyMade: true, connectionId: 'conn-gmail' };

    it.each([
        ['opening the session', 401, 'initialize'],
        ['telling it the session is open', 403, 'notifications/initialized'],
        ['asking for the tools', 401, 'tools/list'],
    ])('lists it as expired when the link answers %s with %i', async (_when, status, method) => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        servers = [gmail];
        http.post.mockImplementation(async (_url: string, body: { message: { method: string } }) => {
            const sent = body.message.method;
            const refused = sent === method;
            return { data: { status: refused ? status : 200, contentType: 'application/json', sessionId: sent === 'initialize' ? 's' : null, body: sent === 'tools/list' ? JSON.stringify({ jsonrpc: '2.0', id: '1', result: { tools: [tool('send_email')] } }) : '{}' } };
        });
        const found = await discover();
        expect(found.issues).toHaveLength(1);
        expect(found.issues?.[0]).toMatchObject({ serverId: 'srv-rm', state: 'expired' });
        vi.unstubAllEnvs();
    });
});

describe('what a failed read says about the server (#1819)', () => {
    it('keeps a refused sign-in at initialize when the server then answers the listing with a 400', async () => {
        http.post.mockImplementation(async (_url: string, body: { method: string }) => {
            if (body.method === 'initialize') throw httpError(401);
            throw httpError(400);
        });
        const found = await discover();
        expect(found.issues).toHaveLength(1);
        expect(found.issues?.[0]).toMatchObject({ state: 'expired' });
        await flush();
        expect(reports.map((r) => r.body.state)).toEqual(['expired']);
    });

    it('lists a ready-made App whose link failed with a 502 while opening the session as not answering', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'svc');
        servers = [{ id: 'srv-rm', botId: 'bot-1', name: 'Gmail', serverUrl: 'https://stored.link/mcp', authType: 'none', enabled: true, readyMade: true, connectionId: 'conn-gmail' }];
        http.post.mockImplementation(async () => ({ data: { status: 502, contentType: null, sessionId: null, body: '' } }));
        const found = await discover();
        expect(found.issues?.[0]).toMatchObject({ serverId: 'srv-rm', state: 'no-answer' });
        vi.unstubAllEnvs();
    });

    it('does not take a field of a tool\'s own answer for a refused sign-in', async () => {
        http.post.mockImplementation(async (_url: string, body: { method: string }) => {
            if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
            return { data: { jsonrpc: '2.0', id: '2', result: { content: [{ type: 'text', text: 'ok' }], signInRefused: 401 } }, headers: {} };
        });
        const result = await MCPConnector.executeToolCall('srv-1', base.serverUrl, 'search', {}, 'oauth', TOKEN_A);
        expect(signInRefusalOf(result)).toBeUndefined();
    });

    it('records a server that did not answer when Test server meets it, as a reply does', async () => {
        listAnswer = () => {
            throw httpError(502);
        };
        const test = await MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin');
        expect(test).toMatchObject({ read: false });
        await flush();
        expect(reports.map((r) => r.body.state)).toEqual(['no-answer']);
    });
});
