/**
 * A server's whole tool list (game #1654): every page is read, each tool carries its fingerprint, the list is saved to
 * Orbit whenever it is read fresh, and a server that says its list changed is read again next time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { MCPConnector } from '../MCPConnector';

vi.mock('../../ai/encryption', () => ({ decryptApiKey: (val: string | null | undefined) => val || null }));
vi.mock('dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isCancel: vi.fn(), isAxiosError: vi.fn() } }));
const http = vi.mocked(axios, true);
http.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);

const ORBIT = 'https://orbit.test';
const SERVER = { id: 'srv-1', botId: 'bot-1', name: 'Linear', serverUrl: 'https://linear.example/mcp', authType: 'bearer', authConfig: 'key-sara', enabled: true };
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: `${name} does a thing`, inputSchema: { type: 'object', properties: {} }, ...extra });
const answer = (tools: unknown[], nextCursor?: string) => ({ data: { jsonrpc: '2.0', id: '1', result: { tools, ...(nextCursor ? { nextCursor } : {}) } } });

let pages: Array<ReturnType<typeof answer>> = [];
let listCalls: Array<Record<string, unknown> | undefined> = [];
let saved: Array<{ tools: Array<Record<string, unknown>>; truncated?: boolean; totalSeen?: number }> = [];
let known: unknown[] = [];
/** What Orbit's list says about a cut list; none for an Orbit that doesn't know about it. */
let orbitSays: Record<string, unknown> = {};
const PLAIN_CALL = { data: { jsonrpc: '2.0', id: '2', result: { content: [{ type: 'text', text: 'ok' }] } } };
let callAnswer: unknown = PLAIN_CALL;

beforeEach(() => {
    vi.clearAllMocks();
    pages = [];
    listCalls = [];
    saved = [];
    known = [];
    orbitSays = {};
    callAnswer = PLAIN_CALL;
    http.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/mcp-servers')) return { data: [SERVER] };
        if (url.endsWith('/tools')) return { data: { tools: known, ...orbitSays } };
        throw new Error(`Unexpected GET ${url}`);
    });
    http.put.mockImplementation(async (_url: string, body: { tools: Array<Record<string, unknown>>; truncated?: boolean; totalSeen?: number }) => {
        saved.push(body);
        return { data: { added: body.tools.map((t) => t.name), changed: [], removed: [] } };
    });
    http.post.mockImplementation(async (_url: string, body: { method: string; params?: Record<string, unknown> }) => {
        if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
        if (body.method === 'tools/list') {
            listCalls.push(body.params);
            return pages.shift() ?? answer([]);
        }
        return callAnswer;
    });
});

afterEach(() => MCPConnector.clearCache());

const discover = (suggest?: (system: string, user: string) => Promise<string>) =>
    MCPConnector.discoverToolsWithMapping('bot-1', ORBIT, 'admin', 'svc', { suggest });

describe('reading a server’s whole list', () => {
    it('follows every page, so a tool on a later page is offered and listed too', async () => {
        pages = [answer([tool('a'), tool('b')], 'p2'), answer([tool('c')], 'p3'), answer([tool('d')])];
        const { tools, toolServerMap } = await discover();
        expect(tools.map((t) => t.function.name)).toEqual(['a', 'b', 'c', 'd']);
        expect([...toolServerMap.keys()]).toEqual(['a', 'b', 'c', 'd']);
        expect(listCalls).toEqual([undefined, { cursor: 'p2' }, { cursor: 'p3' }]);
    });

    it('stops at a cursor that does not move on', async () => {
        pages = [answer([tool('a')], 'same'), answer([tool('b')], 'same')];
        expect((await discover()).tools.map((t) => t.function.name)).toEqual(['a', 'b']);
    });

    it('keeps and saves nothing of a list when a later page fails, so a half-read list is never taken for the whole', async () => {
        pages = [answer([tool('a')], 'p2'), { data: { jsonrpc: '2.0', id: '1', error: { message: 'boom' } } } as never];
        expect((await discover()).tools).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(saved).toHaveLength(0);
        // The next read, when the server answers fully, is the one kept
        pages = [answer([tool('a')], 'p2'), answer([tool('b')])];
        expect((await discover()).tools.map((t) => t.function.name)).toEqual(['a', 'b']);
    });

    it('gives each tool a fingerprint and its server’s name, and the fingerprint moves when the tool does', async () => {
        pages = [answer([tool('a')])];
        const first = (await discover()).toolServerMap.get('a')!;
        expect(first).toMatchObject({ serverId: 'srv-1', serverName: 'Linear' });
        expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        // From the cache, the same tool has the same fingerprint
        expect((await discover()).toolServerMap.get('a')!.fingerprint).toBe(first.fingerprint);
        MCPConnector.clearCache();
        pages = [answer([tool('a', { description: 'now deletes things too' })])];
        expect((await discover()).toolServerMap.get('a')!.fingerprint).not.toBe(first.fingerprint);
    });
});

describe('a server with more tools than are kept', () => {
    const many = (count: number, from = 0) => Array.from({ length: count }, (_, i) => tool(`t${String(from + i).padStart(4, '0')}`));
    const afterSave = () => vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));

    it('gives the model and Orbit the same first 500, says the list is cut, and how many the server has', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        // The last name in name order is the one left out, wherever the server put it
        pages = [answer([...many(250, 250).reverse(), ...many(250), tool('zzz_last')])];
        const { tools } = await discover();
        await afterSave();
        expect(tools).toHaveLength(500);
        expect(tools.map((t) => t.function.name)).not.toContain('zzz_last');
        expect(saved[0].tools).toHaveLength(500);
        expect(saved[0].tools.map((t) => t.name)).not.toContain('zzz_last');
        expect(new Set(saved[0].tools.map((t) => t.name))).toEqual(new Set(tools.map((t) => t.function.name)));
        expect(saved[0]).toMatchObject({ truncated: true, totalSeen: 501 });
    });

    it('counts the tools of every page when all were read', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        pages = [answer(many(300), 'p2'), answer(many(300, 300), 'p3'), answer(many(100, 600))];
        const { tools } = await discover();
        await afterSave();
        expect(tools).toHaveLength(500);
        expect(saved[0]).toMatchObject({ truncated: true, totalSeen: 700 });
    });

    it('does not call a server with exactly 500 tools cut, even with an empty page after them', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        pages = [answer(many(500), 'p2'), answer([])];
        const { tools } = await discover();
        await afterSave();
        expect(tools).toHaveLength(500);
        expect(saved[0].tools).toHaveLength(500);
        expect(saved[0].truncated).toBe(false);
        expect(saved[0]).not.toHaveProperty('totalSeen');
    });

    it('does not count one tool twice', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        pages = [answer([...many(500), ...many(10)])];
        await discover();
        await afterSave();
        expect(saved[0].truncated).toBe(false);
    });

    it('says the list is cut, with no count, when pages were left after the page guard', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        // 20 pages read, the 21st never asked for
        pages = Array.from({ length: 25 }, (_, i) => answer(many(10, i * 10), `p${i + 2}`));
        const { tools } = await discover();
        await afterSave();
        expect(listCalls).toHaveLength(20);
        expect(tools).toHaveLength(200);
        expect(saved[0].truncated).toBe(true);
        expect(saved[0]).not.toHaveProperty('totalSeen');
    });

    it('sends nothing new to an Orbit that does not know about cut lists', async () => {
        pages = [answer(many(501))];
        await discover();
        await afterSave();
        expect(saved[0]).not.toHaveProperty('truncated');
        expect(saved[0]).not.toHaveProperty('totalSeen');
        expect(saved[0].tools).toHaveLength(500);
    });

    it('saves again when only what Orbit says about the cut differs, and not when it already says it', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        pages = [answer(many(501))];
        await discover();
        await afterSave();
        known = saved[0].tools;
        saved = [];
        // Orbit has the same 500 tools but still says the list is whole
        MCPConnector.clearCache();
        pages = [answer(many(501))];
        await discover();
        await afterSave();
        expect(saved[0]).toMatchObject({ truncated: true, totalSeen: 501 });
        // Now it says so too: nothing to save
        saved = [];
        orbitSays = { truncated: true, totalSeen: 501 };
        MCPConnector.clearCache();
        pages = [answer(many(501))];
        await discover();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(saved).toHaveLength(0);
        // The server shrinks back to 500: Orbit is told it is whole again
        MCPConnector.clearCache();
        pages = [answer(many(500))];
        await discover();
        await afterSave();
        expect(saved[0].truncated).toBe(false);
    });

    it('tells Test server how it went with a cut list too', async () => {
        orbitSays = { truncated: false, totalSeen: null };
        pages = [answer(many(520))];
        expect(await MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin')).toMatchObject({ read: true, tools: 500, saved: { result: 'saved' } });
        expect(saved[0]).toMatchObject({ truncated: true, totalSeen: 520 });
    });
});

describe('saving the list to Orbit', () => {
    it('after a Test server whose save failed, the next read saves the list again', async () => {
        http.put.mockRejectedValueOnce(new Error('orbit down'));
        pages = [answer([tool('a')]), answer([tool('a')])];
        expect(await MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin')).toMatchObject({ read: true, saved: { result: 'skipped' } });
        await discover();
        await vi.waitFor(() => expect(saved).toHaveLength(1));
        expect(listCalls).toHaveLength(2);
    });

    it('tries to save the list again on the next read when Orbit did not get it, not only when the cache runs out', async () => {
        http.put.mockRejectedValueOnce(new Error('orbit down'));
        pages = [answer([tool('a')]), answer([tool('a')])];
        await discover();
        await vi.waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await discover();
        await vi.waitFor(() => expect(saved).toHaveLength(1));
        expect(listCalls).toHaveLength(2);
    });

    it('saves the list with a suggested heading each time it is read fresh, not from the cache', async () => {
        pages = [answer([tool('look', { annotations: { readOnlyHint: true } }), tool('post')])];
        const suggest = vi.fn().mockResolvedValue('{"post":"changesThings"}');
        await discover(suggest);
        await vi.waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0].tools.map((t) => [t.name, t.suggestedHeading, t.suggestionSource])).toEqual([
            ['look', 'looksUp', 'server'],
            ['post', 'changesThings', 'description'],
        ]);
        await discover(suggest);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(saved).toHaveLength(1);
    });

    it('never holds up the reply: a slow or failing Orbit changes nothing about the tools it gets', async () => {
        pages = [answer([tool('a')])];
        http.put.mockRejectedValue(new Error('Orbit is down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect((await discover()).tools).toHaveLength(1);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('not saved')));
        warn.mockRestore();
    });
});

describe('a server that says its list changed', () => {
    it('is read again next time, and saved again', async () => {
        pages = [answer([tool('a')])];
        await discover();
        await vi.waitFor(() => expect(saved).toHaveLength(1));

        callAnswer = {
            headers: { 'content-type': 'text/event-stream' },
            data:
                'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n' +
                'event: message\ndata: {"jsonrpc":"2.0","id":"2","result":{"content":[{"type":"text","text":"done"}]}}\n\n',
        };
        const result = await MCPConnector.executeToolCall('srv-1', SERVER.serverUrl, 'a', {}, 'bearer', 'key-sara', undefined, 'p1');
        expect(result).toEqual([{ type: 'text', text: 'done' }]);

        pages = [answer([tool('a'), tool('a_new')])];
        expect((await discover()).tools.map((t) => t.function.name)).toEqual(['a', 'a_new']);
    });

    it('keeps the list when the server says nothing about it', async () => {
        pages = [answer([tool('a')])];
        await discover();
        await MCPConnector.executeToolCall('srv-1', SERVER.serverUrl, 'a', {}, 'bearer', 'key-sara', undefined, 'p1');
        pages = [answer([tool('a'), tool('other')])];
        expect((await discover()).tools.map((t) => t.function.name)).toEqual(['a']);
    });
});

describe('Test server and connecting a server', () => {
    it('reads the list now, whatever the cache holds, keeps it and saves it', async () => {
        pages = [answer([tool('a')])];
        await discover();
        pages = [answer([tool('a'), tool('b')])];
        const outcome = await MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin');
        expect(outcome).toMatchObject({ read: true, tools: 2, saved: { result: 'saved' } });
        expect(saved.at(-1)!.tools.map((t) => t.name)).toEqual(['a', 'b']);
        pages = [];
        expect((await discover()).tools.map((t) => t.function.name)).toEqual(['a', 'b']);
    });

    it('says so when the bot has no such server or the server does not answer', async () => {
        expect(await MCPConnector.refreshServerTools('bot-1', 'nope', ORBIT, 'admin')).toBeNull();
        http.post.mockImplementation(async (_url: string, body: { method: string }) => {
            if (body.method === 'initialize') return { data: { jsonrpc: '2.0', id: 'init', result: {} }, headers: {} };
            throw Object.assign(new Error('503'), { isAxiosError: true, response: { status: 503 } });
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await MCPConnector.refreshServerTools('bot-1', 'srv-1', ORBIT, 'admin')).toMatchObject({ read: false });
    });
});
