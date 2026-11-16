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
const WAIT = 90_000;
const SCHEMA = { type: 'object', properties: { chargeId: { type: 'string', maxLength: 80 } }, required: ['chargeId'], additionalProperties: false };
const op = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `Do ${id}`, category: 'lookUp', heading: 'looksUp', verified: true, inputSchema: SCHEMA, tool: `example_${id.toLowerCase()}`, fingerprint: `fp-${id}`, ...extra });
const APP = {
    serverId: 'grant-1',
    connectionId: 'conn-1',
    name: 'Example Pay',
    short: 'Example',
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
            ['grant-1', ['example_lookuppayment', 'example_makepaymentlink']],
            ['g2', ['example_ok']],
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
        expect(tools.map((tool) => tool.function.name)).toEqual(['example_lookuppayment', 'example_makepaymentlink']);
        expect(tools[0].function.parameters).toEqual(SCHEMA);
        const entry = entries.get('example_lookuppayment')!;
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
        expect(found.tools.map((tool) => tool.function.name)).toEqual(['example_lookuppayment', 'example_makepaymentlink']);
        expect(found.toolServerMap.get('example_makepaymentlink')?.keyApp?.operation).toBe('makePaymentLink');
    });

    it('keeps an MCP tool that has the same name, and adds the rest', async () => {
        const mcpTool = { type: 'function', function: { name: 'example_lookuppayment', description: 'From the MCP server', parameters: { type: 'object', properties: {} } } };
        const mcpEntry = { serverId: 'mcp-1', serverUrl: 'https://mcp.test', authType: 'none' as const };
        const found = await (MCPConnector as unknown as { withKeyApps: (keyApps: Promise<ReturnType<typeof parseKeyApps>>, found: unknown) => Promise<{ tools: Array<{ function: { name: string; description: string } }>; toolServerMap: Map<string, { serverId: string; keyApp?: unknown }> }> }).withKeyApps(Promise.resolve(parseKeyApps({ apps: [APP] })), {
            tools: [mcpTool],
            toolServerMap: new Map([['example_lookuppayment', mcpEntry]]),
        });
        // The name is there once, still the MCP server's; the other key-App operation is added
        expect(found.tools.map((tool) => tool.function.name).sort()).toEqual(['example_lookuppayment', 'example_makepaymentlink']);
        expect(found.tools.find((tool) => tool.function.name === 'example_lookuppayment')?.function.description).toBe('From the MCP server');
        expect(found.toolServerMap.get('example_lookuppayment')).toMatchObject({ serverId: 'mcp-1' });
        expect(found.toolServerMap.get('example_lookuppayment')?.keyApp).toBeUndefined();
        expect(found.toolServerMap.get('example_makepaymentlink')?.keyApp).toBeDefined();
    });
});

describe('a call', () => {
    const use = { botId: 'bot-1', requesterKey: 'sara-uuid', callId: 'call-1' };
    const where = { adminApiUrl: ORBIT, serviceToken: 'svc' };

    it('goes to Orbit with the operation, the arguments, the version and who asked, and nothing else', async () => {
        http.post.mockResolvedValueOnce({ status: 200, data: { ok: true, httpStatus: 200, data: { id: 'chg_1', status: 'CAPTURED' }, truncated: false } });
        const result = await callKeyApp(where, entryFor('example_lookuppayment'), { chargeId: 'chg_1' }, use, undefined, WAIT);
        expect(result).toEqual({ id: 'chg_1', status: 'CAPTURED' });
        expect(http.post).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/key-apps/grant-1/call`, { callId: 'call-1', operation: 'lookUpPayment', arguments: { chargeId: 'chg_1' }, definitionHash: 'a'.repeat(64), requesterKey: 'sara-uuid' }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer svc' }) }));
    });

    it('says it works for its owner on its own only when told so', async () => {
        http.post.mockResolvedValueOnce({ status: 200, data: { ok: true, data: {} } });
        await callKeyApp(where, entryFor('example_lookuppayment'), {}, { botId: 'bot-1', callId: 'c', forOwner: true }, undefined, WAIT);
        expect(http.post.mock.calls[0][1]).toMatchObject({ forOwner: true });
        expect(http.post.mock.calls[0][1]).not.toHaveProperty('requesterKey');
    });

    it('is never sent for a tool that is not a key app, or without a token', async () => {
        expect(await callKeyApp(where, { serverId: 's', serverUrl: 'https://x.test', authType: 'none' }, {}, use, undefined, WAIT)).toMatchObject({ outcome: 'not_sent' });
        expect(await callKeyApp({ adminApiUrl: ORBIT, serviceToken: '' }, entryFor('example_lookuppayment'), {}, use, undefined, WAIT)).toMatchObject({ outcome: 'not_sent' });
        expect(http.post).not.toHaveBeenCalled();
    });

    it('sends nothing when the turn was stopped first, and says so as proof it did not run', async () => {
        const stopped = new AbortController();
        stopped.abort();
        const result = (await callKeyApp(where, entryFor('example_makepaymentlink'), {}, use, stopped.signal, WAIT)) as { error: string; outcome?: string };
        expect(result.outcome).toBe('not_sent');
        expect(http.post).not.toHaveBeenCalled();
    });

    it('hands the turn’s stop signal to the request, and a stop after it was sent is not proof it did not run', async () => {
        const turn = new AbortController();
        http.post.mockImplementationOnce(async (_url: string, _body: unknown, config: { signal?: AbortSignal }) => {
            expect(config.signal).toBe(turn.signal);
            turn.abort();
            throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
        });
        const result = (await callKeyApp(where, entryFor('example_makepaymentlink'), {}, use, turn.signal, WAIT)) as { error: string; outcome?: string };
        expect(result.error).toMatch(/couldn't tell whether/);
        expect(result.outcome).toBeUndefined();
    });

    it('waits as long as it was told to: the bot’s Patience, or the default the other tools have', async () => {
        http.post.mockResolvedValue({ status: 200, data: { ok: true, data: {} } });
        await callKeyApp(where, entryFor('example_lookuppayment'), {}, use, undefined, 300_000);
        await callKeyApp(where, entryFor('example_lookuppayment'), {}, { ...use, callId: 'c2' }, undefined, 90_000);
        expect(http.post.mock.calls[0][2]).toMatchObject({ timeout: 300_000 });
        expect(http.post.mock.calls[1][2]).toMatchObject({ timeout: 90_000 });
    });

    it('does not claim it did not run when Orbit could not be reached', async () => {
        http.post.mockRejectedValueOnce(new Error('timeout'));
        const result = (await callKeyApp(where, entryFor('example_makepaymentlink'), {}, use, undefined, WAIT)) as { error: string; outcome?: string };
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
            // Orbit may have sent it and lost the answer: never said to be undone
            [502, { code: 'unavailable' }, undefined],
            // Any server error may have come after the request was sent on: never said to be undone
            [500, {}, undefined],
            [503, {}, undefined],
            [504, { code: 'timeout' }, undefined],
            [503, { code: 'key_rejected' }, 'failed'],
        ];
        for (const [status, body, outcome] of cases) {
            const result = answerOf(status, body) as { error: string; outcome?: string };
            expect(result.error.length).toBeGreaterThan(10);
            expect(result.outcome).toBe(outcome);
        }
    });

    it('treats a call that was already made as done, so a retry never makes a second one', () => {
        expect(answerOf(409, { code: 'already_asked' })).toMatchObject({ done: true });
    });

    it('never says an address, a key or an app’s inside', () => {
        for (const status of [200, 400, 403, 404, 409, 429, 500, 502, 503, 504]) expect(JSON.stringify(answerOf(status, { code: 'x', error: 'bad' }))).not.toMatch(/https?:\/\/|sk_|Bearer/);
    });
});

import { ASK_FOR_KEY_TOOL, PAYMENT_TOOL, keyAppsNote, keyToolDefinitions, runKeyTool, isKeyTool } from '../ai/KeyTools';

describe('the two tools of a Brick for keys', () => {
    const apps = parseKeyApps({ apps: [{ ...APP, payments: true }] });
    const context = { where: { adminApiUrl: ORBIT, serviceToken: 'svc' }, botId: 'bot-1', userId: 'sara-uuid', apps };

    it('are named and described without ever asking for a key in the chat', () => {
        expect(keyToolDefinitions().map((tool) => tool.function.name)).toEqual([ASK_FOR_KEY_TOOL, PAYMENT_TOOL]);
        expect(isKeyTool('ask_for_key') && isKeyTool('take_payments_on_page') && !isKeyTool('offer_app')).toBe(true);
        expect(keyToolDefinitions()[0].function.description).toMatch(/NEVER ask them to type or paste a key into the chat/);
    });

    it('teach the model to write a setup for any payment gateway from its docs, not a particular one', () => {
        const props = (keyToolDefinitions()[0].function.parameters as { properties: { draft: { description: string } } }).properties;
        expect(props.draft.description).toMatch(/payment\? only for a payment gateway/);
        expect(props.draft.description).toMatch(/successStates/);
        expect(props.draft.description).toMatch(/never guess a state, a path or a host/);
        expect(JSON.stringify(keyToolDefinitions())).not.toMatch(/\bTap\b/);
    });

    it('lead to the form with a link and give the model no key', async () => {
        http.post.mockResolvedValueOnce({ status: 201, data: { id: 'form-123', replacing: false } });
        const result = (await runKeyTool(ASK_FOR_KEY_TOOL, { service: 'examplepay' }, context)) as { shown: boolean; note: string };
        expect(result.shown).toBe(true);
        expect(result.note).toContain('(#key-form=form-123)');
        expect(http.post).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/app-key-forms`, { requesterKey: 'sara-uuid', service: 'examplepay' }, expect.anything());
    });

    it('send a draft only with the docs it came from, and say plainly when Orbit refuses it', async () => {
        expect(await runKeyTool(ASK_FOR_KEY_TOOL, { draft: { name: 'X' } }, context)).toHaveProperty('error');
        expect(http.post).not.toHaveBeenCalled();
        http.post.mockResolvedValueOnce({ status: 400, data: { error: 'The setup is not valid' } });
        expect(((await runKeyTool(ASK_FOR_KEY_TOOL, { draft: { name: 'X', short: 'X' }, source: 'https://docs.x.com' }, context)) as { error: string }).error).toContain('not valid');
        http.post.mockResolvedValueOnce({ status: 404, data: {} });
        expect(await runKeyTool(ASK_FOR_KEY_TOOL, { service: 'examplepay' }, context)).toHaveProperty('error');
        http.post.mockRejectedValueOnce(new Error('down'));
        expect(((await runKeyTool(ASK_FOR_KEY_TOOL, { service: 'examplepay' }, context)) as { error: string }).error).toMatch(/Do not ask them for the key/);
    });

    it('never follow a form id that is not a plain id', async () => {
        http.post.mockResolvedValueOnce({ status: 201, data: { id: 'x)](https://evil.test)' } });
        expect(await runKeyTool(ASK_FOR_KEY_TOOL, { service: 'examplepay' }, context)).toHaveProperty('error');
    });

    it('set up a payment through an App that can take one, with the amount as text', async () => {
        http.post.mockResolvedValueOnce({ status: 200, data: { job: { amount: '4.500', currency: 'KWD', app: 'Example Pay' } } });
        const result = (await runKeyTool(PAYMENT_TOOL, { artifact: 'art-1', app: 'example', amount: '4.500', currency: 'KWD' }, context)) as { done: boolean; amount: string };
        expect(result).toMatchObject({ done: true, amount: '4.500 KWD' });
        expect(http.post).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/key-apps/grant-1/page-jobs`, { requesterKey: 'sara-uuid', artifactId: 'art-1', amount: '4.500', currency: 'KWD' }, expect.anything());
    });

    it('refuse a currency that is not exactly three letters, instead of cutting it to fit', async () => {
        for (const currency of ['USDT', 'US', '', 'K W', 'U$D', undefined, 3]) {
            const result = (await runKeyTool(PAYMENT_TOOL, { artifact: 'art-1', app: 'example', amount: '4.500', currency }, context)) as { error?: string };
            expect(result.error).toMatch(/three-letter/);
        }
        expect(http.post).not.toHaveBeenCalled();
        // Spaces around a good code are only trimmed
        http.post.mockResolvedValueOnce({ status: 200, data: { job: { amount: '4.500', currency: 'KWD', app: 'Example Pay' } } });
        await runKeyTool(PAYMENT_TOOL, { artifact: 'art-1', app: 'example', amount: '4.500', currency: ' KWD ' }, context);
        expect(http.post.mock.calls[0][1]).toMatchObject({ currency: 'KWD' });
    });

    it('do not set up a payment through an App that cannot take one, or is off', async () => {
        const none = { ...context, apps: parseKeyApps({ apps: [{ ...APP, payments: false }, { ...APP, serverId: 'g2', payments: true, enabled: false }] }) };
        expect(await runKeyTool(PAYMENT_TOOL, { artifact: 'a', app: 'example', amount: '1', currency: 'KWD' }, none)).toHaveProperty('error');
        expect(http.post).not.toHaveBeenCalled();
    });

    it('do not set up a payment through an App whose key stopped working, and say what to do', async () => {
        const broken = { ...context, apps: parseKeyApps({ apps: [{ ...APP, working: false, payments: true }] }) };
        const result = (await runKeyTool(PAYMENT_TOOL, { artifact: 'a', app: 'example', amount: '1', currency: 'KWD' }, broken)) as { error: string };
        expect(result.error).toMatch(/Replace key/);
        expect(http.post).not.toHaveBeenCalled();
    });

    it('say what Orbit said no to in words', async () => {
        for (const [status, match] of [[404, /not a page of theirs/], [403, /Only the owner/], [400, /Nothing was set up/]] as const) {
            http.post.mockResolvedValueOnce({ status, data: { error: 'The amount must be more than zero' } });
            expect(((await runKeyTool(PAYMENT_TOOL, { artifact: 'a', app: 'example', amount: '0', currency: 'KWD' }, context)) as { error: string }).error).toMatch(match);
        }
    });

    it('give a note that names the Apps they have and never asks for a key', () => {
        const note = keyAppsNote(apps, [{ service: 'examplepay', name: 'Example Pay', short: 'Example' }]);
        expect(note).toContain('Example Pay (service examplepay)');
        expect(note).toContain('- Example (can take payments for a page)');
        expect(note).toMatch(/Never ask for a key in the chat/);
        expect(keyAppsNote(parseKeyApps({ apps: [{ ...APP, working: false }] }), [])).toContain('Replace key');
    });
});
