/**
 * The rows of Orbit's fault record that Orbit has not taken yet, kept in the bot servers' shared store (Redis) so a restart or a redeploy of the bot
 * server does not lose the evidence a failed computer job's money decision rests on (ComputerRefusals sends them again, under the ids they had).
 *
 * One hash per job, `computer:faults:pending:<jobId>`, one field per call (the call id) holding the bot and the row. The hash lives 7 days from its
 * last write. A row holds ids, a reason, a source, a route and times: nothing anyone said, no key. A damaged or foreign entry is skipped (and never
 * stops the bot server starting); an entry older than the time rows are kept is removed.
 */
import type { CallRow, EvidenceStore, SharedCalls } from './ComputerRefusals';
import { EVIDENCE_KEEP_MS, REFUSAL_NOTE_KEEP_MS } from './ComputerRefusals';

/** The few Redis commands used (a node-redis v4 client has them all). */
export interface EvidenceRedis {
    hGetAll(key: string): Promise<Record<string, string>>;
    hSet(key: string, field: string, value: string): Promise<unknown>;
    hDel(key: string, fields: string | string[]): Promise<unknown>;
    /** Runs a script in the store, so a comparison and the deletion that rests on it are one step (node-redis v4: `eval(script, { keys, arguments })`). */
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
    scan(cursor: number, options: { MATCH: string; COUNT: number }): Promise<{ cursor: number; keys: string[] }>;
}

export const EVIDENCE_PREFIX = 'computer:faults:pending:';

/**
 * Deletes fields of the hash KEYS[1] only where each still holds the value it was given (ARGV: field, value, field, value...): a field that was written
 * again since (a newer row of the same call id, which Orbit has not taken) stays. Answers how many were deleted.
 */
export const DELETE_IF_UNCHANGED = `
local removed = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    removed = removed + redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return removed
`;

/** A key of another kind that matches the prefix (Redis answers WRONGTYPE to a hash command on it): not ours, and no reason to stop reading the others. */
const wrongType = (error: unknown): boolean => error instanceof Error && /^WRONGTYPE\b/.test(error.message);
export const EVIDENCE_TTL_SECONDS = Math.round(EVIDENCE_KEEP_MS / 1000);

const KINDS = new Set(['fault', 'not_ours', 'uncertain']);
const SOURCES = new Set(['universe-ai', 'own-key']);
const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A row read back from the store, or null when it is not one (a damaged or foreign entry). */
function validRow(value: unknown): CallRow | null {
    if (typeof value !== 'object' || value === null) return null;
    const row = value as Record<string, unknown>;
    if (!text(row.callId) || row.callId.length > 120 || !text(row.reason) || typeof row.kind !== 'string' || !KINDS.has(row.kind)) return null;
    if (typeof row.source !== 'string' || !SOURCES.has(row.source) || !text(row.route) || !text(row.at)) return null;
    if (typeof row.turn !== 'number' || !Number.isInteger(row.turn) || row.turn < 0) return null;
    if (row.providerStatus !== null && typeof row.providerStatus !== 'number') return null;
    if (row.run !== undefined && !text(row.run)) return null;
    return row as unknown as CallRow;
}

export class RedisEvidenceStore implements EvidenceStore {
    /**
     * `redis` answers the client while it is connected and null while it is not. A call not answered within `deadlineMs` fails, so a connection that has
     * gone silent never holds a job's end.
     */
    constructor(
        private readonly redis: () => EvidenceRedis | null,
        private readonly now: () => number = Date.now,
        private readonly deadlineMs = 3000
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

    async save(botId: string, jobId: string, row: CallRow): Promise<boolean> {
        try {
            const client = this.client();
            const key = EVIDENCE_PREFIX + jobId;
            await this.within(client.hSet(key, row.callId, JSON.stringify({ botId, row })));
            // The life of the hash starts again with each write
            await this.within(client.expire(key, EVIDENCE_TTL_SECONDS));
            return true;
        } catch {
            return false;
        }
    }

    async drop(botId: string, jobId: string, rows: CallRow[]): Promise<void> {
        if (rows.length === 0) return;
        try {
            // Each row only while it is the one in the store: a newer row of the same call id (written after the one Orbit took) is not Orbit's yet
            await this.deleteIfUnchanged(EVIDENCE_PREFIX + jobId, rows.map((row) => [row.callId, JSON.stringify({ botId, row })] as [string, string]));
        } catch {
            /* a row left behind is only sent again, and Orbit keeps one per job and call */
        }
    }

    private async deleteIfUnchanged(key: string, fields: Array<[string, string]>): Promise<void> {
        await this.within(this.client().eval(DELETE_IF_UNCHANGED, { keys: [key], arguments: fields.flat() }));
    }

    async load(): Promise<Array<{ botId: string; jobId: string; rows: CallRow[] }>> {
        const client = this.client();
        const keys = new Set<string>();
        let cursor = 0;
        do {
            const page = await this.within(client.scan(cursor, { MATCH: `${EVIDENCE_PREFIX}*`, COUNT: 100 }));
            cursor = page.cursor;
            for (const key of page.keys) keys.add(key);
        } while (cursor !== 0);
        const jobs: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
        for (const key of keys) {
            const jobId = key.slice(EVIDENCE_PREFIX.length);
            if (jobId === '') continue;
            let all: Record<string, string>;
            try {
                all = await this.within(client.hGetAll(key));
            } catch (error) {
                // A foreign key that matches the prefix must not stop every job from coming back; a store that cannot be reached still does (it is asked again)
                if (wrongType(error)) continue;
                throw error;
            }
            const rows: CallRow[] = [];
            let botId: string | undefined;
            const stale: Array<[string, string]> = [];
            for (const [field, value] of Object.entries(all)) {
                let entry: { botId?: unknown; row?: unknown } | null = null;
                try {
                    entry = JSON.parse(value) as typeof entry;
                } catch {
                    entry = null;
                }
                const row = validRow(entry?.row);
                if (!entry || !row || !text(entry.botId) || row.callId !== field) continue;
                const at = Date.parse(row.at);
                if (Number.isFinite(at) && at < this.now() - EVIDENCE_KEEP_MS) {
                    stale.push([field, value]);
                    continue;
                }
                botId = entry.botId;
                rows.push(row);
            }
            // An expired row is removed only if it is still the one that was read: another bot server may have written a newer one since
            if (stale.length > 0) await this.deleteIfUnchanged(key, stale).catch(() => undefined);
            if (botId && rows.length > 0) jobs.push({ botId, jobId, rows });
        }
        return jobs;
    }
}

export const CALLED_PREFIX = 'computer:called:';

/**
 * Where the bot servers say to each other that a call of a job reached their relay (the runner of a job lives on one server, its machine's calls may land on
 * another): one hash per job, `computer:called:<jobId>`, one field per bot server (its own random id) holding the latest moment (ms) it saw one. It lives an
 * hour from the last write, as long as the runner's own notes. Holds ids and times only.
 */
export class RedisSharedCalls implements SharedCalls {
    constructor(
        private readonly redis: () => EvidenceRedis | null,
        /** This server's id: what it wrote is not read back as another's (its own notes know exactly). */
        private readonly instanceId: string,
        private readonly deadlineMs = 3000
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

    async noteCalled(jobId: string, at: number): Promise<void> {
        const client = this.client();
        const key = CALLED_PREFIX + jobId;
        await this.within(client.hSet(key, this.instanceId, String(at)));
        await this.within(client.expire(key, Math.round(REFUSAL_NOTE_KEEP_MS / 1000)));
    }

    async lastCalledByOthers(jobId: string): Promise<number | null> {
        const all = await this.within(this.client().hGetAll(CALLED_PREFIX + jobId));
        let latest: number | null = null;
        for (const [instance, value] of Object.entries(all)) {
            if (instance === this.instanceId) continue;
            const at = Number(value);
            if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
        }
        return latest;
    }
}
