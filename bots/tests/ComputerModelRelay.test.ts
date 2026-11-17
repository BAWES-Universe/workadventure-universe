import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { stepKindOf, createComputerModelRelay, estimateCallMicros, inputTokensOf, neverReached, readBoundedJson, readBoundedWithFlag, RELAY_GUARDS, outputCapOf, relayOrbitFor, type AuthorizeInput, type RelayOrbit, type RelayRoute, type SettleInput } from '../server/ComputerModelRelay';
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
    // A rate of the super admin's own, so a test model has a price (a Universe-paid step on a model with no price is refused)
    settings: { costPerToken: 0.000001 },
    ...over,
});

let upstream: Server;
let upstreamBase: string;
let upstreamRequests: Array<{ url: string; auth: string | undefined; body: Record<string, any> }>;
let upstreamHandler: (req: express.Request, res: express.Response) => void;

let relay: Server;
let relayBase: string;

/** How a wait for room is made in the tests: recorded, and by default instant. */
const waits = { slept: [] as number[], sleep: async (ms: number): Promise<void> => { waits.slept.push(ms); } };

let orbit: RelayOrbit & { contract: ReturnType<typeof vi.fn>; identify: ReturnType<typeof vi.fn>; authorize: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> };
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

beforeAll(async () => {
    const up = express();
    up.use(express.json());
    up.post('/v1/chat/completions', (req, res) => {
        upstreamRequests.push({ url: req.url, auth: req.headers.authorization, body: req.body });
        upstreamHandler(req, res);
    });
    upstream = await listen(up);
    upstreamBase = `${urlOf(upstream)}/v1`;

    orbit = { identify: vi.fn(), authorize: vi.fn(), settle: vi.fn(), contract: vi.fn() } as never;
});

/** A relay of its own for each test: the limits Orbit last served are kept by the relay, and must not carry from one test into the next. */
const startRelay = async () => {
    const app = express();
    app.use(createComputerModelRelay({ orbit, routeFor: async () => route, settleDelaysMs: [1, 1], sleep: (ms) => waits.sleep(ms) }));
    relay = await listen(app);
    relayBase = urlOf(relay);
};

afterAll(async () => {
    await Promise.all([upstream].map((server) => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })));
});

afterEach(async () => {
    await new Promise<void>((resolve) => {
        relay.closeAllConnections?.();
        relay.close(() => resolve());
    });
});

beforeEach(async () => {
    upstreamRequests = [];
    upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    orbit.identify.mockReset().mockResolvedValue({ ok: true, jobId: JOB, botId: BOT });
    orbit.authorize.mockReset().mockResolvedValue({ ok: true });
    orbit.settle.mockReset().mockResolvedValue({ ok: true });
    (orbit.contract as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(null);
    waits.slept = [];
    waits.sleep = async (ms: number) => { waits.slept.push(ms); };
    route = { config: config({ endpoint: upstreamBase }), source: 'universe-ai', keyOwnerId: null };
    await startRelay();
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
        expect(estimateCallMicros({ messages }, config({ endpoint: 'https://nobody.example/v1', model: 'mystery', settings: {} }), 100, new Date())).toBe(50_000);
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
        expect(settled()[0].callId).toBe(orbit.authorize.mock.calls[0][0].operationId);
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

const askInput = (over: Partial<AuthorizeInput> = {}): AuthorizeInput => ({
    token: 't',
    operationId: 'op_c',
    payer: 'universe',
    route: 'universe-ai',
    estimate: { inputTokens: 10, inputMicros: 5, outputMicrosPerMillion: 2_000_000, maxOutputTokens: 100, providerMaxMicros: 205 },
    estimateMicros: 205,
    ...over,
});

describe('the Orbit calls', () => {
    const admin = (status: number, data: Record<string, unknown>) => ({ computerRelayCall: vi.fn().mockResolvedValue({ status, data }) });

    it('reads a good key, a refused key, and an unexpected answer as what they are', async () => {
        expect(await relayOrbitFor(admin(200, { ok: true, jobId: 'j', botId: 'b' })).identify('t')).toEqual({ ok: true, jobId: 'j', botId: 'b' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'refused' })).identify('t')).toEqual({ ok: false });
        await expect(relayOrbitFor(admin(401, {})).identify('t')).rejects.toThrow();
    });

    it('reads room answers; a reason nobody has a line for is a typed reason, never a bad key', async () => {
        const input = askInput();
        expect(await relayOrbitFor(admin(200, { ok: true })).authorize(input)).toEqual({ ok: true });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'allowance' })).authorize(input)).toEqual({ ok: false, reason: 'allowance' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'refused' })).authorize(input)).toEqual({ ok: false, reason: 'refused' });
        expect(await relayOrbitFor(admin(200, { ok: false, reason: 'something new' })).authorize(input)).toEqual({ ok: false, reason: 'other', code: 'something new' });
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

    it('reads a short answer whole', async () => {
        expect(await readBoundedWithFlag(bodyOf('{"a":', '1}').response, 100)).toEqual({ text: '{"a":1}', tooLong: false });
    });

    it('stops and cancels the body once it is longer than the bound, keeping the words before it', async () => {
        const { response, state } = bodyOf('abcd', 'efgh', 'ijkl', 'mnop');
        const read = await readBoundedWithFlag(response, 10);
        expect(read.tooLong).toBe(true);
        expect(read.text).toBe('abcdefgh');
        expect(state.cancelled).toBe(true);
    });

    it('gives no JSON for an answer that is too long or is not JSON', async () => {
        expect(await readBoundedJson(bodyOf('{"a":1}').response, 100)).toEqual({ a: 1 });
        expect(await readBoundedJson(bodyOf('{"a":', '"'.repeat(50), '}').response, 10)).toBeNull();
        expect(await readBoundedJson(bodyOf('not json').response, 100)).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Computer relay money rules (build thread C): R2, R3, R5, R6, R8, R10, S1, S2 and the version 2 contract
// ---------------------------------------------------------------------------------------------------------------------

const sseOf = (res: express.Response, chunks: string[]) => {
    res.status(200).setHeader('Content-Type', 'text/event-stream');
    for (const chunk of chunks) res.write(chunk);
    res.end();
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const authorizeInputs = () => orbit.authorize.mock.calls.map((call) => call[0] as AuthorizeInput);

describe('busy is not out (R2)', () => {
    it('waits the time Orbit says while only other work’s holds block the step, asks again as the same step, and goes ahead', async () => {
        orbit.authorize.mockResolvedValueOnce({ ok: false, reason: 'busy', retryAfterSeconds: 3 }).mockResolvedValueOnce({ ok: true });
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(200);
        expect(waits.slept).toEqual([3000]);
        expect(orbit.authorize).toHaveBeenCalledTimes(2);
        const [first, second] = authorizeInputs();
        expect(second.operationId).toBe(first.operationId);
        expect(upstreamRequests).toHaveLength(1);
    });

    it('answers 429 rate_limit_exceeded with Retry-After once the one bounded wait is spent, and never insufficient_quota', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'busy', retryAfterSeconds: 20 });
        const answer = await ask({ messages });
        expect(answer.status).toBe(429);
        expect(answer.headers.get('retry-after')).toBe('20');
        const error = (await answer.json()).error;
        expect(error.code).toBe('rate_limit_exceeded');
        expect(error.code).not.toBe('insufficient_quota');
        // one wait of 20 s fits in the bound; a second would not
        expect(waits.slept).toEqual([20_000]);
        expect(upstreamRequests).toHaveLength(0);
        expect(settled()).toHaveLength(0);
    });

    it('takes the bound Orbit serves, not a fixed one', async () => {
        orbit.identify.mockResolvedValue({ ok: true, jobId: JOB, botId: BOT, limits: { maxWaitSeconds: 5 } });
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'busy', retryAfterSeconds: 4 });
        const answer = await ask({ messages });
        expect(answer.status).toBe(429);
        expect(waits.slept).toEqual([4000]);
    });

    it('answers a call over the calls at once with a wait time too, and takes the number Orbit serves', async () => {
        orbit.identify.mockResolvedValue({ ok: true, jobId: JOB, botId: BOT, limits: { maxCallsInFlight: 2 } });
        const release: Array<() => void> = [];
        orbit.authorize.mockImplementation(() => new Promise((resolve) => release.push(() => resolve({ ok: true }))));
        const burst = Array.from({ length: 4 }, (_, i) => ask({ messages: [{ role: 'user', content: `step ${i}` }] }));
        await vi.waitFor(() => expect(release).toHaveLength(2), { timeout: 3000 });
        const turnedAway = await Promise.race(burst);
        expect(turnedAway.status).toBe(429);
        expect(Number(turnedAway.headers.get('retry-after'))).toBeGreaterThan(0);
        expect((await turnedAway.json()).error.code).toBe('rate_limit_exceeded');
        release.forEach((go) => go());
        await Promise.all(burst);
    });

    it('lets 5 parallel steps on a nearly full allowance all finish: each waits for the room another one frees', async () => {
        // Orbit has room for 2 holds at a time; the rest are told to wait a moment
        let holds = 0;
        orbit.authorize.mockImplementation(async () => (holds >= 2 ? { ok: false, reason: 'busy', retryAfterSeconds: 1 } : (holds++, { ok: true })));
        orbit.settle.mockImplementation(async () => (holds--, { ok: true }));
        waits.sleep = async (ms) => {
            waits.slept.push(ms);
            await new Promise((resolve) => setTimeout(resolve, 15));
        };
        upstreamHandler = (_req, res) => setTimeout(() => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), 25);
        const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => ask({ messages: [{ role: 'user', content: `step ${i}` }] })));
        expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200]);
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(5), { timeout: 3000 });
        expect(waits.slept.length).toBeGreaterThan(0);
        expect(holds).toBe(0);
    });
});

describe('the same step keeps one id (contract version 2)', () => {
    it('gives the same operation id to the same messages asked again after a refusal, and another to a different step', async () => {
        orbit.authorize.mockResolvedValueOnce({ ok: false, reason: 'busy', retryAfterSeconds: 99 }).mockResolvedValue({ ok: true });
        expect((await ask({ messages })).status).toBe(429);
        await askAndSettle({ messages });
        await askAndSettle({ messages: [{ role: 'user', content: 'a different step' }] }, 2);
        const [refused, again, other] = authorizeInputs();
        expect(again.operationId).toBe(refused.operationId);
        expect(other.operationId).not.toBe(refused.operationId);
        expect(refused.operationId).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/);
    });

    it('gives a step that was really made again a new id, so it is never mistaken for a repeat and left unbilled', async () => {
        await askAndSettle({ messages });
        await askAndSettle({ messages }, 2);
        const [first, second] = authorizeInputs();
        expect(second.operationId).not.toBe(first.operationId);
        expect(new Set(settled().map((entry) => entry.callId)).size).toBe(2);
    });

    it('names the kind of step: a picture back is vision, a tool that writes is edit, any other tool is tool, the person’s words are a reply', () => {
        const call = (name: string) => ({ role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name, arguments: '{}' } }] });
        expect(stepKindOf({ messages: [{ role: 'user', content: 'hi' }] })).toBe('reply');
        expect(stepKindOf({ messages: [{ role: 'user', content: 'hi' }, call('write_file'), { role: 'tool', tool_call_id: 'c', content: 'ok' }] })).toBe('edit');
        expect(stepKindOf({ messages: [{ role: 'user', content: 'hi' }, call('browser_click'), { role: 'tool', tool_call_id: 'c', content: 'ok' }] })).toBe('tool');
        expect(stepKindOf({ messages: [{ role: 'user', content: 'hi' }, call('screenshot'), { role: 'tool', tool_call_id: 'c', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] })).toBe('vision');
        expect(stepKindOf({ messages: [] })).toBe('other');
    });

    it('sends the version 2 ingredients: the input, the price of an output token, the real answer limit, the kind of step and the route', async () => {
        const body = {
            max_tokens: 700,
            messages: [
                { role: 'user', content: 'Fill the form' },
                { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'browser_click', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'c1', content: 'ok' },
            ],
        };
        await askAndSettle(body);
        const input = authorizeInputs()[0];
        expect(input).toMatchObject({ payer: 'universe', route: 'universe-ai', model: 'gpt-test', modelFormat: 'openai', stepKind: 'tool', estimate: { maxOutputTokens: 700 } });
        // the test model is priced at $0.000001 a token: an output token is one millionth of a dollar, so a million cost 1,000,000 millionths
        expect(input.estimate.outputMicrosPerMillion).toBe(1_000_000);
        expect(input.estimate.inputTokens).toBeGreaterThan(0);
        expect(input.estimate.providerMaxMicros).toBe(input.estimate.inputMicros + 700);
        expect(JSON.stringify(input)).not.toContain('Fill the form');
    });
});

describe('a spending rule says so (R3)', () => {
    it('is 403 spend_rule in the rule’s own words, never a bad key, and is not tried on another payer', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'rule', words: 'You said your Brick may spend at most $2 a day on other accounts.' });
        const answer = await ask({ messages });
        expect(answer.status).toBe(403);
        const error = (await answer.json()).error;
        expect(error.code).toBe('spend_rule');
        expect(error.message).toBe('You said your Brick may spend at most $2 a day on other accounts.');
        expect(answer.status).not.toBe(401);
        expect(orbit.authorize).toHaveBeenCalledTimes(1);
        expect(upstreamRequests).toHaveLength(0);
        expect(settled()).toHaveLength(0);
    });

    it('says a reason it has no line for as a busy service, not as a bad key', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'other', code: 'brand_new' });
        const answer = await ask({ messages });
        expect(answer.status).toBe(503);
        expect((await answer.json()).error.code).toBe('service_unavailable');
        expect(Number(answer.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('says this Brick’s AI cannot run a computer yet when Orbit says so', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'unsupported' });
        const answer = await ask({ messages });
        expect(answer.status).toBe(501);
        expect((await answer.json()).error.message).toMatch(/cannot run a computer yet/);
    });

    it('keeps the words of "truly out" for money that is used up', async () => {
        orbit.authorize.mockResolvedValue({ ok: false, reason: 'allowance' });
        const answer = await ask({ messages });
        expect(answer.status).toBe(429);
        expect((await answer.json()).error.code).toBe('insufficient_quota');
    });
});

describe('screenshots hold what the provider’s rule says (R5)', () => {
    const png = (width: number, height: number, bytes: number) => {
        const head = Buffer.alloc(33);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
        head.writeUInt32BE(13, 8);
        head.write('IHDR', 12, 'ascii');
        head.writeUInt32BE(width, 16);
        head.writeUInt32BE(height, 20);
        return Buffer.concat([head, Buffer.alloc(bytes - head.length, 7)]);
    };
    const withShot = (url: string) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Where is the button?' }, { type: 'image_url', image_url: { url } }] }] });
    const shot = `data:image/png;base64,${png(1280, 720, 600_000).toString('base64')}`;

    it('holds a 600 KB screenshot at its provider’s count, not at a third of its base64 text', () => {
        const body = withShot(shot);
        const textOnly = inputTokensOf({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Where is the button?' }] }] });
        // OpenAI's tile rule: 1280x720 is 3 by 2 tiles of 170 and a base of 85 (a few tokens more for the picture's own marker)
        expect(inputTokensOf(body, config({ model: 'gpt-4o' })) - textOnly).toBeGreaterThanOrEqual(85 + 170 * 6);
        expect(inputTokensOf(body, config({ model: 'gpt-4o' }))).toBeLessThan(2000);
        // Claude's: 46 by 26 patches
        expect(inputTokensOf(body, config({ model: 'claude-sonnet-4-5' })) - textOnly).toBeGreaterThanOrEqual(46 * 26);
        // the old reading, for the record, was over 200,000
        expect(Math.ceil(Buffer.byteLength(JSON.stringify(body.messages)) / RELAY_GUARDS.charsPerToken)).toBeGreaterThan(200_000);
    });

    it('asks Orbit for room by that count', async () => {
        route = { config: config({ endpoint: upstreamBase, model: 'gpt-4o' }), source: 'universe-ai', keyOwnerId: null };
        await askAndSettle(withShot(shot));
        const input = authorizeInputs()[0];
        expect(input.estimate.inputTokens).toBeLessThan(2000);
        expect(input.estimate.inputTokens).toBeGreaterThan(85 + 170 * 6);
    });

    it('holds a linked picture and a file id at the provider’s documented largest', () => {
        const linked = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/shot.png' } }, { type: 'input_image', file_id: 'file-1' }] }] };
        const cfg = config({ model: 'gpt-4o' });
        const base = inputTokensOf({ messages: [{ role: 'user', content: [] }] }, cfg);
        expect(inputTokensOf(linked, cfg) - base).toBeGreaterThanOrEqual(2 * (85 + 170 * 8));
    });
});

describe('both figures (R6)', () => {
    it('keeps a provider cost of $0.10 beside a member price of $0.02 that a super admin’s rate sets', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: { costPerToken: 0.0000001 } }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 100_000, completion_tokens: 100_000, cost: 0.1 } });
        await askAndSettle({ messages });
        expect(settled()[0]).toMatchObject({ costMicros: 20_000, providerCostMicros: 100_000, basis: 'measured' });
    });

    it('keeps the provider’s figure in a stream too', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: { costPerToken: 0.0000001 } }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => sseOf(res, [frame({ choices: [{ delta: { content: 'hi' } }] }), frame({ choices: [], usage: { prompt_tokens: 100_000, completion_tokens: 100_000, cost: 0.1 } }), 'data: [DONE]\n\n']);
        await askAndSettle({ messages, stream: true });
        expect(settled()[0]).toMatchObject({ costMicros: 20_000, providerCostMicros: 100_000 });
    });

    it('is the same figure twice when no rate is set, and unknown beside an unknown price', async () => {
        route = { config: config({ endpoint: upstreamBase, settings: {} }), source: 'own-key', keyOwnerId: 'person-owner' };
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.002 } });
        await askAndSettle({ messages });
        expect(settled()[0]).toMatchObject({ costMicros: 2000, providerCostMicros: 2000 });
        orbit.settle.mockClear();
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
        await askAndSettle({ messages: [{ role: 'user', content: 'again' }] });
        expect(settled()[0]).toMatchObject({ costMicros: null, providerCostMicros: null, basis: 'unknown' });
    });
});

describe('own keys are not cut (R8)', () => {
    const own = (over: Partial<AIProviderConfig> = {}): RelayRoute => ({ config: config({ endpoint: upstreamBase, ...over }), source: 'own-key', keyOwnerId: 'person-owner' });

    it('writes past 32,768 on an own key with a 64k answer limit', async () => {
        route = own({ maxTokens: 65_536 });
        await askAndSettle({ messages });
        expect(upstreamRequests[0].body.max_tokens).toBe(65_536);
        // what Hermes asks for is also its own to ask, past the old guard
        upstreamRequests = [];
        await askAndSettle({ messages: [{ role: 'user', content: 'b' }], max_tokens: 100_000 }, 2);
        expect(upstreamRequests[0].body.max_tokens).toBe(100_000);
    });

    it('sends no length at all when nobody said one, so the endpoint’s own limit decides', async () => {
        route = own({ maxTokens: 0 });
        await askAndSettle({ messages });
        expect(upstreamRequests[0].body).not.toHaveProperty('max_tokens');
        expect(upstreamRequests[0].body).not.toHaveProperty('max_completion_tokens');
        expect(authorizeInputs()[0].estimate.maxOutputTokens).toBeNull();
    });

    it('asks again within the length a model states once it refuses more, and remembers it', async () => {
        route = own({ maxTokens: 65_536, model: 'small-answers' });
        let calls = 0;
        upstreamHandler = (req, res) => {
            calls++;
            if (req.body.max_tokens > 8192) return void res.status(400).json({ error: { message: 'max_tokens: 65536 > 8192, which is the maximum allowed number of output tokens for small-answers' } });
            res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
        };
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(200);
        expect(upstreamRequests.map((request) => request.body.max_tokens)).toEqual([65_536, 8192]);
        upstreamRequests = [];
        await askAndSettle({ messages: [{ role: 'user', content: 'again' }] }, 2);
        expect(upstreamRequests.map((request) => request.body.max_tokens)).toEqual([8192]);
        expect(calls).toBe(3);
    });

    it('passes a 64k-token answer through whole, streamed or not, and counts it', async () => {
        route = own({ maxTokens: 65_536 });
        const longText = 'word '.repeat(60_000);
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: longText } }], usage: { prompt_tokens: 10, completion_tokens: 60_000 } });
        const whole = await askAndSettle({ messages });
        expect((JSON.parse(whole.text).choices[0].message.content as string).length).toBe(longText.length);
        expect(settled()[0].tokens).toMatchObject({ output: 60_000 });
        orbit.settle.mockClear();
        upstreamHandler = (_req, res) => sseOf(res, [...longText.match(/.{1,5000}/g)!.map((piece) => frame({ choices: [{ delta: { content: piece } }] })), frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 60_000 } }), 'data: [DONE]\n\n']);
        const streamed = await askAndSettle({ messages: [{ role: 'user', content: 'again' }], stream: true });
        expect(streamed.text).toContain('[DONE]');
        expect(streamed.text.length).toBeGreaterThan(longText.length);
        expect(settled()[0].tokens).toMatchObject({ output: 60_000 });
    });

    it('says an answer longer than the 16 MiB guard is too long, never hands it on cut, and still settles it', async () => {
        route = own({ maxTokens: 65_536 });
        upstreamHandler = (_req, res) => res.type('json').send(`{"choices":[{"message":{"content":"${'x'.repeat(RELAY_GUARDS.maxReplyBytes + 10)}"}}]}`);
        const answer = await ask({ messages });
        expect(answer.status).toBe(502);
        expect((await answer.json()).error.code).toBe('reply_too_long');
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(settled()[0]).toMatchObject({ sent: true, cutShort: true });
    });

    it('still bounds a Universe-paid call: to what Orbit serves, else to the old guard', async () => {
        route = { config: config({ endpoint: upstreamBase, maxTokens: 65_536 }), source: 'universe-ai', keyOwnerId: null };
        await askAndSettle({ messages });
        expect(upstreamRequests[0].body.max_tokens).toBe(RELAY_GUARDS.maxOutputTokens);
        upstreamRequests = [];
        orbit.identify.mockResolvedValue({ ok: true, jobId: JOB, botId: BOT, limits: { maxOutputTokens: 70_000 } });
        await askAndSettle({ messages: [{ role: 'user', content: 'again' }] }, 2);
        expect(upstreamRequests[0].body.max_tokens).toBe(65_536);
        expect(authorizeInputs()[1].estimate.maxOutputTokens).toBe(65_536);
        upstreamRequests = [];
        orbit.identify.mockResolvedValue({ ok: true, jobId: JOB, botId: BOT, limits: { maxOutputTokens: 9000 } });
        await askAndSettle({ messages: [{ role: 'user', content: 'third' }] }, 3);
        expect(upstreamRequests[0].body.max_tokens).toBe(9000);
    });

    it('tells a stream that was cut that it was, in the shape clients read', async () => {
        route = own();
        upstreamHandler = (_req, res) => {
            res.status(200).setHeader('Content-Type', 'text/event-stream');
            res.write(frame({ choices: [{ delta: { content: 'part' } }] }));
            setTimeout(() => res.destroy(), 10);
        };
        const answer = await ask({ messages, stream: true });
        const text = await answer.text().catch(() => '');
        expect(text).toContain('"part"');
        await vi.waitFor(() => expect(orbit.settle).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(settled()[0]).toMatchObject({ cutShort: true });
    });
});

describe('a model with no price (R10)', () => {
    const unpriced = (source: RelayRoute['source'] = 'universe-ai'): RelayRoute => ({ config: config({ endpoint: upstreamBase, settings: {} }), source, keyOwnerId: source === 'own-key' ? 'person-owner' : null });

    it('is refused for a Universe-paid step, with its typed reason, before anything is held or sent', async () => {
        route = unpriced();
        const answer = await ask({ messages });
        expect(answer.status).toBe(422);
        expect((await answer.json()).error.code).toBe('model_not_priced');
        expect(orbit.authorize).not.toHaveBeenCalled();
        expect(upstreamRequests).toHaveLength(0);
        expect(settled()).toHaveLength(0);
    });

    it('carries on for a call on the owner’s own key', async () => {
        route = unpriced('own-key');
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(200);
        expect(authorizeInputs()[0]).toMatchObject({ payer: 'own-key' });
    });

    it('keeps the old fixed hold for an Orbit that speaks version 1', async () => {
        route = unpriced();
        orbit.contract.mockReturnValue(1);
        const { answer } = await askAndSettle({ messages });
        expect(answer.status).toBe(200);
        expect(authorizeInputs()[0].estimateMicros).toBe(RELAY_GUARDS.unpricedHoldMicros);
    });
});

describe('Gemini’s tokens the address does not explain (S1)', () => {
    const gemini = (): RelayRoute => ({ config: config({ endpoint: upstreamBase, model: 'gemini-2.5-flash' }), source: 'universe-ai', keyOwnerId: null });

    it('prices the thinking it names as thinking, and reports the rest as exposure, never as measured use', async () => {
        route = gemini();
        upstreamHandler = (_req, res) =>
            res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1700, completion_tokens_details: { reasoning_tokens: 400 } } });
        await askAndSettle({ messages });
        const entry = settled()[0];
        // the member is charged for what is explained: 1000 + 100 + 400 tokens at the test rate of one millionth each
        expect(entry.costMicros).toBe(1500);
        expect(entry.tokens).toMatchObject({ input: 1000, output: 100, reasoning: 400 });
        expect(entry.unexplained?.tokens).toBe(200);
    });

    it('reports every token of the gap when it names none', async () => {
        route = gemini();
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1900 } });
        await askAndSettle({ messages });
        expect(settled()[0].costMicros).toBe(1100);
        expect(settled()[0].unexplained?.tokens).toBe(800);
    });

    it('reports nothing unexplained when the total is the parts, and nothing for another provider', async () => {
        route = gemini();
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
        await askAndSettle({ messages });
        expect(settled()[0].unexplained).toBeUndefined();
        orbit.settle.mockClear();
        route = { config: config({ endpoint: upstreamBase, model: 'gpt-4o' }), source: 'universe-ai', keyOwnerId: null };
        upstreamHandler = (_req, res) => res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1900 } });
        await askAndSettle({ messages: [{ role: 'user', content: 'again' }] });
        expect(settled()[0].unexplained).toBeUndefined();
    });
});

describe('Claude cache writes by their lifetime (S2)', () => {
    const claude = (): RelayRoute => ({ config: config({ endpoint: upstreamBase, model: 'claude-sonnet-4-5' }), source: 'universe-ai', keyOwnerId: null });
    const marked = (ttl?: string) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) } }] }] });
    const writes = (res: express.Response, extra: Record<string, unknown> = {}) =>
        res.json({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 3000, completion_tokens: 10, prompt_tokens_details: { cache_write_tokens: 2000, ...extra } } });

    it('reads the provider’s own split of one-hour writes', async () => {
        route = claude();
        upstreamHandler = (_req, res) => writes(res, { cache_creation: { ephemeral_1h_input_tokens: 1500, ephemeral_5m_input_tokens: 500 } });
        await askAndSettle(marked());
        expect(settled()[0].tokens).toMatchObject({ cacheWrite: 2000, cacheWrite1h: 1500 });
        expect(settled()[0].basis).toBe('measured');
    });

    it('prices every write at the one-hour price when the request asked only for one-hour caches', async () => {
        route = claude();
        upstreamHandler = (_req, res) => writes(res);
        await askAndSettle(marked('1h'));
        expect(settled()[0].tokens).toMatchObject({ cacheWrite: 2000, cacheWrite1h: 2000 });
        expect(settled()[0].basis).toBe('measured');
    });

    it('prices writes as the short kind when the request asked for the short cache', async () => {
        route = claude();
        upstreamHandler = (_req, res) => writes(res);
        await askAndSettle(marked());
        expect(settled()[0].tokens?.cacheWrite1h).toBeUndefined();
    });

    it('takes the higher reading and says it is an estimate when a request asked for both kinds', async () => {
        route = claude();
        upstreamHandler = (_req, res) => writes(res);
        const mixed = { messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }] }] };
        await askAndSettle(mixed);
        expect(settled()[0].tokens).toMatchObject({ cacheWrite1h: 2000 });
        expect(settled()[0].basis).toBe('estimated');
    });
});

describe('the three pairings of the contract (6.3)', () => {
    const admin = (answers: Array<{ status: number; data: Record<string, unknown> }>) => {
        const call = vi.fn();
        for (const answer of answers) call.mockResolvedValueOnce(answer);
        call.mockResolvedValue({ status: 200, data: { ok: true } });
        return { computerRelayCall: call };
    };
    const bodiesOf = (a: { computerRelayCall: ReturnType<typeof vi.fn> }) => a.computerRelayCall.mock.calls.map((call) => ({ step: call[0] as string, body: call[1] as Record<string, any> }));
    const settleInput = { jobId: 'j', callId: 'op_1', sent: true as const, costMicros: 20_000, providerCostMicros: 100_000, basis: 'measured' as const, route: 'universe-ai' as const, tokens: { input: 5, output: 6, cached: 0, reasoning: 0, cacheWrite: 0, cacheWrite1h: 0 }, unexplained: { tokens: 9, costMicros: 3 } };

    it('both new: version 2 on the wire, the limits and the typed refusals read, both figures settled', async () => {
        const a = admin([{ status: 200, data: { ok: true, contract: 2, limits: { maxOutputTokens: 40_000, maxCallsInFlight: 4, maxWaitSeconds: 25 } } }]);
        const orbitReal = relayOrbitFor(a);
        expect(await orbitReal.authorize(askInput())).toEqual({ ok: true, limits: { maxOutputTokens: 40_000, maxCallsInFlight: 4, maxWaitSeconds: 25 } });
        expect(orbitReal.contract?.()).toBe(2);
        const sent = bodiesOf(a)[0].body;
        expect(sent).toMatchObject({ contract: 2, operationId: 'op_c', payer: 'universe', inputTokens: 10, maxOutputTokens: 100 });
        expect(sent).not.toHaveProperty('estimateMicros');
        expect(sent).not.toHaveProperty('callId');
        await orbitReal.settle(settleInput);
        const settleSent = bodiesOf(a)[1].body;
        expect(settleSent).toMatchObject({ contract: 2, operationId: 'op_1', providerCostMicros: 100_000, costMicros: 20_000, unexplained: { tokens: 9, costMicros: 3 }, tokens: { cacheWrite1h: 0 } });
        // the strict version 2 route knows no callId
        expect(settleSent).not.toHaveProperty('callId');
        // and every name sent is one the contract lists
        const listed = ['contract', 'jobId', 'operationId', 'sent', 'costMicros', 'providerCostMicros', 'basis', 'payerPersonId', 'route', 'tokens', 'unexplained', 'cutShort'];
        expect(Object.keys(settleSent).filter((key) => !listed.includes(key))).toEqual([]);
        const authorizeListed = ['contract', 'token', 'operationId', 'payer', 'route', 'model', 'modelFormat', 'stepKind', 'inputTokens', 'inputMicros', 'outputMicrosPerMillion', 'maxOutputTokens', 'providerMaxMicros'];
        expect(Object.keys(sent).filter((key) => !authorizeListed.includes(key))).toEqual([]);
    });

    it('both new: authorize with no room needed for an own-key call still sends every required number', async () => {
        const a = admin([{ status: 200, data: { ok: true, contract: 2, memberMicros: 0, providerMaxMicros: 0, authorisation: null } }]);
        const own = askInput({ payer: 'own-key', route: 'own-key', estimate: { inputTokens: 3, inputMicros: 0, outputMicrosPerMillion: null, maxOutputTokens: null, providerMaxMicros: null }, estimateMicros: 50_000 });
        await relayOrbitFor(a).authorize(own);
        expect(bodiesOf(a)[0].body).toMatchObject({ contract: 2, payer: 'own-key', inputMicros: 0, outputMicrosPerMillion: 0 });
        expect(bodiesOf(a)[0].body.maxOutputTokens).toBeGreaterThanOrEqual(1);
    });

    it('both new: a wait, a rule, a budget and a Brick whose AI cannot run a computer are each read as what they are', async () => {
        const read = async (data: Record<string, unknown>) => relayOrbitFor(admin([{ status: 200, data: { ok: false, contract: 2, ...data } }])).authorize(askInput());
        expect(await read({ reason: 'busy', retryAfterSeconds: 7 })).toEqual({ ok: false, reason: 'busy', retryAfterSeconds: 7 });
        expect(await read({ reason: 'holds', retryAfterSeconds: 4 })).toEqual({ ok: false, reason: 'busy', retryAfterSeconds: 4 });
        expect(await read({ reason: 'rule', words: 'Your rule.' })).toEqual({ ok: false, reason: 'rule', words: 'Your rule.' });
        expect(await read({ reason: 'budget', words: 'Computer work is paused for now.', paused: true, canAskForMore: false })).toEqual({ ok: false, reason: 'allowance', words: 'Computer work is paused for now.' });
        expect(await read({ reason: 'funds' })).toEqual({ ok: false, reason: 'allowance' });
        expect(await read({ reason: 'paused' })).toEqual({ ok: false, reason: 'allowance' });
        expect(await read({ reason: 'unpriced' })).toEqual({ ok: false, reason: 'unpriced' });
        expect(await read({ reason: 'refused' })).toEqual({ ok: false, reason: 'refused' });
        expect(await read({ reason: 'unsupported' })).toEqual({ ok: false, reason: 'unsupported' });
        expect(await read({ reason: 'brand_new', retryAfterSeconds: 2 })).toEqual({ ok: false, reason: 'other', code: 'brand_new', retryAfterSeconds: 2 });
    });

    it('new game, old Orbit: its refusal of the body sends version 1 at once, and version 1 for the rest of the process', async () => {
        const a = admin([{ status: 400, data: { error: 'Invalid input data' } }, { status: 200, data: { ok: true } }]);
        const orbitReal = relayOrbitFor(a);
        expect(await orbitReal.authorize(askInput())).toEqual({ ok: true });
        expect(orbitReal.contract?.()).toBe(1);
        const calls = bodiesOf(a);
        expect(calls[0].body.contract).toBe(2);
        // exactly the old payload: one amount, the call's id, nothing it would refuse
        expect(calls[1].body).toEqual({ token: 't', callId: 'op_c', estimateMicros: 205, payer: 'universe' });
        await orbitReal.authorize(askInput({ operationId: 'op_d' }));
        expect(bodiesOf(a)[2].body).toEqual({ token: 't', callId: 'op_d', estimateMicros: 205, payer: 'universe' });
        // the old settle route is strict too: only the fields it knows
        await orbitReal.settle(settleInput);
        const settleBody = bodiesOf(a)[3].body;
        expect(settleBody).not.toHaveProperty('providerCostMicros');
        expect(settleBody).not.toHaveProperty('unexplained');
        expect(settleBody).not.toHaveProperty('contract');
        expect(settleBody.tokens).toEqual({ input: 5, output: 6, cached: 0, reasoning: 0 });
        expect(settleBody).toMatchObject({ jobId: 'j', callId: 'op_1', costMicros: 20_000, basis: 'measured' });
        // and what version 1 refuses it reads as before, with a rule's words
        const old = relayOrbitFor(admin([{ status: 400, data: {} }, { status: 200, data: { ok: false, reason: 'rule', words: 'Rule words' } }]));
        expect(await old.authorize(askInput())).toEqual({ ok: false, reason: 'rule', words: 'Rule words' });
    });

    it('a real bad request of version 2 is not taken for an old Orbit', async () => {
        const a = admin([{ status: 400, data: { error: 'Invalid input data', contract: 2 } }]);
        const orbitReal = relayOrbitFor(a);
        await expect(orbitReal.authorize(askInput())).rejects.toThrow();
        expect(orbitReal.contract?.()).toBeNull();
    });

    it('old game, new Orbit: the old payload is exactly what version 1 always was, and the answer is read in version 1 shapes', async () => {
        // the game's version 1 mode sends the strict old body (above); Orbit's side answers it in version 1: a 200 with ok, or a reason word
        const a = admin([{ status: 400, data: {} }, { status: 200, data: { ok: false, reason: 'pool' } }]);
        expect(await relayOrbitFor(a).authorize(askInput())).toEqual({ ok: false, reason: 'pool' });
    });

    it('serves no limits to the relay once Orbit has spoken version 1', async () => {
        const a = admin([{ status: 200, data: { ok: true, jobId: 'j', botId: 'b', limits: { maxOutputTokens: 1 } } }]);
        const fresh = relayOrbitFor(a);
        expect((await fresh.identify('t'))).toMatchObject({ ok: true, limits: { maxOutputTokens: 1 } });
        const v1 = relayOrbitFor(admin([{ status: 400, data: {} }, { status: 200, data: { ok: true } }, { status: 200, data: { ok: true, jobId: 'j', botId: 'b', limits: { maxOutputTokens: 1 } } }]));
        await v1.authorize(askInput());
        expect(await v1.identify('t')).toEqual({ ok: true, jobId: 'j', botId: 'b' });
    });
});
