/**
 * The model relay for a Brick's computer (build handoff v2, section 5). Hermes, on the computer, talks to an OpenAI-format address
 * and holds one thing: a short-lived key Orbit made for the job. It never holds a provider key. This is that address.
 *
 * Every call goes through the same steps, in this order:
 *  1. Orbit says which Brick the key belongs to (and refuses a key that ended, or that is from before a take-over).
 *  2. Orbit says how that Brick's AI runs (Universe AI, a server provider, or the owner's own key), exactly as for a reply, and the
 *     provider's key stays here.
 *  3. Orbit takes room for this one call from the person's computer allowance (none for a call on their own key). No room: the
 *     call is refused with the reason and nothing is sent to a provider.
 *  4. The call runs, streamed straight back. If Hermes goes away the provider call is cut off.
 *  5. What it cost goes to Orbit once: priced by the same price list as a reply, estimated from what came through when the
 *     provider did not say, unknown (settled at the room held, never 0) when nothing is known.
 *
 * Nothing anyone said is logged or kept here: only ids, statuses and costs.
 */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import express, { type Request, type Response, type Router } from 'express';
import type { AIProviderConfig } from '../ai/types';
import { decryptApiKey } from '../ai/encryption';
import { fetchFor, providerErrorText } from '../ai/providers/ownKeyHttp';
import { isOpenAIHost, readUsageDetail, refusesStreamOptions } from '../ai/providers/OpenAIProvider';
import { priceCall } from '../ai/pricing/costing';
import { priceMetadata, type CallMetadata } from '../ai/pricing/ledger';
import type { CallCost } from '../ai/pricing/types';

/** What the relay needs of Orbit: the three calls of /api/computer/llm. */
export interface RelayOrbit {
    identify(token: string): Promise<{ ok: true; jobId: string; botId: string } | { ok: false }>;
    authorize(input: { token: string; callId: string; estimateMicros: number; payer: 'universe' | 'own-key' }): Promise<{ ok: true } | { ok: false; reason: 'refused' | 'allowance' | 'pool' }>;
    settle(input: SettleInput): Promise<{ ok: boolean }>;
}

/** The Orbit calls the relay makes, over the bot server's service token. */
export function relayOrbitFor(admin: { computerRelayCall(step: 'identify' | 'authorize' | 'settle', body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> }): RelayOrbit {
    const unexpected = (step: string, status: number) => new Error(`Orbit answered ${step} with ${status}`);
    return {
        async identify(token) {
            const { status, data } = await admin.computerRelayCall('identify', { token });
            if (status !== 200) throw unexpected('identify', status);
            return data.ok === true && typeof data.jobId === 'string' && typeof data.botId === 'string' ? { ok: true, jobId: data.jobId, botId: data.botId } : { ok: false };
        },
        async authorize(input) {
            const { status, data } = await admin.computerRelayCall('authorize', input);
            if (status !== 200) throw unexpected('authorize', status);
            if (data.ok === true) return { ok: true };
            return { ok: false, reason: data.reason === 'allowance' || data.reason === 'pool' ? data.reason : 'refused' };
        },
        async settle(input) {
            const { status } = await admin.computerRelayCall('settle', { ...input });
            // 404: Orbit knows no such call, so nothing was written; telling it again would change nothing
            if (status === 404) return { ok: false };
            if (status !== 200) throw unexpected('settle', status);
            return { ok: true };
        },
    };
}

export interface SettleInput {
    jobId: string;
    callId: string;
    /** False when nothing went to a provider: Orbit gives the room back and writes nothing. */
    sent: boolean;
    costMicros?: number | null;
    basis?: 'measured' | 'estimated' | 'unknown';
    payerPersonId?: string | null;
    route?: 'universe-ai' | 'own-key' | 'provider';
    tokens?: { input?: number | null; output?: number | null; cached?: number | null; reasoning?: number | null };
    cutShort?: boolean;
}

/** How the Brick's AI runs now, as Orbit says (the same answer a reply gets). Null when it cannot be told or the key is resting. */
export type RelayRoute = { config: AIProviderConfig; source: 'universe-ai' | 'provider' | 'own-key'; keyOwnerId: string | null };

export interface RelayDeps {
    orbit: RelayOrbit;
    routeFor(botId: string): Promise<RelayRoute | null>;
    /** For tests: how a call to the provider is made. Defaults to the global fetch (the address guard for an address a person typed). */
    fetchFor?: (config: AIProviderConfig) => typeof fetch;
    /** For tests: how long to wait between tries to settle. */
    settleDelaysMs?: number[];
}

/** Technical guards, in one place (none of these is a limit a person sees). */
export const RELAY_GUARDS = {
    /** The largest request Hermes may send (a long conversation with files in it). */
    maxBodyBytes: 16 * 1024 * 1024,
    /** Calls one job may have in flight at once. */
    maxCallsInFlight: 8,
    /** How long one provider call may take in all. */
    callTimeoutMs: 10 * 60 * 1000,
    /** The most a call may be allowed to write, whatever Hermes asks for. */
    maxOutputTokens: 32_768,
    /** What a call may write when neither Hermes nor the provider's settings say. */
    defaultOutputTokens: 4096,
    /** Room held for a call on a model whose price is not known: unknown is held generously and settled at what is held, never 0. */
    unpricedHoldMicros: 50_000,
    /** Characters per token, set low on purpose: the room held is an upper reading of the input. */
    charsPerToken: 3,
} as const;

const SETTLE_DELAYS_MS = [1000, 3000];

/** Waits until a written-to response can take more, or is gone (a wait that never ended would hold the provider call open). */
const drained = (res: Response) =>
    new Promise<void>((resolve) => {
        const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
        };
        res.once('drain', done);
        res.once('close', done);
    });

/** The words of a provider's error answer: its message when it is JSON with one, else the text as it came. */
function wordsOf(text: string): string {
    try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
        const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
        if (typeof message === 'string' && message) return message;
    } catch {
        /* not JSON: the text itself */
    }
    return text;
}

/** A provider that says our key is wrong is our problem, not Hermes's: Hermes must not read it as its own key being refused. */
const statusToHermes = (status: number): number => (status === 401 || status === 402 || status === 403 ? 502 : status >= 400 && status < 600 ? status : 502);

/** An error in the shape every OpenAI client reads. */
const problem = (res: Response, status: number, message: string, code: string, type = 'invalid_request_error') => {
    if (!res.headersSent) res.status(status).json({ error: { message, type, code } });
    else res.end();
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const bearerOf = (req: Request): string | null => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    return token.startsWith('cjt_') && token.length <= 200 ? token : null;
};

/** The most the call may write: what Hermes asked for, else the provider's setting, else the default, never above the guard. */
export function outputCapOf(body: Record<string, unknown>, config: AIProviderConfig): number {
    const asked = [body.max_completion_tokens, body.max_tokens].find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const base = asked ?? (config.maxTokens > 0 ? config.maxTokens : RELAY_GUARDS.defaultOutputTokens);
    return Math.min(Math.floor(base), RELAY_GUARDS.maxOutputTokens);
}

/** Room for one call: its input read high, its longest allowed reply, at the price list's rates. A price nobody knows holds a fixed generous room. */
export function estimateCallMicros(body: Record<string, unknown>, config: AIProviderConfig, outputCap: number, at: Date): number {
    const inputTokens = Math.ceil((JSON.stringify(body.messages ?? []).length + JSON.stringify(body.tools ?? []).length) / RELAY_GUARDS.charsPerToken);
    const cost = priceCall({ config, usage: { inputTokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: outputCap, reasoningTokens: 0 }, at });
    return Math.max(1, cost.micros ?? RELAY_GUARDS.unpricedHoldMicros);
}

/** What Orbit is told of a priced call. */
function factsOf(cost: CallCost, estimated: boolean): { costMicros: number | null; basis: 'measured' | 'estimated' | 'unknown' } {
    if (cost.micros === null || cost.basis === 'unknown') return { costMicros: null, basis: 'unknown' };
    return { costMicros: cost.micros, basis: estimated ? 'estimated' : 'measured' };
}

interface Ended {
    usage: CallMetadata | undefined;
    /** What came through, when the provider said nothing of its own use: the output is read from it. */
    outputChars: number;
    cutShort: boolean;
    /** The call could not be made at all (the provider was not reached): nothing was sent, so nothing is owed. */
    notSent: boolean;
}

export function createComputerModelRelay(deps: RelayDeps): Router {
    const router = express.Router();
    const inFlight = new Map<string, number>();
    const delays = deps.settleDelaysMs ?? SETTLE_DELAYS_MS;
    // Providers that refused `stream_options` once are not asked again
    const refusedStreamOptions = new Set<string>();
    const fetchOf = deps.fetchFor ?? fetchFor;
    const json = express.json({ limit: RELAY_GUARDS.maxBodyBytes });

    /** Tells Orbit how a call ended: tried again for a moment, and if Orbit still cannot be reached its own sweep settles the room at what was held. */
    async function settleOnce(input: SettleInput): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            try {
                await deps.orbit.settle(input);
                return;
            } catch (error) {
                if (attempt >= delays.length) {
                    console.error('[ComputerRelay] Could not settle a call:', providerErrorText(error));
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
            }
        }
    }

    router.get('/v1/models', async (req: Request, res: Response) => {
        const token = bearerOf(req);
        const who = token ? await deps.orbit.identify(token).catch(() => null) : null;
        if (!who?.ok) return problem(res, 401, 'Invalid API key.', 'invalid_api_key', 'authentication_error');
        // One name: Hermes never chooses the model, the Brick's own AI does
        res.json({ object: 'list', data: [{ id: 'universe-ai', object: 'model', created: 0, owned_by: 'universe' }] });
    });

    router.post('/v1/chat/completions', json, async (req: Request, res: Response) => {
        const token = bearerOf(req);
        let who: Awaited<ReturnType<RelayOrbit['identify']>> | null = null;
        try {
            who = token ? await deps.orbit.identify(token) : null;
        } catch {
            return problem(res, 503, 'The service is busy. Try again in a moment.', 'service_unavailable', 'server_error');
        }
        if (!token || !who?.ok) return problem(res, 401, 'Invalid API key.', 'invalid_api_key', 'authentication_error');
        const { jobId, botId } = who as { ok: true; jobId: string; botId: string };

        const body = req.body;
        if (!isRecord(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
            return problem(res, 400, 'A request needs a list of messages.', 'invalid_request');
        }
        const streaming = body.stream === true;

        let route: RelayRoute | null;
        try {
            route = await deps.routeFor(botId);
        } catch {
            return problem(res, 503, 'The AI could not be reached. Try again in a moment.', 'service_unavailable', 'server_error');
        }
        if (!route) return problem(res, 503, 'This Brick’s AI is not answering right now.', 'ai_resting', 'server_error');
        const { config, source } = route;
        // Only OpenAI-format providers are reached directly here; others come with their own translation
        if (config.type !== 'openai') return problem(res, 501, 'This Brick’s AI cannot be used from a computer yet.', 'provider_not_supported', 'server_error');

        const running = inFlight.get(jobId) ?? 0;
        if (running >= RELAY_GUARDS.maxCallsInFlight) return problem(res, 429, 'Too many calls at once. Slow down.', 'rate_limit_exceeded', 'rate_limit_error');

        const now = new Date();
        const outputCap = outputCapOf(body, config);
        const callId = randomUUID();
        const payer = source === 'own-key' ? 'own-key' : 'universe';
        let allowed: Awaited<ReturnType<RelayOrbit['authorize']>>;
        try {
            allowed = await deps.orbit.authorize({ token, callId, estimateMicros: estimateCallMicros(body, config, outputCap, now), payer });
        } catch {
            return problem(res, 503, 'The service is busy. Try again in a moment.', 'service_unavailable', 'server_error');
        }
        if (!allowed.ok) {
            const reason = 'reason' in allowed ? allowed.reason : 'refused';
            if (reason === 'allowance') return problem(res, 429, 'This computer’s allowance is used up.', 'insufficient_quota', 'insufficient_quota');
            if (reason === 'pool') return problem(res, 503, 'Computers are busy right now. Try again in a moment.', 'overloaded', 'server_error');
            return problem(res, 401, 'Invalid API key.', 'invalid_api_key', 'authentication_error');
        }

        inFlight.set(jobId, running + 1);
        const payerPersonId = source === 'own-key' ? route.keyOwnerId : null;
        let ended: Ended = { usage: undefined, outputChars: 0, cutShort: false, notSent: false };
        try {
            ended = await callProvider({ body, config, streaming, outputCap, res });
        } catch (error) {
            console.error('[ComputerRelay] A call failed:', providerErrorText(error));
            if (!res.headersSent) problem(res, 502, 'The AI did not answer.', 'upstream_error', 'server_error');
            else res.end();
            ended = { usage: undefined, outputChars: 0, cutShort: true, notSent: false };
        } finally {
            inFlight.set(jobId, Math.max(0, (inFlight.get(jobId) ?? 1) - 1));
            if ((inFlight.get(jobId) ?? 0) === 0) inFlight.delete(jobId);
        }

        if (ended.notSent) {
            await settleOnce({ jobId, callId, sent: false });
            return;
        }
        // The provider said what it used: priced from that. If it said nothing, the input is read as estimated and the output from what came through
        let metadata = ended.usage;
        let estimated = false;
        if (!metadata?.error && (!metadata || (metadata.promptTokens ?? 0) + (metadata.completionTokens ?? 0) <= 0)) {
            const promptTokens = Math.ceil((JSON.stringify(body.messages).length + JSON.stringify(body.tools ?? []).length) / RELAY_GUARDS.charsPerToken);
            const completionTokens = Math.ceil(ended.outputChars / RELAY_GUARDS.charsPerToken);
            metadata = completionTokens > 0 ? { promptTokens, completionTokens } : undefined;
            estimated = metadata !== undefined;
        }
        const priced = priceMetadata(config, metadata, now);
        const facts = factsOf(priced.cost, estimated);
        await settleOnce({
            jobId,
            callId,
            sent: true,
            ...facts,
            ...(payerPersonId ? { payerPersonId } : {}),
            route: source,
            tokens: { input: priced.usage.inputTokens, output: priced.usage.outputTokens, cached: priced.usage.cachedTokens, reasoning: priced.usage.reasoningTokens },
            ...(ended.cutShort ? { cutShort: true } : {}),
        });
    });

    /** Makes the call and gives the answer back as it comes. */
    async function callProvider(call: { body: Record<string, unknown>; config: AIProviderConfig; streaming: boolean; outputCap: number; res: Response }): Promise<Ended> {
        const { body, config, streaming, outputCap, res } = call;
        const key = config.apiKeyEncrypted ? decryptApiKey(config.apiKeyEncrypted) : null;
        const url = `${(config.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;

        const sent: Record<string, unknown> = { ...body, model: config.model, n: 1, stream: streaming };
        // The reply is never longer than the room held for it. OpenAI's own models want the newer field name.
        delete sent.max_tokens;
        delete sent.max_completion_tokens;
        sent[isOpenAIHost(config.endpoint) || typeof body.max_completion_tokens === 'number' ? 'max_completion_tokens' : 'max_tokens'] = outputCap;
        if (streaming && !refusedStreamOptions.has(url)) sent.stream_options = { ...(isRecord(body.stream_options) ? body.stream_options : {}), include_usage: true };
        else delete sent.stream_options;

        const controller = new AbortController();
        let cutShort = false;
        const timer = setTimeout(() => {
            cutShort = true;
            controller.abort();
        }, RELAY_GUARDS.callTimeoutMs);
        // Hermes went away (it was cancelled, the person took over, the computer stopped): the provider call stops too
        const onClose = () => {
            if (!res.writableFinished) {
                cutShort = true;
                controller.abort();
            }
        };
        res.on('close', onClose);

        const send = (payload: Record<string, unknown>) =>
            fetchOf(config)(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

        try {
            let upstream: Awaited<ReturnType<typeof fetch>>;
            try {
                upstream = await send(sent);
                if (!upstream.ok && sent.stream_options) {
                    const text = await upstream.clone().text().catch(() => '');
                    if (refusesStreamOptions(upstream.status, text)) {
                        refusedStreamOptions.add(url);
                        delete sent.stream_options;
                        upstream = await send(sent);
                    }
                }
            } catch (error) {
                // Not reached at all: nothing was sent. A cut-off while waiting is not the same thing and is owed.
                if (!controller.signal.aborted) {
                    problem(res, 502, 'The AI could not be reached.', 'upstream_unreachable', 'server_error');
                    console.warn('[ComputerRelay] The provider was not reached:', providerErrorText(error));
                    return { usage: undefined, outputChars: 0, cutShort: false, notSent: true };
                }
                if (!res.headersSent && !res.writableEnded) problem(res, 504, 'The AI took too long.', 'upstream_timeout', 'server_error');
                return { usage: undefined, outputChars: 0, cutShort: true, notSent: false };
            }

            if (!upstream.ok) {
                // What the provider said, in words fit for a log: never its key, never the conversation
                const text = await upstream.text().catch(() => '');
                const message = providerErrorText(wordsOf(text)).split(key ?? '\u0000').join('[redacted]');
                console.warn('[ComputerRelay] The provider refused a call:', upstream.status, message);
                problem(res, statusToHermes(upstream.status), message, 'upstream_error', 'server_error');
                // A call the provider refused was not billed
                return { usage: { error: true }, outputChars: 0, cutShort: false, notSent: false };
            }

            if (!streaming) {
                const data = (await upstream.json().catch(() => null)) as { usage?: unknown; choices?: Array<{ message?: { content?: unknown } }> } | null;
                if (!data) {
                    problem(res, 502, 'The AI answered with something unreadable.', 'upstream_error', 'server_error');
                    return { usage: undefined, outputChars: 0, cutShort: false, notSent: false };
                }
                res.status(200).json(data);
                const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
                const content = data.choices?.[0]?.message?.content;
                return {
                    usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, ...readUsageDetail(usage) } : undefined,
                    outputChars: typeof content === 'string' ? content.length : 0,
                    cutShort,
                    notSent: false,
                };
            }

            if (!upstream.body) {
                problem(res, 502, 'The AI answered with something unreadable.', 'upstream_error', 'server_error');
                return { usage: undefined, outputChars: 0, cutShort: false, notSent: false };
            }
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            let pending = '';
            let usage: CallMetadata | undefined;
            let outputChars = 0;
            const read = (line: string) => {
                if (!line.startsWith('data:')) return;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const chunk = JSON.parse(data) as { usage?: { prompt_tokens?: number; completion_tokens?: number } | null; choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }> };
                    if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, ...readUsageDetail(chunk.usage) };
                    for (const choice of chunk.choices ?? []) {
                        if (typeof choice.delta?.content === 'string') outputChars += choice.delta.content.length;
                        if (typeof choice.delta?.reasoning_content === 'string') outputChars += choice.delta.reasoning_content.length;
                    }
                } catch {
                    /* a line that is not JSON says nothing of use */
                }
            };
            try {
                for await (const chunk of Readable.fromWeb(upstream.body as never) as AsyncIterable<Buffer>) {
                    if (res.destroyed || res.writableEnded) break;
                    pending += chunk.toString('utf8');
                    let at: number;
                    while ((at = pending.indexOf('\n')) >= 0) {
                        read(pending.slice(0, at).replace(/\r$/, ''));
                        pending = pending.slice(at + 1);
                    }
                    if (!res.write(chunk)) await drained(res);
                }
                read(pending);
                if (!res.writableEnded) res.end();
            } catch (error) {
                // The provider's stream broke, or Hermes went away: what came through is counted, and the other side is told
                if (!controller.signal.aborted) {
                    console.warn('[ComputerRelay] A stream broke:', providerErrorText(error));
                    cutShort = true;
                }
                if (!res.writableEnded) res.end();
            }
            return { usage, outputChars, cutShort, notSent: false };
        } finally {
            clearTimeout(timer);
            res.off('close', onClose);
        }
    }

    // A body too big, or not JSON: said in the shape clients read, never as a page
    router.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
        if (res.headersSent) return next(error);
        const status = isRecord(error) && typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? error.status : 400;
        return problem(res, status, status === 413 ? 'The request is too large.' : 'The request could not be read.', status === 413 ? 'request_too_large' : 'invalid_request');
    });

    return router;
}
