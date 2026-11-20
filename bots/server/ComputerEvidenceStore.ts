/**
 * The rows of Orbit's fault record that Orbit has not taken yet, kept in the bot servers' shared store (Redis) so a restart or a redeploy of the bot
 * server does not lose the evidence a failed computer job's money decision rests on (ComputerRefusals sends them again, under the ids they had).
 *
 * One hash per job, `computer:faults:pending:<jobId>`, one field per call (the call id) holding the bot and the row. The hash lives 7 days from its
 * last write. A row holds ids, a reason, a source, a route and times: nothing anyone said, no key. A damaged or foreign entry is skipped (and never
 * stops the bot server starting); an entry older than the time rows are kept is removed.
 */
import type { CallRow, EvidenceStore } from './ComputerRefusals';
import { EVIDENCE_KEEP_MS } from './ComputerRefusals';

/** The few Redis commands used (a node-redis v4 client has them all). */
export interface EvidenceRedis {
    hGetAll(key: string): Promise<Record<string, string>>;
    hSet(key: string, field: string, value: string): Promise<unknown>;
    hDel(key: string, fields: string | string[]): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
    scan(cursor: number, options: { MATCH: string; COUNT: number }): Promise<{ cursor: number; keys: string[] }>;
}

export const EVIDENCE_PREFIX = 'computer:faults:pending:';
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

    async drop(jobId: string, callIds: string[]): Promise<void> {
        if (callIds.length === 0) return;
        try {
            await this.within(this.client().hDel(EVIDENCE_PREFIX + jobId, callIds));
        } catch {
            /* a row left behind is only sent again, and Orbit keeps one per job and call */
        }
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
            const all = await this.within(client.hGetAll(key));
            const rows: CallRow[] = [];
            let botId: string | undefined;
            const stale: string[] = [];
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
                    stale.push(field);
                    continue;
                }
                botId = entry.botId;
                rows.push(row);
            }
            if (stale.length > 0) await this.within(client.hDel(key, stale)).catch(() => undefined);
            if (botId && rows.length > 0) jobs.push({ botId, jobId, rows });
        }
        return jobs;
    }
}
