import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { createRefusalNotes, type CallRow } from '../server/ComputerRefusals';
import { createComputerModelRelay, estimateCallMicros, inputTokensOf, jobsOwnLimit, leadingFieldsOf, neverReached, readBoundedJson, readBoundedWithFlag, RELAY_GUARDS, ROUTING_FIELDS, outputCapOf, relayOrbitFor, readProviderError, whoseProviderError, type RelayOrbit, type RelayRoute, type SettleInput } from '../server/ComputerModelRelay';
import type { AIProviderConfig } from '../ai/types';

vi.mock('../ai/encryption', () => ({ decryptApiKey: (value: string | null | undefined) => (value ? `plain-${value}` : null) }));

const TOKEN = `cjt_${'a'.repeat(43)}`;
const JOB = 'job-1';
const BOT = 'brick-1';

const config = (over: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
    providerId: 'p1',
    name: 'Test',
    type: 'openai',
    enabled: true,
    endpoint: '',
    apiKeyEncrypted: 'secret',
    model: 'gpt-test',
    temperature: 0.5,
    maxTokens: 1000,
    supportsStreaming: true,
    ...over,
});

let upstream: Server;
let upstreamBase: string;
let upstreamRequests: Array<{ url: string; auth: string | undefined; body: Record<string, any> }>;
let upstreamHandler: (req: express.Request, res: express.Response) => void;

let relay: Server;
let relayBase: string;

let orbit: RelayOrbit & { identify: ReturnType<typeof vi.fn>; authorize: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> };
let route: RelayRoute | null;

const settled = (): SettleInput[] => orbit.settle.mock.calls.map((call) => call[0] as SettleInput);
/** A call is settled after its answer is sent, so a test waits for it. */
const askAndSettle = async (body: unknown, count = 1) => {
    const answer = await ask(body);
    const text = await answer.text();
    await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(count), { timeout: 3000 });
    return { answer, text };
};
const ask = (body: unknown, token: string | null = TOKEN) =>
    fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const listen = (app: express.Express) => new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
const urlOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const messages = [{ role: 'user', content: 'Fill the form' }];

// Rows the relay sent to Orbit's fault record, per job; `sinkAnswers` false makes Orbit unreachable
const sunk: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
let sinkAnswers = true;
const notes = createRefusalNotes(Date.now, {
    sink: async (botId, jobId, rows) => {
        if (!sinkAnswers) return false;
        sunk.push({ botId, jobId, rows });
        return true;
    },
    retryMs: [0, 0],
});
const rowsOf = (jobId: string): CallRow[] => sunk.filter((entry) => entry.jobId === jobId).flatMap((entry) => entry.rows);
/** Waits for the rows of a job to reach Orbit's record. */
const rowsSent = async (jobId: string, count = 1): Promise<CallRow[]> => {
    await vi.waitFor(() => expect(rowsOf(jobId).length).toBeGreaterThanOrEqual(count), { timeout: 3000 });
    return rowsOf(jobId);
};

beforeAll(async () => {
    const up = express();
    up.use(express.json());
    up.post('/v1/chat/completions', (req, res) => {
        upstreamRequests.push({ url: req.url, auth: req.headers.authorization, body: req.body });
        upstreamHandler(req, res);
    });
    upstream = await listen(up);
    upstreamBase = `${urlOf(upstream)}/v1`;

    orbit = { identify: vi.fn(), authorize: vi.fn(), settle: vi.fn() } as never;
    const app = express();
    app.use(createComputerModelRelay({ orbit, routeFor: async () => route, settleDelaysMs: [1, 1], refusals: notes }));
    relay = await listen(app);
    relayBase = urlOf(relay);
});

afterAll(async () => {
    await Promise.all([upstream, relay].map((server) => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })));
});

beforeEach(() => {
    upstreamRequests = [];
    upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    orbit.identify.mockReset().mockResolvedValue({ ok: true, jobId: JOB, botId: BOT });
    orbit.authorize.mockReset().mockResolvedValue({ ok: true });
    orbit.settle.mockReset().mockResolvedValue({ ok: true });
    route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
    sunk.length = 0;
    sinkAnswers = true;
});

describe('who may call', () => {
    it('refuses a call with no key, or one that is not a computer’s, without asking Orbit or the provider', async () => {
        expect((await ask({ messages }, null)).status).toBe(401);
        expect((await ask({ messages }, 'sk-something-else')).status).toBe(401);
        expect(orbit.identify).not.toHaveBeenCalled();
        expect(upstreamRequests).toHaveLength(0);
    });

    it('refuses a key Orbit does not know, ended, or from before a take-over: nothing is reserved or sent', async () => {
        orbit.identify.mockResolvedValue({ ok: false });
        const answer = await ask({ messages });
        expect(answer.status).toBe(401);
        expect((await answer.json()).error.code).toBe('invalid_api_key');
        expect(orbit.authorize).not.toHaveBeenCalled();
        expect(upstreamRequests).toHaveLength(0);
    });

    it('says the service is busy, not that the key is wrong, when Orbit cannot be reached', async () => {
        orbit.identify.mockRejectedValue(new Error('down'));
        expect((await ask({ messages })).status).toBe(503);
    });

    it('says the service is busy, not that the key is wrong, when Orbit cannot be reached while a client asks what models there are', async () => {
        orbit.identify.mockRejectedValue(new Error('down'));
        expect((await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(503);
    });

    it('lists one model name, for a client that asks what there is', async () => {
        const answer = await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect((await answer.json()).data.map((model: { id: string }) => model.id)).toEqual(['universe-ai']);
        orbit.identify.mockResolvedValue({ ok: false });
        expect((await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(401);
    });
});

describe('a call that reached the relay is noted for the runner', () => {
    it('notes it for a key Orbit knows, on the model list and on a chat call, and for no other key', async () => {
        const before = notes.mark();
        expect(notes.calledSince(JOB, before)).toBe(false);
        // a key Orbit does not know reached the relay too, but proves nothing of this job's machine
        orbit.identify.mockResolvedValueOnce({ ok: false });
        await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(notes.calledSince(JOB, before)).toBe(false);
        // an Orbit that cannot be asked proves nothing either
        orbit.identify.mockRejectedValueOnce(new Error('down'));
        await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(notes.calledSince(JOB, before)).toBe(false);
        // the model list asked with the job's own key
        await fetch(`${relayBase}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(notes.calledSince(JOB, before)).toBe(true);
        // a chat call too, whatever became of it
        const afterList = notes.mark();
        expect(notes.calledSince(JOB, afterList)).toBe(false);
        await ask({ messages });
        expect(notes.calledSince(JOB, afterList)).toBe(true);
        expect(notes.calledSince('another-job', before)).toBe(false);
    });

    it('does not note a chat call whose key Orbit refuses (401) or that could not be checked because Orbit is away (503): the runner reads such a turn as one no call reached', async () => {
        const before = notes.mark();
        orbit.identify.mockResolvedValueOnce({ ok: false });
        expect((await ask({ messages })).status).toBe(401);
        expect(notes.calledSince(JOB, before)).toBe(false);
        orbit.identify.mockRejectedValueOnce(new Error('down'));
        expect((await ask({ messages })).status).toBe(503);
        expect(notes.calledSince(JOB, before)).toBe(false);
        // no key at all
        expect((await ask({ messages }, null)).status).toBe(401);
        expect(notes.calledSince(JOB, before)).toBe(false);
    });
});

describe('room before the call', () => {
    it('notes a refusal for the person’s allowance or a rule of theirs for the job, and no other refusal', async () => {
        const before = Date.now() - 1;
        for (const reason of ['pool', 'refused'] as const) {
            orbit.authorize.mockResolvedValue({ ok: false, reason });
            await ask({ messages, tools: [{ type: 'function', function: { name: 'x' } }] });
        }
        expect(notes.sawSince(JOB, before)).toBe(false);

        orbit.authorize.mockResolvedValue({ ok: false, reason: 'rule' });
        const rule = await ask({ messages, tools: [{ type: 'function', function: { name: 'x' } }] });
        // a rule is said as a refusal for room, not as a wrong key, and the provider is never reached
        expect(rule.status).toBe(429);
        expect((await rule.json()).error.code).toBe('insufficient_quota');
        expect(upstreamRequests).toHaveLength(0);
        expect(notes.sawSince(JOB, before)).toBe(true);
    });

    it('notes an allowance refusal too', async () => {
        const before = Date.now() - 1;
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        await ask({ messages, tools: [{ type: 'function', function: { name: 'x' } }] });
        expect(notes.sawSince(JOB, before)).toBe(true);
        expect(notes.sawSince(JOB, Date.now() + 1000)).toBe(false);
    });

    it('is asked of Orbit for this one call before anything is sent, and a refusal is said with its reason', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        const answer = await ask({ messages });
        expect(answer.status).toBe(429);
        expect((await answer.json()).error.code).toBe('insufficient_quota');
        expect(upstreamRequests).toHaveLength(0);
        expect(settled()).toHaveLength(0);

        orbit.authorize.mockResolvedValue({ ok: false, reason: 'pool' });
        expect((await ask({ messages })).status).toBe(503);
        expect(upstreamRequests).toHaveLength(0);
    });

    it('names the route on the room request, the same string as in its fault rows (universe-ai:<providerId>), so Orbit can count failures and pause a route', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
        await askAndSettle({ messages });
        expect(orbit.authorize).toHaveBeenCalledWith(expect.objectContaining({ payer: 'universe', route: `universe-ai:${config().providerId}` }));
    });

    it('names the route on the room request for a call on the owner’s own key as own-key', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        await askAndSettle({ messages });
        expect(orbit.authorize).toHaveBeenCalledWith(expect.objectContaining({ payer: 'own-key', route: 'own-key' }));
    });

    it('holds room for a call on the owner’s own key as theirs, with none taken from the pool', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        await askAndSettle({ messages });
        expect(orbit.authorize).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, payer: 'own-key' }));
        expect(settled()[0]).toMatchObject({ route: 'own-key', payerPersonId: 'person-owner' });
    });

    it('holds a longer reply and a longer conversation at more, and a model nobody has a price for at a fixed generous room', () => {
        const priced = config({ endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
        const small = estimateCallMicros({ messages: [{ role: 'user', content: 'hi' }] }, priced, 100, new Date());
        const big = estimateCallMicros({ messages: [{ role: 'user', content: 'x'.repeat(30_000) }] }, priced, 8000, new Date());
        expect(small).toBeGreaterThan(0);
        expect(big).toBeGreaterThan(small);
        expect(estimateCallMicros({ messages }, config({ endpoint: 'https://nobody.example/v1', model: 'mystery' }), 100, new Date())).toBe(50_000);
    });

    it('reads text that takes several bytes a character (Arabic, Chinese, emoji) at what it costs, not at a third of it (audit F9)', () => {
        const latin = { messages: [{ role: 'user', content: 'a'.repeat(3000) }] };
        const arabic = { messages: [{ role: 'user', content: 'م'.repeat(3000) }] };
        const chinese = { messages: [{ role: 'user', content: '你'.repeat(3000) }] };
        // Same number of characters, more bytes: more tokens held, and a Chinese character is at least a token
        expect(inputTokensOf(arabic)).toBeGreaterThan(inputTokensOf(latin));
        expect(inputTokensOf(chinese)).toBeGreaterThanOrEqual(3000);
        // A fixed price per token, so the test does not depend on the price catalog
        const priced = config({ model: 'any', settings: { costPerToken: 0.000001 } });
        expect(estimateCallMicros(chinese, priced, 100, new Date())).toBeGreaterThan(estimateCallMicros(latin, priced, 100, new Date()));
    });

    it('allows a reply as long as Hermes asked, up to the guard, else what the provider says', () => {
        expect(outputCapOf({ max_tokens: 500 }, config())).toBe(500);
        expect(outputCapOf({ max_completion_tokens: 900 }, config())).toBe(900);
        expect(outputCapOf({ max_tokens: 10_000_000 }, config({ maxTokens: 0 }))).toBe(32_768);
        // Never more than our own setting, even when the job asks for more
        expect(outputCapOf({ max_tokens: 32_768 }, config({ maxTokens: 8192 }))).toBe(8192);
        expect(outputCapOf({ max_completion_tokens: 2000 }, config({ maxTokens: 8192 }))).toBe(2000);
        expect(outputCapOf({}, config({ maxTokens: 1000 }))).toBe(1000);
        expect(outputCapOf({ max_tokens: -5 }, config({ maxTokens: 0 }))).toBe(4096);
    });
});

describe('the call', () => {
    it('goes to the Brick’s AI with that AI’s key and model, never Hermes’s own, and the reply comes back whole', async () => {
        const answer = await ask({ model: 'whatever-hermes-says', messages, tools: [{ type: 'function', function: { name: 'x' } }], max_tokens: 700 });
        expect(answer.status).toBe(200);
        expect((await answer.json()).choices[0].message.content).toBe('done');
        expect(upstreamRequests[0].auth).toBe('Bearer plain-secret');
        expect(upstreamRequests[0].body).toMatchObject({ model: 'gpt-test', n: 1, stream: false, max_tokens: 700, messages });
        expect(upstreamRequests[0].body.tools).toHaveLength(1);
    });

    it('is settled once, with what the provider said it used, priced by the list, and not as another person’s', async () => {
        await askAndSettle({ messages });
        expect(settled()).toHaveLength(1);
        expect(settled()[0]).toMatchObject({ jobId: JOB, sent: true, route: 'universe-ai', tokens: { input: 100, output: 20, cached: 0, reasoning: 0 } });
        expect(settled()[0].payerPersonId).toBeUndefined();
        // the call id Orbit was asked about is the one it is told about
        expect(settled()[0].callId).toBe(orbit.authorize.mock.calls[0][0].callId);
    });

    it('settles a call at "unknown" when the provider said nothing and nothing came through', async () => {
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: '' } }] });
        await askAndSettle({ messages });
        expect(settled()[0]).toMatchObject({ costMicros: null, basis: 'unknown' });
    });

    it('keeps a cost the provider reported when it sent no token counts, in a whole reply', async () => {
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { cost: 0.0123 } });
        await askAndSettle({ messages });
        expect(settled()[0]).toMatchObject({ sent: true, costMicros: 12_300, basis: 'measured' });
    });

    it('keeps the cost the provider reported when a rate per token is set and it sent no counts, in a whole reply', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: { costPerToken: 0.001 } }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(300) } }], usage: { cost: 0.0123 } });
        await askAndSettle({ messages });
        // Not the 100 estimated tokens at the rate (a different, made-up amount): the provider's own figure
        expect(settled()[0]).toMatchObject({ sent: true, costMicros: 12_300, basis: 'measured' });
        // The estimated counts still fill the token tallies
        expect(settled()[0].tokens?.output).toBe(100);
    });

    it('still prices real counts at the rate per token, which wins over a reported cost', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: { costPerToken: 0.001 } }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.0123 } });
        await askAndSettle({ messages });
        expect(settled()[0]).toMatchObject({ costMicros: 30_000, basis: 'measured' });
    });

    it('writes max_completion_tokens for OpenAI’s own host, which wants the newer name', async () => {
        // Same shape the provider code uses; the guard is on the host name
        const { isOpenAIHost } = await import('../ai/providers/OpenAIProvider');
        expect(isOpenAIHost('https://api.openai.com/v1')).toBe(true);
        expect(isOpenAIHost(upstreamBase)).toBe(false);
    });

    it('a provider that refuses the call is told to Hermes as it is, was not billed, and its key is never shown', async () => {
        upstreamHandler = (_req, res) => res.status(401).json({ error: { message: 'Incorrect API key provided: plain-secret' } });
        const { answer, text } = await askAndSettle({ messages });
        // Hermes must not read this as its own key being wrong
        expect(answer.status).toBe(502);
        expect(settled()[0]).toMatchObject({ sent: true, costMicros: 0 });
        expect(text).toContain('Incorrect API key');
        expect(text).not.toContain('plain-secret');
    });

    it('a provider that cannot be reached at all gives the room back and writes nothing', async () => {
        route = { config: config({ endpoint: 'http://127.0.0.1:1/v1' }), source: 'universe-ai', keyOwnerId: null };
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(502);
        expect(settled()).toEqual([{ jobId: JOB, callId: expect.any(String), sent: false }]);
    });

    it('a connection that broke after the request went out is owed, not given back; only "never connected" is', async () => {
        expect(neverReached(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) }))).toBe(true);
        expect(neverReached(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(true);
        expect(neverReached(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }))).toBe(false);
        expect(neverReached(new Error('socket hang up'))).toBe(false);
        // the upstream hangs up mid-request
        upstreamHandler = (req) => req.socket.destroy();
        const answer = await ask({ messages });
        await answer.text();
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(settled()[0]).toMatchObject({ sent: true, cutShort: true });
    });

    it('a port with nothing listening gives the room back too', async () => {
        const closed = await listen(express());
        const address = `${urlOf(closed)}/v1`;
        await new Promise<void>((resolve) => closed.close(() => resolve()));
        route = { config: config({ endpoint: address }), source: 'universe-ai', keyOwnerId: null };
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(502);
        expect(settled()).toEqual([{ jobId: JOB, callId: expect.any(String), sent: false }]);
    });

    it('a key that cannot be read gives the room back, as nothing was sent', async () => {
        const encryption = await import('../ai/encryption');
        const spy = vi.spyOn(encryption, 'decryptApiKey').mockImplementation(() => {
            throw new Error('bad key');
        });
        try {
            const { answer } = await askAndSettle({ messages });
            expect(answer.status).toBe(502);
            expect(settled()).toEqual([{ jobId: JOB, callId: expect.any(String), sent: false }]);
            expect(upstreamRequests).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    it('holds a job to its calls in flight even when they arrive together, and gives the places back', async () => {
        const cap = RELAY_GUARDS.maxCallsInFlight;
        const release: Array<() => void> = [];
        orbit.authorize.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ ok: true }))));
        const burst = Array.from({ length: cap + 2 }, () => ask({ messages }));
        await vi.waitFor(() => expect(release).toHaveLength(cap), { timeout: 3000 });
        // the ones over the cap were turned away at once, without asking Orbit
        const refused = await Promise.race(burst.map(async (p, i) => ({ i, status: (await p).status })));
        expect(refused.status).toBe(429);
        expect(orbit.authorize).toHaveBeenCalledTimes(cap);
        release.forEach((go) => go());
        const answers = await Promise.all(burst);
        expect(answers.filter((a) => a.status === 429)).toHaveLength(2);
        expect(answers.filter((a) => a.status === 200)).toHaveLength(cap);
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(cap), { timeout: 3000 });
        // all places are back: a new call is let in
        orbit.authorize.mockResolvedValue({ ok: true });
        expect((await ask({ messages })).status).toBe(200);
    });

    it('gives the place back when Orbit refuses or cannot be reached', async () => {
        const cap = RELAY_GUARDS.maxCallsInFlight;
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        for (let i = 0; i < cap + 3; i++) expect((await ask({ messages })).status).toBe(429);
        orbit.authorize.mockRejectedValue(new Error('down'));
        for (let i = 0; i < cap + 3; i++) expect((await ask({ messages })).status).toBe(503);
        orbit.authorize.mockResolvedValue({ ok: true });
        expect((await ask({ messages })).status).toBe(200);
    });

    it('refuses an AI it cannot talk to directly, before taking any room', async () => {
        route = { config: config({ type: 'anthropic', endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
        expect((await ask({ messages })).status).toBe(501);
        expect(orbit.authorize).not.toHaveBeenCalled();
    });

    it('says the Brick’s AI is not answering when its key is resting, before taking any room', async () => {
        route = null;
        expect((await ask({ messages })).status).toBe(503);
        expect(orbit.authorize).not.toHaveBeenCalled();
    });

    it('refuses a request with no messages, and one too large, in the shape clients read', async () => {
        expect((await ask({ messages: [] })).status).toBe(400);
        expect((await ask({})).status).toBe(400);
        const huge = await fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(17 * 1024 * 1024) }] }) });
        expect(huge.status).toBe(413);
        expect((await huge.json()).error.code).toBe('request_too_large');
        expect(orbit.authorize).not.toHaveBeenCalled();
    });

    it('still settles when Orbit fails the first time', async () => {
        orbit.settle.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ ok: true });
        await askAndSettle({ messages }, 2);
    });
});

describe('what a call used when the provider does not say', () => {
    it('counts tool calls and thinking as what the model wrote, in a whole reply', async () => {
        upstreamHandler = (_req, res) =>
            res.json({ choices: [{ message: { role: 'assistant', content: 'OK', reasoning_content: 'y'.repeat(30), tool_calls: [{ function: { name: 'go', arguments: 'z'.repeat(268) } }] } }] });
        await askAndSettle({ messages });
        // 2 + 30 + 2 + 268 characters, at three to a token
        expect(settled()[0].tokens?.output).toBe(Math.ceil(302 / RELAY_GUARDS.charsPerToken));
    });

    it('counts tool calls as what the model wrote, in a streamed reply', async () => {
        const piece = (arguments_: string) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: arguments_ } }] } }] })}\n\n`;
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(piece('a'.repeat(150)));
            res.write(piece('b'.repeat(150)));
            res.end('data: [DONE]\n\n');
        };
        await askAndSettle({ messages, stream: true });
        expect(settled()[0].tokens?.output).toBe(Math.ceil(300 / RELAY_GUARDS.charsPerToken));
    });
});

describe('a caller that goes away before the call is sent', () => {
    it('sends nothing to the provider and gives the room back', async () => {
        let letGo: () => void = () => undefined;
        orbit.authorize.mockImplementation(() => new Promise((resolve) => { letGo = () => resolve({ ok: true }); }));
        const controller = new AbortController();
        const asked = fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ messages }), signal: controller.signal }).catch(() => null);
        await vi.waitFor(() => expect(orbit.authorize).toHaveBeenCalled(), { timeout: 3000 });
        controller.abort();
        await asked;
        // the close reaches the relay a moment after the abort
        await new Promise((resolve) => setTimeout(resolve, 100));
        letGo();
        await vi.waitFor(() => expect(settled()).toHaveLength(1), { timeout: 3000 });
        expect(settled()[0]).toEqual({ jobId: JOB, callId: expect.any(String), sent: false });
        expect(upstreamRequests).toHaveLength(0);
    });
});

describe('streaming', () => {
    const sse = (res: express.Response, chunks: string[]) => {
        res.setHeader('Content-Type', 'text/event-stream');
        for (const chunk of chunks) res.write(chunk);
        res.end();
    };
    const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

    it('comes straight through, asks for the use to be reported, and is priced from it', async () => {
        upstreamHandler = (_req, res) =>
            sse(res, [data({ choices: [{ delta: { content: 'Hel' } }] }), data({ choices: [{ delta: { content: 'lo' } }] }), data({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 2 } }), 'data: [DONE]\n\n']);
        const { answer, text } = await askAndSettle({ messages, stream: true });
        expect(answer.headers.get('content-type')).toContain('text/event-stream');
        expect(text).toContain('"Hel"');
        expect(text).toContain('[DONE]');
        expect(upstreamRequests[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
        expect(settled()[0]).toMatchObject({ sent: true, tokens: { input: 50, output: 2 } });
    });

    it('is counted by what came through when the provider never says what it used, and the figure says so', async () => {
        upstreamHandler = (_req, res) => sse(res, [data({ choices: [{ delta: { content: 'x'.repeat(300) } }] }), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0].tokens?.output).toBe(100);
        expect(settled()[0].basis === 'estimated' || settled()[0].basis === 'unknown').toBe(true);
    });

    it('keeps a cost the provider reported when it sent no token counts, in a stream', async () => {
        upstreamHandler = (_req, res) => sse(res, [data({ choices: [{ delta: { content: 'hello' } }] }), data({ choices: [], usage: { cost: 0.0123 } }), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0]).toMatchObject({ sent: true, costMicros: 12_300, basis: 'measured' });
    });

    it('keeps the cost the provider reported when a rate per token is set and it sent no counts, in a stream', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: { costPerToken: 0.001 } }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => sse(res, [data({ choices: [{ delta: { content: 'x'.repeat(300) } }] }), data({ choices: [], usage: { cost: 0.0123 } }), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0]).toMatchObject({ sent: true, costMicros: 12_300, basis: 'measured' });
    });

    it('counts a character once when its bytes arrive in two pieces', async () => {
        // 30 characters of 3 bytes each, cut inside the 15th: read piece by piece it would count 31
        const line = Buffer.from(data({ choices: [{ delta: { content: '€'.repeat(30) } }] }));
        const cut = line.indexOf(Buffer.from('€')) + 14 * 3 + 1;
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(line.subarray(0, cut));
            setTimeout(() => {
                res.write(line.subarray(cut));
                res.end('data: [DONE]\n\n');
            }, 30);
        };
        await askAndSettle({ messages, stream: true });
        expect(settled()[0].tokens?.output).toBe(10);
    });

    it('drops a line with no end instead of keeping it, and still reads what comes after it', async () => {
        const huge = 'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 100);
        upstreamHandler = (_req, res) => sse(res, [`data: ${huge}`, '\n', data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }), 'data: [DONE]\n\n']);
        const { text } = await askAndSettle({ messages, stream: true });
        expect(text).toContain('[DONE]');
        expect(settled()[0]).toMatchObject({ tokens: { input: 7, output: 3 } });
    });

    it('does not read a line that grew past the bound in the same chunk that ended it', async () => {
        const pad = 'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 100);
        const oversized = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 999, completion_tokens: 999 }, pad })}\n\n`;
        upstreamHandler = (_req, res) => sse(res, [data({ choices: [{ delta: { content: 'hello' } }] }) + oversized, 'data: [DONE]\n\n']);
        const { text } = await askAndSettle({ messages, stream: true });
        // Passed on as it came, but never read: its counts are not what the call is priced from
        expect(text).toContain('[DONE]');
        expect(settled()[0].tokens?.input).not.toBe(999);
        expect(settled()[0].tokens?.output).not.toBe(999);
    });

    it('a chunk cut across two writes is still read', async () => {
        const whole = data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } });
        upstreamHandler = (_req, res) => sse(res, [whole.slice(0, 20), whole.slice(20), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0]).toMatchObject({ tokens: { input: 7, output: 3 } });
    });

    it('stops the provider and counts what was used when Hermes goes away', async () => {
        let providerSawClose = false;
        let providerResponse: { writableEnded: boolean; destroyed: boolean } | undefined;
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(data({ choices: [{ delta: { content: 'first' } }] }));
            providerResponse = res;
            // The provider's own response closing is what shows the relay let go of it
            res.once('close', () => { providerSawClose = true; });
            // never ends on its own
        };
        const controller = new AbortController();
        const answer = await fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ messages, stream: true }), signal: controller.signal });
        const reader = answer.body!.getReader();
        await reader.read();
        // Still open at the moment Hermes goes away: only the abort can close it
        expect(providerResponse).toBeDefined();
        expect(providerResponse!.writableEnded).toBe(false);
        expect(providerSawClose).toBe(false);
        controller.abort();
        await vi.waitFor(() => expect(settled()).toHaveLength(1), { timeout: 3000 });
        expect(settled()[0]).toMatchObject({ sent: true, cutShort: true });
        await vi.waitFor(() => expect(providerSawClose).toBe(true), { timeout: 3000 });
    });

    it('asks again without stream_options when a provider refuses them, once, and remembers', async () => {
        upstreamHandler = (req, res) => {
            if (req.body.stream_options) return void res.status(400).json({ error: { message: 'Stream options can only be defined when stream=True' } });
            sse(res, [data({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]\n\n']);
        };
        expect((await askAndSettle({ messages, stream: true })).text).toContain('"ok"');
        expect(upstreamRequests).toHaveLength(2);
        await askAndSettle({ messages, stream: true }, 2);
        expect(upstreamRequests).toHaveLength(3);
        expect(upstreamRequests[2].body.stream_options).toBeUndefined();
    });
});

describe('a first answer that refuses stream_options', () => {
    it('is let go of before the call is made again without them, and the call settles as before', async () => {
        const cancel = vi.fn(async () => undefined);
        let calls = 0;
        const fetchFor = () =>
            (async (input: RequestInfo | URL, init?: RequestInit) => {
                if (++calls === 1) {
                    const answer = JSON.stringify({ error: { message: 'Stream options can only be defined when stream=True' } });
                    return { ok: false, status: 400, clone: () => new Response(answer, { status: 400 }), body: { cancel } } as unknown as Response;
                }
                return fetch(input, init);
            }) as typeof fetch;
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`);
            res.end('data: [DONE]\n\n');
        };
        // A host the earlier test did not use, so what it learned about stream_options does not apply
        route = { config: config({ endpoint: upstreamBase.replace('127.0.0.1', 'localhost') }), source: 'universe-ai', keyOwnerId: null };
        const app = express();
        app.use(createComputerModelRelay({ orbit, routeFor: async () => route, settleDelaysMs: [1, 1], fetchFor }));
        const own = await listen(app);
        try {
            const answer = await fetch(`${urlOf(own)}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ messages, stream: true }) });
            expect(await answer.text()).toContain('"ok"');
            await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
            expect(cancel).toHaveBeenCalledTimes(1);
            expect(calls).toBe(2);
            expect(settled()[0]).toMatchObject({ sent: true, tokens: { input: 5, output: 2 } });
        } finally {
            await new Promise<void>((resolve) => { own.closeAllConnections?.(); own.close(() => resolve()); });
        }
    });
});

describe('the Orbit calls', () => {
    const admin = (status: number, data: Record<string, unknown>) => ({ computerRelayCall: vi.fn().mockResolvedValue({ status, data }) });

    it('reads a good key, a refused key, and an unexpected answer as what they are', async () => {
        expect(await relayOrbitFor(admin(200, { ok: true, jobId: 'j', botId: 'b' })).identify('t')).toEqual({ ok: true, jobId: 'j', botId: 'b' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'refused' })).identify('t')).toEqual({ ok: false });
        await expect(relayOrbitFor(admin(401, {})).identify('t')).rejects.toThrow();
    });

    it('reads room answers, and takes any odd reason as a refusal', async () => {
        const input = { token: 't', callId: 'c', estimateMicros: 1, payer: 'universe' as const, route: 'universe-ai:p' };
        expect(await relayOrbitFor(admin(200, { ok: true })).authorize(input)).toEqual({ ok: true });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'allowance' })).authorize(input)).toEqual({ ok: false, reason: 'allowance' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'rule' })).authorize(input)).toEqual({ ok: false, reason: 'rule' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'pool', full: true })).authorize(input)).toEqual({ ok: false, reason: 'pool', full: true });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'pool' })).authorize(input)).toEqual({ ok: false, reason: 'pool', full: false });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'something new' })).authorize(input)).toEqual({ ok: false, reason: 'refused' });
        await expect(relayOrbitFor(admin(500, {})).authorize(input)).rejects.toThrow();
    });

    it('a call Orbit does not know is not tried again, and a failure is', async () => {
        const input = { jobId: 'j', callId: 'c', sent: true };
        expect(await relayOrbitFor(admin(404, { ok: false })).settle(input)).toEqual({ ok: false });
        expect(await relayOrbitFor(admin(200, { ok: true })).settle(input)).toEqual({ ok: true });
        await expect(relayOrbitFor(admin(502, {})).settle(input)).rejects.toThrow();
    });
});

describe('reading a provider’s answer', () => {
    const bodyOf = (...pieces: string[]) => {
        const state = { cancelled: false };
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                const next = pieces.shift();
                if (next === undefined) controller.close();
                else controller.enqueue(new TextEncoder().encode(next));
            },
            cancel() {
                state.cancelled = true;
            },
        });
        return { response: new Response(stream), state };
    };

    it('does not wait on the cancel of a clone, whose other branch the caller has yet to read', async () => {
        const { response } = bodyOf('abcd', 'efgh', 'ijkl', 'mnop');
        const clone = response.clone();
        const stuck = Symbol('stuck');
        const read = await Promise.race([readBoundedWithFlag(clone, 10), new Promise<symbol>((resolve) => setTimeout(() => resolve(stuck), 500))]);
        expect(read).toEqual({ text: 'abcdefghij', tooLong: true });
        // The original is still there to be read afterwards
        expect(await readBoundedWithFlag(response, 100)).toEqual({ text: 'abcdefghijklmnop', tooLong: false });
    });

    it('reads a short answer whole', async () => {
        expect(await readBoundedWithFlag(bodyOf('{"a":', '1}').response, 100)).toEqual({ text: '{"a":1}', tooLong: false });
    });

    it('stops and cancels the body once it is longer than the bound, keeping the words before it', async () => {
        const { response, state } = bodyOf('abcd', 'efgh', 'ijkl', 'mnop');
        const read = await readBoundedWithFlag(response, 10);
        expect(read.tooLong).toBe(true);
        expect(read.text).toBe('abcdefghij');
        expect(state.cancelled).toBe(true);
    });

    it('keeps the same first bytes however the chunks fell, never more than the bound, and a field that fits in the chunk that crosses it', async () => {
        const text = '{"error":{"param":"temperature","message":"' + 'x'.repeat(100) + '"}}';
        const whole = await readBoundedWithFlag(bodyOf(text).response, 64);
        expect(whole).toEqual({ text: text.slice(0, 64), tooLong: true });
        for (const size of [1, 7, 13, 64, 65, 200]) {
            const pieces = text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) as string[];
            expect(await readBoundedWithFlag(bodyOf(...pieces).response, 64)).toEqual(whole);
        }
        // the field is read from what fit, whether the body came whole or in pieces
        expect(leadingFieldsOf(whole.text)).toEqual({ param: 'temperature' });
        // the bound is in bytes: five bytes of two-byte characters are two whole characters and half of a third, read as UTF-8 reads the first five bytes
        const accents = await readBoundedWithFlag(bodyOf('ééééé').response, 5);
        expect(accents.text).toBe(Buffer.from('ééééé').subarray(0, 5).toString('utf8'));
        expect(accents.tooLong).toBe(true);
        expect(Buffer.byteLength(accents.text.replace(/\uFFFD$/, ''))).toBeLessThanOrEqual(5);
        // and the same however the chunks fell
        expect(await readBoundedWithFlag(bodyOf('é', 'éé', 'éé').response, 5)).toEqual(accents);
        // exactly the bound is not too long
        expect(await readBoundedWithFlag(bodyOf('abcd', 'efgh', 'ij').response, 10)).toEqual({ text: 'abcdefghij', tooLong: false });
    });

    it('gives no JSON for an answer that is too long or is not JSON', async () => {
        expect(await readBoundedJson(bodyOf('{"a":1}').response, 100)).toEqual({ a: 1 });
        expect(await readBoundedJson(bodyOf('{"a":', '"'.repeat(50), '}').response, 10)).toBeNull();
        expect(await readBoundedJson(bodyOf('not json').response, 100)).toBeNull();
    });
});

describe('how a call ended, for the runner', () => {
    // The agent's own calls carry its tools; a side call (a summary, a title) does not
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const since = () => Date.now() - 1;
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });

    it('notes a provider that answered with an error of its own, or could not be reached, as a fault of ours', async () => {
        asJob('job-fault-500');
        const before = since();
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'The model broke' } });
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-fault-500', before)).toBe(true);

        asJob('job-fault-unreachable');
        route = { config: config({ endpoint: 'http://127.0.0.1:1/v1' }), source: 'universe-ai', keyOwnerId: null };
        await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-fault-unreachable', before)).toBe(true);
    });

    it('stamps the row of a call with the turn and the run it started in, though the runner moves to another run while it is open', async () => {
        asJob('job-run');
        notes.turn('job-run', 3, 'run-before');
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        upstreamHandler = (_req, res) => void gate.then(() => res.status(500).json({ error: { message: 'The model broke' } }));
        const asked = askAndSettle(agent);
        await vi.waitFor(() => expect(upstreamRequests.length).toBeGreaterThan(0), { timeout: 3000 });
        // the bot server restarted, or took the job up again: another run, its turns numbered from 1
        notes.turn('job-run', 1, 'run-after');
        release();
        await asked;
        expect((await rowsSent('job-run')).map((row) => [row.turn, row.run])).toEqual([[3, 'run-before']]);
    });

    it('ties a call to the turn that was current when it ARRIVED, though asking Orbit who the caller is took until the runner was on the next turn', async () => {
        const job = 'job-late-identify';
        notes.turn(job, 4, 'run-x');
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        // Orbit is slow to say who this caller is
        orbit.identify.mockReset().mockImplementationOnce(async () => {
            await gate;
            return { ok: true, jobId: job, botId: BOT };
        });
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'The model broke' } });
        const asked = askAndSettle(agent);
        await vi.waitFor(() => expect(orbit.identify).toHaveBeenCalledTimes(1), { timeout: 3000 });
        // the runner moves on to turn 5 (and the job is not known to the relay yet: nothing in the call has named it)
        notes.turn(job, 5, 'run-x');
        release();
        await asked;
        expect((await rowsSent(job)).map((row) => [row.turn, row.run])).toEqual([[4, 'run-x']]);
        // a call that arrives after the change is turn 5's
        orbit.identify.mockReset().mockResolvedValue({ ok: true, jobId: job, botId: BOT });
        await askAndSettle(agent, 2);
        expect((await rowsSent(job, 2)).map((row) => row.turn)).toEqual([4, 5]);
    });

    it('never forwards the routing fields of a job to the provider: it cannot choose another model or provider for a call paid on our key', async () => {
        asJob('job-routing');
        await askAndSettle({
            ...agent,
            models: ['openai/gpt-5-expensive', 'anthropic/claude-opus'],
            provider: { only: ['SomeHost'], max_price: { prompt: 1000 } },
            route: 'fallback',
            transforms: ['middle-out'],
            plugins: [{ id: 'web', max_results: 50 }],
            preset: '@someone/preset',
            fallbacks: ['x/y'],
            temperature: 0.2,
        });
        const sent = upstreamRequests.at(-1)?.body as Record<string, unknown>;
        for (const field of ROUTING_FIELDS) expect(sent).not.toHaveProperty(field);
        // what the job's own machine is allowed to set still goes through, and the model is the relay's own
        expect(sent).toMatchObject({ temperature: 0.2, model: route.config.model });
        expect(sent.messages).toBeDefined();
    });

    it('never forwards them on a person’s own key either: no setting of an owner’s routing exists for a Brick’s AI, so a job cannot invent one', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-routing-own');
        await askAndSettle({
            ...agent,
            models: ['openai/gpt-5-expensive'],
            provider: { only: ['SomeHost'], allow_fallbacks: false },
            route: 'fallback',
            transforms: ['middle-out'],
            plugins: [{ id: 'web' }],
            preset: '@someone/preset',
            fallbacks: ['x/y'],
            temperature: 0.2,
        });
        const sent = upstreamRequests.at(-1)?.body as Record<string, unknown>;
        for (const field of ROUTING_FIELDS) expect(sent).not.toHaveProperty(field);
        expect(sent).toMatchObject({ temperature: 0.2, model: route.config.model });
    });

    it('notes a whole reply cut at the bound as unresolved (class 3), never a confirmed fault of ours and never the person’s', async () => {
        asJob('job-too-long');
        const before = since();
        // 17 MiB of JSON: more than the relay reads of one reply (only a job's own settings, like logprobs on every token, make one)
        const huge = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(17 * 1024 * 1024) } }] });
        upstreamHandler = (_req, res) => res.status(200).type('application/json').send(huge);
        const { answer } = await askAndSettle(agent);
        expect(answer.status).toBe(502);
        // Unresolved: Orbit's bounded goodwill decides, from a row that says so; never confirmed, and not the person's side either
        expect(notes.confirmedSince('job-too-long', before)).toBe(false);
        expect(notes.sawSince('job-too-long', before)).toBe(false);
        expect((await rowsSent('job-too-long')).map((row) => [row.kind, row.reason, row.providerStatus])).toEqual([['uncertain', 'provider_5xx', 502]]);
    });

    it('keeps the relay’s own cutoff unresolved on a person’s own key too: a reply cut at the bound and a time limit are no refusal by their provider', async () => {
        const before = since();
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-own-too-long');
        const huge = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(17 * 1024 * 1024) } }] });
        upstreamHandler = (_req, res) => res.status(200).type('application/json').send(huge);
        await askAndSettle(agent);
        expect(notes.confirmedSince('job-own-too-long', before)).toBe(false);
        expect((await rowsSent('job-own-too-long')).map((row) => [row.kind, row.reason, row.source])).toEqual([['uncertain', 'provider_5xx', 'own-key']]);

        const original = RELAY_GUARDS.callTimeoutMs;
        (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = 150;
        try {
            asJob('job-own-timeout');
            upstreamHandler = () => undefined;
            await askAndSettle(agent, 2);
            expect((await rowsSent('job-own-timeout')).map((row) => [row.kind, row.reason, row.source])).toEqual([['uncertain', 'timeout_no_output', 'own-key']]);
        } finally {
            (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = original;
        }
        // their own provider failing with a 5xx proves nothing of whose it was: unresolved, as on Universe's key (only a refusal of their key or credit is theirs)
        asJob('job-own-refused');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await askAndSettle(agent, 3);
        expect((await rowsSent('job-own-refused'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_5xx', source: 'own-key' });
    });

    it('does not let an empty 200 clear an earlier fault of the same job: only something the model wrote, or tokens it spent, is an answer', async () => {
        const before = since();
        asJob('job-empty-answer');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await askAndSettle({ ...agent, stream: true }, 1);
        expect(notes.endedOnFault('job-empty-answer', before)).toBe(true);
        // a retry answers 200 with a stream that closes with nothing in it
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.end('data: [DONE]\n\n');
        };
        await askAndSettle({ ...agent, stream: true }, 2);
        expect(notes.endedOnFault('job-empty-answer', before)).toBe(true);
        // a retry that wrote something does clear it
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Done' } }] })}\n\n`);
            res.end('data: [DONE]\n\n');
        };
        await askAndSettle({ ...agent, stream: true }, 3);
        expect(notes.endedOnFault('job-empty-answer', before)).toBe(false);
        // and so does a tool call, or tokens the provider says it spent
        asJob('job-empty-tokens');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await askAndSettle(agent, 4);
        expect(notes.endedOnFault('job-empty-tokens', before)).toBe(true);
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
        await askAndSettle(agent, 5);
        expect(notes.endedOnFault('job-empty-tokens', before)).toBe(false);
    });

    it('does not let a stream that ended in the middle of an event clear an earlier fault, whatever it had written: only a whole stream is an answer', async () => {
        const before = since();
        asJob('job-incomplete-stream');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await askAndSettle({ ...agent, stream: true }, 1);
        expect(notes.endedOnFault('job-incomplete-stream', before)).toBe(true);
        // a retry writes some words, then its last event is cut in the middle and the stream closes normally
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            res.end('data: {"choices":[{"delta":{"content":"lo wor');
        };
        await askAndSettle({ ...agent, stream: true }, 2);
        expect(notes.endedOnFault('job-incomplete-stream', before)).toBe(true);
        // the cut is unresolved, written down as a stream that broke
        expect((await rowsSent('job-incomplete-stream', 2)).map((row) => [row.kind, row.reason])).toEqual([['uncertain', 'provider_5xx'], ['uncertain', 'stream_cut']]);
        // a data line that never ended within the bound is cut as well
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            res.end(`data: {"pad":"${'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 10)}`);
        };
        await askAndSettle({ ...agent, stream: true }, 3);
        expect(notes.endedOnFault('job-incomplete-stream', before)).toBe(true);
        // only the start of a field name left
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            res.end('da');
        };
        await askAndSettle({ ...agent, stream: true }, 4);
        expect(notes.endedOnFault('job-incomplete-stream', before)).toBe(true);
        // a whole stream still makes it good: its last event may come without the blank line after it, and a [DONE] may be the last thing said
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}`);
        };
        await askAndSettle({ ...agent, stream: true }, 5);
        expect(notes.endedOnFault('job-incomplete-stream', before)).toBe(false);
        asJob('job-incomplete-tool');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await askAndSettle({ ...agent, stream: true }, 6);
        expect(notes.endedOnFault('job-incomplete-tool', before)).toBe(true);
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'click', arguments: '{"x":1}' } }] } }] })}\n\n`);
            res.end('data: [DONE]');
        };
        await askAndSettle({ ...agent, stream: true }, 7);
        expect(notes.endedOnFault('job-incomplete-tool', before)).toBe(false);
    });

    it('ties a call to the turn that was current when it ARRIVED, though its body was still arriving when the runner moved on to the next turn', async () => {
        const job = 'job-slow-body';
        asJob(job);
        notes.turn(job, 4, 'run-x');
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'The model broke' } });
        const marks = vi.spyOn(notes, 'mark');
        try {
            const payload = JSON.stringify(agent);
            const half = Math.floor(payload.length / 2);
            const url = new URL(`${relayBase}/v1/chat/completions`);
            const answered = new Promise<number>((resolve, reject) => {
                const request = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${TOKEN}` } }, (response) => {
                    response.resume();
                    response.on('end', () => resolve(response.statusCode ?? 0));
                });
                request.on('error', reject);
                request.write(payload.slice(0, half));
                // the relay has seen the call arrive (its head is in), and the rest of its body is still to come
                void vi.waitFor(() => expect(marks).toHaveBeenCalled(), { timeout: 3000 }).then(() => {
                    // the runner moves on to turn 5 while the body is arriving
                    notes.turn(job, 5, 'run-x');
                    request.end(payload.slice(half));
                });
            });
            expect(await answered).toBe(500);
        } finally {
            marks.mockRestore();
        }
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect((await rowsSent(job)).map((row) => [row.turn, row.run])).toEqual([[4, 'run-x']]);
        // a call that arrives after the change is turn 5's
        await askAndSettle(agent, 2);
        expect((await rowsSent(job, 2)).map((row) => row.turn)).toEqual([4, 5]);
    });

    it('does not let a stream that had data dropped unread clear an earlier fault: an error past the line bound may have been in it, and a whole stream with nothing dropped still does', async () => {
        const before = since();
        const long = 'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 100);
        const delta = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`;
        const fail = (name: string, count: number) => {
            asJob(name);
            upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
            return askAndSettle({ ...agent, stream: true }, count);
        };
        // a line completed inside one chunk, over the bound, then the stream ends cleanly
        await fail('job-skipped-inchunk', 1);
        expect(notes.endedOnFault('job-skipped-inchunk', before)).toBe(true);
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.end(`${delta}data: ${JSON.stringify({ error: { message: 'overloaded', pad: long } })}\n\n`);
        };
        await askAndSettle({ ...agent, stream: true }, 2);
        expect(notes.endedOnFault('job-skipped-inchunk', before)).toBe(true);
        // a line that grows over the bound across chunks, whose end comes in a later chunk
        await fail('job-skipped-chunks', 3);
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(delta);
            res.write(`data: {"error":{"message":"overloaded","pad":"${long}`);
            setTimeout(() => res.end(`more"}}\n\n`), 30);
        };
        await askAndSettle({ ...agent, stream: true }, 4);
        expect(notes.endedOnFault('job-skipped-chunks', before)).toBe(true);
        // and a whole stream whose lines all fit still makes it good
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.end(`${delta}data: [DONE]\n\n`);
        };
        await askAndSettle({ ...agent, stream: true }, 5);
        expect(notes.endedOnFault('job-skipped-chunks', before)).toBe(false);
        // none of the streams after the 500 wrote a row of its own: a stream with data dropped is neither a fault nor an answer
        expect(rowsOf('job-skipped-chunks').map((row) => row.kind)).toEqual(['uncertain']);
    });

    it('notes no refusal for a caller that went away while the room was being asked for, whatever Orbit then said: an allowance, a rule, or no room', async () => {
        const before = since();
        for (const [name, refusal] of [
            ['job-gone-allowance', { ok: false, reason: 'allowance' }],
            ['job-gone-rule', { ok: false, reason: 'rule' }],
            ['job-gone-pool', { ok: false, reason: 'pool', full: true }],
            ['job-gone-pool-size', { ok: false, reason: 'pool' }],
        ] as const) {
            asJob(name);
            let letGo: () => void = () => undefined;
            orbit.authorize.mockImplementationOnce(() => new Promise((resolve) => { letGo = () => resolve(refusal); }));
            // The relay's own side of the connection: when the server has seen this request's response close, the relay knows its caller went away
            const serverSawClose = new Promise<void>((resolve) => relay.once('request', (_req, res) => void res.once('close', () => resolve())));
            const controller = new AbortController();
            const asked = fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(agent), signal: controller.signal }).catch(() => null);
            await vi.waitFor(() => expect(orbit.authorize).toHaveBeenCalled(), { timeout: 3000 });
            controller.abort();
            await asked;
            await serverSawClose;
            // every close listener of that response has run before the next macrotask
            await new Promise((resolve) => setImmediate(resolve));
            letGo();
            // the handler goes on from the refusal in microtasks only: the next macrotask is after it has finished, and the sink is flushed after that
            await new Promise((resolve) => setImmediate(resolve));
            await notes.flush(name);
            expect(rowsOf(name)).toEqual([]);
            expect(notes.sawSince(name, before)).toBe(false);
            expect(notes.endedOnFault(name, before)).toBe(false);
            orbit.authorize.mockClear();
        }
        // a caller that is still there is refused and noted as it always was
        asJob('job-here-pool');
        orbit.authorize.mockResolvedValueOnce({ ok: false, reason: 'pool', full: true });
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-here-pool'))[0]).toMatchObject({ kind: 'fault', reason: 'pool_busy' });
    });

    it('reads no refusal from an error body that was only partly read when the relay’s time ran out: its own cutoff stands, never a confirmed fault from the part', async () => {
        const before = since();
        const original = RELAY_GUARDS.callTimeoutMs;
        (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = 150;
        try {
            asJob('job-partial-401');
            // a 401 whose body starts and then stalls: the status alone would read as our key refused
            upstreamHandler = (_req, res) => {
                res.status(401);
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Length', '500');
                res.write('{"error":{"code":"invalid_api_key","mess');
            };
            // the provider's headers arrived (the relay's 502 for its 401): the time ran out while its body was being read, not before it answered
            expect((await askAndSettle(agent, 1)).answer.status).toBe(502);
            expect(notes.confirmedSince('job-partial-401', before)).toBe(false);
            expect((await rowsSent('job-partial-401'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output' });
            // the same on a person's own key: the relay's cutoff, never their provider refusing
            route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
            asJob('job-partial-own');
            expect((await askAndSettle(agent, 2)).answer.status).toBe(502);
            expect((await rowsSent('job-partial-own'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output', source: 'own-key' });
        } finally {
            (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = original;
        }
        // a refusal whose body came whole in time is read as it always was
        route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai' } as never;
        asJob('job-whole-401');
        upstreamHandler = (_req, res) => res.status(401).json({ error: { message: 'Incorrect API key' } });
        await askAndSettle(agent, 3);
        expect(notes.confirmedSince('job-whole-401', before)).toBe(true);
    });

    it('keeps what a stream said of its own error when it then stalls until the relay’s time limit: the error was the provider’s whole statement, so timing does not decide it; an error cut in the middle is no statement, and the limit stands', async () => {
        const before = since();
        const original = RELAY_GUARDS.callTimeoutMs;
        (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = 150;
        const stalledAfter = (text: string) => (_req: express.Request, res: express.Response) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(text);
        };
        const whole = `data: ${JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key' } })}\n\n`;
        try {
            // our key refused, said whole, then nothing more: the same row as a stream that ended, not a timeout
            asJob('job-stall-error');
            upstreamHandler = stalledAfter(whole);
            await askAndSettle({ ...agent, stream: true }, 1);
            expect(notes.confirmedSince('job-stall-error', before)).toBe(true);
            expect((await rowsSent('job-stall-error'))[0]).toMatchObject({ kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai' });
            asJob('job-stall-error-ended');
            upstreamHandler = (_req, res) => {
                res.setHeader('Content-Type', 'text/event-stream');
                res.end(whole);
            };
            await askAndSettle({ ...agent, stream: true }, 2);
            expect((await rowsSent('job-stall-error-ended'))[0]).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });

            // the same on a person's own key: their provider's refusal, theirs, never a timeout of ours
            route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
            asJob('job-stall-error-own');
            upstreamHandler = stalledAfter(whole);
            await askAndSettle({ ...agent, stream: true }, 3);
            expect(notes.confirmedSince('job-stall-error-own', before)).toBe(false);
            expect((await rowsSent('job-stall-error-own'))[0]).toMatchObject({ kind: 'not_ours', reason: 'own_provider', source: 'own-key' });

            // the error cut in the middle of its JSON and then silence: nothing was said, so the relay's own cutoff, unresolved, on either key
            asJob('job-stall-cut-own');
            upstreamHandler = stalledAfter('data: {"error":{"code":"invalid_api_key","mes');
            await askAndSettle({ ...agent, stream: true }, 4);
            expect((await rowsSent('job-stall-cut-own'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output', source: 'own-key' });
            route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
            asJob('job-stall-cut');
            await askAndSettle({ ...agent, stream: true }, 5);
            expect(notes.confirmedSince('job-stall-cut', before)).toBe(false);
            expect((await rowsSent('job-stall-cut'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output', source: 'universe-ai' });
        } finally {
            (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = original;
        }
    });

    it('does not confirm a key fault from the first of two codes that disagree in a refusal cut at the bound', async () => {
        const before = since();
        asJob('job-cut-two-codes');
        upstreamHandler = (_req, res) =>
            res.status(400).type('application/json').send(`{"error":{"code":"invalid_api_key","code":"invalid_value","message":"x","pad":"${'x'.repeat(RELAY_GUARDS.maxErrorBytes * 2)}"}}`);
        await askAndSettle(agent);
        expect(notes.confirmedSince('job-cut-two-codes', before)).toBe(false);
        expect((await rowsSent('job-cut-two-codes'))[0]).toMatchObject({ kind: 'uncertain', reason: 'fieldless_400' });
    });

    it('stamps a call with the turn it started in, when the runner has moved on by the time it fails', async () => {
        asJob('job-turn-start');
        notes.turn('job-turn-start', 4);
        let fail: () => void = () => undefined;
        upstreamHandler = (_req, res) => {
            fail = () => res.status(500).json({ error: { message: 'boom' } });
        };
        const asked = ask(agent);
        await vi.waitFor(() => expect(upstreamRequests).toHaveLength(1), { timeout: 3000 });
        // the runner ended turn 4 (a reconnect ran out) and began turn 5 while this call was still open
        notes.turn('job-turn-start', 5);
        fail();
        await asked;
        expect((await rowsSent('job-turn-start'))[0]).toMatchObject({ turn: 4 });
        // a call that begins in turn 5 is stamped 5
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'boom' } });
        await ask(agent);
        expect((await rowsSent('job-turn-start', 2))[1]).toMatchObject({ turn: 5 });
    });

    it('writes nothing for a caller that went away while Orbit was being asked for room, and Orbit then failed; a caller that is still there gets the fault', async () => {
        const before = since();
        asJob('job-gone-authorize');
        let fail: () => void = () => undefined;
        orbit.authorize.mockImplementation(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('down')); }));
        const controller = new AbortController();
        const asked = fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(agent), signal: controller.signal }).catch(() => null);
        await vi.waitFor(() => expect(orbit.authorize).toHaveBeenCalled(), { timeout: 3000 });
        controller.abort();
        await asked;
        await new Promise((resolve) => setTimeout(resolve, 100));
        fail();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(notes.endedOnFault('job-gone-authorize', before)).toBe(false);
        expect(rowsOf('job-gone-authorize')).toHaveLength(0);

        asJob('job-here-authorize');
        orbit.authorize.mockRejectedValue(new Error('down'));
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-here-authorize'))[0]).toMatchObject({ kind: 'fault', reason: 'relay_down' });
    });

    it('notes Orbit that cannot be asked, a Brick with no AI, and computers all busy as faults of ours', async () => {
        const before = since();
        asJob('job-busy');
        orbit.authorize.mockRejectedValue(new Error('down'));
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-busy', before)).toBe(true);

        asJob('job-resting');
        route = null as never;
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-resting', before)).toBe(true);

        asJob('job-pool');
        route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'pool', full: true });
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-pool', before)).toBe(true);
    });

    it('does not note a refusal for the person’s allowance or rule, or a call the provider refused for its content, as a fault of ours', async () => {
        const before = since();
        asJob('job-allowance');
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        await ask(agent);
        expect(notes.endedOnFault('job-allowance', before)).toBe(false);

        asJob('job-wrong');
        orbit.authorize.mockResolvedValue({ ok: true });
        upstreamHandler = (_req, res) => res.status(400).json({ error: { message: 'maximum context length exceeded' } });
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-wrong', before)).toBe(false);
    });

    it('does not note a fault that a later call made good, and notes one that came after an answer', async () => {
        asJob('job-retry');
        const before = since();
        upstreamHandler = (_req, res) => res.status(503).json({ error: { message: 'busy' } });
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-retry', before)).toBe(true);
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-retry', before)).toBe(false);
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'broke' } });
        await askAndSettle(agent, 3);
        expect(notes.endedOnFault('job-retry', before)).toBe(true);
    });

    it('notes a rate limit on our own key, a 502 for a revoked key of ours, and a stored key that cannot be read, as faults of ours', async () => {
        const before = since();
        asJob('job-ratelimit');
        upstreamHandler = (_req, res) => res.status(429).json({ error: { message: 'slow down' } });
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-ratelimit', before)).toBe(true);

        asJob('job-revoked');
        upstreamHandler = (_req, res) => res.status(401).json({ error: { message: 'revoked' } });
        await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-revoked', before)).toBe(true);

        // a stored key that cannot be read is ours on a person's key too
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-unreadable-own');
        const encryption = await import('../ai/encryption');
        const spy = vi.spyOn(encryption, 'decryptApiKey').mockImplementation(() => {
            throw new Error('bad key');
        });
        try {
            await askAndSettle(agent, 3);
            expect(notes.endedOnFault('job-unreadable-own', before)).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    it('notes a refusal of a person’s own key or credit on their side, never a fault of ours; every other failure of their provider, key or endpoint is unresolved, as on Universe’s key', async () => {
        const before = since();
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        let count = 0;
        // their key out of credit (402 comes to Hermes as 502) and a revoked key: theirs, so a turn that ends on it is never ours
        for (const [name, status] of [['job-own-402', 402], ['job-own-401', 401]] as const) {
            asJob(name);
            upstreamHandler = (_req, res) => res.status(status).json({ error: { message: 'no' } });
            count += 1;
            await askAndSettle(agent, count);
            expect(notes.endedOnFault(name, before)).toBe(false);
            expect(notes.sawSince(name, before)).toBe(true);
        }
        // their provider's own error, a rate limit: nothing proves whose it was, so it is read as on our key (unresolved, and a fault the runner may end on)
        for (const [name, status] of [['job-own-500', 500], ['job-own-429', 429]] as const) {
            asJob(name);
            upstreamHandler = (_req, res) => res.status(status).json({ error: { message: 'no' } });
            count += 1;
            await askAndSettle(agent, count);
            expect(notes.endedOnFault(name, before)).toBe(true);
            expect(notes.confirmedSince(name, before)).toBe(false);
            expect(notes.sawSince(name, before)).toBe(false);
        }
        // an endpoint that is gone
        asJob('job-own-gone');
        route = { config: config({ endpoint: 'http://127.0.0.1:1/v1' }), source: 'own-key', keyOwnerId: 'person-owner' };
        count += 1;
        await askAndSettle(agent, count);
        expect(notes.endedOnFault('job-own-gone', before)).toBe(true);
        expect(notes.confirmedSince('job-own-gone', before)).toBe(false);
        expect(notes.sawSince('job-own-gone', before)).toBe(false);

        // a stream their endpoint cut off
        asJob('job-own-cut');
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        upstreamHandler = (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            setTimeout(() => req.socket.destroy(), 10);
        };
        const cut = await ask({ ...agent, stream: true });
        await cut.text().catch(() => '');
        count += 1;
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(count), { timeout: 3000 });
        expect(notes.endedOnFault('job-own-cut', before)).toBe(true);
        expect(notes.confirmedSince('job-own-cut', before)).toBe(false);
        expect(notes.sawSince('job-own-cut', before)).toBe(false);
    });

    it('reads a refused token limit by whose value it was: the job’s own ask with no setting of ours is the request’s, a value under our setting is ours', async () => {
        const before = since();
        const tooLarge = (_req: express.Request, res: express.Response) => res.status(400).json({ error: { param: 'max_tokens', code: 'invalid_value', message: 'max_tokens is too large: 32768. This model supports at most 8192' } });
        asJob('job-limit-asked');
        route = { config: config({ endpoint: upstreamBase, maxTokens: 0 }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = tooLarge;
        await askAndSettle({ ...agent, max_tokens: 100_000 }, 1);
        expect(notes.endedOnFault('job-limit-asked', before)).toBe(false);
        expect(notes.sawSince('job-limit-asked', before)).toBe(true);

        asJob('job-limit-setting');
        route = { config: config({ endpoint: upstreamBase, maxTokens: 32_768 }), source: 'universe-ai', keyOwnerId: null };
        await askAndSettle({ ...agent, max_tokens: 16_384 }, 2);
        expect(notes.endedOnFault('job-limit-setting', before)).toBe(true);
    });

    it('reads the relay’s own time limit as unresolved either way: no output in time and output that was still coming are both for Orbit’s bounded goodwill, each with its own reason', async () => {
        const before = since();
        const original = RELAY_GUARDS.callTimeoutMs;
        (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = 150;
        try {
            // a stream that wrote nothing in time
            asJob('job-timeout-silent');
            upstreamHandler = () => undefined;
            await askAndSettle({ ...agent, stream: true }, 1);
            expect(notes.endedOnFault('job-timeout-silent', before)).toBe(true);
            expect(notes.confirmedSince('job-timeout-silent', before)).toBe(false);
            expect((await rowsSent('job-timeout-silent'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output', source: 'universe-ai' });

            // a stream that was writing when the time ran out proves progress only
            asJob('job-timeout-writing');
            upstreamHandler = (_req, res) => {
                res.setHeader('Content-Type', 'text/event-stream');
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            };
            await askAndSettle({ ...agent, stream: true }, 2);
            expect(notes.endedOnFault('job-timeout-writing', before)).toBe(true);
            expect(notes.confirmedSince('job-timeout-writing', before)).toBe(false);
            expect((await rowsSent('job-timeout-writing'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_after_output' });

            // not streamed: nothing came through
            asJob('job-timeout-plain');
            upstreamHandler = () => undefined;
            await askAndSettle(agent, 3);
            expect((await rowsSent('job-timeout-plain'))[0]).toMatchObject({ kind: 'uncertain', reason: 'timeout_no_output' });
        } finally {
            (RELAY_GUARDS as { callTimeoutMs: number }).callTimeoutMs = original;
        }
    });

    it('does not note a caller that went away while the provider was still working as a fault of anyone', async () => {
        const before = since();
        asJob('job-hungup');
        // the provider hangs; the caller gives up and goes away
        upstreamHandler = () => undefined;
        const controller = new AbortController();
        const pending = fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(agent) }).catch(() => null);
        await vi.waitFor(() => expect(upstreamRequests).toHaveLength(1), { timeout: 3000 });
        controller.abort();
        await pending;
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(notes.endedOnFault('job-hungup', before)).toBe(false);
    });

    it('does not note a refusal for the person’s allowance on a side call with no tools', async () => {
        const before = since();
        asJob('job-side-refused');
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        expect((await ask({ messages })).status).toBe(429);
        expect(notes.sawSince('job-side-refused', before)).toBe(false);
        expect((await ask(agent)).status).toBe(429);
        expect(notes.sawSince('job-side-refused', before)).toBe(true);
    });

    it('reads an error the provider put in a 200 stream (or a 200 body with no choices) as its fault: unresolved on our key and on theirs', async () => {
        const before = since();
        const sseError = (_req: express.Request, res: express.Response) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`);
            res.end();
        };
        asJob('job-stream-error');
        upstreamHandler = sseError;
        await askAndSettle({ ...agent, stream: true });
        expect(notes.endedOnFault('job-stream-error', before)).toBe(true);

        asJob('job-body-error');
        upstreamHandler = (_req, res) => res.json({ error: { message: 'overloaded' } });
        await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-body-error', before)).toBe(true);

        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-own-stream-error');
        upstreamHandler = sseError;
        await askAndSettle({ ...agent, stream: true }, 3);
        // on their own key it is unresolved too, not theirs
        expect(notes.endedOnFault('job-own-stream-error', before)).toBe(true);
        expect(notes.sawSince('job-own-stream-error', before)).toBe(false);
    });

    it('says the Brick’s own key resting is the person’s: noted on their side, never a fault of ours; Universe AI resting or an unknown route stays ours', async () => {
        const before = since();
        asJob('job-own-resting');
        route = { restingOwnKey: true } as never;
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-own-resting', before)).toBe(false);
        expect(notes.sawSince('job-own-resting', before)).toBe(true);
        expect(upstreamRequests).toHaveLength(0);

        asJob('job-unknown-route');
        route = null as never;
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-unknown-route', before)).toBe(true);
    });

    it('reads what the provider said: 401, 402, a key code and a 404 naming our model are our key or our settings (ours), a plain 403 or a 404 about image input or tool use is unresolved; moderation, a context too long and a body too large are the request’s (not ours, not an answer)', async () => {
        const before = since();
        let count = 0;
        const said = async (name: string, status: number, error: Record<string, unknown>) => {
            asJob(name);
            upstreamHandler = (_req, res) => res.status(status).json({ error });
            count += 1;
            await askAndSettle(agent, count);
        };
        await said('job-403-plain', 403, { message: 'Forbidden' });
        await said('job-401', 401, { message: 'revoked' });
        await said('job-402', 402, { message: 'out of credit' });
        await said('job-403-moderation', 403, { message: 'Your request was flagged by content moderation', code: 'content_policy_violation' });
        await said('job-404', 404, { message: 'The model does not exist' });
        await said('job-400-param', 400, { message: 'Unsupported parameter: max_tokens', param: 'max_tokens' });
        await said('job-400-temperature', 400, { message: 'temperature must be at most 2', param: 'temperature' });
        await said('job-400-noparam', 400, { message: 'bad request' });
        await said('job-401-invalid-request', 401, { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key' });
        await said('job-404-invalid-request', 404, { type: 'invalid_request_error', code: 'model_not_found', message: 'The model does not exist' });
        await said('job-422-messages', 422, { message: 'invalid image url', param: 'messages[0].content' });
        await said('job-400-context', 400, { code: 'context_length_exceeded', message: 'maximum context length exceeded' });
        await said('job-413', 413, { message: 'payload' });
        await said('job-404-image', 404, { message: 'No endpoints found that support image input', code: 404 });
        await said('job-404-tools', 404, { message: 'No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs', code: 404 });
        await said('job-404-our-model', 404, { message: 'No endpoints found for vendor/our-model.', code: 404 });
        await said('job-404-plain', 404, { message: 'Not found' });
        await said('job-404-model-image', 404, { message: 'No endpoints found for vendor/our-model that support image input.', code: 404 });
        // A fieldless 400 (a bad payload of the job's, or a serialization error of ours, cannot be told apart) is unresolved: a fault of the turn, never confirmed
        for (const name of ['job-403-plain', 'job-401', 'job-402', 'job-404', 'job-400-param', 'job-400-noparam', 'job-401-invalid-request', 'job-404-invalid-request', 'job-404-image', 'job-404-tools', 'job-404-our-model', 'job-404-plain', 'job-404-model-image']) expect(notes.endedOnFault(name, before)).toBe(true);
        for (const name of ['job-401', 'job-402', 'job-404', 'job-401-invalid-request', 'job-404-invalid-request', 'job-404-our-model']) expect(notes.confirmedSince(name, before)).toBe(true);
        // A 404 that says the request needs something the model lacks (the job sends the image, the tools), a plain 404 and a plain 403 are not confirmed: unresolved
        for (const name of ['job-400-param', 'job-400-noparam', 'job-403-plain', 'job-404-image', 'job-404-tools', 'job-404-plain', 'job-404-model-image']) expect(notes.confirmedSince(name, before)).toBe(false);
        for (const name of ['job-404-image', 'job-404-tools', 'job-404-plain', 'job-404-model-image']) expect((await rowsSent(name))[0]).toMatchObject({ kind: 'uncertain', reason: 'fieldless_400', providerStatus: 404 });
        expect((await rowsSent('job-403-plain'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_403', providerStatus: 403 });
        expect((await rowsSent('job-404-our-model'))[0]).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        expect((await rowsSent('job-400-noparam'))[0]).toMatchObject({ kind: 'uncertain', reason: 'fieldless_400', providerStatus: 400 });
        expect((await rowsSent('job-400-param'))[0]).toMatchObject({ kind: 'uncertain', reason: 'field_relay_set' });
        expect((await rowsSent('job-401'))[0]).toMatchObject({ kind: 'fault', reason: 'provider_key_ours', providerStatus: 401, source: 'universe-ai' });
        expect((await rowsSent('job-400-temperature'))[0]).toMatchObject({ kind: 'not_ours', reason: 'field_job_set' });
        for (const name of ['job-403-moderation', 'job-400-context', 'job-413', 'job-400-temperature', 'job-422-messages']) {
            expect(notes.endedOnFault(name, before)).toBe(false);
            // the request's own failure is off our side: the runner never ends the job as ours for it
            expect(notes.sawSince(name, before)).toBe(true);
        }
    });

    it('reads an error object inside a 200 by what it says: moderation or a context too long is the request’s; a 5xx, a 429, a parameter error or no code is ours', async () => {
        const before = since();
        let count = 0;
        const inBody = async (name: string, error: Record<string, unknown>) => {
            asJob(name);
            upstreamHandler = (_req, res) => res.json({ error });
            count += 1;
            await askAndSettle(agent, count);
        };
        await inBody('job-200-400', { code: 400, message: 'prompt is too long' });
        await inBody('job-200-context', { code: 'context_length_exceeded', message: 'too long' });
        await inBody('job-200-moderation', { message: 'blocked by moderation' });
        await inBody('job-200-500', { code: 500, message: 'internal' });
        await inBody('job-200-429', { code: '429', message: 'rate' });
        await inBody('job-200-nocode', { message: 'something broke' });
        await inBody('job-200-param', { code: 400, message: 'invalid parameter', param: 'model' });
        await inBody('job-200-tools', { type: 'invalid_request_error', message: 'bad schema', param: 'tools[0]' });
        await inBody('job-200-422', { code: 422, message: 'unprocessable' });
        await inBody('job-200-key', { type: 'invalid_request_error', code: 'invalid_api_key', param: null, message: 'Incorrect API key provided' });
        await inBody('job-200-model', { type: 'invalid_request_error', code: 'model_not_found', param: 'messages', message: 'The model does not exist' });
        for (const name of ['job-200-400', 'job-200-context', 'job-200-moderation', 'job-200-tools']) expect(notes.endedOnFault(name, before)).toBe(false);
        // job-200-422 names no field: unresolved
        for (const name of ['job-200-500', 'job-200-429', 'job-200-nocode', 'job-200-param', 'job-200-key', 'job-200-model', 'job-200-422']) expect(notes.endedOnFault(name, before)).toBe(true);
        for (const name of ['job-200-key', 'job-200-model']) expect(notes.confirmedSince(name, before)).toBe(true);
        for (const name of ['job-200-500', 'job-200-429', 'job-200-nocode', 'job-200-param', 'job-200-422']) expect(notes.confirmedSince(name, before)).toBe(false);
    });

    it('reads a key or model error inside a stream as ours, whatever type it carries', async () => {
        const before = since();
        asJob('job-stream-key');
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_api_key', param: null, message: 'Incorrect API key provided' } })}\n\n`);
            res.end();
        };
        await askAndSettle({ ...agent, stream: true });
        expect(notes.endedOnFault('job-stream-key', before)).toBe(true);
    });

    it('does not let a side call that carries no tools make or unmake a fault of the turn', async () => {
        asJob('job-side');
        const before = since();
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        await askAndSettle(agent);
        // a summary or title call that fails after the turn was answered is no fault of the turn
        upstreamHandler = (_req, res) => res.status(500).json({ error: { message: 'broke' } });
        await askAndSettle({ messages }, 2);
        expect(notes.endedOnFault('job-side', before)).toBe(false);
        // and a side call that works does not make good a fault of the agent's own call
        asJob('job-side-2');
        await askAndSettle(agent, 3);
        expect(notes.endedOnFault('job-side-2', before)).toBe(true);
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        await askAndSettle({ messages }, 4);
        expect(notes.endedOnFault('job-side-2', before)).toBe(true);
    });

    it('notes a streamed answer that the provider cut off as a fault of ours, and a whole one as an answer', async () => {
        const before = since();
        asJob('job-cut');
        upstreamHandler = (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
            setTimeout(() => req.socket.destroy(), 10);
        };
        const cut = await ask({ ...agent, stream: true });
        await cut.text().catch(() => '');
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(notes.endedOnFault('job-cut', before)).toBe(true);

        asJob('job-whole');
        upstreamHandler = (_req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\ndata: [DONE]\n\n`);
            res.end();
        };
        await askAndSettle({ ...agent, stream: true }, 2);
        expect(notes.endedOnFault('job-whole', before)).toBe(false);
    });
});

describe('whoseProviderError', () => {
    it('reads a 429 “Requested” as the input plus our limit: ours when the input alone fits, the request’s when it does not or when the job set the limit', () => {
        const message = (requested: number) => `Request too large for gpt-4o on tokens per min (TPM): Limit 30000, Requested ${requested}. The input or output tokens must be reduced in order to run successfully.`;
        // our setting 32768, a 100-token prompt: the input fits, our limit made it too large
        expect(whoseProviderError(429, { message: message(32_868) }, { limit: false, name: false, outputCap: 32_768 })).toBe('ours');
        // a prompt of exactly the limit (30000) with our cap of 1000: the input fits, removing our cap would bring the request within the limit
        expect(readProviderError(429, { message: message(31_000) }, { limit: false, name: false, outputCap: 1000 })).toMatchObject({ who: 'ours', kind: 'uncertain', reason: 'provider_429' });
        // one token over the limit: the prompt alone does not fit
        expect(whoseProviderError(429, { message: message(31_001) }, { limit: false, name: false, outputCap: 1000 })).toBe('request');
        // a 40000-token prompt with our 4096: the input alone does not fit
        expect(whoseProviderError(429, { message: message(44_096) }, { limit: false, name: false, outputCap: 4096 })).toBe('request');
        // the job set the limit
        expect(whoseProviderError(429, { message: message(32_868) }, { limit: true, name: false, outputCap: 32_768 })).toBe('request');
        // no numbers to read: the request's
        expect(whoseProviderError(429, { message: 'Request too large for this model' }, { limit: false, name: false, outputCap: 4096 })).toBe('request');
    });
    it('reads a 429 that says this one request is too large as the request’s, and a plain rate limit as ours', () => {
        expect(whoseProviderError(429, { message: 'Request too large for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Requested 45000. The input or output tokens must be reduced in order to run successfully.' })).toBe('request');
        expect(whoseProviderError(429, { message: 'Limit 30000, Requested 45000' })).toBe('request');
        expect(whoseProviderError(429, { message: 'Rate limit reached for gpt-4o on tokens per min (TPM): Limit 30000, Used 28000, Requested 5000. Please try again in 2s.' })).toBe('ours');
        expect(whoseProviderError(429, {})).toBe('ours');
    });
    it('reads the prompt-length wording of a provider that counts the input with the limit as the request’s', () => {
        expect(whoseProviderError(400, { param: 'max_tokens', message: 'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 32769' }, { limit: false, name: false })).toBe('request');
        expect(whoseProviderError(400, { param: 'max_tokens', message: 'max_new_tokens plus prompt tokens exceed the window' }, { limit: false, name: false })).toBe('request');
    });
    it('reads a refusal of the token limit by whose limit it was: the job’s own ask is the request’s, a limit we chose is ours unless the wording blames the input', () => {
        // (a) OpenAI’s own body when the job asked for more than the model takes
        expect(whoseProviderError(400, { param: 'max_tokens', code: 'invalid_value', message: 'max_tokens is too large: 32768. This model supports at most 8192 completion tokens' }, { limit: true, name: false })).toBe('request');
        // (b) a provider that counts the input and the limit together
        expect(whoseProviderError(400, { param: 'max_tokens', code: null, message: 'Input validation error: inputs tokens + max_new_tokens must be <= 32769' }, { limit: false, name: false })).toBe('request');
        // (c) a context length
        expect(whoseProviderError(400, { param: 'max_tokens', message: "This model's maximum context length is 4096 tokens. However, you requested 5000 tokens (3000 in the messages, 2000 in the completion)." }, { limit: false, name: false })).toBe('request');
        expect(whoseProviderError(400, { param: 'max_tokens', code: 'context_length_exceeded', message: 'too large' }, { limit: false, name: false })).toBe('request');
        // A limit we chose, refused as too large: ours
        expect(whoseProviderError(400, { param: 'max_tokens', message: 'max_tokens is too large: 100000. This model supports at most 4096' }, { limit: false, name: false })).toBe('ours');
        expect(whoseProviderError(400, { param: 'max_completion_tokens', message: 'max_completion_tokens exceeds the maximum allowed for this model' }, { limit: false, name: false })).toBe('ours');
        expect(whoseProviderError(null, { type: 'invalid_request_error', param: 'max_tokens', message: 'token limit too large' }, { limit: false, name: false })).toBe('ours');
        // The name of the field is ours either way; model, n and stream are ours whoever asked
        expect(whoseProviderError(400, { param: 'max_tokens', message: 'Unsupported parameter: max_tokens is not supported with this model' }, { limit: true, name: false })).toBe('ours');
        expect(whoseProviderError(400, { param: 'model', message: 'too large' }, { limit: true, name: false })).toBe('ours');
        expect(whoseProviderError(400, { param: 'messages', code: 'context_length_exceeded', message: 'maximum context length' }, { limit: false, name: false })).toBe('request');
        expect(whoseProviderError(400, { param: 'messages[0].content', message: 'content is too large' }, { limit: false, name: false })).toBe('request');
    });
    it('reads whose the token limit and its field name are: the job’s own ask when we set no limit, a setting’s mistake otherwise; the name is the job’s off OpenAI’s host', () => {
        // no setting: any ask is the job's, including one the guard lowered
        expect(jobsOwnLimit({ max_tokens: 500 }, config({ maxTokens: 0 })).limit).toBe(true);
        expect(jobsOwnLimit({ max_tokens: 100_000 }, config({ maxTokens: 0 })).limit).toBe(true);
        expect(jobsOwnLimit({}, config({ maxTokens: 0 })).limit).toBe(false);
        // a setting: a refused value is ours, even an honest ask under it
        expect(jobsOwnLimit({ max_tokens: 16_384 }, config({ maxTokens: 32_768 })).limit).toBe(false);
        expect(jobsOwnLimit({ max_tokens: 32_768 }, config({ maxTokens: 8192 })).limit).toBe(false);
        // the name: OpenAI's host gets max_completion_tokens whatever the job wrote; elsewhere the job's own name is kept
        expect(jobsOwnLimit({ max_completion_tokens: 500 }, config({ endpoint: 'https://api.openai.com/v1' })).name).toBe(false);
        expect(jobsOwnLimit({ max_completion_tokens: 500 }, config({ endpoint: 'https://api.together.xyz/v1' })).name).toBe(true);
        // max_tokens is the name the relay sends there anyway (an Azure o-series deployment rejects it whoever wrote it): ours
        expect(jobsOwnLimit({ max_tokens: 500 }, config({ endpoint: 'https://my.openai.azure.com/v1' })).name).toBe(false);
        expect(jobsOwnLimit({}, config({ endpoint: 'https://api.together.xyz/v1' })).name).toBe(false);
    });
    it('reads a refused field name as ours only when the relay picked it', () => {
        const unsupported = { param: 'max_completion_tokens', message: "Unsupported parameter: 'max_completion_tokens' is not supported with this model" };
        expect(whoseProviderError(400, unsupported, { limit: false, name: false })).toBe('ours');
        expect(whoseProviderError(400, unsupported, { limit: false, name: true })).toBe('request');
    });
    it('is the request’s for moderation, a context too long, a body too large and a 400/422 about anything but the relay’s own fields; everything else is ours', () => {
        expect(whoseProviderError(500, {})).toBe('ours');
        expect(whoseProviderError(503, { message: 'moderation backend down' })).toBe('ours');
        expect(whoseProviderError(429, {})).toBe('ours');
        expect(whoseProviderError(401, {})).toBe('ours');
        expect(whoseProviderError(402, {})).toBe('ours');
        expect(whoseProviderError(403, { message: 'nope' })).toBe('ours');
        expect(whoseProviderError(404, { message: 'model not found' })).toBe('ours');
        expect(whoseProviderError(400, { message: 'Unsupported parameter', param: 'max_tokens' }, { limit: false, name: false })).toBe('ours');
        expect(whoseProviderError(400, { param: 'max_tokens' }, { limit: false, name: false })).toBe('ours');
        expect(whoseProviderError(400, { param: 'stream_options.include_usage' })).toBe('ours');
        expect(whoseProviderError(422, { param: 'model' })).toBe('ours');
        expect(whoseProviderError(400, { param: 'temperature' })).toBe('request');
        // OpenAI says invalid_request_error on a revoked key, no credit and a model that is gone: those are ours
        expect(whoseProviderError(401, { type: 'invalid_request_error', code: 'invalid_api_key' })).toBe('ours');
        expect(whoseProviderError(402, { type: 'invalid_request_error' })).toBe('ours');
        expect(whoseProviderError(404, { type: 'invalid_request_error', code: 'model_not_found', param: 'messages' })).toBe('ours');
        expect(whoseProviderError(403, { type: 'invalid_request_error', param: 'tools' })).toBe('ours');
        // with no status (an error object inside a 200 or a stream) the error names it itself
        expect(whoseProviderError(null, { type: 'invalid_request_error', code: 'invalid_api_key', param: null })).toBe('ours');
        expect(whoseProviderError(null, { type: 'invalid_request_error', code: 'model_not_found', param: 'messages' })).toBe('ours');
        expect(whoseProviderError(null, { type: 'insufficient_quota', code: 'insufficient_quota' })).toBe('ours');
        expect(whoseProviderError(null, { type: 'invalid_request_error', code: 'billing_hard_limit_reached' })).toBe('ours');
        expect(whoseProviderError(null, { type: 'invalid_request_error', param: 'temperature' })).toBe('request');
        expect(whoseProviderError(null, { message: 'Incorrect API key provided' })).toBe('ours');
        // a provider echoes the job's own values in its message, and a job can steer those: never read as ours
        expect(whoseProviderError(400, { param: 'messages[0].role', message: "Invalid value: 'billing'. Supported values are: 'system', 'user'." })).toBe('request');
        expect(whoseProviderError(400, { param: 'messages[0].content[1].file.file_id', message: "The file 'file-abc' does not exist" })).toBe('request');
        expect(whoseProviderError(422, { param: 'tool_choice', message: "tool 'permission_denied' does not exist" })).toBe('request');
        // a 400 or 422 that names no field cannot be told from a bad payload of the job's or a serialization error of ours: unresolved, and never confirmed from an echoed word
        expect(readProviderError(400, { message: "Invalid value: 'billing'" })).toEqual({ who: 'ours', kind: 'uncertain', reason: 'fieldless_400' });
        expect(whoseProviderError(null, { param: 'messages[0].role', message: "Invalid value: 'billing'. Supported values are" })).toBe('request');
        expect(whoseProviderError(null, { type: 'invalid_request_error', param: 'tools[0]', message: "tool 'insufficient_quota' does not exist" })).toBe('request');
        expect(whoseProviderError(null, { type: 'invalid_request_error', code: 'context_length_exceeded', param: 'messages' })).toBe('request');
        expect(whoseProviderError(400, { param: 'messages[0].content[1].image_url' })).toBe('request');
        expect(readProviderError(400, {})).toEqual({ who: 'ours', kind: 'uncertain', reason: 'fieldless_400' });
        expect(readProviderError(422, {})).toEqual({ who: 'ours', kind: 'uncertain', reason: 'fieldless_400' });
        // a plain 403 is unresolved under a reason of its own, so operations can read it; a 400 with no field keeps its own
        expect(readProviderError(403, { message: 'Forbidden' })).toEqual({ who: 'ours', kind: 'uncertain', reason: 'provider_403' });
        expect(whoseProviderError(null, { type: 'invalid_request_error', param: 'tools' })).toBe('request');
        expect(whoseProviderError(403, { code: 'moderation_blocked' })).toBe('request');
        expect(whoseProviderError(400, { code: 'context_length_exceeded' })).toBe('request');
        expect(whoseProviderError(400, { message: 'Your prompt is too long' })).toBe('request');
        expect(whoseProviderError(413, {})).toBe('request');
        expect(whoseProviderError(null, { code: 'content_filter' })).toBe('request');
        expect(whoseProviderError(null, { code: 524 })).toBe('ours');
        expect(whoseProviderError(null, 'a string')).toBe('ours');
    });
});

describe('what #2078 (bounded provider reads, per-call metering) and #2101 (whose fault a call was) do together', () => {
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const since = () => Date.now() - 1;
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });
    const sseOf = (res: express.Response, chunks: string[]) => {
        res.setHeader('Content-Type', 'text/event-stream');
        for (const chunk of chunks) res.write(chunk);
        res.end();
    };
    const dataOf = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

    const refused = (status: number, error: Record<string, unknown>) => (_req: express.Request, res: express.Response) => res.status(status).json({ error });
    const tooBig = 'x'.repeat(RELAY_GUARDS.maxErrorBytes * 2);

    it('reads whose a refusal is from the fields that came before the bound, so an answer too long to keep whole is not read as the request’s', async () => {
        const before = since();
        const unsupported = { message: 'Unsupported parameter: max_tokens', param: 'max_tokens', code: 'unsupported_parameter', type: 'invalid_request_error' };
        // the same refusal, short and long: our own setting, ours both times
        asJob('job-short-refusal');
        upstreamHandler = refused(400, unsupported);
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-short-refusal', before)).toBe(true);

        asJob('job-long-refusal');
        upstreamHandler = refused(400, { ...unsupported, pad: tooBig });
        const { answer, text } = await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-long-refusal', before)).toBe(true);
        // what Hermes is told is short, never the provider's whole answer
        expect(answer.status).toBe(400);
        expect(text.length).toBeLessThan(RELAY_GUARDS.maxErrorBytes);
        // the call was refused, so nothing is priced
        expect(settled()[1]).toMatchObject({ jobId: 'job-long-refusal', sent: true, costMicros: 0, tokens: { input: 0, output: 0 } });
    });

    it('reads a 404 cut at the bound whose error fields were cut away as unresolved, never from the raw words: a model named in a sibling object is no confirmed fault', async () => {
        const before = since();
        asJob('job-cut-404');
        // `meta` says a model does not exist; the `error` object (what a full parse would read) was cut before its words
        upstreamHandler = (_req, res) =>
            res.status(404).type('application/json').send(`{"meta":{"message":"model xyz does not exist"},"error":{"pad":"${tooBig}","message":"model xyz does not exist"}}`);
        await askAndSettle(agent);
        expect(notes.confirmedSince('job-cut-404', before)).toBe(false);
        expect((await rowsSent('job-cut-404'))[0]).toMatchObject({ kind: 'uncertain', providerStatus: 404 });
        // The same words inside the error object, whole, are what they always were: our model is gone, ours
        const whole = since();
        asJob('job-whole-404');
        upstreamHandler = (_req, res) => res.status(404).json({ error: { message: 'model xyz does not exist' } });
        await askAndSettle(agent, 2);
        expect(notes.confirmedSince('job-whole-404', whole)).toBe(true);
    });

    it('reads a refusal cut at the bound from its error object only: a key code in a sibling object is no confirmed fault, as the full body would not read it either', async () => {
        const before = since();
        asJob('job-cut-sibling');
        upstreamHandler = (_req, res) =>
            res.status(400).type('application/json').send(`{"meta":{"code":"invalid_api_key"},"error":{"message":"Invalid value","param":"temperature","pad":"${tooBig}"}}`);
        await askAndSettle(agent);
        expect(notes.confirmedSince('job-cut-sibling', before)).toBe(false);
        expect((await rowsSent('job-cut-sibling'))[0]).toMatchObject({ kind: 'not_ours', reason: 'field_job_set' });
    });

    it('does not read a field the cut took away: a refusal whose words come after the bound names no field, so it is unresolved (fieldless), never confirmed as ours', async () => {
        const before = since();
        asJob('job-cut-away');
        upstreamHandler = refused(400, { pad: tooBig, message: 'Unsupported parameter: max_tokens', param: 'max_tokens', code: 'unsupported_parameter', type: 'invalid_request_error' });
        await askAndSettle(agent);
        expect(notes.confirmedSince('job-cut-away', before)).toBe(false);
        expect((await rowsSent('job-cut-away'))[0]).toMatchObject({ kind: 'uncertain', reason: 'fieldless_400' });
    });

    it('keeps a refusal of ours as ours by its status when its answer is too long to keep, and reads nothing the provider only echoed after the cut', async () => {
        const before = since();
        asJob('job-long-401');
        upstreamHandler = refused(401, { message: 'Incorrect API key provided', code: 'invalid_api_key', pad: tooBig });
        await askAndSettle(agent);
        expect(notes.endedOnFault('job-long-401', before)).toBe(true);
        asJob('job-long-500');
        upstreamHandler = refused(500, { pad: tooBig });
        await askAndSettle(agent, 2);
        expect(notes.endedOnFault('job-long-500', before)).toBe(true);
    });

    it('drops a stream line past the bound without reading it, and still notes the stream’s own error that comes after it as a fault of ours', async () => {
        const before = since();
        asJob('job-stream-long');
        const oversized = `data: ${JSON.stringify({ choices: [], pad: 'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 100) })}\n\n`;
        upstreamHandler = (_req, res) => sseOf(res, [dataOf({ choices: [{ delta: { content: 'Hel' } }] }), oversized, dataOf({ error: { type: 'invalid_request_error', code: 'invalid_api_key', param: null, message: 'Incorrect API key provided' } })]);
        await askAndSettle({ ...agent, stream: true });
        expect(notes.endedOnFault('job-stream-long', before)).toBe(true);
    });

    it('prices a cut stream from what came through (not from a line it dropped) and notes it as a fault of ours', async () => {
        const before = since();
        asJob('job-stream-cut');
        const oversized = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 999, completion_tokens: 999 }, pad: 'x'.repeat(RELAY_GUARDS.maxStreamLineChars + 100) })}\n\n`;
        upstreamHandler = (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(dataOf({ choices: [{ delta: { content: 'Hello there, this is a cut answer' } }] }) + oversized);
            setTimeout(() => req.socket.destroy(), 10);
        };
        const cut = await ask({ ...agent, stream: true });
        await cut.text().catch(() => '');
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(notes.endedOnFault('job-stream-cut', before)).toBe(true);
        expect(settled()[0]).toMatchObject({ jobId: 'job-stream-cut', sent: true });
        expect(settled()[0].tokens?.output).not.toBe(999);
        expect(settled()[0].tokens?.output).toBeGreaterThan(0);
    });

    it('two jobs calling at once: every settle carries its own job, and a fault of one is not noted on the other', async () => {
        const before = since();
        const tokenA = `cjt_${'b'.repeat(43)}`;
        const tokenB = `cjt_${'c'.repeat(43)}`;
        orbit.identify.mockImplementation(async (token: string) => ({ ok: true, jobId: token === tokenA ? 'job-two-a' : 'job-two-b', botId: BOT }));
        upstreamHandler = (req, res) => {
            const auth = String(req.headers.authorization ?? '');
            // both calls go out with the same key of ours: the job is told apart by the order, so the first call to arrive fails and the other answers
            if (upstreamRequests.length === 1) res.status(500).json({ error: { message: 'broke' } });
            else res.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
            void auth;
        };
        const [first, second] = await Promise.all([ask(agent, tokenA), ask(agent, tokenB)]);
        await Promise.all([first.text(), second.text()]);
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(2), { timeout: 3000 });
        expect(settled().map((input) => input.jobId).sort()).toEqual(['job-two-a', 'job-two-b']);
        expect(new Set(settled().map((input) => input.callId)).size).toBe(2);
        // exactly one of the two jobs ended on the fault, and it is the one whose call failed
        const failed = settled().find((input) => input.costMicros === 0)!;
        const faulty = ['job-two-a', 'job-two-b'].filter((job) => notes.endedOnFault(job, before));
        expect(faulty).toEqual([failed.jobId]);
    });
});

describe('a model that is missing', () => {
    it('reads a 429 that names our credit or key as ours, always given back, and a plain rate limit as unresolved', () => {
        // OpenAI-style providers say our used-up credit as 429 + insufficient_quota (code or type); that is not a rate limit
        expect(readProviderError(429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' })).toEqual({ who: 'ours', kind: 'fault', reason: 'provider_key_ours' });
        expect(readProviderError(429, { type: 'insufficient_quota', message: 'x' })).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        expect(readProviderError(429, { code: 'billing_hard_limit_reached', message: 'x' })).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        // the same code in an error that has no status of its own (a stream error event): numeric from the code field is not needed, the status is the call's
        expect(readProviderError(429, { code: 'rate_limit_exceeded', type: 'requests', message: 'Rate limit reached' })).toEqual({ who: 'ours', kind: 'uncertain', reason: 'provider_429' });
        expect(readProviderError(429, { message: 'Too many requests' })).toEqual({ who: 'ours', kind: 'uncertain', reason: 'provider_429' });
        // a key word only in the message (what a provider echoes of the job's own words) is not read as ours
        expect(readProviderError(429, { code: 'rate_limit_exceeded', message: 'You exceeded your current quota, please check your plan and billing details' })).toMatchObject({ kind: 'uncertain', reason: 'provider_429' });
        expect(readProviderError(429, { message: 'insufficient_quota billing' })).toMatchObject({ kind: 'uncertain', reason: 'provider_429' });
        // a request that is too large for the provider's limit is still the request's
        expect(readProviderError(429, { code: 'rate_limit_exceeded', message: 'Request too large for gpt-4o: Limit 30000, Requested 45000. The input or output tokens must be reduced' })).toMatchObject({ kind: 'not_ours' });
    });
    it('is confirmed ours by its structured code even when it names the model field, and a field-only model refusal stays unresolved', () => {
        expect(readProviderError(404, { code: 'model_not_found', param: 'model', message: 'The model does not exist' })).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        expect(readProviderError(400, { type: 'invalid_request_error', code: 'model_not_found', param: 'model', message: 'x' })).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        expect(readProviderError(400, { param: 'model', message: 'Invalid value' })).toMatchObject({ kind: 'uncertain', reason: 'field_relay_set' });
        expect(readProviderError(400, { code: 'invalid_value', param: 'n', message: 'Invalid value' })).toMatchObject({ kind: 'uncertain', reason: 'field_relay_set' });
    });
});

describe('leadingFieldsOf', () => {
    it('reads the first of each field a refusal said, from a body cut in the middle', () => {
        expect(leadingFieldsOf('{"error":{"message":"Unsupported parameter: max_tokens","param":"max_tokens","code":"unsupported_parameter","type":"invalid_request_error","pad":"xxxx')).toEqual({
            message: 'Unsupported parameter: max_tokens',
            param: 'max_tokens',
            code: 'unsupported_parameter',
            type: 'invalid_request_error',
        });
    });

    it('reads a number, a null, and a field said twice with the same value, and not a value that was cut off', () => {
        expect(leadingFieldsOf('{"error":{"code":429,"param":null,"message":"slow","message":"slow","type":"inva')).toEqual({ code: 429, param: null, message: 'slow' });
    });

    it('reads no value of a field that is said twice with different values (a whole parse would keep the last, which a cut body may not have reached)', () => {
        // the duplicate message says two things: neither is read, the rest still is
        expect(leadingFieldsOf('{"error":{"code":429,"param":null,"message":"slow","message":"other","type":"inva')).toEqual({ code: 429, param: null });
        // a key code and then another code: never a confirmed key fault from the first of two that disagree
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":"rate_limited","message":"x","pad":"xx')).toEqual({ message: 'x' });
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":null,"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":429,"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":true,"pad":"xx')).toBeNull();
        // a decimal or an exponent is a second say too, not a number to ignore (a whole parse keeps it as the last value)
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":1.5,"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":1e5,"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":429,"code":4.5,"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":-2.5E+3,"message":"x","pad":"xx')).toEqual({ message: 'x' });
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":{"a":1},"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":["x"],"pad":"xx')).toBeNull();
        // a third say of a value that agreed with the first stays unreadable
        expect(leadingFieldsOf('{"error":{"code":"a","code":"b","code":"a","pad":"xx')).toBeNull();
        // the same code said twice is the code
        expect(leadingFieldsOf('{"error":{"code":"invalid_api_key","code":"invalid_api_key","pad":"xx')).toEqual({ code: 'invalid_api_key' });
        // so a refusal cut after two disagreeing codes is not a confirmed fault of ours by its code
        const said = leadingFieldsOf('{"error":{"code":"invalid_api_key","code":"rate_limited","message":"x","pad":"xx') ?? {};
        expect(readProviderError(null, said)).toMatchObject({ kind: 'uncertain' });
    });

    it('reads only the error object: not a sibling object, not a nested one, not the top level beside an error that may come after the cut', () => {
        // the fields of `meta` are not the error's: a key code there is no confirmed fault, and the param after it is the error's own
        expect(leadingFieldsOf('{"meta":{"code":"invalid_api_key"},"error":{"param":"temperature","message":"bad","pad":"xx')).toEqual({ param: 'temperature', message: 'bad' });
        expect(leadingFieldsOf('{"meta":{"code":"invalid_api_key","type":"authentication_error"},"error":{"pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"error":{"metadata":{"code":"invalid_api_key"},"param":"temperature","pad":"xx')).toEqual({ param: 'temperature' });
        expect(leadingFieldsOf('{"error":{"items":[{"code":"invalid_api_key"}],"code":"other","pad":"xx')).toEqual({ code: 'other' });
        // the top level alone: the full parse would read `error` if it came after, so nothing is read
        expect(leadingFieldsOf('{"code":"invalid_api_key","type":"authentication_error","pad":"xx')).toBeNull();
        expect(leadingFieldsOf('{"code":"invalid_api_key","error":{"param":"temperature","pad":"xx')).toEqual({ param: 'temperature' });
        // an error that is only words, and strings that hold braces, quotes and colons
        expect(leadingFieldsOf('{"error":"Rate limited","code":"invalid_api_key"}')).toEqual({ message: 'Rate limited' });
        expect(leadingFieldsOf('{"error":{"message":"say \\"code\\": {\\"x\\"} now","code":"c1","pad":"xx')).toEqual({ message: 'say "code": {"x"} now', code: 'c1' });
    });

    it('is null when no field was said', () => {
        expect(leadingFieldsOf('<html>Bad gateway</html>')).toBeNull();
    });
});

describe('the rows the relay sends to Orbit’s fault record', () => {
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const since = () => Date.now() - 1;
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });
    const refused = (status: number, error: Record<string, unknown>) => (_req: express.Request, res: express.Response) => res.status(status).json({ error });
    const cutStream = (_req: express.Request, res: express.Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
        setTimeout(() => res.socket?.destroy(), 10);
    };

    it('sends one row per failed agent call with its job, turn, call, kind, reason, source, route and upstream status, and nothing for an answer', async () => {
        asJob('job-rows-401');
        notes.turn('job-rows-401', 4);
        upstreamHandler = refused(401, { message: 'revoked' });
        await askAndSettle(agent, 1);
        const rows = await rowsSent('job-rows-401');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ turn: 4, kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai', route: `universe-ai:${config().providerId}`, providerStatus: 401 });
        expect(typeof rows[0].callId).toBe('string');
        expect(Number.isNaN(Date.parse(rows[0].at))).toBe(false);
        // the call id is the one Orbit settled the call under
        expect(settled()[0].callId).toBe(rows[0].callId);

        asJob('job-rows-ok');
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        await askAndSettle(agent, 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(rowsOf('job-rows-ok')).toEqual([]);
    });

    it('tells a confirmed fault (our key or model refused, no route, no room, Orbit down) from an unresolved one (the provider’s 5xx or 429, a stream that broke) and from the person’s side', async () => {
        const reasons = async (jobId: string, count: number) => (await rowsSent(jobId, count)).map((row) => `${row.kind}:${row.reason}`);
        let settledCount = 0;
        const call = async (name: string, handler: typeof upstreamHandler, body: unknown = agent) => {
            asJob(name);
            upstreamHandler = handler;
            settledCount += 1;
            await askAndSettle(body, settledCount);
        };
        await call('job-r-500', refused(500, { message: 'down' }));
        expect(await reasons('job-r-500', 1)).toEqual(['uncertain:provider_5xx']);
        await call('job-r-429', refused(429, { message: 'Rate limit reached for gpt-4o: Limit 30000, Used 28000, Requested 5000.' }));
        expect(await reasons('job-r-429', 1)).toEqual(['uncertain:provider_429']);
        await call('job-r-429-large', refused(429, { message: 'Request too large for gpt-4o: Limit 30000, Requested 45000. Must be reduced.' }));
        expect(await reasons('job-r-429-large', 1)).toEqual(['not_ours:field_job_set']);
        // our credit used up is said as 429 + insufficient_quota: a confirmed fault of ours (always given back), not a rate limit
        await call('job-r-429-quota', refused(429, { message: 'You exceeded your current quota', code: 'insufficient_quota', type: 'insufficient_quota' }));
        expect(await reasons('job-r-429-quota', 1)).toEqual(['fault:provider_key_ours']);
        await call('job-r-429-keyword', refused(429, { message: 'You exceeded your current quota, check billing', code: 'rate_limit_exceeded' }));
        expect(await reasons('job-r-429-keyword', 1)).toEqual(['uncertain:provider_429']);
        await call('job-r-404', refused(404, { message: 'The model does not exist', code: 'model_not_found' }));
        expect(await reasons('job-r-404', 1)).toEqual(['fault:provider_key_ours']);
        await call('job-r-fieldless', refused(400, { message: 'bad request' }));
        expect(await reasons('job-r-fieldless', 1)).toEqual(['uncertain:fieldless_400']);
        await call('job-r-relayfield', refused(400, { message: 'Invalid value', param: 'model' }));
        expect(await reasons('job-r-relayfield', 1)).toEqual(['uncertain:field_relay_set']);
        await call('job-r-jobfield', refused(400, { message: 'Invalid value', param: 'temperature' }));
        expect(await reasons('job-r-jobfield', 1)).toEqual(['not_ours:field_job_set']);
        await call('job-r-cut', cutStream, { ...agent, stream: true });
        expect(await reasons('job-r-cut', 1)).toEqual(['uncertain:stream_cut']);
    });

    it('records the faults that come before any provider call: Orbit down, no room, no route, a route Orbit has no way to call, and the person’s own key resting', async () => {
        asJob('job-r-authorize');
        orbit.authorize.mockRejectedValue(new Error('down'));
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-r-authorize'))[0]).toMatchObject({ kind: 'fault', reason: 'relay_down', providerStatus: 503 });

        asJob('job-r-pool');
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'pool', full: true });
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-r-pool'))[0]).toMatchObject({ kind: 'fault', reason: 'pool_busy' });

        // A call refused for its own size (the pool may have room for a smaller one, and a call grows with what the job sent) is unresolved, never confirmed:
        // also when it is the first call of the job, and when an older Orbit says nothing of the size. Orbit confirms a pool that took none of a job's calls by its own record
        for (const refusal of [{ ok: false, reason: 'pool', full: false }, { ok: false, reason: 'pool' }] as const) {
            const name = `job-r-pool-first-${'full' in refusal ? 'sized' : 'plain'}`;
            asJob(name);
            orbit.authorize.mockResolvedValue(refusal);
            expect((await ask(agent)).status).toBe(503);
            expect((await rowsSent(name))[0]).toMatchObject({ kind: 'uncertain', reason: 'pool_busy' });
        }
        // A call Orbit found room for is noted as taken up (a call refused is not), whatever the provider then said
        asJob('job-r-taken');
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'pool', full: true });
        await ask(agent);
        expect(notes.acceptedSince('job-r-taken', 0)).toBe(false);
        orbit.authorize.mockResolvedValue({ ok: true });
        upstreamHandler = refused(401, { message: 'revoked' });
        await askAndSettle(agent, 1);
        expect(notes.acceptedSince('job-r-taken', 0)).toBe(true);

        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        asJob('job-r-allowance');
        expect((await ask(agent)).status).toBe(429);
        expect((await rowsSent('job-r-allowance'))[0]).toMatchObject({ kind: 'not_ours', reason: 'allowance', providerStatus: 429 });
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'rule' });
        asJob('job-r-rule');
        expect((await ask(agent)).status).toBe(429);
        expect((await rowsSent('job-r-rule'))[0]).toMatchObject({ kind: 'not_ours', reason: 'rule' });

        orbit.authorize.mockResolvedValue({ ok: true });
        asJob('job-r-noroute');
        route = null;
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-r-noroute'))[0]).toMatchObject({ kind: 'fault', reason: 'route_unknown', source: 'universe-ai' });

        asJob('job-r-resting');
        route = { restingOwnKey: true } as unknown as RelayRoute;
        expect((await ask(agent)).status).toBe(503);
        expect((await rowsSent('job-r-resting'))[0]).toMatchObject({ kind: 'not_ours', reason: 'own_provider', source: 'own-key' });
    });

    it('records a person’s own provider failing with a 5xx as unresolved, and a refusal of their key or credit as the person’s side, never a fault', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-r-own');
        // the window begins before the request, by the order of events: it does not depend on how long the request and the queue take
        const before = notes.mark();
        upstreamHandler = refused(500, { message: 'their provider is down' });
        await askAndSettle(agent);
        expect((await rowsSent('job-r-own'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_5xx', source: 'own-key', route: 'own-key', providerStatus: 500 });
        expect(notes.confirmedSince('job-r-own', before)).toBe(false);
        expect(notes.sawSince('job-r-own', before)).toBe(false);

        // 429, a plain 403: unresolved with their own reasons
        asJob('job-r-own-429');
        upstreamHandler = refused(429, { message: 'slow down', type: 'rate_limit' });
        await askAndSettle(agent, 2);
        expect((await rowsSent('job-r-own-429'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_429', source: 'own-key', providerStatus: 429 });
        asJob('job-r-own-403');
        upstreamHandler = refused(403, { message: 'forbidden' });
        await askAndSettle(agent, 3);
        expect((await rowsSent('job-r-own-403'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_403', source: 'own-key', providerStatus: 403 });

        // a revoked key, a key out of credit, a key code: theirs
        const personal = notes.mark();
        let settled = 3;
        for (const [name, status, error] of [
            ['job-r-own-401', 401, { message: 'bad key' }],
            ['job-r-own-402', 402, { message: 'out of credit' }],
            ['job-r-own-code', 400, { code: 'invalid_api_key', message: 'no' }],
            ['job-r-own-429-quota', 429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' }],
        ] as const) {
            asJob(name);
            upstreamHandler = refused(status, error);
            await askAndSettle(agent, ++settled);
            expect((await rowsSent(name))[0]).toMatchObject({ kind: 'not_ours', reason: 'own_provider', source: 'own-key', route: 'own-key' });
        }
        expect(notes.confirmedSince('job-r-own-401', personal)).toBe(false);
        expect(notes.sawSince('job-r-own-401', personal)).toBe(true);
    });

    it('records a gone endpoint and a cut stream on a person’s own key as unresolved (what the runner reads, and a row for each), never theirs', async () => {
        const before = since();
        route = { config: config({ endpoint: 'http://127.0.0.1:1/v1' }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-own-gone');
        await askAndSettle(agent, 1);
        expect(notes.endedOnFault('job-own-gone', before)).toBe(true);
        expect(notes.sawSince('job-own-gone', before)).toBe(false);
        expect((await rowsSent('job-own-gone'))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_5xx', source: 'own-key' });

        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        asJob('job-own-cut');
        upstreamHandler = cutStream;
        const cut = await ask({ ...agent, stream: true });
        await cut.text().catch(() => '');
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(2), { timeout: 3000 });
        expect(notes.endedOnFault('job-own-cut', before)).toBe(true);
        expect(notes.sawSince('job-own-cut', before)).toBe(false);
        expect((await rowsSent('job-own-cut'))[0]).toMatchObject({ kind: 'uncertain', reason: 'stream_cut', source: 'own-key' });
    });

    it('sends nothing for a side call with no tools, and is not held up by an Orbit that cannot take the rows', async () => {
        asJob('job-r-side');
        upstreamHandler = refused(500, { message: 'down' });
        await askAndSettle({ messages }, 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(rowsOf('job-r-side')).toEqual([]);

        sinkAnswers = false;
        asJob('job-r-orbit-down');
        const beforeDown = notes.mark();
        upstreamHandler = refused(500, { message: 'down' });
        const answer = await ask(agent);
        expect(answer.status).toBe(500);
        // the runner of the job can still read the fault in this process, and the rows wait to be sent
        expect(notes.endedOnFault('job-r-orbit-down', beforeDown)).toBe(true);
        sinkAnswers = true;
        expect(await notes.flush('job-r-orbit-down')).toBe(true);
        expect(rowsOf('job-r-orbit-down')).toHaveLength(1);
    });
});

describe('an error nobody expected while the provider is called', () => {
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });
    it('is unresolved on Universe’s key and on a person’s own key alike, never the person’s', async () => {
        const fetchFor = () =>
            (async () =>
                ({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/event-stream' }),
                    clone: () => new Response('', { status: 200 }),
                    get body(): never {
                        throw new Error('an error nobody expected');
                    },
                }) as unknown as Response) as typeof fetch;
        const app = express();
        app.use(createComputerModelRelay({ orbit, routeFor: async () => route, settleDelaysMs: [1, 1], refusals: notes, fetchFor }));
        const own = await listen(app);
        try {
            for (const [name, source] of [['job-unexpected-ours', 'universe-ai'], ['job-unexpected-own', 'own-key']] as const) {
                route = { config: config({ endpoint: upstreamBase }), source, keyOwnerId: source === 'own-key' ? 'person-owner' : null };
                asJob(name);
                const before = notes.mark();
                const answer = await fetch(`${urlOf(own)}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ ...agent, stream: true }) });
                expect(answer.status).toBe(502);
                expect((await rowsSent(name))[0]).toMatchObject({ kind: 'uncertain', reason: 'provider_5xx', source, providerStatus: 502 });
                expect(notes.endedOnFault(name, before)).toBe(true);
                expect(notes.sawSince(name, before)).toBe(false);
            }
        } finally {
            await new Promise<void>((resolve) => { own.closeAllConnections?.(); own.close(() => resolve()); });
        }
    });
});

describe('a call that is identified, or taken up, after the runner has moved on to the next turn', () => {
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });
    const gate = <T,>() => {
        let open!: (value: T) => void;
        const promise = new Promise<T>((resolve) => (open = resolve));
        return { promise, open };
    };
    const poolRefusal = { callId: 'turn5-pool', kind: 'fault', reason: 'pool_busy', source: 'universe-ai', route: 'universe-ai:p', providerStatus: 503 } as const;

    it('does not count a call of turn 4 that Orbit identifies in turn 5 as a call of turn 5', async () => {
        for (const moved of [true, false]) {
            const job = `job-late-identify-${moved}`;
            asJob(job);
            notes.turn(job, 4, 'r');
            const identified = gate<{ ok: true; jobId: string; botId: string }>();
            orbit.identify.mockImplementationOnce(() => identified.promise);
            const asked = ask(agent);
            await vi.waitFor(() => expect(orbit.identify).toHaveBeenCalled(), { timeout: 3000 });
            // the runner moves on to turn 5 while the call waits to be identified
            const turn4 = moved ? undefined : notes.mark();
            if (moved) notes.turn(job, 5, 'r');
            const turn5 = notes.mark();
            identified.open({ ok: true, jobId: job, botId: BOT });
            await (await asked).text();
            if (moved) expect(notes.calledSince(job, turn5)).toBe(false);
            // a call that arrived and was identified in the turn that is going counts as it always did
            else expect(notes.calledSince(job, turn4!)).toBe(true);
        }
    });

    it('still counts a call that arrives in turn 5, and leaves no marker for a key Orbit does not know', async () => {
        const job = 'job-turn5-call';
        asJob(job);
        notes.turn(job, 4, 'r');
        notes.turn(job, 5, 'r');
        const turn5 = notes.mark();
        await (await ask(agent)).text();
        expect(notes.calledSince(job, turn5)).toBe(true);
        const unknown = 'job-unknown-key';
        notes.turn(unknown, 1, 'r');
        orbit.identify.mockResolvedValue({ ok: false });
        const before = notes.mark();
        expect((await ask(agent)).status).toBe(401);
        expect(notes.calledSince(unknown, before)).toBe(false);
    });

    it('does not record a call of turn 4 that Orbit takes up in turn 5 as a call taken up in turn 5', async () => {
        const job = 'job-late-accept';
        asJob(job);
        notes.turn(job, 4, 'r');
        const room = gate<{ ok: true }>();
        orbit.authorize.mockImplementationOnce(() => room.promise);
        const asked = ask(agent);
        await vi.waitFor(() => expect(orbit.authorize).toHaveBeenCalled(), { timeout: 3000 });
        notes.turn(job, 5, 'r');
        const turn5 = notes.mark();
        // in turn 5 the pool refuses a call outright
        notes.record(BOT, job, { ...poolRefusal, turn: 5, run: 'r' });
        room.open({ ok: true });
        await (await asked).text();
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalled(), { timeout: 3000 });
        // nothing of turn 5 was taken up: it is a turn of refusals for room, as it was
        expect(notes.acceptedSince(job, turn5)).toBe(false);
        expect(notes.onlyPoolBusySince(job, turn5)).toBe(true);
    });
});

describe('a model of the person’s own key that the provider says it does not have', () => {
    const agent = { messages, tools: [{ type: 'function', function: { name: 'x' } }] };
    const asJob = (jobId: string) => orbit.identify.mockResolvedValue({ ok: true, jobId, botId: BOT });
    const refusedWith = (status: number, error: Record<string, unknown>) => (_req: express.Request, res: express.Response) => res.status(status).json({ error });

    it('is unresolved, while a revoked key and an exhausted credit stay the person’s', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        let settledCalls = 0;
        for (const [name, status, error, expected] of [
            ['job-own-model-code', 404, { code: 'model_not_found', message: 'The model `x` does not exist or you do not have access to it.' }, { kind: 'uncertain', reason: 'field_relay_set' }],
            ['job-own-model-message', 404, { message: 'The model x does not exist' }, { kind: 'uncertain', reason: 'field_relay_set' }],
            ['job-own-model-429', 429, { code: 'model_not_found', type: 'invalid_request_error', message: 'no such model' }, { kind: 'uncertain', reason: 'field_relay_set' }],
            ['job-own-key-revoked', 401, { code: 'invalid_api_key', message: 'Incorrect API key provided' }, { kind: 'not_ours', reason: 'own_provider' }],
            ['job-own-credit', 429, { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' }, { kind: 'not_ours', reason: 'own_provider' }],
            ['job-own-both', 404, { code: 'model_not_found', type: 'authentication_error', message: 'nope' }, { kind: 'not_ours', reason: 'own_provider' }],
        ] as const) {
            asJob(name);
            upstreamHandler = refusedWith(status, error);
            const answer = await ask(agent);
            await answer.text();
            await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(++settledCalls), { timeout: 3000 });
            expect((await rowsSent(name))[0], name).toMatchObject({ ...expected, source: 'own-key' });
        }
    });

    it('is still a confirmed fault of ours on Universe’s own key (a model of ours that is missing)', async () => {
        route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
        asJob('job-ours-model');
        upstreamHandler = refusedWith(404, { code: 'model_not_found', message: 'The model x does not exist' });
        await (await ask(agent)).text();
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect((await rowsSent('job-ours-model'))[0]).toMatchObject({ kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai' });
    });
});
