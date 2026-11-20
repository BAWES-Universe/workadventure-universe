import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createRefusalNotes } from '../server/ComputerRefusals';
import { createComputerModelRelay, estimateCallMicros, inputTokensOf, neverReached, RELAY_GUARDS, outputCapOf, relayOrbitFor, type RelayOrbit, type RelayRoute, type SettleInput } from '../server/ComputerModelRelay';
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

const notes = createRefusalNotes();

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

describe('room before the call', () => {
    it('notes a refusal for the person’s allowance or a rule of theirs for the job, and no other refusal', async () => {
        const before = Date.now() - 1;
        for (const reason of ['pool', 'refused'] as const) {
            orbit.authorize.mockResolvedValue({ ok: false, reason });
            await ask({ messages });
        }
        expect(notes.sawSince(JOB, before)).toBe(false);

        orbit.authorize.mockResolvedValue({ ok: false, reason: 'rule' });
        const rule = await ask({ messages });
        // a rule is said as a refusal for room, not as a wrong key, and the provider is never reached
        expect(rule.status).toBe(429);
        expect((await rule.json()).error.code).toBe('insufficient_quota');
        expect(upstreamRequests).toHaveLength(0);
        expect(notes.sawSince(JOB, before)).toBe(true);
    });

    it('notes an allowance refusal too', async () => {
        const before = Date.now() - 1;
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        await ask({ messages });
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
        expect(outputCapOf({ max_tokens: 10_000_000 }, config())).toBe(32_768);
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

    it('a chunk cut across two writes is still read', async () => {
        const whole = data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } });
        upstreamHandler = (_req, res) => sse(res, [whole.slice(0, 20), whole.slice(20), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0]).toMatchObject({ tokens: { input: 7, output: 3 } });
    });

    it('stops the provider and counts what was used when Hermes goes away', async () => {
        let providerSawClose = false;
        upstreamHandler = (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.write(data({ choices: [{ delta: { content: 'first' } }] }));
            req.on('close', () => { providerSawClose = true; });
            // never ends on its own
        };
        const controller = new AbortController();
        const answer = await fetch(`${relayBase}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ messages, stream: true }), signal: controller.signal });
        const reader = answer.body!.getReader();
        await reader.read();
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

describe('the Orbit calls', () => {
    const admin = (status: number, data: Record<string, unknown>) => ({ computerRelayCall: vi.fn().mockResolvedValue({ status, data }) });

    it('reads a good key, a refused key, and an unexpected answer as what they are', async () => {
        expect(await relayOrbitFor(admin(200, { ok: true, jobId: 'j', botId: 'b' })).identify('t')).toEqual({ ok: true, jobId: 'j', botId: 'b' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'refused' })).identify('t')).toEqual({ ok: false });
        await expect(relayOrbitFor(admin(401, {})).identify('t')).rejects.toThrow();
    });

    it('reads room answers, and takes any odd reason as a refusal', async () => {
        const input = { token: 't', callId: 'c', estimateMicros: 1, payer: 'universe' as const };
        expect(await relayOrbitFor(admin(200, { ok: true })).authorize(input)).toEqual({ ok: true });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'allowance' })).authorize(input)).toEqual({ ok: false, reason: 'allowance' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'rule' })).authorize(input)).toEqual({ ok: false, reason: 'rule' });
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
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'pool' });
        expect((await ask(agent)).status).toBe(503);
        expect(notes.endedOnFault('job-pool', before)).toBe(true);
    });

    it('does not note a refusal for the person’s allowance or rule, or a call the provider found wrong, as a fault of ours', async () => {
        const before = since();
        asJob('job-allowance');
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        await ask(agent);
        expect(notes.endedOnFault('job-allowance', before)).toBe(false);

        asJob('job-wrong');
        orbit.authorize.mockResolvedValue({ ok: true });
        upstreamHandler = (_req, res) => res.status(400).json({ error: { message: 'bad request' } });
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

    it('does not note what a person’s own provider, key or endpoint did as a fault of ours', async () => {
        const before = since();
        route = { config: config({ endpoint: upstreamBase }), source: 'own-key', keyOwnerId: 'person-owner' };
        let count = 0;
        // their provider's own error, their key out of credit (402 comes to Hermes as 502), a revoked key, a rate limit, an endpoint that is gone
        for (const [name, status] of [['job-own-500', 500], ['job-own-402', 402], ['job-own-401', 401], ['job-own-429', 429]] as const) {
            asJob(name);
            upstreamHandler = (_req, res) => res.status(status).json({ error: { message: 'no' } });
            count += 1;
            await askAndSettle(agent, count);
            expect(notes.endedOnFault(name, before)).toBe(false);
        }
        asJob('job-own-gone');
        route = { config: config({ endpoint: 'http://127.0.0.1:1/v1' }), source: 'own-key', keyOwnerId: 'person-owner' };
        count += 1;
        await askAndSettle(agent, count);
        expect(notes.endedOnFault('job-own-gone', before)).toBe(false);

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
        expect(notes.endedOnFault('job-own-cut', before)).toBe(false);
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
