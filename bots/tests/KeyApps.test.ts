/**
 * Apps with a key (game #2044), bot server side: the list Orbit gives is read defensively, the operations become tools with no way
 * in, and a call goes through Orbit and comes back as words the model can use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { answerOf, callKeyApp, keyAppTools, loadKeyApps, parseKeyApps } from '../mcp/KeyApps';
import { MCPConnector } from '../mcp/MCPConnector';
import { resultOf } from '../ai/ToolSteps';

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

    it('takes a name from a ready-made App, and keeps that App beside it so its own actions still go through it (own Apps first)', async () => {
        const readyTool = { type: 'function', function: { name: 'example_lookuppayment', description: 'From the ready-made App', parameters: { type: 'object', properties: {} } } };
        const calendar = { serverId: 'cal-1', serverUrl: 'https://link.test', authType: 'none' as const, serverName: 'Google Calendar', readyMade: true };
        const gmail = { serverId: 'gmail-1', serverUrl: 'https://link.test', authType: 'none' as const, serverName: 'Gmail', readyMade: true, otherApps: [calendar] };
        const found = await (MCPConnector as unknown as { withKeyApps: (keyApps: Promise<ReturnType<typeof parseKeyApps>>, found: unknown) => Promise<{ tools: Array<{ function: { name: string; description: string } }>; toolServerMap: Map<string, { serverId: string; keyApp?: unknown; otherApps?: Array<{ serverId: string; otherApps?: unknown }> }> }> }).withKeyApps(Promise.resolve(parseKeyApps({ apps: [APP] })), {
            tools: [readyTool],
            toolServerMap: new Map([['example_lookuppayment', gmail]]),
        });
        // The name is there once, now the key App's; both ready-made Apps are kept beside it, each once
        expect(found.tools.filter((tool) => tool.function.name === 'example_lookuppayment')).toHaveLength(1);
        expect(found.tools.find((tool) => tool.function.name === 'example_lookuppayment')?.function.description).not.toBe('From the ready-made App');
        const entry = found.toolServerMap.get('example_lookuppayment');
        expect(entry?.keyApp).toBeDefined();
        expect(entry?.otherApps?.map((app) => app.serverId)).toEqual(['gmail-1', 'cal-1']);
        expect(entry?.otherApps?.[0].otherApps).toBeUndefined();
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
        expect(result.outcome).toBe('uncertain');
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
        expect(result.outcome).toBe('uncertain');
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
            [502, { code: 'unavailable' }, 'uncertain'],
            // Any server error may have come after the request was sent on: never said to be undone
            [500, {}, 'uncertain'],
            [503, {}, 'uncertain'],
            [504, { code: 'timeout' }, 'uncertain'],
            [503, { code: 'key_rejected' }, 'failed'],
        ];
        for (const [status, body, outcome] of cases) {
            const result = answerOf(status, body) as { error: string; outcome?: string };
            expect(result.error.length).toBeGreaterThan(10);
            expect(result.outcome).toBe(outcome);
        }
    });

    it('shows a server error as not known, never as failed: the step cannot say it did not work', () => {
        for (const status of [500, 502, 503, 504]) expect(resultOf('step', answerOf(status, {}))).toMatchObject({ ok: false, unknown: true });
        // A key the service refused is proven
        expect(resultOf('step', answerOf(503, { code: 'key_rejected' }))).toEqual(expect.not.objectContaining({ unknown: true }));
    });

    it('says "paused" kindly, not "gone", when Orbit refuses with the team\'s pause', () => {
        const result = answerOf(403, { allowed: false, reason: 'paused' }) as { error: string; outcome?: string };
        expect(result.error).toContain('paused for a while');
        expect(result.error).not.toMatch(/any more/);
        expect(result.outcome).toBe('not_sent');
    });

    it('treats a call that was already made as done, so a retry never makes a second one', () => {
        expect(answerOf(409, { code: 'already_asked' })).toMatchObject({ done: true });
    });

    it('never says an address, a key or an app’s inside', () => {
        for (const status of [200, 400, 403, 404, 409, 429, 500, 502, 503, 504]) expect(JSON.stringify(answerOf(status, { code: 'x', error: 'bad' }))).not.toMatch(/https?:\/\/|sk_|Bearer/);
    });
});

import { ASK_FOR_KEY_TOOL, PAYMENT_TOOL, keyAppsNote, keyToolDefinitions, minorUnitsOf, runKeyTool, isKeyTool } from '../ai/KeyTools';

describe('the two tools of a Brick for keys', () => {
    const apps = parseKeyApps({ apps: [{ ...APP, payments: true }] });
    const context = { where: { adminApiUrl: ORBIT, serviceToken: 'svc' }, botId: 'bot-1', userId: 'sara-uuid', apps };
    /** A page job as Orbit saves it (canonical form): KWD has three decimals, so 4.500 is 4500. */
    const saved = (over: Record<string, unknown> = {}) => ({ id: 'job-1', artifactId: 'art-1', connectionId: 'conn-1', app: 'Example Pay', amount: '4.500', amountMinor: 4500, currency: 'KWD', exponent: 3, description: null, status: 'active', active: true, ...over });

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
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
        const result = (await runKeyTool(PAYMENT_TOOL, { artifact: 'art-1', app: 'example', amount: '4.500', currency: 'KWD' }, context)) as { done: boolean; amount: string };
        expect(result).toMatchObject({ done: true, amount: '4.500 KWD' });
        expect(http.get).not.toHaveBeenCalled();
        expect(http.post).toHaveBeenCalledWith(`${ORBIT}/api/bots/bot-1/key-apps/grant-1/page-jobs`, { requesterKey: 'sara-uuid', artifactId: 'art-1', amount: '4.500', currency: 'KWD' }, expect.anything());
    });

    it('refuse a currency that is not exactly three letters, instead of cutting it to fit', async () => {
        for (const currency of ['USDT', 'US', '', 'K W', 'U$D', undefined, 3]) {
            const result = (await runKeyTool(PAYMENT_TOOL, { artifact: 'art-1', app: 'example', amount: '4.500', currency }, context)) as { error?: string };
            expect(result.error).toMatch(/three-letter/);
        }
        expect(http.post).not.toHaveBeenCalled();
        // Spaces around a good code are only trimmed
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
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

    const args = { artifact: 'art-1', app: 'example', amount: '4.500', currency: 'KWD' };
    const ask = (over: Record<string, unknown> = {}) => runKeyTool(PAYMENT_TOOL, { ...args, ...over }, context) as Promise<{ done?: boolean; amount?: string; error?: string }>;

    it('says "done" only when the saved job is the page, the App\'s connection, the amount in minor units, the currency, and it is on', async () => {
        // "4.5" and "4.500" KWD are the same 4500
        for (const amount of ['4.5', '4.500', '04.500']) {
            http.post.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
            expect(await ask({ amount })).toMatchObject({ done: true });
        }
        // JPY has no decimals, USD two: GPT's 99.00 USD is 9900
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved({ amount: '500', amountMinor: 500, currency: 'JPY', exponent: 0 }) } });
        expect(await ask({ amount: '500', currency: 'jpy' })).toMatchObject({ done: true, amount: '500 JPY' });
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved({ amount: '99.00', amountMinor: 9900, currency: 'USD', exponent: 2 }) } });
        expect(await ask({ amount: '99.00', currency: 'USD' })).toMatchObject({ done: true, amount: '99.00 USD' });
        expect(http.get).not.toHaveBeenCalled();
    });

    it('reads back once, and never writes again, when the saved job is not what was asked for: not confirmed, with the approved words', async () => {
        const differs: Record<string, unknown>[] = [
            { amountMinor: 450, amount: '0.450' }, // a hundredth of the price
            { amountMinor: 99000, amount: '99.000' }, // GPT's 99.00 USD that was saved as ten times 9.90
            { currency: 'USD', exponent: 2 },
            { artifactId: 'another-page' },
            { connectionId: 'conn-2' },
            { active: false, status: 'inactive' },
        ];
        for (const over of differs) {
            http.post.mockClear();
            http.get.mockClear();
            http.post.mockResolvedValueOnce({ status: 200, data: { job: saved(over) } });
            // The read-back says the same: it is still not what was asked for
            http.get.mockResolvedValueOnce({ status: 200, data: { job: saved(over) } });
            const result = await ask();
            expect(result).not.toHaveProperty('done');
            expect(result.error).toMatch(/not confirmed/);
            expect(result.error).toContain("What was saved doesn't match 4.500 KWD, so I didn't set it up again. Please open the page and check the price before you share it.");
            expect(http.post).toHaveBeenCalledTimes(1);
            expect(http.get).toHaveBeenCalledTimes(1);
            expect(http.get.mock.calls[0][0]).toBe(`${ORBIT}/api/bots/bot-1/key-apps/grant-1/page-jobs`);
            expect(http.get.mock.calls[0][1]).toMatchObject({ params: { artifactId: 'art-1' } });
        }
    });

    it('does not call a setup done when a timed-out write changed only the description and the read-back still holds the old one', async () => {
        const described = () => ask({ description: 'Join the club' });
        // The read-back holds the same page, App, amount and currency, with the description it had before
        http.post.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));
        http.get.mockResolvedValueOnce({ status: 200, data: { job: saved({ description: 'Old text' }) } });
        const stale = await described();
        expect(stale).not.toHaveProperty('done');
        expect(stale.error).toMatch(/not confirmed/);
        expect(http.post).toHaveBeenCalledTimes(1);

        // With the description that was asked for, it is done
        http.post.mockClear();
        http.post.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));
        http.get.mockResolvedValueOnce({ status: 200, data: { job: saved({ description: 'Join the club' }) } });
        expect(await described()).toMatchObject({ done: true });
        expect(http.post).toHaveBeenCalledTimes(1);

        // A read-back that does not carry the description cannot confirm one that was asked for
        http.post.mockClear();
        http.post.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));
        const { description: _gone, ...without } = saved();
        http.get.mockResolvedValueOnce({ status: 200, data: { job: without } });
        expect(await described()).not.toHaveProperty('done');

        // None asked for: what the job holds is not compared
        http.post.mockClear();
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved({ description: 'Old text' }) } });
        expect(await ask()).toMatchObject({ done: true });
    });

    it('compares a long description as Orbit stores it: cut at 200 characters and trimmed, so a cut just after a space still matches', async () => {
        // Cut at 200 it ends in a space, which Orbit's fitWords does not keep
        const long = `${'a'.repeat(199)} and some more words after the cut`;
        http.post.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));
        http.get.mockResolvedValueOnce({ status: 200, data: { job: saved({ description: 'a'.repeat(199) }) } });
        expect(await ask({ description: long })).toMatchObject({ done: true });
        expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('takes the read-back as the answer when the write gave none that was whole: no second write either way', async () => {
        const unclear: unknown[] = [new Error('timeout of 15000ms exceeded'), { status: 502, data: {} }, { status: 200, data: {} }, { status: 200, data: { job: {} } }, { status: 200, data: { job: { amount: '4.500', currency: 'KWD', app: 'Example Pay' } } }, { status: 200, data: { job: null } }];
        for (const first of unclear) {
            http.post.mockClear();
            http.get.mockClear();
            if (first instanceof Error) http.post.mockRejectedValueOnce(first);
            else http.post.mockResolvedValueOnce(first as never);
            // It was made after all: the read-back says so
            http.get.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
            expect(await ask()).toMatchObject({ done: true, amount: '4.500 KWD' });
            expect(http.post).toHaveBeenCalledTimes(1);
            expect(http.get).toHaveBeenCalledTimes(1);

            // Nothing is found, or the read-back gives no clear answer either: not confirmed, never "nothing was set up", never a blind retry
            for (const read of [{ status: 404, data: { code: 'not_found' } }, { status: 500, data: {} }, new Error('down'), undefined]) {
                http.post.mockClear();
                http.get.mockClear();
                if (first instanceof Error) http.post.mockRejectedValueOnce(first);
                else http.post.mockResolvedValueOnce(first as never);
                if (read instanceof Error) http.get.mockRejectedValueOnce(read);
                else http.get.mockResolvedValueOnce(read as never);
                const result = await ask();
                expect(result).not.toHaveProperty('done');
                expect(result.error).toMatch(/not confirmed/);
                expect(result.error).toMatch(/do not set it up again/i);
                expect(result.error).not.toMatch(/offer to try again/);
                expect(http.post).toHaveBeenCalledTimes(1);
                expect(http.get).toHaveBeenCalledTimes(1);
            }
        }
        // No clear answer anywhere: the other approved words
        http.post.mockRejectedValueOnce(new Error('timeout'));
        http.get.mockResolvedValueOnce({ status: 404, data: {} });
        expect((await ask()).error).toContain("No clear answer came back, so I can't confirm the payment setup. I didn't set it up again. Please open the page and check it.");
    });

    it('says plainly that nothing was set up when Orbit refuses the write, and reads nothing back; a text that is not an amount is never "done"', async () => {
        for (const [status, expected] of [[404, /not a page of theirs/], [403, /Only the owner/], [400, /Nothing was set up/]] as const) {
            http.post.mockResolvedValueOnce({ status, data: { error: 'No.' } });
            expect((await ask()).error).toMatch(expected);
        }
        expect(http.get).not.toHaveBeenCalled();
        // An amount that is not a number: Orbit would refuse it, and if it saved anything, that is not "done"
        http.post.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
        http.get.mockResolvedValueOnce({ status: 200, data: { job: saved() } });
        const oops = await ask({ amount: 'oops' });
        expect(oops).not.toHaveProperty('done');
        expect(oops.error).toMatch(/not confirmed/);
    });

    it('turns an amount into the smallest unit of its currency without ever rounding', () => {
        expect(minorUnitsOf('4.5', 3)).toBe(4500);
        expect(minorUnitsOf('4.500', 3)).toBe(4500);
        expect(minorUnitsOf('19.99', 2)).toBe(1999);
        expect(minorUnitsOf('99', 2)).toBe(9900);
        expect(minorUnitsOf('500', 0)).toBe(500);
        // Zeros past the decimals change nothing; any other digit is an amount the currency cannot hold
        expect(minorUnitsOf('500.00', 0)).toBe(500);
        expect(minorUnitsOf('4.5000', 3)).toBe(4500);
        expect(minorUnitsOf('4.5001', 3)).toBeNull();
        expect(minorUnitsOf('0.005', 2)).toBeNull();
        for (const bad of ['oops', '', '-1', '1,5', '1e3', ' ', '4.', '.5', '99999999999999']) expect(minorUnitsOf(bad, 2)).toBeNull();
    });

    it('teach a page to hear a payment result only from its own parent window, only while its checkout waits, and only with its own request id', () => {
        const description = String(keyToolDefinitions().find((tool) => tool.function.name === PAYMENT_TOOL)?.function.description);
        expect(description).toContain('e.source !== window.parent');
        expect(description).toContain('!waiting');
        // ...and only for its own request: the game echoes the id back, so an earlier checkout's result is ignored
        expect(description).toContain('request: waiting, session }');
        expect(description).toContain('e.data.request !== waiting');
        // A "paid" that comes after its request ended (Check payment or Restore purchase found the purchase later) is heard, for the last request the page sent only
        expect(description).toContain('let waiting = "", asked = ""');
        expect(description).toContain('e.data.status === "paid" && !waiting && e.data.request === asked');
        expect(description).toContain('waiting = asked = crypto.randomUUID()');
        // ...and only for its own document: the page makes a session id when its scripts start, sends it with every message and ignores an answer with another one
        expect(description).toContain('const session = crypto.randomUUID()');
        expect(description).toContain('e.data.session !== session');
        expect(description).toMatch(/A message without its session is never answered/);
        expect(description).toMatch(/result of an earlier request/);
        expect(description).toContain('"busy"');
        expect(description).toMatch(/Show "paid" only for status "paid" heard that way/);
    });

    it('teach a page to ask once on load whether this visitor already bought, to keep the pay button on "none", and to show a test payment as a preview only', () => {
        const description = String(keyToolDefinitions().find((tool) => tool.function.name === PAYMENT_TOOL)?.function.description);
        expect(description).toContain('request: waiting, session, restore: true');
        expect(description).toContain('"none"');
        expect(description).toMatch(/A restore is not a checkout: it never opens a payment window/);
        expect(description).toContain('e.data.test === true');
        expect(description).toMatch(/Test payment" preview/);
        expect(description).toMatch(/never unlock or hand over anything real/);
        // The Universe window owns Check payment, Restore purchase and the receipt link: the page never shows them
        expect(description).toMatch(/the Universe window shows those itself/);
        // A page made with the older instructions has to be made again
        expect(description).toMatch(/older instructions[^.]*make the page again/);
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
