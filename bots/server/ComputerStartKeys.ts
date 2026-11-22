import { createHash } from 'node:crypto';
import type { EvidenceRedis } from './ComputerEvidenceStore';

/**
 * Where the key of the OPEN computer start of a person and Brick waits while its outcome is not known, so a restart of this server between sending a start and reading its answer
 * finds the key again: the next ask sends the SAME key and the SAME payload, and Orbit answers with the job the first start made instead of making a second one (a second charge).
 * One record per Brick and person, `computer:startkey:<hash of both>`, holding the key, when it was first sent and what that start said (`StoredStartPayload`: the words of the
 * ask, so the words a person gave are in Redis as long as the record lives, which is at most the open start's safety life of 24 hours). It is set BEFORE the start is sent, and
 * deleted when the outcome is final. Without the store (Redis down), the process's own memory keeps the key as before.
 *
 * The first key of an ask wins across servers: `claim` is ONE step in the store that returns the key already held while it is still good, and otherwise keeps the caller's
 * and returns that. Two servers that handle the same ask at the same moment, and an ask that races a stored one, therefore send the same key (one job, never two).
 */
export const START_KEY_PREFIX = 'computer:startkey:';

/**
 * What the start of a key said, exactly as it was sent: the words of the ask (title, details, writes, the way Brick weighed, the chat it came from). It is kept WITH the key because
 * the key is that start's identity at Orbit: a start that is sent again (its look-up found no job yet) must send the SAME task under it, never the task of whatever the person asks
 * next. It lives as long as the key does (the open start's safety life) and goes with it. A record that has none (written before this, or damaged) is never sent again: its key is only looked up.
 */
export interface StoredStartPayload {
    title: string;
    brief?: string;
    writes?: boolean;
    plan?: { app: string; steps?: number; appCannot?: string };
    origin?: { kind: 'dm'; ref: string };
}

/** What is kept for one ask: the key sent, when it was first sent (ms), and what it said. */
export interface StoredStartKey {
    key: string;
    at: number;
    payload?: StoredStartPayload;
}

/** A payload as it is read back: only one of the shape `runComputerTool` sends, with nothing else in it. */
export function startPayloadOf(raw: unknown): StoredStartPayload | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const one = raw as Record<string, unknown>;
    if (typeof one.title !== 'string' || one.title === '' || one.title.length > 1000) return undefined;
    const out: StoredStartPayload = { title: one.title };
    if (one.brief !== undefined) {
        if (typeof one.brief !== 'string' || one.brief.length > 20_000) return undefined;
        out.brief = one.brief;
    }
    if (one.writes !== undefined) {
        if (typeof one.writes !== 'boolean') return undefined;
        out.writes = one.writes;
    }
    if (one.plan !== undefined) {
        const plan = one.plan as Record<string, unknown> | null;
        if (typeof plan !== 'object' || plan === null || typeof plan.app !== 'string' || plan.app.length > 1000) return undefined;
        if (plan.steps !== undefined && !(typeof plan.steps === 'number' && Number.isInteger(plan.steps))) return undefined;
        if (plan.appCannot !== undefined && (typeof plan.appCannot !== 'string' || plan.appCannot.length > 5000)) return undefined;
        out.plan = { app: plan.app, ...(plan.steps !== undefined ? { steps: plan.steps as number } : {}), ...(plan.appCannot !== undefined ? { appCannot: plan.appCannot as string } : {}) };
    }
    if (one.origin !== undefined) {
        const origin = one.origin as Record<string, unknown> | null;
        if (typeof origin !== 'object' || origin === null || origin.kind !== 'dm' || typeof origin.ref !== 'string' || origin.ref === '' || origin.ref.length > 1000) return undefined;
        out.origin = { kind: 'dm', ref: origin.ref };
    }
    return out;
}

/** What `runComputerTool` asks of the place the keys are kept. Every call answers or fails within a short time and never throws to its caller. */
export interface StartKeyStore {
    /**
     * Keeps `entry` for `keepMs` from now (at least a second) unless the store already holds a key of this ask that was first sent no longer than `lifeMs` ago, and answers
     * the entry the store holds after this (the one already there, or `entry`): the caller sends THAT key. Undefined when the store did not answer: the caller's own key goes on.
     */
    claim(scope: string, entry: StoredStartKey, keepMs: number, lifeMs: number): Promise<StoredStartKey | undefined>;
    /** Takes the key back only while the store still holds exactly this key. */
    delete(scope: string, key: string): Promise<void>;
    /**
     * Whether a shared store is expected to hold the keys of this server's asks (one is set up). A store that is expected and did not answer a claim means a key of this ask may
     * be held there that this process cannot see: nothing new is sent then. A server with no shared store at all (one machine, no Redis) has only its own memory. Taken as true when absent.
     */
    expected?(): boolean;
}

/**
 * Keeps the entry ARGV[1] with a life of ARGV[2] ms unless the name already holds an entry of this shape (a key of the shape Orbit takes and a number moment) first sent at or after ARGV[3] (the
 * oldest moment still good, ms): then that one is left as it is. Answers the entry that is held after this, as the store holds it. One step: two callers at once cannot both win.
 */
export const CLAIM_START_KEY = `
local held = redis.call('GET', KEYS[1])
if held then
  local ok, entry = pcall(cjson.decode, held)
  -- Only an entry of the shape the caller reads (the key Orbit takes: 8 to 64 of letters, digits, _ and -, and a number moment): anything else is replaced, never returned
  if ok and type(entry) == 'table' and type(entry.key) == 'string' and #entry.key >= 8 and #entry.key <= 64 and string.find(entry.key, '^[A-Za-z0-9_%-]+$') and type(entry.at) == 'number' and entry.at >= tonumber(ARGV[3]) then
    return held
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return ARGV[1]
`;
/** Deletes the key KEYS[1] only while the entry it holds is the key ARGV[1]: an ask that has started again since (another key) stays. */
export const DELETE_START_KEY = `
local held = redis.call('GET', KEYS[1])
if not held then return 0 end
local ok, entry = pcall(cjson.decode, held)
if ok and type(entry) == 'table' and entry.key == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

/** The key of a scope in the store: a hash, so no title or chat id is a part of a key name. */
export const startKeyNameOf = (scope: string): string => START_KEY_PREFIX + createHash('sha256').update(scope).digest('hex').slice(0, 40);

const SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

export class RedisStartKeys implements StartKeyStore {
    constructor(
        private readonly redis: () => EvidenceRedis | null,
        /** A call not answered within this fails: a store gone silent never holds a tool call. */
        private readonly deadlineMs = 1000,
        private readonly isExpected: () => boolean = () => true
    ) {}

    expected(): boolean {
        return this.isExpected();
    }

    private async within<T>(work: Promise<T>): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), this.deadlineMs);
            timer.unref?.();
        });
        try {
            return await Promise.race([work, late]);
        } finally {
            clearTimeout(timer);
        }
    }

    private client(): EvidenceRedis {
        const client = this.redis();
        if (!client) throw new Error('Shared store is not connected');
        return client;
    }

    async claim(scope: string, entry: StoredStartKey, keepMs: number, lifeMs: number): Promise<StoredStartKey | undefined> {
        try {
            const oldestGood = Date.now() - lifeMs;
            const held = await this.within(
                this.client().eval(CLAIM_START_KEY, {
                    keys: [startKeyNameOf(scope)],
                    arguments: [JSON.stringify({ key: entry.key, at: entry.at, ...(entry.payload ? { payload: entry.payload } : {}) }), String(Math.max(1000, Math.round(keepMs))), String(oldestGood)],
                })
            );
            if (typeof held !== 'string') return undefined;
            const kept = JSON.parse(held) as unknown;
            if (typeof kept !== 'object' || kept === null) return undefined;
            const { key, at, payload } = kept as { key?: unknown; at?: unknown; payload?: unknown };
            // Only a key of the shape Orbit takes, and a moment that is a number: anything else is not ours
            if (typeof key !== 'string' || !SHAPE.test(key) || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
            // What it said is read back only when it is whole; a record without it (or with a damaged one) holds a key that is only looked up, never sent again
            const said = startPayloadOf(payload);
            return { key, at, ...(said ? { payload: said } : {}) };
        } catch {
            return undefined;
        }
    }

    async delete(scope: string, key: string): Promise<void> {
        try {
            await this.within(this.client().eval(DELETE_START_KEY, { keys: [startKeyNameOf(scope)], arguments: [key] }));
        } catch {
            /* the key lives out its ten minutes */
        }
    }
}

/**
 * Gives the AI service the place the start keys wait: the shared store the relay and the runner already use. Called once by the server at start-up (`server/index.ts`, which
 * a test reads, since the server cannot be started in a test): a server that did not call it would keep its keys in the process's own memory only, and a restart would forget them.
 */
export function wireComputerStartKeys(
    ai: { setComputerStartKeys(store: StartKeyStore | undefined): void },
    redis: () => EvidenceRedis | null,
    expected: () => boolean = () => true
): RedisStartKeys {
    const keys = new RedisStartKeys(redis, 1000, expected);
    ai.setComputerStartKeys(keys);
    return keys;
}
