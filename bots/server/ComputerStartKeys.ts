import { createHash } from 'node:crypto';
import type { EvidenceRedis } from './ComputerEvidenceStore';

/**
 * Where the key of a computer job's start waits while its outcome is open, so a restart of this server between sending a start and reading its answer finds the key again:
 * the next ask of the same thing sends the SAME key, and Orbit answers with the job the first start made instead of making a second one (a second charge). One key per
 * Brick, person, chat and title, `computer:startkey:<bot>:<person>:<hash of chat and title>`, holding the key, when it was first sent and nothing else (no title, no words of
 * anyone's). It lives ten minutes from the first send, set BEFORE the start is sent, and is deleted when the outcome is final (a job that worked, ended or finished, a refusal).
 * Without the store (Redis down), the process's own memory keeps the key as before.
 *
 * The first key of an ask wins across servers: `claim` is ONE step in the store that returns the key already held while it is still good, and otherwise keeps the caller's
 * and returns that. Two servers that handle the same ask at the same moment, and an ask that races a stored one, therefore send the same key (one job, never two).
 */
export const START_KEY_PREFIX = 'computer:startkey:';

/** What is kept for one ask: the key sent, and when it was first sent (ms). */
export interface StoredStartKey {
    key: string;
    at: number;
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
                    arguments: [JSON.stringify({ key: entry.key, at: entry.at }), String(Math.max(1000, Math.round(keepMs))), String(oldestGood)],
                })
            );
            if (typeof held !== 'string') return undefined;
            const kept = JSON.parse(held) as unknown;
            if (typeof kept !== 'object' || kept === null) return undefined;
            const { key, at } = kept as { key?: unknown; at?: unknown };
            // Only a key of the shape Orbit takes, and a moment that is a number: anything else is not ours
            if (typeof key !== 'string' || !SHAPE.test(key) || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
            return { key, at };
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
