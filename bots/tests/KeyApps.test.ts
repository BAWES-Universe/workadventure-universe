/**
 * Apps with a key (game #2044), bot server side: the list Orbit gives is read defensively, the operations become tools with no way
 * in, and a call goes through Orbit and comes back as words the model can use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { answerOf, callKeyApp, keyAppTools, loadKeyApps, parseKeyApps } from '../mcp/KeyApps';
import { MCPConnector } from '../mcp/MCPConnector';

vi.mock('../ai/encryption', () => ({ decryptApiKey: (val: string | null | undefined) => val || null }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isCancel: vi.fn(), isAxiosError: vi.fn() } }));
const http = vi.mocked(axios, true);
http.isAxiosError.mockImplementation((err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true);

const ORBIT = 'https://orbit.test';
const SCHEMA = { type: 'object', properties: { chargeId: { type: 'string', maxLength: 80 } }, required: ['chargeId'], additionalProperties: false };
const op = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `Do ${id}`, category: 'lookUp', heading: 'looksUp', verified: true, inputSchema: SCHEMA, tool: `tap_${id.toLowerCase()}`, fingerprint: `fp-${id}`, ...extra });
const APP = {
    serverId: 'grant-1',
    connectionId: 'conn-1',
    name: 'Tap Payments',
    short: 'Tap',
    definitionHash: 'a'.repeat(64),
    enabled: true,
    working: true,
    settings: { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' },
    operations: [op('lookUpPayment'), op('makePaymentLink', { category: 'make', heading: 'makesNew' })],
};
const entryFor = (name: string) => keyAppTools(parseKeyApps({ apps: [APP] })).entries.get(name)!;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('reading the list', () => {
    it('keeps what is usable and drops the rest', () => {
        const apps = parseKeyApps({ apps: [APP, { serverId: 1 }, null, { ...APP, serverId: 'g2', operations: [op('ok'), { id: 'x' }, op('bad name', { tool: 'has spaces' }), op('noprint', { fingerprint: undefined })] }] });
        expect(apps.map((app) => [app.serverId, app.operations.map((operation) => operation.tool)])).toEqual([
            ['grant-1', ['tap_lookuppayment', 'tap_makepaymentlink']],
            ['g2', ['tap_ok']],
        ]);
    });

    it.each([[null], [undefined], ['x'], [{}], [{ apps: 'no' }], [{ apps: [] }]])('reads %j as no apps', (data) => {
        expect(parseKeyApps(data)).toEqual([]);
    });

    it('asks Orbit with the service token, and gives none when it cannot', async () => {
        http.get.mockResolvedValueOnce({ status: 200, data: { apps: [APP] } });
        expect(await loadKeyApps('bot-1', ORBIT, 'svc')).toHaveLength(1);
        expect(http.get).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/key-apps`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer svc' }) }));
        http.get.mockRejectedValueOnce(new Error('down'));
        expect(await loadKeyApps('bot-1', ORBIT, 'svc')).toEqual([]);
        http.get.mockResolvedValueOnce({ status: 404, data: { error: 'no' } });
        expect(await loadKeyApps('bot-1', ORBIT, 'svc')).toEqual([]);
        expect(await loadKeyApps('bot-1', ORBIT, '')).toEqual([]);
    });
});

describe('the tools', () => {
    it('are the operations, with the schema Orbit gave and no way in', () => {
        const { tools, entries } = keyAppTools(parseKeyApps({ apps: [APP] }));
        expect(tools.map((tool) => tool.function.name)).toEqual(['tap_lookuppayment', 'tap_makepaymentlink']);
        expect(tools[0].function.parameters).toEqual(SCHEMA);
        const entry = entries.get('tap_lookuppayment')!;
        expect(entry).toMatchObject({ serverId: 'grant-1', serverUrl: '', authType: 'none', fingerprint: 'fp-lookUpPayment', connectionId: 'conn-1', keyApp: { definitionHash: 'a'.repeat(64), operation: 'lookUpPayment' } });
        expect(entry.authConfig).toBeUndefined();
        expect(entry.headers).toBeUndefined();
        expect(JSON.stringify([tools, [...entries.values()]])).not.toMatch(/https?:\/\//);
    });

    it('are left out for an App that is off or whose key stopped working', () => {
        expect(keyAppTools(parseKeyApps({ apps: [{ ...APP, enabled: false }] })).tools).toEqual([]);
        expect(keyAppTools(parseKeyApps({ apps: [{ ...APP, working: false }] })).tools).toEqual([]);
    });

    it('never offer one name twice', () => {
        const { tools } = keyAppTools(parseKeyApps({ apps: [APP, { ...APP, serverId: 'g2', connectionId: 'c2' }] }));
        expect(tools).toHaveLength(2);
    });
});

describe('discovering a Brick’s tools', () => {
    it('adds the key apps even when it has no MCP servers', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/mcp-servers')) throw Object.assign(new Error('none'), { isAxiosError: true, response: { status: 404 } });
            if (url.endsWith('/key-apps')) return { status: 200, data: { apps: [APP] } };
            throw new Error(`Unexpected GET ${url}`);
        });
        const found = await MCPConnector.discoverToolsWithMapping('bot-1', ORBIT, 'admin', 'svc');
        expect(found.tools.map((tool) => tool.function.name)).toEqual(['tap_lookuppayment', 'tap_makepaymentlink']);
        expect(found.toolServerMap.get('tap_makepaymentlink')?.keyApp?.operation).toBe('makePaymentLink');
    });

    it('keeps an MCP tool that has the same name, and adds the rest', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/mcp-servers')) return { data: [] };
            if (url.endsWith('/key-apps')) return { status: 200, data: { apps: [APP] } };
            throw new Error(`Unexpected GET ${url}`);
        });
        const found = await MCPConnector.discoverToolsWithMapping('bot-1', ORBIT, 'admin', 'svc');
        expect(found.tools).toHaveLength(2);
    });
});

describe('a call', () => {
    const use = { botId: 'bot-1', requesterKey: 'sara-uuid', callId: 'call-1' };
    const where = { adminApiUrl: ORBIT, serviceToken: 'svc' };

    it('goes to Orbit with the operation, the arguments, the version and who asked, and nothing else', async () => {
        http.post.mockResolvedValueOnce({ status: 200, data: { ok: true, httpStatus: 200, data: { id: 'chg_1', status: 'CAPTURED' }, truncated: false } });
        const result = await callKeyApp(where, entryFor('tap_lookuppayment'), { chargeId: 'chg_1' }, use);
        expect(result).toEqual({ id: 'chg_1', status: 'CAPTURED' });
        expect(http.post).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/key-apps/grant-1/call`, { callId: 'call-1', operation: 'lookUpPayment', arguments: { chargeId: 'chg_1' }, definitionHash: 'a'.repeat(64), requesterKey: 'sara-uuid' }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer svc' }) }));
    });

    it('says it works for its owner on its own only when told so', async () => {
        http.post.mockResolvedValueOnce({ status: 200, data: { ok: true, data: {} } });
        await callKeyApp(where, entryFor('tap_lookuppayment'), {}, { botId: 'bot-1', callId: 'c', forOwner: true });
        expect(http.post.mock.calls[0][1]).toMatchObject({ forOwner: true });
        expect(http.post.mock.calls[0][1]).not.toHaveProperty('requesterKey');
    });

    it('is never sent for a tool that is not a key app, or without a token', async () => {
        expect(await callKeyApp(where, { serverId: 's', serverUrl: 'https://x.test', authType: 'none' }, {}, use)).toMatchObject({ outcome: 'not_sent' });
        expect(await callKeyApp({ adminApiUrl: ORBIT, serviceToken: '' }, entryFor('tap_lookuppayment'), {}, use)).toMatchObject({ outcome: 'not_sent' });
        expect(http.post).not.toHaveBeenCalled();
    });

    it('does not claim it did not run when Orbit could not be reached', async () => {
        http.post.mockRejectedValueOnce(new Error('timeout'));
        const result = (await callKeyApp(where, entryFor('tap_makepaymentlink'), {}, use)) as { error: string; outcome?: string };
        expect(result.error).toMatch(/couldn't tell whether/);
        expect(result.outcome).toBeUndefined();
    });
});

describe('what the model is told', () => {
    it('is only the fields Orbit sent, with a note when the answer was cut', () => {
        expect(answerOf(200, { ok: true, data: { id: 'x' }, truncated: true })).toEqual({ id: 'x', note: 'The answer was too long to read in full.' });
        expect(answerOf(200, { ok: true, data: null })).toEqual({ done: true });
    });

    it('is a proven failure, with a status and none of what the service wrote, when the service says no', () => {
        const result = answerOf(200, { ok: false, httpStatus: 422, data: null }) as { error: string; outcome: string };
        expect(result.outcome).toBe('failed');
        expect(result.error).toContain('422');
    });

    it('is plain words for every way Orbit can refuse', () => {
        const cases: Array<[number, Record<string, unknown>, string | undefined]> = [
            [403, { allowed: false, reason: 'not_owner' }, 'not_sent'],
            [403, { allowed: false, reason: 'off' }, 'not_sent'],
            [403, { allowed: false, reason: 'something odd' }, 'not_sent'],
            [404, { code: 'unknown_operation' }, 'not_sent'],
            [404, {}, 'not_sent'],
            [409, { code: 'changed' }, 'not_sent'],
            [400, { code: 'bad_arguments', error: 'amount is required' }, 'not_sent'],
            [429, { code: 'limit' }, 'not_sent'],
            [502, { code: 'key_rejected' }, 'failed'],
            [502, { code: 'unavailable' }, 'failed'],
            [500, {}, 'not_sent'],
        ];
        for (const [status, body, outcome] of cases) {
            const result = answerOf(status, body) as { error: string; outcome: string };
            expect(result.error.length).toBeGreaterThan(10);
            expect(result.outcome).toBe(outcome);
        }
    });

    it('treats a call that was already made as done, so a retry never makes a second one', () => {
        expect(answerOf(409, { code: 'already_asked' })).toMatchObject({ done: true });
    });

    it('never says an address, a key or an app’s inside', () => {
        for (const status of [200, 400, 403, 404, 409, 429, 500, 502]) expect(JSON.stringify(answerOf(status, { code: 'x', error: 'bad' }))).not.toMatch(/https?:\/\/|sk_|Bearer/);
    });
});
