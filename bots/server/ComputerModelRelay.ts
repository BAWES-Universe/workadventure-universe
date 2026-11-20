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
import { StringDecoder } from 'node:string_decoder';
import express, { type Request, type Response, type Router } from 'express';
import type { AIProviderConfig } from '../ai/types';
import { decryptApiKey } from '../ai/encryption';
import { fetchFor, providerErrorText } from '../ai/providers/ownKeyHttp';
import { isOpenAIHost, readUsageDetail, refusesStreamOptions } from '../ai/providers/OpenAIProvider';
import { priceCall } from '../ai/pricing/costing';
import { priceMetadata, type CallMetadata } from '../ai/pricing/ledger';
import type { CallCost } from '../ai/pricing/types';
import type { CallKind, FaultReason, RefusalNotes } from './ComputerRefusals';

/** What the relay needs of Orbit: the three calls of /api/computer/llm. */
export interface RelayOrbit {
    identify(token: string): Promise<{ ok: true; jobId: string; botId: string } | { ok: false }>;
    authorize(input: { token: string; callId: string; estimateMicros: number; payer: 'universe' | 'own-key' }): Promise<{ ok: true } | { ok: false; reason: 'refused' | 'allowance' | 'pool' | 'rule' }>;
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
            return { ok: false, reason: data.reason === 'allowance' || data.reason === 'pool' || data.reason === 'rule' ? data.reason : 'refused' };
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

/** Orbit says the Brick's own key is down and its owner chose to stop replying: no AI is called, and the person's own key is why. */
export type RelayRestingOwnKey = { restingOwnKey: true };

export interface RelayDeps {
    orbit: RelayOrbit;
    routeFor(botId: string): Promise<RelayRoute | RelayRestingOwnKey | null>;
    /** For tests: how a call to the provider is made. Defaults to the global fetch (the address guard for an address a person typed). */
    fetchFor?: (config: AIProviderConfig) => typeof fetch;
    /** For tests: how long to wait between tries to settle. */
    settleDelaysMs?: number[];
    /** Where a refusal for the person's allowance or a rule of theirs is noted, so the runner of the same job can tell such a turn from one that broke. */
    refusals?: RefusalNotes;
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
    /** The most of a provider's answer that is read into memory: a refusal's words, a whole reply, one line of a stream. */
    maxErrorBytes: 64 * 1024,
    maxReplyBytes: 16 * 1024 * 1024,
    maxStreamLineChars: 1024 * 1024,
} as const;

const SETTLE_DELAYS_MS = [1000, 3000];

/** Waits until a written-to response can take more, or is gone (a wait that never ended would hold the provider call open). */
/** The characters a model wrote as tool calls (the name and the arguments), in a reply or in a piece of one. */
const toolCallChars = (calls: unknown): number => {
    if (!Array.isArray(calls)) return 0;
    let total = 0;
    for (const call of calls) {
        const fn = isRecord(call) && isRecord(call.function) ? call.function : null;
        if (!fn) continue;
        if (typeof fn.name === 'string') total += fn.name.length;
        if (typeof fn.arguments === 'string') total += fn.arguments.length;
    }
    return total;
};

/**
 * A provider's answer read up to `max` bytes. Past that the body is cancelled and the words so far are returned, cut: an answer is never held whole
 * in memory because a provider (or something in front of it) sent more than any answer needs. `tooLong` says so.
 */
export async function readBoundedWithFlag(response: globalThis.Response, max: number): Promise<{ text: string; tooLong: boolean }> {
    const body = response.body;
    if (!body) return { text: '', tooLong: false };
    const reader = body.getReader();
    const decoder = new StringDecoder('utf8');
    let text = '';
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > max) {
                // Not waited for: the body of a clone is one of two branches of a tee, and cancelling one branch finishes only when the other is
                // cancelled or read to its end too, which a caller that reads the original after this returns would never reach
                void reader.cancel().catch(() => undefined);
                return { text: text + decoder.end(), tooLong: true };
            }
            text += decoder.write(Buffer.from(value));
        }
    } finally {
        reader.releaseLock?.();
    }
    return { text: text + decoder.end(), tooLong: false };
}

const readBounded = async (response: globalThis.Response, max: number): Promise<string> => (await readBoundedWithFlag(response, max)).text;

/** The JSON of an answer no longer than `max` bytes; null when it is longer or is not JSON. */
export async function readBoundedJson(response: globalThis.Response, max: number): Promise<unknown> {
    try {
        const { text, tooLong } = await readBoundedWithFlag(response, max);
        return tooLong ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

/** The JSON of a whole non-streamed answer, and whether it was cut at the bound (then it is not read at all). */
export async function readBoundedReply<T>(response: globalThis.Response, max: number): Promise<{ data: T | null; tooLong: boolean }> {
    try {
        const { text, tooLong } = await readBoundedWithFlag(response, max);
        return tooLong ? { data: null, tooLong: true } : { data: JSON.parse(text) as T, tooLong: false };
    } catch {
        return { data: null, tooLong: false };
    }
}

/**
 * The string and number fields a provider's refusal said (`code`, `type`, `param`, `message`, `status`) in a body that was cut at the bound, so
 * it could not be parsed whole: the first of each, read where it stands. Nothing is guessed: a field that was cut off is not there.
 */
export function leadingFieldsOf(text: string): Record<string, unknown> | null {
    const found: Record<string, unknown> = {};
    const field = /"(code|type|param|message|status)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+|null)/g;
    for (let match = field.exec(text); match; match = field.exec(text)) {
        if (match[1] in found) continue;
        try {
            found[match[1]] = JSON.parse(match[2]);
        } catch {
            /* a value that was cut in the middle is not read */
        }
    }
    return Object.keys(found).length > 0 ? found : null;
}

const drained = (res: Response, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        const done = () => {
            res.off('drain', done);
            res.off('close', done);
            signal.removeEventListener('abort', done);
            resolve();
        };
        // A caller that stops reading and keeps the connection open must not hold the call past its deadline
        if (signal.aborted) return resolve();
        res.once('drain', done);
        res.once('close', done);
        signal.addEventListener('abort', done, { once: true });
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
/** The codes and types a provider sets when the error is about our key, our credit or our model (it never echoes what the job sent in them): ours. */
const KEY_CODES = /invalid[_ -]?api[_ -]?key|model[_ -]?not[_ -]?found|insufficient[_ -]?(quota|funds|credit)|billing|account[_ -]?(deactivated|suspended)|authentication[_ -]?(error|failed)|permission[_ -]?denied/i;
/** The same said in a message: read only when the error has no status and names no field, since a provider echoes the job's own values in a message. */
const KEY_MESSAGE = /incorrect api key|invalid api key|model .*does not exist|exceeded your (current )?quota|insufficient[_ -]?(quota|funds|credit)|billing|account (is )?(deactivated|suspended)/i;
/** A 429 that is about this one request being larger than the limit (OpenAI: "Request too large ... Limit 30000, Requested 45000 ... must be reduced"), not a rate limit: a rate limit names what was used too (Limit 30000, Used 28000, Requested 5000). */
const REQUEST_TOO_LARGE = /request too large|too large for|must be reduced|reduce (the length|the size|your (prompt|input|request))|limit \d+,? requested \d+/i;
const CONTENT_WORDS = /moderat|content[_ -]?(policy|filter|management)|safety|flagged|context[_ -]?(length|window)|maximum context|too many tokens|token limit|prompt (is )?too long|too large/i;
/** Wording that says the prompt or the context is the problem, not the value of a field: the job's own input. */
const INPUT_WORDS = /context[_ -]?(length|window)|maximum context|prompt (is )?too long|too many tokens|in the (messages|prompt)|messages? (is|are) too (long|large)|inputs? tokens|max_new_tokens|prompt tokens/i;
/** The two fields that carry the token limit: the job's own ask up to our setting, so the limit is the job's unless we lowered it. */
const TOKEN_LIMIT_FIELDS = new Set(['max_tokens', 'max_completion_tokens']);
/** The fields of a call that the relay sets itself; every other field is what the job's own machine sent, and a job's words can steer it. */
const RELAY_FIELDS = new Set(['model', 'max_tokens', 'max_completion_tokens', 'n', 'stream', 'stream_options']);

/** How the fields of a call were chosen, for reading a provider's refusal of them (see jobsOwnLimit), and the limit the relay sent. */
export interface JobsOwn {
    limit: boolean;
    name: boolean;
    outputCap?: number;
}

/**
 * What a provider's error says, in the three classes Orbit judges refunds by:
 *  - `fault`: a confirmed fault of Universe's (our key or model refused: 401, 402, 403, 404, a key code), which no job's words can cause.
 *  - `not_ours`: what the job itself sent was refused (moderation, a content policy, a context that is too long, a body too large, a 400 or 422 about
 *    a field the job's machine sent, a token limit the job asked for): neither a fault of ours nor an answer.
 *  - `uncertain`: unresolved, for bounded goodwill and reconciliation: the provider's own service failing (5xx), a rate limit (429), a refusal of a
 *    field only the relay sets (model, a token limit we chose, n, stream), a 400 or 422 that names no field at all, and an error that says nothing.
 * `who` is `ours` for `fault` and `uncertain`, `request` for `not_ours`.
 */
export interface ProviderReading {
    who: 'ours' | 'request';
    kind: 'fault' | 'uncertain' | 'not_ours';
    reason: FaultReason;
}

const OURS_FAULT = (reason: FaultReason): ProviderReading => ({ who: 'ours', kind: 'fault', reason });
const OURS_UNSURE = (reason: FaultReason): ProviderReading => ({ who: 'ours', kind: 'uncertain', reason });
const REQUESTS = (): ProviderReading => ({ who: 'request', kind: 'not_ours', reason: 'field_job_set' });

export function readProviderError(status: number | null, error: unknown, jobs: JobsOwn = { limit: true, name: true }): ProviderReading {
    const record = isRecord(error) ? error : {};
    const words = ['code', 'type', 'message', 'status'].map((key) => (typeof record[key] === 'string' ? (record[key] as string) : '')).join(' ');
    let numeric = status;
    if (numeric === null) {
        const code = record.code ?? record.status;
        const asNumber = typeof code === 'number' ? code : typeof code === 'string' && /^\d{3}$/.test(code) ? Number(code) : null;
        numeric = asNumber !== null && asNumber >= 100 && asNumber < 600 ? asNumber : null;
    }
    if (numeric === 429 && REQUEST_TOO_LARGE.test(words)) {
        // "Requested" is the input and the limit we set together: when the input alone fits under the provider's limit, it was our limit that made the
        // request too large (ours); when the job set the limit, or the input alone does not fit, it is the request's
        const limit = Number(/\blimit\D{0,3}(\d[\d,]*)/i.exec(words)?.[1]?.replace(/,/g, ''));
        const requested = Number(/\brequested\D{0,3}(\d[\d,]*)/i.exec(words)?.[1]?.replace(/,/g, ''));
        if (!jobs.limit && jobs.outputCap !== undefined && limit > 0 && requested > 0 && requested - jobs.outputCap < limit) return OURS_UNSURE('provider_429');
        return REQUESTS();
    }
    if (numeric === 429) return OURS_UNSURE('provider_429');
    if (numeric !== null && numeric >= 500) return OURS_UNSURE('provider_5xx');
    if (numeric === 413) return REQUESTS();
    // A refusal of a field the relay sets (model, n, stream, its options): ours, but unresolved (a setting of ours may be wrong, or the provider may have
    // changed). The token limit is the job's own when the job asked for it and we did not lower it, and then a refusal of it is the request's; a limit we
    // chose is ours, unless the wording blames the prompt or the context (a context that is too long, N tokens in the messages, inputs tokens)
    const paramField = typeof record.param === 'string' ? (/^[A-Za-z_]+/.exec(record.param)?.[0] ?? '') : '';
    const refusedShape = numeric === null || numeric === 400 || numeric === 422;
    if (refusedShape && RELAY_FIELDS.has(paramField)) {
        if (!TOKEN_LIMIT_FIELDS.has(paramField)) return OURS_UNSURE('field_relay_set');
        // The name of the field is the relay's choice on OpenAI's host (max_completion_tokens) and the job's own elsewhere, where the relay keeps the name the job
        // used: a refusal of the name is ours only when the relay picked it
        if (/unsupported[_ ]parameter/i.test(`${typeof record.code === 'string' ? record.code : ''} ${typeof record.message === 'string' ? record.message.slice(0, 40) : ''}`)) return jobs.name ? REQUESTS() : OURS_UNSURE('field_relay_set');
        return jobs.limit || INPUT_WORDS.test(words) ? REQUESTS() : OURS_UNSURE('field_relay_set');
    }
    if (CONTENT_WORDS.test(words)) return REQUESTS();
    // Our key, our credit or our model, named by the error itself: ours, before its shape is looked at. Only what the provider sets (code, type) is
    // read for that, never a message on a call that names a field: a message echoes the job's own values, and a job can steer those
    const codes = ['code', 'type'].map((key) => (typeof record[key] === 'string' ? (record[key] as string) : '')).join(' ');
    if (KEY_CODES.test(codes)) return OURS_FAULT('provider_key_ours');
    if (numeric === null && typeof record.param !== 'string' && KEY_MESSAGE.test(typeof record.message === 'string' ? record.message : '')) return OURS_FAULT('provider_key_ours');
    // A refusal of the shape of the call (by status when there is one: a 401, 402, 403 or 404 often carries type `invalid_request_error` too, and is
    // about our key or our model): the request's when it names a field the job sent, unresolved when it names no field at all (a bad payload of the job's
    // or a forwarding or serialization error of ours cannot be told apart)
    const badShape = numeric === null ? record.type === 'invalid_request_error' || typeof record.param === 'string' : numeric === 400 || numeric === 422;
    if (badShape) return paramField ? REQUESTS() : OURS_UNSURE('fieldless_400');
    if (numeric === 401 || numeric === 402 || numeric === 403 || numeric === 404) return OURS_FAULT('provider_key_ours');
    // Any other status, or an error that says nothing of a code: unresolved
    return OURS_UNSURE(numeric === null ? 'provider_5xx' : 'fieldless_400');
}

/** Whose a provider's error is, read as `readProviderError` does: `request` when what the job itself sent was refused, else `ours`. */
export function whoseProviderError(status: number | null, error: unknown, jobs: JobsOwn = { limit: true, name: true }): 'ours' | 'request' {
    return readProviderError(status, error, jobs).who;
}

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

const askedLimitOf = (body: Record<string, unknown>): number | undefined =>
    [body.max_completion_tokens, body.max_tokens].find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

/**
 * What of the token limit the job chose, for reading a provider's refusal of it. The value is the job's own when it asked for one and we set no
 * limit of our own (with a setting, a value the provider refuses is our setting's mistake; with none, any ask is the job's, including one the
 * guard lowered). The field name is the job's own only when the host is not OpenAI's and the job itself sent max_completion_tokens (the relay keeps that name there); max_tokens is the name the relay sends anyway, so a refusal of it is ours.
 */
export function jobsOwnLimit(body: Record<string, unknown>, config: AIProviderConfig): { limit: boolean; name: boolean } {
    const asked = askedLimitOf(body);
    return {
        limit: asked !== undefined && !(config.maxTokens > 0),
        name: !isOpenAIHost(config.endpoint) && typeof body.max_completion_tokens === 'number',
    };
}

/** The most the call may write: what Hermes asked for, else the provider's setting, else the default, never above our setting or the guard. */
export function outputCapOf(body: Record<string, unknown>, config: AIProviderConfig): number {
    const asked = askedLimitOf(body);
    const setting = config.maxTokens > 0 ? config.maxTokens : null;
    // Never more than our own setting, so a limit the job asked for above it is lowered to it
    const base = asked !== undefined ? (setting !== null ? Math.min(asked, setting) : asked) : (setting ?? RELAY_GUARDS.defaultOutputTokens);
    return Math.min(Math.floor(base), RELAY_GUARDS.maxOutputTokens);
}

/**
 * The input of a call read in tokens, high on purpose: counted in bytes (UTF-8), not characters, so text that takes more than one byte a
 * character (Arabic, Chinese, emoji) is not read as a third of what it costs. A characters count undercounted it, and the room held for
 * such a call was smaller than the call (audit F9).
 */
export function inputTokensOf(body: Record<string, unknown>): number {
    return Math.ceil((Buffer.byteLength(JSON.stringify(body.messages ?? [])) + Buffer.byteLength(JSON.stringify(body.tools ?? []))) / RELAY_GUARDS.charsPerToken);
}

/** Room for one call: its input read high, its longest allowed reply, at the price list's rates. A price nobody knows holds a fixed generous room. */
export function estimateCallMicros(body: Record<string, unknown>, config: AIProviderConfig, outputCap: number, at: Date): number {
    const inputTokens = inputTokensOf(body);
    const cost = priceCall({ config, usage: { inputTokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: outputCap, reasoningTokens: 0 }, at });
    return Math.max(1, cost.micros ?? RELAY_GUARDS.unpricedHoldMicros);
}

/** What Orbit is told of a priced call. */
function factsOf(cost: CallCost, estimated: boolean): { costMicros: number | null; basis: 'measured' | 'estimated' | 'unknown' } {
    if (cost.micros === null || cost.basis === 'unknown') return { costMicros: null, basis: 'unknown' };
    return { costMicros: cost.micros, basis: estimated ? 'estimated' : 'measured' };
}

/** Errors that mean the request never left (no address, nothing listening, no route). Anything else, such as a reset, may have come after the provider took the request. */
const NEVER_REACHED_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL']);
export function neverReached(error: unknown): boolean {
    for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === 'string' && NEVER_REACHED_CODES.has(code)) return true;
        // fetch itself refused the address before any connection (a port it blocks, an address it cannot read)
        if (current instanceof Error && /^(bad port|invalid url)/i.test(current.message)) return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

interface Ended {
    usage: CallMetadata | undefined;
    /** What came through, when the provider said nothing of its own use: the output is read from it. */
    outputChars: number;
    cutShort: boolean;
    /** The call could not be made at all (the provider was not reached): nothing was sent, so nothing is owed. */
    notSent: boolean;
    /** The call failed on our side before the provider was asked (its stored key could not be read): ours whoever's key it is. */
    relaySide?: boolean;
    /** What the provider said was wrong, when it said so (an error answer, or an error object inside a 200 answer): whose it is. Neither is an answer. */
    reading?: ProviderReading;
    /** The status the provider answered with, when it answered an error. */
    upstreamStatus?: number;
}

/** Of two readings of the same call the stronger counts: a confirmed fault, then an unresolved one, then the request's. */
const strongerReading = (one: ProviderReading | undefined, two: ProviderReading): ProviderReading => {
    if (!one) return two;
    const rank = (reading: ProviderReading) => (reading.kind === 'fault' ? 2 : reading.kind === 'uncertain' ? 1 : 0);
    return rank(two) > rank(one) ? two : one;
};

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
        let who: Awaited<ReturnType<RelayOrbit['identify']>> | null = null;
        try {
            who = token ? await deps.orbit.identify(token) : null;
        } catch {
            // An Orbit that cannot be reached is no proof that the key is wrong
            return problem(res, 503, 'The service is busy. Try again in a moment.', 'service_unavailable', 'server_error');
        }
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
        // A call that failed for a fault of ours is noted for the runner (see ComputerRefusals): Hermes may hand its error back as a finished turn
        // Only the agent's own calls (they carry its tools) count: a side call Hermes makes with the same key (a summary, a title) that fails
        // after the turn was answered is no failure of the turn. Set once the body is read.
        let agentCall = true;
        // The call's own id: Orbit's fault record keeps one row per job and call, so the same id is sent when a row is sent again
        const callId = randomUUID();
        let routeName = 'unknown';
        let rowSource: 'universe-ai' | 'own-key' = 'universe-ai';
        // How the call ended, for the runner (in this process) and for Orbit's durable fault record. Only the agent's own calls count.
        const noteCall = (kind: CallKind, reason: FaultReason, providerStatus: number | null = null) => {
            if (agentCall) deps.refusals?.record(botId, jobId, { callId, kind, reason, source: rowSource, route: routeName, providerStatus });
        };
        const fault = (reason: FaultReason, status: number, message: string, code: string, type = 'server_error') => {
            noteCall('fault', reason, status);
            return problem(res, status, message, code, type);
        };

        const body = req.body;
        if (!isRecord(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
            return problem(res, 400, 'A request needs a list of messages.', 'invalid_request');
        }
        const streaming = body.stream === true;
        agentCall = Array.isArray(body.tools) && body.tools.length > 0;

        let asked: RelayRoute | RelayRestingOwnKey | null;
        try {
            asked = await deps.routeFor(botId);
        } catch {
            return fault('relay_down', 503, 'The AI could not be reached. Try again in a moment.', 'service_unavailable');
        }
        // The Brick's own key is down and its owner chose to stop: that is the person's, never ours. Universe's AI resting, or a route nobody can tell, is ours
        if (asked && 'restingOwnKey' in asked) {
            rowSource = 'own-key';
            routeName = 'own-key';
            noteCall('not_ours', 'own_provider', 503);
            return problem(res, 503, 'This Brick’s AI is not answering right now.', 'ai_resting', 'server_error');
        }
        if (!asked) return fault('route_unknown', 503, 'This Brick’s AI is not answering right now.', 'ai_resting');
        const route = asked as RelayRoute;
        const { config, source } = route;
        rowSource = source === 'own-key' ? 'own-key' : 'universe-ai';
        routeName = source === 'own-key' ? 'own-key' : `${source}:${config.providerId}`;
        // Only OpenAI-format providers are reached directly here; others come with their own translation
        if (config.type !== 'openai') return fault('route_unknown', 501, 'This Brick’s AI cannot be used from a computer yet.', 'provider_not_supported');

        // Check and take the place in one step, before anything is awaited: calls arriving together cannot all read the same count
        const running = inFlight.get(jobId) ?? 0;
        if (running >= RELAY_GUARDS.maxCallsInFlight) return problem(res, 429, 'Too many calls at once. Slow down.', 'rate_limit_exceeded', 'rate_limit_error');
        inFlight.set(jobId, running + 1);
        let held = true;
        const release = () => {
            if (!held) return;
            held = false;
            const left = (inFlight.get(jobId) ?? 1) - 1;
            if (left <= 0) inFlight.delete(jobId);
            else inFlight.set(jobId, left);
        };

        // Whether the caller went away while the route and the room were being asked for: nothing is sent for a caller that is not there
        let gone = false;
        res.once('close', () => {
            if (!res.writableFinished) gone = true;
        });

        const now = new Date();
        const outputCap = outputCapOf(body, config);
        const payer = source === 'own-key' ? 'own-key' : 'universe';
        let ended: Ended = { usage: undefined, outputChars: 0, cutShort: false, notSent: false };
        try {
            let allowed: Awaited<ReturnType<RelayOrbit['authorize']>>;
            try {
                allowed = await deps.orbit.authorize({ token, callId, estimateMicros: estimateCallMicros(body, config, outputCap, now), payer });
            } catch {
                return fault('relay_down', 503, 'The service is busy. Try again in a moment.', 'service_unavailable');
            }
            if (!allowed.ok) {
                const reason = 'reason' in allowed ? allowed.reason : 'refused';
                if (reason === 'allowance' || reason === 'rule') noteCall('not_ours', reason, 429);
                if (reason === 'allowance') return problem(res, 429, 'This computer’s allowance is used up.', 'insufficient_quota', 'insufficient_quota');
                if (reason === 'rule') return problem(res, 429, 'A spending rule stops this call.', 'insufficient_quota', 'insufficient_quota');
                if (reason === 'pool') return fault('pool_busy', 503, 'Computers are busy right now. Try again in a moment.', 'overloaded');
                return problem(res, 401, 'Invalid API key.', 'invalid_api_key', 'authentication_error');
            }

            try {
                if (gone || res.destroyed) ended = { usage: undefined, outputChars: 0, cutShort: false, notSent: true };
                else {
                    const timing = { timedOut: false };
                    ended = await callProvider({ body, config, streaming, outputCap, res, timing });
                    // The relay's own time limit ran out: unresolved either way (a stream that wrote nothing in time may be a provider that hung, one that
                    // was writing proves progress only), so it is for Orbit's bounded goodwill and reconciliation, not charged or refunded blindly
                    if (timing.timedOut && !ended.reading) ended = { ...ended, reading: OURS_UNSURE(ended.outputChars === 0 ? 'timeout_no_output' : 'timeout_after_output') };
                    // How the call ended, for the runner and for Orbit's fault record: a confirmed fault of ours, an unresolved one, what the person's side
                    // did (their allowance, a rule, their own provider, a request of the job's own that the provider refused) or a whole answer. What a
                    // provider answered (an error of its own, a rate limit, a stream it cut off) is ours only when the provider and its key are ours: on a
                    // person's own key the provider, the key and the endpoint are theirs (their credit ran out, their key was revoked)
                    // A caller that went away is no fault of anyone's (the 504 written for a cut-off wait goes to nobody)
                    if (agentCall && !gone) {
                        const reading = ended.reading;
                        const requestWrong = reading?.who === 'request';
                        const providerSaid = !requestWrong && (reading?.who === 'ours' || res.statusCode >= 500 || ended.cutShort);
                        const status = ended.upstreamStatus ?? (res.statusCode >= 400 ? res.statusCode : null);
                        // What the provider said was wrong of the job's own request (moderation, a context too long, an invalid request) is neither a
                        // fault nor an answer, and is off our side: the runner never ends a job as ours for a turn that the job's own request failed
                        if (requestWrong) noteCall('not_ours', 'field_job_set', status);
                        else if (providerSaid) {
                            if (ended.relaySide) noteCall('fault', 'relay_down', status);
                            // A person's own provider failing is not ours: it is on the person's side, so the runner never ends the job as ours for it
                            else if (source === 'own-key') noteCall('not_ours', 'own_provider', status);
                            else if (reading) noteCall(reading.kind, reading.reason, status);
                            // A stream that broke after it began, or an answer that was a 5xx with nothing read from it: unresolved
                            else noteCall('uncertain', ended.cutShort ? 'stream_cut' : 'provider_5xx', status);
                        } else if (res.statusCode === 200 && !ended.cutShort && !ended.notSent) noteCall('answered', 'provider_5xx' /* no reason is kept for an answer */);
                    }
                }
            } catch (error) {
                console.error('[ComputerRelay] A call failed:', providerErrorText(error));
                // An error nobody expected, while the provider was being called: ours (unresolved) only when the provider is ours
                if (!res.headersSent) {
                    if (source !== 'own-key' && !gone) {
                        noteCall('uncertain', 'provider_5xx', 502);
                        problem(res, 502, 'The AI did not answer.', 'upstream_error', 'server_error');
                    } else {
                        if (!gone) noteCall('not_ours', 'own_provider', 502);
                        problem(res, 502, 'The AI did not answer.', 'upstream_error', 'server_error');
                    }
                } else {
                    if (!gone) {
                        if (source !== 'own-key') noteCall('uncertain', 'stream_cut');
                        else noteCall('not_ours', 'own_provider');
                    }
                    res.end();
                }
                ended = { usage: undefined, outputChars: 0, cutShort: true, notSent: false };
            }
        } finally {
            release();
        }
        const payerPersonId = source === 'own-key' ? route.keyOwnerId : null;

        if (ended.notSent) {
            await settleOnce({ jobId, callId, sent: false });
            return;
        }
        // The provider said what it used: priced from that. If it said nothing, the input is read as estimated and the output from what came through
        let metadata = ended.usage;
        let estimated = false;
        let estimatedCounts = false;
        if (!metadata?.error && (!metadata || (metadata.promptTokens ?? 0) + (metadata.completionTokens ?? 0) <= 0)) {
            const promptTokens = inputTokensOf(body);
            const completionTokens = Math.ceil(ended.outputChars / RELAY_GUARDS.charsPerToken);
            // A cost the provider reported stands whatever else is missing: only the token counts are filled in
            const reported = typeof metadata?.costUsd === 'number' && Number.isFinite(metadata.costUsd) && metadata.costUsd >= 0 ? { costUsd: metadata.costUsd } : {};
            metadata = completionTokens > 0 ? { promptTokens, completionTokens, ...reported } : 'costUsd' in reported ? reported : undefined;
            estimated = metadata !== undefined && !('costUsd' in reported);
            estimatedCounts = metadata !== undefined && 'completionTokens' in metadata;
        }
        // Counts we only estimated never re-price a cost the provider reported (a rate per token would win over it on made-up counts):
        // that cost is priced on its own, and the estimated counts only fill the token tallies
        const reportedCost = estimatedCounts && metadata && 'costUsd' in metadata && metadata.costUsd !== undefined ? { costUsd: metadata.costUsd } : null;
        const withCounts = priceMetadata(config, metadata, now);
        const priced = reportedCost ? { cost: priceMetadata(config, reportedCost, now).cost, usage: withCounts.usage } : withCounts;
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
    async function callProvider(call: { body: Record<string, unknown>; config: AIProviderConfig; streaming: boolean; outputCap: number; res: Response; timing: { timedOut: boolean } }): Promise<Ended> {
        const { body, config, streaming, outputCap, res, timing } = call;
        // A key that cannot be read means nothing was sent: the room goes back
        let key: string | null;
        try {
            key = config.apiKeyEncrypted ? decryptApiKey(config.apiKeyEncrypted) : null;
        } catch (error) {
            console.error('[ComputerRelay] A key could not be read:', providerErrorText(error));
            problem(res, 502, 'The AI could not be reached.', 'upstream_unreachable', 'server_error');
            return { usage: undefined, outputChars: 0, cutShort: false, notSent: true, relaySide: true };
        }
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
            timing.timedOut = true;
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
                    const text = await readBounded(upstream.clone(), RELAY_GUARDS.maxErrorBytes).catch(() => '');
                    if (refusesStreamOptions(upstream.status, text)) {
                        refusedStreamOptions.add(url);
                        delete sent.stream_options;
                        // The first answer is let go of (its copy was read above): a body nobody reads would be held until the call ends. Not waited for.
                        void upstream.body?.cancel().catch(() => undefined);
                        upstream = await send(sent);
                    }
                }
            } catch (error) {
                // Not reached at all (no connection was made): nothing was sent. A cut-off while waiting, or a connection that broke after the request went out, may have been used and is owed.
                if (!controller.signal.aborted) {
                    const reached = !neverReached(error);
                    problem(res, 502, 'The AI could not be reached.', 'upstream_unreachable', 'server_error');
                    console.warn(reached ? '[ComputerRelay] The connection to the provider broke:' : '[ComputerRelay] The provider was not reached:', providerErrorText(error));
                    return { usage: undefined, outputChars: 0, cutShort: reached, notSent: !reached };
                }
                if (!res.headersSent && !res.writableEnded) problem(res, 504, 'The AI took too long.', 'upstream_timeout', 'server_error');
                return { usage: undefined, outputChars: 0, cutShort: true, notSent: false };
            }

            if (!upstream.ok) {
                // What the provider said, in words fit for a log: never its key, never the conversation
                const { text, tooLong } = await readBoundedWithFlag(upstream, RELAY_GUARDS.maxErrorBytes).catch(() => ({ text: '', tooLong: false }));
                const message = providerErrorText(wordsOf(text)).split(key ?? '\u0000').join('[redacted]');
                console.warn('[ComputerRelay] The provider refused a call:', upstream.status);
                problem(res, statusToHermes(upstream.status), message, 'upstream_error', 'server_error');
                // A call the provider refused was not billed. Whose the refusal is is read from what it said
                let said: unknown = null;
                try {
                    const parsed = JSON.parse(text) as unknown;
                    said = isRecord(parsed) && parsed.error !== undefined ? parsed.error : parsed;
                } catch {
                    // A body that is not JSON says nothing more than its status. One that was cut at the bound is JSON that was never finished: the
                    // fields the provider put before the cut (its code, type, param and message) still say whose the refusal is
                    if (tooLong) said = leadingFieldsOf(text);
                }
                return { usage: { error: true }, outputChars: 0, cutShort: false, notSent: false, upstreamStatus: upstream.status, reading: readProviderError(upstream.status, isRecord(said) ? said : { message: typeof said === 'string' ? said : text.slice(0, 300) }, { ...jobsOwnLimit(body, config), outputCap }) };
            }

            if (!streaming) {
                const { data, tooLong } = await readBoundedReply<{ usage?: unknown; choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> }>(upstream, RELAY_GUARDS.maxReplyBytes);
                if (!data) {
                    problem(res, 502, 'The AI answered with something unreadable.', 'upstream_error', 'server_error');
                    // A reply cut at the bound is unresolved (class 3: Orbit's bounded goodwill, never a confirmed fault of ours and never decided
                    // as the person's): only the job's own settings (logprobs on every token) can make a reply that long, so it is not confirmed
                    // ours, but nothing proves whose it is either. It is written down explicitly (reason provider_5xx: the 502 the agent gets and
                    // one of the 15 reasons Orbit takes) so it can never become a confirmed fault. A reply that is not JSON is unresolved too
                    return { usage: undefined, outputChars: 0, cutShort: false, notSent: false, ...(tooLong ? { reading: OURS_UNSURE('provider_5xx') } : {}) };
                }
                res.status(200).json(data);
                const answerError = (data as { error?: unknown }).error !== undefined && !data.choices?.length ? readProviderError(null, (data as { error?: unknown }).error, { ...jobsOwnLimit(body, config), outputCap }) : null;
                const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
                const message = data.choices?.[0]?.message;
                // What the model wrote counts whether it was words, thinking or a tool call
                const written = (typeof message?.content === 'string' ? message.content.length : 0) + (typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0) + toolCallChars(message?.tool_calls);
                return {
                    usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, ...readUsageDetail(usage) } : undefined,
                    outputChars: written,
                    cutShort,
                    notSent: false,
                    ...(answerError ? { reading: answerError } : {}),
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
            // A line that grew past the bound is dropped whole, to its end: it is passed on as it came but never read
            let skipping = false;
            const decoder = new StringDecoder('utf8');
            let usage: CallMetadata | undefined;
            let outputChars = 0;
            let reading: ProviderReading | undefined;
            const read = (line: string) => {
                if (!line.startsWith('data:')) return;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const chunk = JSON.parse(data) as { error?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> };
                    // A provider can answer 200 and put its error in the stream: that is no answer
                    if (chunk.error !== undefined && chunk.error !== null) {
                        reading = strongerReading(reading, readProviderError(null, chunk.error, { ...jobsOwnLimit(body, config), outputCap }));
                    }
                    if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, ...readUsageDetail(chunk.usage) };
                    for (const choice of chunk.choices ?? []) {
                        if (typeof choice.delta?.content === 'string') outputChars += choice.delta.content.length;
                        if (typeof choice.delta?.reasoning_content === 'string') outputChars += choice.delta.reasoning_content.length;
                        outputChars += toolCallChars(choice.delta?.tool_calls);
                    }
                } catch {
                    /* a line that is not JSON says nothing of use */
                }
            };
            try {
                for await (const chunk of Readable.fromWeb(upstream.body as never) as AsyncIterable<Buffer>) {
                    if (res.destroyed || res.writableEnded || controller.signal.aborted) break;
                    pending += decoder.write(chunk);
                    let at: number;
                    while ((at = pending.indexOf('\n')) >= 0) {
                        if (skipping) skipping = false;
                        // A line that was completed in this very chunk is held to the bound too: it is passed on, never read
                        else if (at <= RELAY_GUARDS.maxStreamLineChars) read(pending.slice(0, at).replace(/\r$/, ''));
                        pending = pending.slice(at + 1);
                    }
                    if (pending.length > RELAY_GUARDS.maxStreamLineChars) {
                        pending = '';
                        skipping = true;
                    }
                    if (!res.write(chunk)) await drained(res, controller.signal);
                }
                pending += decoder.end();
                if (!skipping) read(pending);
                if (!res.writableEnded) res.end();
            } catch (error) {
                // The provider's stream broke, or Hermes went away: what came through is counted, and the other side is told
                if (!controller.signal.aborted) {
                    console.warn('[ComputerRelay] A stream broke:', providerErrorText(error));
                    cutShort = true;
                }
                if (!res.writableEnded) res.end();
            }
            return { usage, outputChars, cutShort, notSent: false, ...(reading ? { reading } : {}) };
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
