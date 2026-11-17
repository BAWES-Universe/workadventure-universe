/**
 * The model relay for a Brick's computer (build handoff v2, section 5). Hermes, on the computer, talks to an OpenAI-format address
 * and holds one thing: a short-lived key Orbit made for the job. It never holds a provider key. This is that address.
 *
 * Every call goes through the same steps, in this order:
 *  1. Orbit says which Brick the key belongs to (and refuses a key that ended, or that is from before a take-over).
 *  2. Orbit says how that Brick's AI runs (Universe AI, a server provider, or the owner's own key), exactly as for a reply, and the
 *     provider's key stays here.
 *  3. Orbit takes room for this one call from the person's computer allowance (none for a call on their own key). Busy (other work's
 *     holds) waits the time Orbit says, once and bounded, then answers 429 with Retry-After; no room, or a spending rule, is refused with its
 *     own reason and nothing is sent to a provider. A Universe-paid model with no price is refused with its typed reason.
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
import { isOpenAIHost, readUsageDetail, refusesStreamOptions, statedOutputCeiling } from '../ai/providers/OpenAIProvider';
import { priceCall, providerCostMicros } from '../ai/pricing/costing';
import { priceMetadata, type CallMetadata } from '../ai/pricing/ledger';
import { imageRuleName, separatePictures } from '../ai/pricing/imageTokens';
import { emptyUsage, type CallCost, type CallUsage } from '../ai/pricing/types';
import { createHash } from 'node:crypto';

/**
 * What Orbit serves for a computer's calls (contract version 2): the longest answer one call may be allowed, the calls one job may have at once, and the
 * most seconds one operation may wait for room. When Orbit serves none (version 1, or a field left out) the guards of RELAY_GUARDS stand in.
 */
export interface RelayLimits {
    maxOutputTokens?: number;
    maxCallsInFlight?: number;
    maxWaitSeconds?: number;
}

/** What the relay can say of one call before it is made: the input read in tokens, and the prices that make the room (R1). */
export interface CallEstimate {
    inputTokens: number;
    /** The input at the model's price, in millionths of a dollar. */
    inputMicros: number;
    /** Millionths of a dollar for a million output tokens; null when the model has no price. */
    outputMicrosPerMillion: number | null;
    /** The longest answer the call is really allowed; null when none is sent (a call on the owner's own key with no length said). */
    maxOutputTokens: number | null;
    /** Input plus the longest allowed answer: the provider's most. Null when the model has no price. */
    providerMaxMicros: number | null;
}

export type StepKind = 'reply' | 'edit' | 'tool' | 'vision' | 'other';

export interface AuthorizeInput {
    token: string;
    /** One operation is one step. The same id when Hermes asks again for the same step, so Orbit never takes room twice for it. */
    operationId: string;
    payer: 'universe' | 'own-key';
    route: 'universe-ai' | 'provider' | 'own-key';
    /** The model the call goes to, so comparable steps group for Orbit's estimate. */
    model?: string;
    /** The wire format of the route (the check before a paid wake, and Gemini's gap). */
    modelFormat?: 'openai' | 'gemini-compatible' | 'other';
    /** What kind of step this is, where it can be told. */
    stepKind?: StepKind;
    estimate: CallEstimate;
    /** The one amount version 1 holds: the whole most of the call. */
    estimateMicros: number;
}

/**
 * Why Orbit said no, each as Orbit says it. `busy`: room is held by other work and will free: wait. `allowance`: truly used up. `rule`: a spending
 * rule the person made, in its own words. `unsupported`: this Brick's AI cannot run a computer. `other`: a typed reason this code has no line for.
 */
export type Refusal =
    | { reason: 'refused' }
    /** Truly out: the person's credit, Universe's budget, a provider's funds, or a job already paused. `words` is Orbit's sentence for the person, when it gave one. */
    | { reason: 'allowance'; words?: string }
    | { reason: 'pool' }
    | { reason: 'busy'; retryAfterSeconds: number }
    | { reason: 'rule'; words: string }
    | { reason: 'unsupported' }
    | { reason: 'unpriced' }
    | { reason: 'other'; code: string; retryAfterSeconds?: number };

export type AuthorizeResult = ({ ok: true; limits?: RelayLimits } | ({ ok: false } & Refusal));

/** What the relay needs of Orbit: the three calls of /api/computer/llm. */
export interface RelayOrbit {
    identify(token: string): Promise<{ ok: true; jobId: string; botId: string; limits?: RelayLimits } | { ok: false }>;
    authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
    settle(input: SettleInput): Promise<{ ok: boolean }>;
    /** Which version Orbit speaks: 2, 1 once it refused version 2, null before it has answered. */
    contract?(): 1 | 2 | null;
}

const countOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined);

/** The limits Orbit served in an answer, when it served any. */
function limitsOf(data: unknown): RelayLimits | undefined {
    const raw = isRecord(data) && isRecord(data.limits) ? data.limits : null;
    if (!raw) return undefined;
    const limits: RelayLimits = {};
    const output = countOf(raw.maxOutputTokens);
    const calls = countOf(raw.maxCallsInFlight);
    const wait = countOf(raw.maxWaitSeconds);
    if (output) limits.maxOutputTokens = output;
    if (calls) limits.maxCallsInFlight = calls;
    if (wait) limits.maxWaitSeconds = wait;
    return Object.keys(limits).length ? limits : undefined;
}

/**
 * The version 2 body of an authorise, with exactly the names of docs/computer-llm-contract-v2.md (Orbit refuses any other field): the two amounts'
 * ingredients, never one summed amount. A call on the owner's own key takes no room, so its amounts are 0 and its answer length a placeholder Orbit ignores.
 */
function authorizeBodyV2(input: AuthorizeInput): Record<string, unknown> {
    const { estimate } = input;
    return {
        contract: 2,
        token: input.token,
        operationId: input.operationId,
        payer: input.payer,
        route: input.route,
        ...(input.model ? { model: input.model.slice(0, 120) } : {}),
        ...(input.modelFormat ? { modelFormat: input.modelFormat } : {}),
        ...(input.stepKind ? { stepKind: input.stepKind } : {}),
        inputTokens: estimate.inputTokens,
        inputMicros: estimate.inputMicros,
        outputMicrosPerMillion: estimate.outputMicrosPerMillion ?? 0,
        maxOutputTokens: estimate.maxOutputTokens ?? RELAY_GUARDS.defaultOutputTokens,
        ...(estimate.providerMaxMicros !== null ? { providerMaxMicros: estimate.providerMaxMicros } : {}),
    };
}

/** The version 1 body of an authorise, exactly as before: one amount, and the call's id. */
const authorizeBodyV1 = (input: AuthorizeInput): Record<string, unknown> => ({ token: input.token, callId: input.operationId, estimateMicros: input.estimateMicros, payer: input.payer });

/** Reads a refusal of version 1: a reason word, and for a rule the rule's own words. A word nobody knows is not "bad key": it is said as a typed reason. */
function refusalV1(data: Record<string, unknown>): Refusal {
    switch (data.reason) {
        case 'refused':
            return { reason: 'refused' };
        case 'allowance':
            return { reason: 'allowance' };
        case 'pool':
            return { reason: 'pool' };
        case 'rule':
            return { reason: 'rule', words: wordsFrom(data) ?? 'A rule you set does not let this computer spend that much.' };
        default:
            return { reason: 'other', code: typeof data.reason === 'string' ? data.reason.slice(0, 40) : 'unknown' };
    }
}

const wordsFrom = (data: Record<string, unknown>): string | undefined => (typeof data.words === 'string' && data.words.trim() ? data.words.trim().slice(0, 500) : undefined);

/** Reads a refusal of version 2: the typed reason, the wait where waiting helps, Orbit's words. */
function refusalV2(data: Record<string, unknown>): Refusal {
    const wait = countOf(data.retryAfterSeconds);
    const reason = typeof data.reason === 'string' ? data.reason : 'unknown';
    const words = wordsFrom(data);
    switch (reason) {
        case 'busy':
        case 'holds':
            // Waiting helps. With no time said, a short one: never "out"
            return { reason: 'busy', retryAfterSeconds: wait ?? RELAY_GUARDS.defaultRetryAfterSeconds };
        case 'refused':
            return { reason: 'refused' };
        case 'rule':
            return { reason: 'rule', words: words ?? 'A rule you set does not let this computer spend that much.' };
        case 'unsupported':
            return { reason: 'unsupported' };
        case 'unpriced':
            return { reason: 'unpriced' };
        case 'allowance':
        case 'budget':
        case 'funds':
        case 'paused':
            // Truly out of what a person, Universe or a provider can spend (the job is saved and paused by Orbit): the turn stops, never "bad key"
            return { reason: 'allowance', ...(words ? { words } : {}) };
        default:
            return { reason: 'other', code: reason.slice(0, 40), ...(wait ? { retryAfterSeconds: wait } : {}) };
    }
}

/** The Orbit calls the relay makes, over the bot server's service token. */
export function relayOrbitFor(admin: { computerRelayCall(step: 'identify' | 'authorize' | 'settle', body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> }): RelayOrbit {
    const unexpected = (step: string, status: number) => new Error(`Orbit answered ${step} with ${status}`);
    // Version 2 is tried first. An Orbit that refuses its body (it has the strict version 1 route) is spoken to in version 1 for the rest of the process.
    let contract: 1 | 2 | null = null;
    return {
        contract: () => contract,
        async identify(token) {
            const { status, data } = await admin.computerRelayCall('identify', { token });
            if (status !== 200) throw unexpected('identify', status);
            if (data.ok === true && typeof data.jobId === 'string' && typeof data.botId === 'string') {
                const limits = contract === 1 ? undefined : limitsOf(data);
                return { ok: true, jobId: data.jobId, botId: data.botId, ...(limits ? { limits } : {}) };
            }
            return { ok: false };
        },
        async authorize(input) {
            if (contract !== 1) {
                const { status, data } = await admin.computerRelayCall('authorize', authorizeBodyV2(input));
                // The strict version 1 route answers an unknown field with 400 and no contract: that is Orbit saying it only speaks version 1
                if (status === 400 && data.contract !== 2) {
                    contract = 1;
                } else {
                    if (status !== 200) throw unexpected('authorize', status);
                    contract = 2;
                    if (data.ok === true) {
                        const limits = limitsOf(data);
                        return { ok: true, ...(limits ? { limits } : {}) };
                    }
                    return { ok: false, ...refusalV2(data) };
                }
            }
            const { status, data } = await admin.computerRelayCall('authorize', authorizeBodyV1(input));
            if (status !== 200) throw unexpected('authorize', status);
            if (data.ok === true) return { ok: true };
            return { ok: false, ...refusalV1(data) };
        },
        async settle(input) {
            // Version 1's route refuses a field it does not know, so only what it knows is sent to it
            const body = contract === 1 ? settleBodyV1(input) : settleBodyV2(input);
            const { status } = await admin.computerRelayCall('settle', body);
            // 404: Orbit knows no such call, so nothing was written; telling it again would change nothing
            if (status === 404) return { ok: false };
            if (status !== 200) throw unexpected('settle', status);
            return { ok: true };
        },
    };
}

/** What version 2's settle route takes: `operationId` is the call's id there (the strict route refuses `callId`). */
function settleBodyV2(input: SettleInput): Record<string, unknown> {
    const { callId, ...rest } = input;
    return { contract: 2, ...rest, operationId: callId };
}

/** What version 1's settle route takes: the same fields it always had. */
function settleBodyV1(input: SettleInput): Record<string, unknown> {
    const { providerCostMicros: _provider, unexplained: _unexplained, ...rest } = input;
    const tokens = rest.tokens ? { input: rest.tokens.input, output: rest.tokens.output, cached: rest.tokens.cached, reasoning: rest.tokens.reasoning } : undefined;
    return { ...rest, ...(tokens ? { tokens } : {}) };
}

export interface SettleInput {
    jobId: string;
    callId: string;
    /** False when nothing went to a provider: Orbit gives the room back and writes nothing. */
    sent: boolean;
    /** What a member is charged: the price a super admin set for this provider if there is one, else the provider's own figure. */
    costMicros?: number | null;
    /** What the provider itself billed (R6): the cost it reported, else the price list's figure. Kept beside the member's, never replaced by it. */
    providerCostMicros?: number | null;
    basis?: 'measured' | 'estimated' | 'unknown';
    payerPersonId?: string | null;
    route?: 'universe-ai' | 'own-key' | 'provider';
    tokens?: { input?: number | null; output?: number | null; cached?: number | null; reasoning?: number | null; cacheWrite?: number | null; cacheWrite1h?: number | null };
    /** Tokens the provider billed and did not explain (Gemini, S1): Universe's exposure, never charged to a member as measured. */
    unexplained?: { tokens: number; costMicros: number | null };
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
    /** For tests: how a wait for room is made (default: a timer). */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Technical guards, in one place (none of these is a limit a person sees).
 *
 * With Orbit's contract version 2 no amount is decided here: the longest answer and the calls at once are the ones Orbit serves, and the room is
 * Orbit's to compute. `maxCallsInFlight`, `maxOutputTokens`, `defaultOutputTokens` and `unpricedHoldMicros` are only the fallback for an Orbit that
 * speaks version 1 (or serves none): they behave exactly as they always did there.
 */
export const RELAY_GUARDS = {
    /** The largest request Hermes may send (a long conversation with files in it). */
    maxBodyBytes: 16 * 1024 * 1024,
    /** Version 1 fallback: calls one job may have in flight at once. */
    maxCallsInFlight: 8,
    /** How long a provider may be silent mid-call (a reply is cut only when nothing has come for this long) and how long a whole answer that is not streamed may take. */
    callTimeoutMs: 10 * 60 * 1000,
    /** Version 1 fallback: the most a call may be allowed to write, whatever Hermes asks for. */
    maxOutputTokens: 32_768,
    /** Version 1 fallback: what a call may write when neither Hermes nor the provider's settings say. */
    defaultOutputTokens: 4096,
    /** Version 1 fallback: room held for a call on a model whose price is not known; settled at what is held, never 0. */
    unpricedHoldMicros: 50_000,
    /** How long one operation may wait in all for room that other work holds, when Orbit does not say. A wait never holds a database lock. */
    maxWaitMs: 30_000,
    /** What Retry-After says when Orbit says nothing (seconds). */
    defaultRetryAfterSeconds: 2,
    /** Characters per token, set low on purpose: the room held is an upper reading of the input. */
    charsPerToken: 3,
    /** The most of a provider's answer that is read into memory: a refusal's words, a whole reply, one line of a stream. */
    maxErrorBytes: 64 * 1024,
    maxReplyBytes: 16 * 1024 * 1024,
    maxStreamLineChars: 1024 * 1024,
} as const;

const SETTLE_DELAYS_MS = [1000, 3000];

/** How many different steps are remembered for the same-step check (a technical bound on memory). */
const OPERATIONS_REMEMBERED = 5000;

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
                await reader.cancel().catch(() => undefined);
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
const statusToHermes = (status: number): number => (status === 401 || status === 402 || status === 403 ? 502 : status >= 400 && status < 600 ? status : 502);

/** An error in the shape every OpenAI client reads. `retryAfter` (seconds) is said in the header clients read to know when to ask again. */
const problem = (res: Response, status: number, message: string, code: string, type = 'invalid_request_error', retryAfter?: number) => {
    if (!res.headersSent) {
        if (retryAfter && retryAfter > 0) res.setHeader('Retry-After', String(Math.ceil(retryAfter)));
        res.status(status).json({ error: { message, type, code } });
    } else res.end();
};

/**
 * What Hermes is told for each reason Orbit gave for no. Each reason has its own status and code, and none is ever "bad key" except a key that is bad:
 * a spending rule is 403 `spend_rule` in the rule's own words, used-up money is the billing code Hermes stops on, and a wait is a 429 it can honour.
 */
export function refuse(res: Response, refusal: Refusal): void {
    switch (refusal.reason) {
        case 'refused':
            return problem(res, 401, 'Invalid API key.', 'invalid_api_key', 'authentication_error');
        case 'allowance':
            return problem(res, 429, refusal.words ?? 'This computer’s allowance is used up.', 'insufficient_quota', 'insufficient_quota');
        case 'unpriced':
            return problem(res, 422, 'This Brick’s AI has no price in Universe’s list, so a computer cannot run on it yet.', 'model_not_priced');
        case 'pool':
            return problem(res, 503, 'Computers are busy right now. Try again in a moment.', 'overloaded', 'server_error', RELAY_GUARDS.defaultRetryAfterSeconds);
        case 'busy':
            return problem(res, 429, 'Computers are busy right now. Try again in a moment.', 'rate_limit_exceeded', 'rate_limit_error', refusal.retryAfterSeconds);
        case 'rule':
            return problem(res, 403, refusal.words, 'spend_rule', 'permission_error');
        case 'unsupported':
            return problem(res, 501, 'This Brick’s AI cannot run a computer yet.', 'provider_not_supported', 'server_error');
        default:
            // A reason this code has no line for: not the key's fault, so it is not said to be. Hermes may ask again.
            console.warn('[ComputerRelay] Orbit refused a call for a reason with no line here:', refusal.code);
            return problem(res, 503, 'The service cannot take this step right now. Try again in a moment.', 'service_unavailable', 'server_error', refusal.retryAfterSeconds ?? RELAY_GUARDS.defaultRetryAfterSeconds);
    }
}

const hasPicture = (message: unknown): boolean =>
    isRecord(message) && Array.isArray(message.content) && message.content.some((part) => isRecord(part) && (part.type === 'image_url' || part.type === 'input_image' || part.type === 'image'));

/**
 * What kind of step this is, where it can be told: a step that just got a picture back is `vision`, one that follows a tool that wrote or changed
 * something is `edit`, one that follows any other tool is `tool`, and one that answers the person's words is `reply`. Comparable steps group by it for
 * Orbit's estimate. Never words, only the kind.
 */
export function stepKindOf(body: Record<string, unknown>): StepKind {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const last = messages[messages.length - 1];
    if (!isRecord(last)) return 'other';
    if (hasPicture(last) || hasPicture(messages[messages.length - 2])) return 'vision';
    if (last.role === 'tool') {
        for (let at = messages.length - 2; at >= 0; at--) {
            const message = messages[at];
            if (!isRecord(message) || message.role !== 'assistant') continue;
            const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
            const names = calls.map((call) => (isRecord(call) && isRecord(call.function) && typeof call.function.name === 'string' ? call.function.name : ''));
            return names.some((name) => /write|edit|patch|replace|create|save|append|delete|move/i.test(name)) ? 'edit' : 'tool';
        }
        return 'tool';
    }
    return last.role === 'user' || last.role === 'assistant' ? 'reply' : 'other';
}

/**
 * How long the cache writes a request asks for live (S2). Claude marks them with cache_control; one marked "1h" lives an hour and is billed
 * twice the input price, the rest five minutes at 1.25 times. `mixed`: both kinds are asked for, so a total of writes cannot be split by this.
 */
export function cacheLifetimeOf(body: Record<string, unknown>): 'short' | 'long' | 'mixed' {
    let long = false;
    let short = false;
    const walk = (value: unknown, depth: number) => {
        if (depth > 8 || !value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            for (const entry of value) walk(entry, depth + 1);
            return;
        }
        const record = value as Record<string, unknown>;
        if (isRecord(record.cache_control)) {
            if (record.cache_control.ttl === '1h') long = true;
            else short = true;
        }
        for (const inner of Object.values(record)) walk(inner, depth + 1);
    };
    walk(body.messages, 0);
    walk(body.tools, 0);
    walk(body.system, 0);
    return long && short ? 'mixed' : long ? 'long' : 'short';
}

/**
 * What a provider's usage block says, as the ledger reads it, plus what it adds up to.
 * Claude through an OpenAI-format address may split its cache writes by lifetime (`cache_creation`). Gemini's address counts its thinking tokens in
 * the total and not always in the completion: the thinking it names (`reasoning_tokens`) is priced as thinking, and any more the total holds than the parts
 * explain comes back as `unexplained`, so it is never read as measured use (S1).
 */
export function usageOf(usage: Record<string, any>, config: AIProviderConfig): { metadata: CallMetadata; unexplained: number } {
    const metadata: CallMetadata = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, ...readUsageDetail(usage) };
    const creation = isRecord(usage.cache_creation) ? usage.cache_creation : isRecord(usage.prompt_tokens_details?.cache_creation) ? usage.prompt_tokens_details.cache_creation : null;
    const hour = creation?.ephemeral_1h_input_tokens;
    if (typeof hour === 'number' && Number.isFinite(hour) && hour >= 0) {
        metadata.cacheWrite1hTokens = hour;
        // The provider split its writes but did not total them: the two kinds are all of them
        const short = creation?.ephemeral_5m_input_tokens;
        if (metadata.cacheWriteTokens === undefined && typeof short === 'number') metadata.cacheWriteTokens = hour + short;
    }
    let unexplained = 0;
    if (imageRuleName(config) === 'gemini') {
        const prompt = Number(usage.prompt_tokens) || 0;
        const completion = Number(usage.completion_tokens) || 0;
        const total = Number(usage.total_tokens);
        const thinking = Number(usage.completion_tokens_details?.reasoning_tokens) || 0;
        if (Number.isFinite(total) && total > 0) {
            let residual = total - prompt - completion;
            // The total holds the thinking on top of the completion: it is the completion's, and priced as thinking
            if (thinking > 0 && residual >= thinking) {
                metadata.completionTokens = completion + thinking;
                metadata.reasoningTokens = thinking;
                residual -= thinking;
            }
            unexplained = residual > 0 ? residual : 0;
        }
    }
    return { metadata, unexplained };
}

/** The last event of a stream that was cut: an error clients read, then the end. */
function endWithError(res: Response, message: string, code: string): void {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify({ error: { message, type: 'server_error', code } })}\n\n`);
    res.write('data: [DONE]\n\n');
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const bearerOf = (req: Request): string | null => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    return token.startsWith('cjt_') && token.length <= 200 ? token : null;
};

/**
 * The most the call may write.
 *  - On the owner's own key nothing of ours limits it: what Hermes asked for, else what the key's owner set for that AI, else nothing is said and the
 *    endpoint's own limit decides (null). The model and endpoint tell if it is too much (see callProvider).
 *  - Paid by Universe: what Hermes asked for, else the AI's own setting, never above what Orbit serves as the longest answer (version 2); an Orbit that serves none
 *    leaves the version 1 guard of 32,768 and 4,096.
 */
export function outputCapOf(body: Record<string, unknown>, config: AIProviderConfig, limits?: RelayLimits, payer: 'universe' | 'own-key' = 'universe'): number {
    const capped = outputCapFor(body, config, limits, payer);
    return capped ?? RELAY_GUARDS.defaultOutputTokens;
}

/** As `outputCapOf`, null when nothing is said (own key only). */
export function outputCapFor(body: Record<string, unknown>, config: AIProviderConfig, limits: RelayLimits | undefined, payer: 'universe' | 'own-key'): number | null {
    const asked = [body.max_completion_tokens, body.max_tokens].find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1);
    if (payer === 'own-key') {
        const set = asked ?? (config.maxTokens > 0 ? config.maxTokens : null);
        return set === null ? null : Math.floor(set);
    }
    const base = asked ?? (config.maxTokens > 0 ? config.maxTokens : RELAY_GUARDS.defaultOutputTokens);
    return Math.max(1, Math.min(Math.floor(base), limits?.maxOutputTokens ?? RELAY_GUARDS.maxOutputTokens));
}

/**
 * The input of a call read in tokens, high on purpose: counted in bytes (UTF-8), not characters, so text that takes more than one byte a
 * character (Arabic, Chinese, emoji) is not read as a third of what it costs. A characters count undercounted it, and the room held for
 * such a call was smaller than the call (audit F9).
 *
 * A picture is not text: a screenshot's base64 would read as a third of its length in tokens, hundreds of times what any provider bills. Pictures are
 * taken out and counted by the rule of the provider that reads them, from the size in their header (R5). `config` names that provider; without it a
 * picture is counted by the rule for a provider nobody knows (the largest published).
 */
export function inputTokensOf(body: Record<string, unknown>, config?: AIProviderConfig): number {
    const { rest, imageTokens } = separatePictures(body.messages ?? [], config ?? { type: 'openai' });
    return imageTokens + Math.ceil((Buffer.byteLength(JSON.stringify(rest)) + Buffer.byteLength(JSON.stringify(body.tools ?? []))) / RELAY_GUARDS.charsPerToken);
}

/** What can be said of a call before it is made, at the price list's rates. A model nobody has a price for has no amounts (null). */
export function estimateCall(body: Record<string, unknown>, config: AIProviderConfig, maxOutputTokens: number | null, at: Date): CallEstimate {
    const inputTokens = inputTokensOf(body, config);
    const priced = (usage: Partial<CallUsage>) => priceCall({ config, usage: { ...emptyUsage(), ...usage }, at });
    const input = priced({ inputTokens });
    // The price of an output token: asked at a million so a rate below one millionth of a dollar is not rounded away
    const perMillion = priced({ outputTokens: 1_000_000 });
    const full = maxOutputTokens === null ? input : priced({ inputTokens, outputTokens: maxOutputTokens });
    const known = input.micros !== null && perMillion.micros !== null && full.micros !== null;
    return {
        inputTokens,
        inputMicros: known ? input.micros! : 0,
        outputMicrosPerMillion: known ? perMillion.micros : null,
        maxOutputTokens,
        providerMaxMicros: known ? Math.max(1, full.micros!) : null,
    };
}

/** Room for one call as one amount (version 1): its input read high, its longest allowed reply, at the price list's rates. A price nobody knows holds a fixed generous room. */
export function estimateCallMicros(body: Record<string, unknown>, config: AIProviderConfig, outputCap: number, at: Date): number {
    return estimateCall(body, config, outputCap, at).providerMaxMicros ?? RELAY_GUARDS.unpricedHoldMicros;
}

/** The AI's config with a super admin's own per-token rate left out: what the provider itself billed is then priced from what it said, not from a rate. */
function withoutOwnRate(config: AIProviderConfig): AIProviderConfig {
    const { costPerToken: _rate, markup: _markup, ...settings } = (config.settings ?? {}) as Record<string, unknown>;
    return { ...config, settings };
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
    /** Tokens the provider billed in its total and did not explain (Gemini). */
    unexplainedTokens: number;
}

export function createComputerModelRelay(deps: RelayDeps): Router {
    const router = express.Router();
    const inFlight = new Map<string, number>();
    const delays = deps.settleDelaysMs ?? SETTLE_DELAYS_MS;
    // Providers that refused `stream_options` once are not asked again
    const refusedStreamOptions = new Set<string>();
    const fetchOf = deps.fetchFor ?? fetchFor;
    const json = express.json({ limit: RELAY_GUARDS.maxBodyBytes });
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    // The limits Orbit last served (version 2). None while Orbit speaks version 1.
    let served: RelayLimits | undefined;
    const limitsNow = (): RelayLimits | undefined => (deps.orbit.contract?.() === 1 ? undefined : served);
    // The model's own stated output ceilings (endpoint and model), learned once the model refuses more
    const modelCeilings = new Map<string, number>();

    /**
     * One id for one step. A step Hermes asks for again (it was told to wait, or its connection broke before an answer) has the same messages, so the same
     * id: Orbit holds room for it once. Once a step was made, asking for the same messages again is a new step with its own id, so it is never
     * mistaken for a repeat and left unbilled.
     */
    const operations = new Map<string, { seq: number; active: number }>();
    function operationFor(jobId: string, body: Record<string, unknown>): { id: string; done(made: boolean): void } {
        const fingerprint = createHash('sha256').update(jobId).update('\0').update(JSON.stringify(body)).digest('hex').slice(0, 40);
        const state = operations.get(fingerprint) ?? { seq: 0, active: 0 };
        operations.delete(fingerprint);
        operations.set(fingerprint, state);
        // Remembering is bounded: the oldest are forgotten first
        while (operations.size > OPERATIONS_REMEMBERED) operations.delete(operations.keys().next().value as string);
        // The same messages asked for while the first is still going are two steps
        const id = state.active > 0 ? `op_${fingerprint}.c${randomUUID().slice(0, 8)}` : `op_${fingerprint}.${state.seq}`;
        const overlapped = state.active > 0;
        state.active += 1;
        return {
            id,
            done(made) {
                state.active -= 1;
                if (made && !overlapped) state.seq += 1;
            },
        };
    }


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
        if (who.limits) served = who.limits;

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
        if (config.type !== 'openai') return problem(res, 501, 'This Brick’s AI cannot run a computer yet.', 'provider_not_supported', 'server_error');

        // What Orbit serves is what the game uses; an Orbit that speaks version 1 (or serves none) leaves the old guards
        const limits = limitsNow();
        // Check and take the place in one step, before anything is awaited: calls arriving together cannot all read the same count
        const running = inFlight.get(jobId) ?? 0;
        if (running >= (limits?.maxCallsInFlight ?? RELAY_GUARDS.maxCallsInFlight)) {
            return problem(res, 429, 'Too many calls at once. Try again in a moment.', 'rate_limit_exceeded', 'rate_limit_error', RELAY_GUARDS.defaultRetryAfterSeconds);
        }
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
        const payer = source === 'own-key' ? 'own-key' : 'universe';
        // One id for one step: the same one when Hermes asks again for the same step (it was told to wait), another when the step is really made again
        const operation = operationFor(jobId, body);
        let ended: Ended = { usage: undefined, outputChars: 0, cutShort: false, notSent: false, unexplainedTokens: 0 };
        let authorized = false;
        try {
            const outputCap = outputCapFor(body, config, limitsNow(), payer);
            const estimate = estimateCall(body, config, outputCap, now);
            // A Universe-paid step on a model with no price cannot be bounded: refused here, with its reason, and nothing is held or sent. Own keys and free models carry on.
            if (payer === 'universe' && estimate.providerMaxMicros === null && deps.orbit.contract?.() !== 1) {
                return problem(res, 422, 'This Brick’s AI has no price in Universe’s list, so a computer cannot run on it yet.', 'model_not_priced');
            }
            const input: AuthorizeInput = {
                token,
                operationId: operation.id,
                payer,
                route: source,
                model: config.model,
                modelFormat: imageRuleName(config) === 'gemini' ? 'gemini-compatible' : 'openai',
                stepKind: stepKindOf(body),
                estimate,
                estimateMicros: estimate.providerMaxMicros ?? RELAY_GUARDS.unpricedHoldMicros,
            };
            // Busy is not out: while only other work's holds block this step, wait the time Orbit says, up to one bounded total
            const maxWaitMs = (limitsNow()?.maxWaitSeconds ?? RELAY_GUARDS.maxWaitMs / 1000) * 1000;
            let waitedMs = 0;
            let allowed: AuthorizeResult;
            for (;;) {
                try {
                    allowed = await deps.orbit.authorize(input);
                } catch {
                    return problem(res, 503, 'The service is busy. Try again in a moment.', 'service_unavailable', 'server_error');
                }
                if (allowed.ok) break;
                const wait = 'retryAfterSeconds' in allowed ? allowed.retryAfterSeconds : undefined;
                if (!wait) break;
                if (!gone && !res.destroyed && waitedMs + wait * 1000 <= maxWaitMs) {
                    waitedMs += wait * 1000;
                    await sleep(wait * 1000);
                    if (!gone && !res.destroyed) continue;
                    return;
                }
                // Still no room in the time allowed: Hermes is told to ask again later, never that the money is gone
                return problem(res, 429, 'Computers are busy right now. Try again in a moment.', 'rate_limit_exceeded', 'rate_limit_error', wait);
            }
            if (!allowed.ok) {
                const { ok: _ok, ...refusal } = allowed;
                return refuse(res, refusal as Refusal);
            }
            authorized = true;
            if (allowed.limits) served = allowed.limits;

            try {
                if (gone || res.destroyed) ended = { usage: undefined, outputChars: 0, cutShort: false, notSent: true, unexplainedTokens: 0 };
                else ended = await callProvider({ body, config, streaming, outputCap, res });
            } catch (error) {
                console.error('[ComputerRelay] A call failed:', providerErrorText(error));
                if (!res.headersSent) problem(res, 502, 'The AI did not answer.', 'upstream_error', 'server_error');
                else res.end();
                ended = { usage: undefined, outputChars: 0, cutShort: true, notSent: false, unexplainedTokens: 0 };
            }
        } finally {
            release();
            // A step that was made is made: asked again, it is another step. A step that was refused or never sent is the same one.
            operation.done(authorized && !ended.notSent);
        }
        const payerPersonId = source === 'own-key' ? route.keyOwnerId : null;
        const callId = operation.id;

        if (ended.notSent) {
            await settleOnce({ jobId, callId, sent: false });
            return;
        }
        // The provider said what it used: priced from that. If it said nothing, the input is read as estimated and the output from what came through
        let metadata = ended.usage;
        let estimated = false;
        const reportedWithoutCounts = typeof metadata?.costUsd === 'number' && (metadata.promptTokens ?? 0) + (metadata.completionTokens ?? 0) <= 0;
        if (!metadata?.error && (!metadata || (metadata.promptTokens ?? 0) + (metadata.completionTokens ?? 0) <= 0)) {
            const promptTokens = inputTokensOf(body, config);
            const completionTokens = Math.ceil(ended.outputChars / RELAY_GUARDS.charsPerToken);
            // A cost the provider reported stands whatever else is missing: only the token counts are filled in
            const reported = typeof metadata?.costUsd === 'number' && Number.isFinite(metadata.costUsd) && metadata.costUsd >= 0 ? { costUsd: metadata.costUsd } : {};
            metadata = completionTokens > 0 ? { promptTokens, completionTokens, ...reported } : 'costUsd' in reported ? reported : undefined;
            estimated = metadata !== undefined && !('costUsd' in reported);
        }
        // Claude cache writes are priced by how long they live (S2): the provider's own split when it gives one, else what the request asked for
        if (metadata && imageRuleName(config) === 'claude' && (metadata.cacheWriteTokens ?? 0) > 0 && metadata.cacheWrite1hTokens === undefined) {
            const lifetime = cacheLifetimeOf(body);
            if (lifetime !== 'short') metadata = { ...metadata, cacheWrite1hTokens: metadata.cacheWriteTokens };
            // Some writes may have been the short kind: the figure is the higher reading, and it says so
            if (lifetime === 'mixed') estimated = true;
        }
        // A cost the provider reported with no token counts of its own cannot be turned into a member price by a per-token rate (counts we made up are no basis for one): it stands
        const priced = priceMetadata(reportedWithoutCounts ? withoutOwnRate(config) : config, metadata, now);
        const facts = factsOf(priced.cost, estimated);
        // The provider's own figure stays beside the member's price (R6): a super admin's rate decides only what a member is charged
        const reportedUsd = typeof metadata?.costUsd === 'number' ? metadata.costUsd : undefined;
        const providerMicros = priced.cost.basis === 'unknown' && reportedUsd === undefined ? null : providerCostMicros({ config, usage: priced.usage, at: now, reportedCostUsd: reportedUsd });
        // What Gemini billed and did not explain is Universe's exposure, priced once at the output rate and never added to what a member is charged as measured (S1)
        const unexplained = ended.unexplainedTokens > 0 ? { tokens: ended.unexplainedTokens, costMicros: providerCostMicros({ config, usage: { ...emptyUsage(), outputTokens: ended.unexplainedTokens }, at: now }) } : undefined;
        await settleOnce({
            jobId,
            callId,
            sent: true,
            ...facts,
            providerCostMicros: providerMicros,
            ...(payerPersonId ? { payerPersonId } : {}),
            route: source,
            tokens: {
                input: priced.usage.inputTokens,
                output: priced.usage.outputTokens,
                cached: priced.usage.cachedTokens,
                reasoning: priced.usage.reasoningTokens,
                cacheWrite: priced.usage.cacheWriteTokens,
                ...(priced.usage.cacheWrite1hTokens ? { cacheWrite1h: priced.usage.cacheWrite1hTokens } : {}),
            },
            ...(unexplained ? { unexplained } : {}),
            ...(ended.cutShort ? { cutShort: true } : {}),
        });
    });

    /** Makes the call and gives the answer back as it comes. */
    async function callProvider(call: { body: Record<string, unknown>; config: AIProviderConfig; streaming: boolean; outputCap: number | null; res: Response }): Promise<Ended> {
        const { body, config, streaming, res } = call;
        // A key that cannot be read means nothing was sent: the room goes back
        let key: string | null;
        try {
            key = config.apiKeyEncrypted ? decryptApiKey(config.apiKeyEncrypted) : null;
        } catch (error) {
            console.error('[ComputerRelay] A key could not be read:', providerErrorText(error));
            problem(res, 502, 'The AI could not be reached.', 'upstream_unreachable', 'server_error');
            return { usage: undefined, outputChars: 0, cutShort: false, notSent: true, unexplainedTokens: 0 };
        }
        const url = `${(config.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;

        const sent: Record<string, unknown> = { ...body, model: config.model, n: 1, stream: streaming };
        // A Universe-paid reply is never longer than the room held for it. On the owner's own key the length is theirs (or the endpoint's): none is sent unless one was said.
        // OpenAI's own models want the newer field name.
        const ceilingKey = `${url} ${config.model}`;
        const learned = modelCeilings.get(ceilingKey);
        let outputCap = call.outputCap !== null && learned !== undefined ? Math.min(call.outputCap, learned) : call.outputCap;
        const capField = isOpenAIHost(config.endpoint) || typeof body.max_completion_tokens === 'number' ? 'max_completion_tokens' : 'max_tokens';
        delete sent.max_tokens;
        delete sent.max_completion_tokens;
        if (outputCap !== null) sent[capField] = outputCap;
        if (streaming && !refusedStreamOptions.has(url)) sent.stream_options = { ...(isRecord(body.stream_options) ? body.stream_options : {}), include_usage: true };
        else delete sent.stream_options;

        const controller = new AbortController();
        let cutShort = false;
        let timedOut = false;
        // A reply is cut only when the provider has been silent this long (a long answer that keeps coming is never cut by a clock): what a call can bill is bounded by its
        // answer length, not by time. An answer that is not streamed comes whole, so this is its total.
        let timer: ReturnType<typeof setTimeout>;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                cutShort = true;
                timedOut = true;
                controller.abort();
            }, RELAY_GUARDS.callTimeoutMs);
        };
        arm();
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
                // A provider that does not take stream_options, and a model that states a shorter answer than was asked: each is asked again once, and remembered
                for (let again = 0; again < 2 && !upstream.ok; again++) {
                    const text = await readBounded(upstream.clone(), RELAY_GUARDS.maxErrorBytes).catch(() => '');
                    if (sent.stream_options && refusesStreamOptions(upstream.status, text)) {
                        refusedStreamOptions.add(url);
                        delete sent.stream_options;
                        upstream = await send(sent);
                        continue;
                    }
                    const ceiling = outputCap !== null ? statedOutputCeiling(upstream.status, text, outputCap) : undefined;
                    if (!ceiling) break;
                    // The model's own limit is kept for its next calls; one that is only what this request left of the context fits this request alone
                    if (ceiling.lasting) modelCeilings.set(ceilingKey, ceiling.tokens);
                    outputCap = ceiling.tokens;
                    sent[capField] = outputCap;
                    upstream = await send(sent);
                }
            } catch (error) {
                // Not reached at all (no connection was made): nothing was sent. A cut-off while waiting, or a connection that broke after the request went out, may have been used and is owed.
                if (!controller.signal.aborted) {
                    const reached = !neverReached(error);
                    problem(res, 502, 'The AI could not be reached.', 'upstream_unreachable', 'server_error');
                    console.warn(reached ? '[ComputerRelay] The connection to the provider broke:' : '[ComputerRelay] The provider was not reached:', providerErrorText(error));
                    return { usage: undefined, outputChars: 0, cutShort: reached, notSent: !reached, unexplainedTokens: 0 };
                }
                if (!res.headersSent && !res.writableEnded) problem(res, timedOut ? 504 : 502, timedOut ? 'The AI took too long.' : 'The AI could not be reached.', timedOut ? 'upstream_timeout' : 'upstream_unreachable', 'server_error');
                return { usage: undefined, outputChars: 0, cutShort: true, notSent: false, unexplainedTokens: 0 };
            }

            if (!upstream.ok) {
                // What the provider said, in words fit for a log: never its key, never the conversation
                const text = await readBounded(upstream, RELAY_GUARDS.maxErrorBytes).catch(() => '');
                const message = providerErrorText(wordsOf(text)).split(key ?? '\u0000').join('[redacted]');
                console.warn('[ComputerRelay] The provider refused a call:', upstream.status);
                problem(res, statusToHermes(upstream.status), message, 'upstream_error', 'server_error');
                // A call the provider refused was not billed
                return { usage: { error: true }, outputChars: 0, cutShort: false, notSent: false, unexplainedTokens: 0 };
            }

            if (!streaming) {
                const read = await readBoundedWithFlag(upstream, RELAY_GUARDS.maxReplyBytes);
                // An answer longer than the guard is said to be, never handed on cut: it was billed, so it is settled at what was held
                if (read.tooLong) {
                    problem(res, 502, 'The AI’s answer was longer than can be passed on.', 'reply_too_long', 'server_error');
                    return { usage: undefined, outputChars: 0, cutShort: true, notSent: false, unexplainedTokens: 0 };
                }
                let data: { usage?: unknown; choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> } | null = null;
                try {
                    const parsed: unknown = JSON.parse(read.text);
                    data = isRecord(parsed) ? parsed : null;
                } catch {
                    data = null;
                }
                if (!data) {
                    problem(res, 502, 'The AI answered with something unreadable.', 'upstream_error', 'server_error');
                    return { usage: undefined, outputChars: 0, cutShort: false, notSent: false, unexplainedTokens: 0 };
                }
                res.status(200).json(data);
                const usage = isRecord(data.usage) ? data.usage : undefined;
                const message = data.choices?.[0]?.message;
                // What the model wrote counts whether it was words, thinking or a tool call
                const written = (typeof message?.content === 'string' ? message.content.length : 0) + (typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0) + toolCallChars(message?.tool_calls);
                const used = usage ? usageOf(usage, config) : null;
                return {
                    usage: used?.metadata,
                    outputChars: written,
                    cutShort,
                    notSent: false,
                    unexplainedTokens: used?.unexplained ?? 0,
                };
            }

            if (!upstream.body) {
                problem(res, 502, 'The AI answered with something unreadable.', 'upstream_error', 'server_error');
                return { usage: undefined, outputChars: 0, cutShort: false, notSent: false, unexplainedTokens: 0 };
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
            let unexplainedTokens = 0;
            let outputChars = 0;
            const read = (line: string) => {
                if (!line.startsWith('data:')) return;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const chunk = JSON.parse(data) as { usage?: Record<string, any> | null; choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }> };
                    if (isRecord(chunk.usage)) {
                        const used = usageOf(chunk.usage, config);
                        usage = used.metadata;
                        unexplainedTokens = used.unexplained;
                    }
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
                    arm();
                    pending += decoder.write(chunk);
                    let at: number;
                    while ((at = pending.indexOf('\n')) >= 0) {
                        if (skipping) skipping = false;
                        else read(pending.slice(0, at).replace(/\r$/, ''));
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
                // A stream that was cut by the clock says so, in the shape clients read: never an answer that just stops
                if (timedOut) endWithError(res, 'The AI took too long.', 'upstream_timeout');
                if (!res.writableEnded) res.end();
            } catch (error) {
                // The provider's stream broke, or Hermes went away: what came through is counted, and the other side is told
                if (!controller.signal.aborted) {
                    console.warn('[ComputerRelay] A stream broke:', providerErrorText(error));
                    cutShort = true;
                    endWithError(res, 'The AI’s answer stopped before it was finished.', 'upstream_error');
                }
                if (!res.writableEnded) res.end();
            }
            return { usage, outputChars, cutShort, notSent: false, unexplainedTokens };
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
