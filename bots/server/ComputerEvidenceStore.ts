/**
 * The rows of Orbit's fault record that Orbit has not taken yet, kept in the bot servers' shared store (Redis) so a restart or a redeploy of the bot
 * server does not lose the evidence a failed computer job's money decision rests on (ComputerRefusals sends them again, under the ids they had).
 *
 * One field per row in one hash, so two bot servers never overwrite each other: `<jobId>|<callId>` holds the bot, the job, the row and when it was
 * kept. A row holds ids, a reason, a source, a route and times: nothing anyone said, no key. A row older than a day, or one that is damaged, is not
 * brought back (and an old one is removed); a damaged entry never stops the bot server starting.
 */
import type { CallRow, EvidenceStore } from './ComputerRefusals';
import { EVIDENCE_KEEP_MS } from './ComputerRefusals';

/** The few Redis hash commands used (a node-redis client has them all). */
export interface EvidenceRedis {
    hGetAll(key: string): Promise<Record<string, string>>;
    hSet(key: string, field: string, value: string): Promise<unknown>;
    hDel(key: string, fields: string | string[]): Promise<unknown>;
}

export const EVIDENCE_KEY = 'computer:evidence';

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
            await this.within(this.client().hSet(EVIDENCE_KEY, `${jobId}|${row.callId}`, JSON.stringify({ botId, jobId, row, at: this.now() })));
            return true;
        } catch {
            return false;
        }
    }

    async drop(jobId: string, callIds: string[]): Promise<void> {
        if (callIds.length === 0) return;
        try {
            await this.within(this.client().hDel(EVIDENCE_KEY, callIds.map((id) => `${jobId}|${id}`)));
        } catch {
            /* a row left behind is only sent again, and Orbit keeps one per job and call */
        }
    }

    async load(): Promise<Array<{ botId: string; jobId: string; rows: CallRow[] }>> {
        const client = this.client();
        const all = await this.within(client.hGetAll(EVIDENCE_KEY));
        const byJob = new Map<string, { botId: string; jobId: string; rows: CallRow[] }>();
        const stale: string[] = [];
        for (const [field, value] of Object.entries(all)) {
            let entry: { botId?: unknown; jobId?: unknown; row?: unknown; at?: unknown } | null = null;
            try {
                entry = JSON.parse(value) as typeof entry;
            } catch {
                entry = null;
            }
            const row = validRow(entry?.row);
            if (!entry || !row || !text(entry.botId) || !text(entry.jobId) || `${entry.jobId}|${row.callId}` !== field) continue;
            if (typeof entry.at === 'number' && entry.at < this.now() - EVIDENCE_KEEP_MS) {
                stale.push(field);
                continue;
            }
            const job = byJob.get(entry.jobId) ?? { botId: entry.botId, jobId: entry.jobId, rows: [] };
            job.rows.push(row);
            byJob.set(entry.jobId, job);
        }
        if (stale.length > 0) await this.within(client.hDel(EVIDENCE_KEY, stale)).catch(() => undefined);
        return [...byJob.values()];
    }
}
