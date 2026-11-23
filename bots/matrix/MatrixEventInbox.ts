import { randomUUID } from 'crypto';
import type { EvidenceRedis } from '../server/ComputerEvidenceStore';

/**
 * The durable inbox of Matrix events (GPT's sixth answer, finding 9; Opus's design of 23 Nov, section 9).
 *
 * Matrix is acknowledged before an event is handled (a reply takes far longer than the transaction may), so the event has to be KEPT before that answer goes out, not merely marked as seen:
 * a server that dies in the middle must leave the event for another server to pick up, and a marker alone would make the redelivery look like a duplicate and lose the person's message.
 *
 * One entry per event, in the shared store (prod Redis has persistence):
 * - `matrix:event:<id>` holds its state: `p|<owner>|<tries>` while it is being handled, `d` once it is done (for a day, so a redelivery is not handled twice);
 * - `matrix:inbox` (a sorted set) holds the ids being handled, scored by the owner's last beat, so another server can find one whose owner went away;
 * - `matrix:inbox:<id>` holds the event itself, so the server that picks it up has what it needs (a day).
 *
 * Every step that changes an entry is one script, conditional on the owner it names: a server that comes back after its entry was taken can neither clear nor finish another server's work.
 */

/** How long a done event is remembered: Matrix sends a transaction again for far less, and a restart finds its events again within minutes. */
export const EVENT_SEEN_SECONDS = 24 * 60 * 60;
export const EVENT_SEEN_PREFIX = 'matrix:event:';
export const INBOX_KEY = 'matrix:inbox';
export const INBOX_EVENT_PREFIX = 'matrix:inbox:';
/** How often the owner says it is still working, and how long after its last beat another server may take the entry. */
export const BEAT_EVERY_MS = 30 * 1000;
export const BEAT_STALE_MS = 2 * 60 * 1000;
/** How often a server looks for entries whose owner went away. */
export const RECOVER_EVERY_MS = 30 * 1000;
/** How many times an event may be taken up at all (the first time, and the tries after a handler that threw before anything was paid for or a server that went away). */
export const MAX_TRIES = 3;
/** How long the shared store has to answer: the router waits for the first step before it answers Matrix, so it can never wait long. */
export const INBOX_DEADLINE_MS = 3000;
/** How many stale entries one scan takes. */
export const RECOVER_BATCH = 50;

/** Takes the event into the inbox: `1` when this server holds it now, `0` when it is already held or was handled. */
const TAKE = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], 'p|' .. ARGV[1] .. '|1', 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[3], ARGV[4], 'EX', tonumber(ARGV[2]))
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[5])
return 1
`;
/** Still working: the entry's score moves to now, only while it is still this server's. */
const BEAT = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 2 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] then
  return 0
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[2]))
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[4])
return 1
`;
/** Handled: the entry becomes `d` for a day and leaves the inbox, only while it is still this server's. */
const DONE = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 2 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
redis.call('ZREM', KEYS[2], ARGV[3])
redis.call('DEL', KEYS[3])
return 1
`;
/**
 * Given back for another try (nothing of it was paid for): the entry keeps its place in the inbox with no owner and the oldest score, so the next scan anywhere takes it. Once it has had
 * all its tries it becomes `d` instead: an event that throws every time must not go round for ever.
 */
const RELEASE = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 2 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] then
  return 0
end
local tries = tonumber(string.match(held, '|(%d+)$')) or 1
if tries >= tonumber(ARGV[3]) then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('DEL', KEYS[3])
  return 2
end
redis.call('SET', KEYS[1], 'p|-|' .. tostring(tries), 'EX', tonumber(ARGV[2]))
redis.call('ZADD', KEYS[2], 0, ARGV[4])
return 1
`;
/**
 * Takes over an entry whose owner went away (it has no owner, or its last beat is older than the stale time): the event itself comes back with it, so this server can handle it. `nil`
 * when it is not there to take (it is done, gone, or its owner is alive).
 */
const TAKEOVER = `
local held = redis.call('GET', KEYS[1])
if not held or held == 'd' then
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('DEL', KEYS[3])
  return nil
end
local owner = string.match(held, '^p|(.-)|%d+$')
local tries = tonumber(string.match(held, '|(%d+)$')) or 1
local score = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[4]) or 0)
if owner ~= '-' and score > tonumber(ARGV[5]) then
  return nil
end
if tries >= tonumber(ARGV[6]) then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('DEL', KEYS[3])
  return nil
end
local payload = redis.call('GET', KEYS[3])
if not payload then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  return nil
end
redis.call('SET', KEYS[1], 'p|' .. ARGV[1] .. '|' .. tostring(tries + 1), 'EX', tonumber(ARGV[2]))
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[4])
return payload
`;

/** An event this server holds: it says it is still working by itself, and ends one way or the other. Never throws. */
export interface InboxEntry {
    /** Handled (whatever came of the handling): no other server takes it, and a redelivery is not handled again. */
    done(): Promise<void>;
    /** Nothing of it was paid for and it threw: it goes back for another try, at most a few times. */
    release(): Promise<void>;
}

/** What the inbox answers when an event arrives: an entry when this server is to handle it, `false` when it is already held or was handled. */
export type Taken = false | InboxEntry;

export interface EventInbox {
    /** Takes the event in before Matrix is answered. Throws only when the store could not be reached (the router then answers Matrix that it must send it again). */
    take(eventId: string, event: unknown): Promise<Taken>;
    /** The entries whose owner went away, with the event each one holds: this server now holds them. Never throws. */
    recover(): Promise<Array<{ event: unknown; entry: InboxEntry }>>;
    /** The name this server holds its entries under (for the tests). */
    readonly owner: string;
}

type Client = Pick<EvidenceRedis, 'eval'> & { zRangeByScore?: (key: string, min: number | string, max: number | string, options?: { LIMIT?: { offset: number; count: number } }) => Promise<string[]> };

/**
 * The inbox over the shared store. With the store NOT CONNECTED every event is handled and nothing is remembered (as before: the key of a computer start, made from the event, is what
 * keeps a job from being made twice). With the store connected but failing, `take` throws: the router answers Matrix that the transaction must come again, so no message is lost.
 */
export function createEventInbox(
    client: () => Client | null,
    options: { owner?: string; ttlSeconds?: number; beatEveryMs?: number; staleMs?: number; deadlineMs?: number; maxTries?: number; batch?: number; log?: (message: string, detail?: unknown) => void } = {}
): EventInbox {
    const owner = options.owner ?? randomUUID();
    const ttlSeconds = options.ttlSeconds ?? EVENT_SEEN_SECONDS;
    const beatEveryMs = options.beatEveryMs ?? BEAT_EVERY_MS;
    const staleMs = options.staleMs ?? BEAT_STALE_MS;
    const deadlineMs = options.deadlineMs ?? INBOX_DEADLINE_MS;
    const maxTries = options.maxTries ?? MAX_TRIES;
    const batch = options.batch ?? RECOVER_BATCH;
    const say = options.log ?? ((message: string, detail?: unknown) => console.warn(`[MatrixInbox] ${message}`, detail instanceof Error ? detail.message : detail));
    /** An entry that holds nothing: the store is not connected, so the event is handled and nothing is remembered. */
    const nothing: InboxEntry = { done: async () => undefined, release: async () => undefined };

    const keysOf = (eventId: string) => [`${EVENT_SEEN_PREFIX}${eventId}`, INBOX_KEY, `${INBOX_EVENT_PREFIX}${eventId}`];
    /** One step in the store against a deadline that rejects: a store that never answers must not hold the room. */
    const step = async (redis: Client, script: string, eventId: string, args: string[]): Promise<unknown> => {
        let timer: NodeJS.Timeout | undefined;
        try {
            const late = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), deadlineMs);
                timer.unref?.();
            });
            return await Promise.race([redis.eval(script, { keys: keysOf(eventId), arguments: args }), late]);
        } finally {
            clearTimeout(timer);
        }
    };

    /** An entry this server holds: it beats while it is held, and the beat stops when it ends. */
    const entryOf = (redis: Client, eventId: string): InboxEntry => {
        const beat = setInterval(() => {
            void step(redis, BEAT, eventId, [owner, String(ttlSeconds), String(Date.now()), eventId]).catch((error) => say('Could not say an event is still being handled:', error));
        }, beatEveryMs);
        beat.unref?.();
        let over = false;
        const end = async (script: string, args: string[], what: string): Promise<void> => {
            if (over) return;
            over = true;
            clearInterval(beat);
            await step(redis, script, eventId, args).catch((error) => say(`Could not mark an event as ${what}; it is taken up again by another server:`, error));
        };
        return {
            done: () => end(DONE, [owner, String(ttlSeconds), eventId], 'handled'),
            release: () => end(RELEASE, [owner, String(ttlSeconds), String(maxTries), eventId], 'to be tried again'),
        };
    };

    return {
        owner,
        take: async (eventId, event) => {
            if (!eventId) return nothing;
            const redis = client();
            if (!redis) return nothing;
            const took = await step(redis, TAKE, eventId, [owner, String(ttlSeconds), String(Date.now()), JSON.stringify(event), eventId]);
            if (took === 0 || took === '0') return false;
            return entryOf(redis, eventId);
        },
        recover: async () => {
            const redis = client();
            if (!redis || !redis.zRangeByScore) return [];
            const found: Array<{ event: unknown; entry: InboxEntry }> = [];
            try {
                const cutoff = Date.now() - staleMs;
                // The oldest beats first, so the events of a room come back in the order they arrived
                const stale = await redis.zRangeByScore(INBOX_KEY, 0, cutoff, { LIMIT: { offset: 0, count: batch } });
                for (const eventId of stale) {
                    // eslint-disable-next-line no-await-in-loop
                    const payload = await step(redis, TAKEOVER, eventId, [owner, String(ttlSeconds), String(Date.now()), eventId, String(cutoff), String(maxTries)]).catch((error) => {
                        say('Could not take over an event left by another server:', error);
                        return null;
                    });
                    if (typeof payload !== 'string') continue;
                    try {
                        found.push({ event: JSON.parse(payload), entry: entryOf(redis, eventId) });
                    } catch (error) {
                        say('An event left by another server could not be read; it is dropped:', error);
                        // eslint-disable-next-line no-await-in-loop
                        await step(redis, DONE, eventId, [owner, String(ttlSeconds), eventId]).catch(() => undefined);
                    }
                }
            } catch (error) {
                say('Could not look for events left by another server:', error);
            }
            return found;
        },
    };
}
