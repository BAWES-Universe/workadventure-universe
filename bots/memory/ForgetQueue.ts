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
    /** When Orbit began answering the request itself with a refusal (a 4xx), counted only while it keeps doing so; an outage resets it. */
    refusedSince?: number;
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

/** A safety limit, not one anyone sees, for the ledger, which is kept for ever otherwise (a hash and a time per forgotten thing). What is waiting for Orbit has none. */
export const MAX_FORGOTTEN_ITEMS = 20000;

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The name of one entry in the store (and in the process): the Brick, the person and the thing. */
export const forgetKeyOf = (entry: { botId: string; userUuid: string; itemKey: string }): string => `${entry.botId}|${entry.userUuid}|${entry.itemKey}`;

/** An entry to remove: its name, and the time of the ask this process held (a later ask stored by another bot server is not removed). */
export interface ForgetQueueRemoval {
    key: string;
    since: number;
}

/**
 * What changed since the store was last written: entries to put, and entries to remove. Another bot server may have asked for the same
 * thing again meanwhile, so a put does not replace a later ask and a removal does not remove one (0 is "whenever it was said": the latest of all).
 */
export interface ForgetQueueChanges {
    pending: { put: PendingItemForget[]; del: ForgetQueueRemoval[] };
    ledger: { put: ForgottenItem[]; del: ForgetQueueRemoval[] };
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
        eval(script: string, options: { keys: string[]; arguments: string[] }): unknown;
        exec(): Promise<unknown>;
    };
}

/** Puts an entry unless the one stored is a later ask (0, "whenever it was said", is later than any time). Run in Redis, so two bot servers cannot cross. */
export const PUT_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if cur then
  local ok, entry = pcall(cjson.decode, cur)
  if ok and type(entry) == 'table' and type(entry.since) == 'number' then
    local stored = entry.since
    local mine = tonumber(ARGV[3])
    if stored == 0 then stored = math.huge end
    if mine == 0 then mine = math.huge end
    if stored > mine then return 0 end
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

/** Removes an entry unless the one stored is a later ask than the one this process held. */
export const REMOVE_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if not cur then return 0 end
local ok, entry = pcall(cjson.decode, cur)
if ok and type(entry) == 'table' and type(entry.since) == 'number' then
  local stored = entry.since
  local mine = tonumber(ARGV[2])
  if stored == 0 then stored = math.huge end
  if mine == 0 then mine = math.huge end
  if stored > mine then return 0 end
end
return redis.call('HDEL', KEYS[1], ARGV[1])
`;

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
        // What Orbit has not taken yet is never let go for size: it is the promise that a forgotten thing stays forgotten, and it can only grow
        // as far as what people actually had remembered. The ledger is a second protection (Orbit keeps the forget too), so its oldest
        // beyond a safety limit are let go, and only if still the ask that was read: an entry another server replaced meanwhile is left.
        const extra = forgotten.slice(0, Math.max(0, forgotten.length - MAX_FORGOTTEN_ITEMS));
        if (extra.length > 0) {
            const cut = client.multi();
            for (const { field, entry } of extra) cut.eval(REMOVE_SCRIPT, { keys: [LEDGER_KEY], arguments: [field, String(entry.since)] });
            await this.within(cut.exec()).catch(() => undefined);
        }
        return { pending: waiting.map((one) => one.entry), ledger: forgotten.slice(-MAX_FORGOTTEN_ITEMS).map((one) => one.entry) };
    }

    async write(changes: ForgetQueueChanges): Promise<void> {
        const client = this.client();
        const batch = client.multi();
        const put = (hash: string, entry: PendingItemForget | ForgottenItem) =>
            batch.eval(PUT_SCRIPT, { keys: [hash], arguments: [forgetKeyOf(entry), JSON.stringify(entry), String(entry.since)] });
        const remove = (hash: string, one: ForgetQueueRemoval) => batch.eval(REMOVE_SCRIPT, { keys: [hash], arguments: [one.key, String(one.since)] });
        for (const entry of changes.pending.put) put(PENDING_KEY, entry);
        for (const one of changes.pending.del) remove(PENDING_KEY, one);
        for (const entry of changes.ledger.put) put(LEDGER_KEY, entry);
        for (const one of changes.ledger.del) remove(LEDGER_KEY, one);
        // One transaction: a forget is never in the ledger without its waiting entry, or the other way round
        await this.within(batch.exec());
    }
}
