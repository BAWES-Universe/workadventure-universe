import { createHash } from 'node:crypto';
import type { EvidenceRedis } from './ComputerEvidenceStore';

/**
 * Where the key of a computer job's start waits while its outcome is open, so a restart of this server between sending a start and reading its answer finds the key again:
 * the next ask of the same thing sends the SAME key, and Orbit answers with the job the first start made instead of making a second one (a second charge). One key per
 * Brick, person, chat and title, `computer:startkey:<bot>:<person>:<hash of chat and title>`, holding the key, when it was first sent and nothing else (no title, no words of
 * anyone's). It lives ten minutes from the first send, set BEFORE the start is sent, and is deleted when the outcome is final (a job that worked, ended or finished, a refusal).
 * Without the store (Redis down), the process's own memory keeps the key as before.
 */
export const START_KEY_PREFIX = 'computer:startkey:';

/** What is kept for one ask: the key sent, and when it was first sent (ms). */
export interface StoredStartKey {
    key: string;
    at: number;
}

/** What `runComputerTool` asks of the place the keys are kept. Every call answers or fails within a short time and never throws to its caller. */
export interface StartKeyStore {
    get(scope: string): Promise<StoredStartKey | undefined>;
    /** Keeps the key for `keepMs` from now (at least a second). */
    set(scope: string, entry: StoredStartKey, keepMs: number): Promise<void>;
    /** Takes the key back only while the store still holds exactly this key. */
    delete(scope: string, key: string): Promise<void>;
}

const GET = `return redis.call('GET', KEYS[1])`;
/** Writes the value ARGV[1] with a life of ARGV[2] ms, as one step. */
export const SET_START_KEY = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return 1
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
        private readonly deadlineMs = 1000
    ) {}

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

    async get(scope: string): Promise<StoredStartKey | undefined> {
        try {
            const held = await this.within(this.client().eval(GET, { keys: [startKeyNameOf(scope)], arguments: [] }));
            if (typeof held !== 'string') return undefined;
            const entry = JSON.parse(held) as unknown;
            if (typeof entry !== 'object' || entry === null) return undefined;
            const { key, at } = entry as { key?: unknown; at?: unknown };
            // Only a key of the shape Orbit takes, and a moment that is a number: anything else is not ours
            if (typeof key !== 'string' || !SHAPE.test(key) || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
            return { key, at };
        } catch {
            return undefined;
        }
    }

    async set(scope: string, entry: StoredStartKey, keepMs: number): Promise<void> {
        try {
            await this.within(this.client().eval(SET_START_KEY, { keys: [startKeyNameOf(scope)], arguments: [JSON.stringify({ key: entry.key, at: entry.at }), String(Math.max(1000, Math.round(keepMs)))] }));
        } catch {
            /* the process's own memory keeps it */
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
