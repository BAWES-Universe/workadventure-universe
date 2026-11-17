/**
 * Forgets a person asked for that Orbit has not taken yet (#2031), and a record of every thing that was forgotten (the
 * ledger), kept in a file so a bot-server restart does not lose either.
 *
 * - The waiting list is what is still owed to Orbit. It is written BEFORE Orbit is told and before the person is told it
 *   is forgotten, so a crash at any point still leaves the forget to be sent again.
 * - The ledger is kept after Orbit has taken a forget. It holds only the key of the thing (a hash, never the words), who
 *   and which Brick it was, and when it was forgotten. Whatever Orbit hands back later that still holds the thing (a
 *   restored archive, a copy older than the forget) is taken out again, and Orbit is told again.
 *
 * Both are small (one short entry per thing), so the whole file is written each time, to a temporary file that then
 * replaces the real one, so a crash never leaves half a file. One file, so the list and the ledger never disagree.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

/** A safety limit, not one anyone sees: the oldest are let go beyond it, so a file that only grows cannot fill a disk. */
export const MAX_PENDING_FORGETS = 5000;
/** The same kind of limit for the ledger, which is kept for ever otherwise (a hash and a time per forgotten thing). */
export const MAX_FORGOTTEN_ITEMS = 20000;

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export class ForgetQueueFile {
    constructor(private readonly path: string) {}

    /** What is waiting and what was forgotten, or nothing when there is no file or it cannot be read (a damaged file must never stop the bot starting). */
    load(): ForgetFileContents {
        const none: ForgetFileContents = { pending: [], ledger: [] };
        try {
            const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
            if (!parsed || typeof parsed !== 'object') return none;
            const { pending, ledger } = parsed as { pending?: unknown; ledger?: unknown };
            const waiting: PendingItemForget[] = [];
            for (const raw of Array.isArray(pending) ? pending : []) {
                const entry = raw as Partial<PendingItemForget> | null;
                if (entry && text(entry.botId) && text(entry.userUuid) && text(entry.itemKey) && typeof entry.kind === 'string' && finite(entry.since) && finite(entry.first)) {
                    waiting.push({ botId: entry.botId, userUuid: entry.userUuid, itemKey: entry.itemKey, kind: entry.kind, since: entry.since, first: entry.first });
                }
            }
            const forgotten: ForgottenItem[] = [];
            for (const raw of Array.isArray(ledger) ? ledger : []) {
                const entry = raw as Partial<ForgottenItem> | null;
                if (entry && text(entry.botId) && text(entry.userUuid) && text(entry.itemKey) && finite(entry.since)) {
                    forgotten.push({ botId: entry.botId, userUuid: entry.userUuid, itemKey: entry.itemKey, ...(typeof entry.kind === 'string' && entry.kind ? { kind: entry.kind } : {}), since: entry.since });
                }
            }
            return { pending: waiting.slice(-MAX_PENDING_FORGETS), ledger: forgotten.slice(-MAX_FORGOTTEN_ITEMS) };
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') console.warn('[ForgetQueueFile] Could not read the waiting forgets:', error);
            return none;
        }
    }

    /** Replaces the file with these lists. Returns false when it could not be written (the queue still works in memory). */
    save(pending: readonly PendingItemForget[], ledger: readonly ForgottenItem[] = []): boolean {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const temporary = `${this.path}.${process.pid}.tmp`;
            writeFileSync(temporary, JSON.stringify({ v: 2, pending: pending.slice(-MAX_PENDING_FORGETS), ledger: ledger.slice(-MAX_FORGOTTEN_ITEMS) }), { mode: 0o600 });
            renameSync(temporary, this.path);
            return true;
        } catch (error) {
            console.warn('[ForgetQueueFile] Could not write the waiting forgets:', error);
            return false;
        }
    }
}
