/**
 * Forgets a person asked for in the chat that Orbit has not taken yet (#2031), kept in a file so a bot-server restart
 * does not lose them. The queue is small (one short entry per thing), so the whole list is written each time, to a
 * temporary file that then replaces the real one, so a crash never leaves half a file.
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

/** A safety limit, not one anyone sees: the oldest are let go beyond it, so a file that only grows cannot fill a disk. */
export const MAX_PENDING_FORGETS = 5000;

export class ForgetQueueFile {
    constructor(private readonly path: string) {}

    /** What is waiting, or nothing when there is no file or it cannot be read (a damaged file must never stop the bot starting). */
    load(): PendingItemForget[] {
        try {
            const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { pending?: unknown }).pending)) return [];
            const entries: PendingItemForget[] = [];
            for (const raw of (parsed as { pending: unknown[] }).pending) {
                const entry = raw as Partial<PendingItemForget> | null;
                if (
                    entry &&
                    typeof entry.botId === 'string' && entry.botId &&
                    typeof entry.userUuid === 'string' && entry.userUuid &&
                    typeof entry.itemKey === 'string' && entry.itemKey &&
                    typeof entry.kind === 'string' &&
                    typeof entry.since === 'number' && Number.isFinite(entry.since) &&
                    typeof entry.first === 'number' && Number.isFinite(entry.first)
                ) {
                    entries.push({ botId: entry.botId, userUuid: entry.userUuid, itemKey: entry.itemKey, kind: entry.kind, since: entry.since, first: entry.first });
                }
            }
            return entries.slice(-MAX_PENDING_FORGETS);
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') console.warn('[ForgetQueueFile] Could not read the waiting forgets:', error);
            return [];
        }
    }

    /** Replaces the file with this list. Returns false when it could not be written (the queue still works in memory). */
    save(entries: readonly PendingItemForget[]): boolean {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const temporary = `${this.path}.${process.pid}.tmp`;
            writeFileSync(temporary, JSON.stringify({ v: 1, pending: entries.slice(-MAX_PENDING_FORGETS) }), { mode: 0o600 });
            renameSync(temporary, this.path);
            return true;
        } catch (error) {
            console.warn('[ForgetQueueFile] Could not write the waiting forgets:', error);
            return false;
        }
    }
}
