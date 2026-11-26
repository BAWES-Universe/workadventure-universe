import { createHash, randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import type { EvidenceRedis } from '../server/ComputerEvidenceStore';
import type { ClosedWhy } from './MatrixEventInbox';

/**
 * The outbox of the notices a person must get when their message will not be handled (GPT's eighth note, G; Opus's design of 24 Nov, patch 2 G).
 *
 * When the inbox CLOSES an entry that will not be handled (the "Cut off" note after paid work began and no answer is proved, or "couldn't answer" when it ran out of tries, waited too long
 * or its entry lapsed), the same store step that closes it writes the notice here: the closure and the notice are one step, so the notice exists BEFORE the work record is closed, and a
 * server that dies right after the closure leaves the notice for the next one. Closing or expiring the inbox record never touches it.
 *
 * One notice per event, in the shared store:
 * - `matrix:outbox:<event id>` (a hash, NO expiry) holds why it was closed (`why`), the event as the inbox kept it (`kept`), when it was written (`at`), how many sends were tried (`tries`), the
 *   send that holds it now (`claim`) and whether it was reported overdue (`reported`);
 * - `matrix:outbox` (a sorted set) holds the event ids, scored by when the next send may be tried.
 *
 * Every send of one notice uses the SAME Matrix transaction id (made from the event and the notice kind): a send whose answer was lost, sent again, is one event in the room, not two. The
 * notice is deleted only when Matrix gave it an event id (or there is nobody to tell: not a person's message, or the Brick is gone). A send that fails is tried again later, backing off,
 * for as long as it takes; a notice still not out after a day is reported (once) and stays. Nothing paid for runs to send it: it is a fixed note, never a model turn.
 */

export const OUTBOX_KEY = 'matrix:outbox';
export const OUTBOX_PREFIX = 'matrix:outbox:';
/** Where the Matrix event id of a notice that got out is kept, for a while: the receipt. */
export const OUTBOX_SENT_PREFIX = 'matrix:outbox-sent:';
export const OUTBOX_SENT_SECONDS = 7 * 24 * 60 * 60;
/** How long one send holds a notice: another server does not send it meanwhile (if it did, the same transaction id would still make one event). */
export const NOTICE_LEASE_MS = 2 * 60 * 1000;
/** The first wait after a failed send; it doubles with each failure, up to the longest wait. */
export const NOTICE_RETRY_MS = 30 * 1000;
export const NOTICE_RETRY_MAX_MS = 10 * 60 * 1000;
/** A notice still not out this long after it was written is reported (once), and stays. */
export const NOTICE_OVERDUE_MS = 24 * 60 * 60 * 1000;
/** How many due notices one look takes. */
export const NOTICE_BATCH = 50;

/** The Matrix transaction id of a notice: the same for every send of it, at every server. */
export function noticeTxnId(eventId: string, why: string): string {
    return `notice-${createHash('sha256').update(`gave-up|${eventId}|${why}`).digest('hex').slice(0, 40)}`;
}

/**
 * The Lua that writes a notice, for the inbox scripts that close an entry (they include it). KEYS[11] is the notice, KEYS[12] the outbox's index. Written only once per event (a closure
 * repeated after its answer was lost does not write it again), and only when the event is still there to say where it goes.
 */
export const WRITE_NOTICE = `local function notice(why, kept, id, now)
  if not kept or string.sub(kept, 1, 1) == '!' then
    return
  end
  if redis.call('EXISTS', KEYS[11]) == 1 then
    return
  end
  redis.call('HSET', KEYS[11], 'why', why, 'kept', kept, 'at', tostring(now), 'tries', '0')
  redis.call('ZADD', KEYS[12], tonumber(now), id)
end
`;

/**
 * Takes a notice for one send: `nil` when there is none (it got out, or there was never one) or when it is not due (another send holds it, or it waits after a failure). Counts the try, and
 * holds it for the lease. ARGV: id, now, lease end, the send's token.
 */
const CLAIM = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return nil
end
local due = redis.call('ZSCORE', KEYS[2], ARGV[1])
if due and tonumber(due) > tonumber(ARGV[2]) then
  return nil
end
local tries = redis.call('HINCRBY', KEYS[1], 'tries', 1)
redis.call('HSET', KEYS[1], 'claim', ARGV[4])
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[1])
return { redis.call('HGET', KEYS[1], 'why') or '', redis.call('HGET', KEYS[1], 'kept') or '', redis.call('HGET', KEYS[1], 'at') or '', tostring(tries) }
`;
/** The notice got out (Matrix gave it an event id, ARGV[2]; empty when there was nobody to tell): it goes, and the receipt is kept a while. */
const SENT = `
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
if ARGV[2] ~= '' then
  redis.call('SET', KEYS[3], ARGV[2], 'EX', tonumber(ARGV[3]))
end
return 1
`;
/**
 * The send failed (or Matrix gave no event id): the notice stays and waits until ARGV[3], only while this send still holds it. Answers `2` the first time it is found overdue (it is reported
 * once), `1` otherwise, `0` when it is not this send's any more.
 */
const LATER = `
if redis.call('HGET', KEYS[1], 'claim') ~= ARGV[2] then
  return 0
end
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[1])
local at = tonumber(redis.call('HGET', KEYS[1], 'at') or ARGV[4]) or tonumber(ARGV[4])
if tonumber(ARGV[4]) - at >= tonumber(ARGV[5]) and redis.call('HSETNX', KEYS[1], 'reported', '1') == 1 then
  return 2
end
return 1
`;
/** The notices due now, oldest first. */
const DUE = `
return redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
`;

/** One send of a notice, taken from the outbox. */
export interface ClaimedNotice {
    eventId: string;
    why: ClosedWhy;
    /** The event the notice answers, as the inbox kept it. */
    event: unknown;
    /** The Matrix transaction id every send of this notice uses. */
    txnId: string;
    /** How many sends were tried, this one included (1 on the first). */
    tries: number;
    /** It got out (`receipt`: the event id Matrix gave it), or there is nobody to tell: the notice goes. Never throws. */
    sent(receipt?: string): Promise<void>;
    /** It did not get out: it stays, and is tried again later. Never throws. */
    later(): Promise<void>;
}

export interface NoticeOutbox {
    /** Takes a notice for one send: `null` when there is none, it is not due, or the store did not answer (the next look finds it). Never throws. */
    claim(eventId: string): Promise<ClaimedNotice | null>;
    /** The ids of the notices due now. Never throws. */
    due(): Promise<string[]>;
}

type Client = Pick<EvidenceRedis, 'eval'>;

export function createNoticeOutbox(
    client: () => Client | null,
    options: {
        leaseMs?: number;
        retryMs?: number;
        retryMaxMs?: number;
        overdueMs?: number;
        batch?: number;
        deadlineMs?: number;
        now?: () => number;
        log?: (message: string, detail?: unknown) => void;
    } = {}
): NoticeOutbox {
    const leaseMs = options.leaseMs ?? NOTICE_LEASE_MS;
    const retryMs = options.retryMs ?? NOTICE_RETRY_MS;
    const retryMaxMs = Math.max(options.retryMaxMs ?? NOTICE_RETRY_MAX_MS, retryMs);
    const overdueMs = options.overdueMs ?? NOTICE_OVERDUE_MS;
    const batch = options.batch ?? NOTICE_BATCH;
    const deadlineMs = options.deadlineMs ?? 3000;
    const now = options.now ?? Date.now;
    const say = options.log ?? ((message: string, detail?: unknown) => console.warn(`[MatrixOutbox] ${message}`, detail instanceof Error ? detail.message : detail));
    const keysOf = (eventId: string) => [`${OUTBOX_PREFIX}${eventId}`, OUTBOX_KEY, `${OUTBOX_SENT_PREFIX}${eventId}`];
    const run = async (redis: Client, script: string, keys: string[], args: string[]): Promise<unknown> => {
        let timer: NodeJS.Timeout | undefined;
        try {
            const late = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), deadlineMs);
                timer.unref?.();
            });
            return await Promise.race([redis.eval(script, { keys, arguments: args }), late]);
        } finally {
            clearTimeout(timer);
        }
    };

    return {
        claim: async (eventId) => {
            const redis = client();
            if (!redis || !eventId) return null;
            const token = randomUUID();
            let read: unknown;
            try {
                read = await run(redis, CLAIM, keysOf(eventId), [eventId, String(now()), String(now() + leaseMs), token]);
            } catch (error) {
                say('Could not take a notice to send; the next look sends it:', error);
                return null;
            }
            if (!Array.isArray(read)) return null;
            const [why, kept, , triesText] = read.map(String);
            const tries = Number(triesText) || 1;
            let event: unknown;
            try {
                const parsed = JSON.parse(kept) as unknown;
                event = typeof parsed === 'object' && parsed !== null && 'event' in parsed ? (parsed as { event: unknown }).event : parsed;
            } catch {
                event = undefined;
            }
            const sent = async (receipt?: string): Promise<void> => {
                await run(redis, SENT, keysOf(eventId), [eventId, receipt ?? '', String(OUTBOX_SENT_SECONDS)]).catch((error) =>
                    // The notice stays: a later look sends it again under the same transaction id, which Matrix answers with the same event
                    say('Could not mark a notice as sent; it may be sent again under the same transaction id:', error)
                );
            };
            if (event === undefined) {
                // Nothing says where it goes: it can never be sent. Said, and dropped
                say('A notice whose event cannot be read is dropped:', eventId);
                await sent();
                return null;
            }
            return {
                eventId,
                why: why as ClosedWhy,
                event,
                txnId: noticeTxnId(eventId, why),
                tries,
                sent,
                later: async () => {
                    const wait = Math.min(retryMs * 2 ** Math.min(Math.max(tries - 1, 0), 20), retryMaxMs);
                    const answer = await run(redis, LATER, keysOf(eventId), [eventId, token, String(now() + wait), String(now()), String(overdueMs)]).catch((error) => {
                        // The lease runs out by itself, and the next look after it sends the notice again
                        say('Could not put a notice back to be sent later; it is sent again once its lease ends:', error);
                        return 1;
                    });
                    if (answer === 2 || answer === '2') {
                        console.error(`[MatrixOutbox] A notice to a person is still not out after ${Math.round(overdueMs / 3_600_000)} h; it stays and is tried again: ${eventId}`);
                        try {
                            Sentry.captureMessage('A notice to a person is still not out', { level: 'error', tags: { area: 'matrix-outbox', why } });
                        } catch {
                            /* a report is never in the way */
                        }
                    }
                },
            };
        },
        due: async () => {
            const redis = client();
            if (!redis) return [];
            try {
                const ids = await run(redis, DUE, [OUTBOX_KEY], [String(now()), String(batch)]);
                return Array.isArray(ids) ? ids.map(String) : [];
            } catch (error) {
                say('Could not look for notices to send:', error);
                return [];
            }
        },
    };
}
