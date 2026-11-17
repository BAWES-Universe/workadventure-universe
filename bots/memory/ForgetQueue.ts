/**
 * Forgets a person asked for that Orbit has not taken yet (#2031), and a record of every thing that was forgotten (the
 * ledger), kept in the bot servers' shared store (Redis) so neither a restart nor a redeploy loses them, and every bot
 * server sees the same ones.
 *
 * - The waiting list is what is still owed to Orbit. It is written BEFORE Orbit is told and before the person is told it
 *   is forgotten, so a crash at any point still leaves the forget to be sent again.
 * - The ledger is kept after Orbit has taken a forget. It holds only the key of the thing (a hash, never the words), who
 *   and which Brick it was, and when it was forgotten. Whatever Orbit hands back later that still holds the thing (a
 *   restored archive, a copy older than the forget) is taken out again, and Orbit is told again.
 *
 * Both are small (one short entry per thing). Each entry is its own field in a hash, so two bot servers writing at the
 * same time never overwrite each other's entries.
 */
export interface PendingItemForget {
    botId: string;
    userUuid: string;
    itemKey: string;
    kind: string;
    /** When the person last asked for it to go. */
    since: number;
    /** When it first failed to reach Orbit. */
    first: number;
}

/** One thing that was forgotten, kept after Orbit took it. */
export interface ForgottenItem {
    botId: string;
    userUuid: string;
    itemKey: string;
    /** Its kind when known (Orbit needs it to be told again); a forget that came from Orbit's own list does not carry one. */
    kind?: string;
    /** When it was forgotten (0: whenever it was said). What the person said again after this stays. */
    since: number;
}

export interface ForgetFileContents {
    pending: PendingItemForget[];
    ledger: ForgottenItem[];
}

/** A safety limit, not one anyone sees: the oldest are let go beyond it, so a list that only grows cannot fill the store. */
export const MAX_PENDING_FORGETS = 5000;
/** The same kind of limit for the ledger, which is kept for ever otherwise (a hash and a time per forgotten thing). */
export const MAX_FORGOTTEN_ITEMS = 20000;

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The name of one entry in the store (and in the process): the Brick, the person and the thing. */
export const forgetKeyOf = (entry: { botId: string; userUuid: string; itemKey: string }): string => `${entry.botId}|${entry.userUuid}|${entry.itemKey}`;

/** What changed since the store was last written: entries to put, and the names of entries to remove. */
export interface ForgetQueueChanges {
    pending: { put: PendingItemForget[]; del: string[] };
    ledger: { put: ForgottenItem[]; del: string[] };
}

/** Where the waiting list and the ledger are kept. */
export interface ForgetQueueStore {
    /**
     * False while there is no shared store at all (it has never been reached, as on one machine without Redis): nothing is read or
     * written then, quietly, and the forgets are kept in this process only. A store that is there but down is not "not in use": it fails (throws).
     */
    inUse?(): boolean;
    /** Everything kept. Throws when the store cannot be reached (an empty store is an empty answer, not an error). */
    load(): Promise<ForgetFileContents>;
    /** Applies these changes together. Throws when it could not, so nothing is taken as kept. */
    write(changes: ForgetQueueChanges): Promise<void>;
}

/** The few Redis commands the queue uses (a node-redis client has them all). */
export interface ForgetQueueRedis {
    hGetAll(key: string): Promise<Record<string, string>>;
    multi(): {
        hSet(key: string, field: string, value: string): unknown;
        hDel(key: string, field: string): unknown;
        exec(): Promise<unknown>;
    };
}

const PENDING_KEY = 'bots:forgets:pending';
const LEDGER_KEY = 'bots:forgets:ledger';

/** Reads the entries of a hash that are well formed, oldest first, with the name each is kept under; anything else in it is ignored (a damaged entry must never stop the bot starting). */
function readEntries<T extends { since: number }>(raw: Record<string, string>, valid: (entry: Partial<T> | null) => entry is T): Array<{ field: string; entry: T }> {
    const entries: Array<{ field: string; entry: T }> = [];
    for (const [field, value] of Object.entries(raw)) {
        try {
            const entry = JSON.parse(value) as Partial<T> | null;
            if (valid(entry)) entries.push({ field, entry });
        } catch {
            // not an entry
        }
    }
    return entries.sort((a, b) => a.entry.since - b.entry.since);
}

const validPending = (entry: Partial<PendingItemForget> | null): entry is PendingItemForget =>
    !!entry && text(entry.botId) && text(entry.userUuid) && text(entry.itemKey) && typeof entry.kind === 'string' && finite(entry.since) && finite(entry.first);
const validForgotten = (entry: Partial<ForgottenItem> | null): entry is ForgottenItem =>
    !!entry && text(entry.botId) && text(entry.userUuid) && text(entry.itemKey) && finite(entry.since) && (entry.kind === undefined || typeof entry.kind === 'string');

/** The queue in Redis: one hash for the waiting list and one for the ledger, an entry per field. Fails (throws) while Redis cannot be reached. */
export class RedisForgetQueue implements ForgetQueueStore {
    /**
     * `redis` answers the client while it is connected and null while it is not. `seen` says whether Redis has ever been reached.
     * A call that is not answered within `deadlineMs` fails, so a connection that has gone silent never holds a memory load or save.
     */
    constructor(
        private readonly redis: () => ForgetQueueRedis | null,
        private readonly seen: () => boolean = () => true,
        private readonly deadlineMs = 5000
    ) {}

    inUse(): boolean {
        return this.seen();
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

    private client(): ForgetQueueRedis {
        const client = this.redis();
        if (!client) throw new Error('Shared store is not connected');
        return client;
    }

    async load(): Promise<ForgetFileContents> {
        const client = this.client();
        const [pending, ledger] = await this.within(Promise.all([client.hGetAll(PENDING_KEY), client.hGetAll(LEDGER_KEY)]));
        const waiting = readEntries(pending, validPending);
        const forgotten = readEntries(ledger, validForgotten);
        // A safety limit nobody sees: the oldest beyond it are let go, so what is kept cannot grow without end
        const cut = client.multi();
        let trimmed = false;
        for (const { field } of waiting.slice(0, Math.max(0, waiting.length - MAX_PENDING_FORGETS))) {
            trimmed = true;
            cut.hDel(PENDING_KEY, field);
        }
        for (const { field } of forgotten.slice(0, Math.max(0, forgotten.length - MAX_FORGOTTEN_ITEMS))) {
            trimmed = true;
            cut.hDel(LEDGER_KEY, field);
        }
        if (trimmed) await this.within(cut.exec()).catch(() => undefined);
        return { pending: waiting.slice(-MAX_PENDING_FORGETS).map((one) => one.entry), ledger: forgotten.slice(-MAX_FORGOTTEN_ITEMS).map((one) => one.entry) };
    }

    async write(changes: ForgetQueueChanges): Promise<void> {
        const client = this.client();
        const batch = client.multi();
        for (const entry of changes.pending.put) batch.hSet(PENDING_KEY, forgetKeyOf(entry), JSON.stringify(entry));
        for (const key of changes.pending.del) batch.hDel(PENDING_KEY, key);
        for (const entry of changes.ledger.put) batch.hSet(LEDGER_KEY, forgetKeyOf(entry), JSON.stringify(entry));
        for (const key of changes.ledger.del) batch.hDel(LEDGER_KEY, key);
        // One transaction: a forget is never in the ledger without its waiting entry, or the other way round
        await this.within(batch.exec());
    }
}
