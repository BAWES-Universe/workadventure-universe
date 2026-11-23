import { randomUUID } from 'crypto';
import type { EvidenceRedis } from '../server/ComputerEvidenceStore';
import { withoutKeys } from './KeyInChat';

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
/** Where an event came in, in the order this process took them: microseconds of the clock, and never less than one more than the stamp before it, so any number of events taken in one millisecond (or after the clock stepped back) keep their order. */
let lastArrival = 0;
const arrivalOf = (): number => {
    lastArrival = Math.max(Date.now() * 1000, lastArrival + 1);
    return lastArrival;
};
/** How many times a give-back that the store did not take is tried again before it is left. */
export const GIVE_BACK_TRIES = 8;
/** How many stale entries one scan takes. */
export const RECOVER_BATCH = 50;

/**
 * Every script that changes an entry names the TOKEN of one acquisition (a new one each time a server takes an event in or takes it over, never the server's own name): a handle whose
 * entry was recovered (even by the same server) can neither beat it, mark it paid, finish it, give it back nor undo it. The token is matched whole, up to the bar that ends it.
 */
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
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[2]))
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[4])
return 1
`;
/**
 * Something the person pays for has BEGUN (Opus G6R-2): the entry is marked `p|<owner>|<tries>|$`, only while it is still this server's. A server that dies after this point leaves an entry
 * no other server hands out again (the turn may have charged them already): it is closed as done, so the person is never charged twice for one message.
 */
const PAID = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
if string.sub(held, -2) == '|$' then
  return 1
end
redis.call('SET', KEYS[1], held .. '|$', 'EX', tonumber(ARGV[2]))
return 1
`;
/** Handled: the entry becomes `d` for a day and leaves the inbox, only while it is still this server's. */
const DONE = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
redis.call('ZREM', KEYS[2], ARGV[3])
redis.call('DEL', KEYS[3])
return 1
`;
/**
 * Given back for another try (nothing of it was paid for): the entry keeps its place in the inbox with no owner and the oldest score, so the next scan anywhere takes it. Once it has had
 * all its tries it becomes `d` instead: an event that throws every time must not go round for ever. It is only ever called for work that did NOT begin, so a paid mark on the entry
 * (`|$`: a write of the fence that the store did not confirm to this server, so the work was never started) is taken off with it, and the tries counted are kept.
 */
const RELEASE = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
local tries = tonumber(string.match(held, '|(%d+)$')) or tonumber(string.match(held, '|(%d+)|%$$')) or 1
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
 * Taken back out of the inbox as if it had never been taken (Opus G6R-1): the transaction it came with was refused (a later event could not be kept), so the transaction Synapse sends
 * again takes every event in afresh, in order. Only while the entry is still this server's and nothing of it was paid for.
 */
const UNDO = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' or string.sub(held, -2) == '|$' then
  return 0
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[3])
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
local paid = string.sub(held, -2) == '|$'
local owner = string.match(held, '^p|(.-)|%d+$')
if paid then
  owner = string.match(held, '^p|(.-)|%d+|%$$')
end
local tries = tonumber(string.match(held, '|(%d+)$')) or tonumber(string.match(held, '|(%d+)|%$$')) or 1
local score = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[4]) or 0)
if owner ~= '-' and score > tonumber(ARGV[5]) then
  return nil
end
-- Something was paid for before its owner went away: it is closed, never handed out again (no second charge, no second answer)
if paid then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('DEL', KEYS[3])
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

/** The fence before paid work was not confirmed: the event is not this server's to answer (or the store could not say), so nothing paid for begins. Not an answer failed, and no note is sent. */
export class PaidFenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PaidFenceError';
    }
}

/** An event this server holds: it says it is still working by itself, and ends one way or the other. Never throws. */
export interface InboxEntry {
    /** Handled (whatever came of the handling): no other server takes it, and a redelivery is not handled again. */
    done(): Promise<void>;
    /** Nothing of it was paid for and it threw: it goes back for another try, at most a few times. */
    release(): Promise<void>;
    /** The transaction this event came in was refused, so it is taken back out as if never taken and the resend takes it in afresh (a failed step leaves it to be recovered instead). */
    undo(): Promise<void>;
    /** Something the person pays for is about to begin: written down BEFORE it does, so a server that dies in the middle never has it handled again by another. Throws `PaidFenceError` when it could not be written down (the event is another server's now, or the store did not answer): nothing paid for may begin then. */
    paid(): Promise<void>;
}

/** What the inbox answers when an event arrives: an entry when this server is to handle it, `false` when it is already held or was handled. */
export type Taken = false | InboxEntry;

export interface EventInbox {
    /** Takes the event in before Matrix is answered. Throws only when the store could not be reached (the router then answers Matrix that it must send it again). */
    take(eventId: string, event: unknown): Promise<Taken>;
    /** The entries whose owner went away, with the event each one holds and where it came in (`arrived`: kept with the event when it was taken, so events that share a time come back in the order they arrived): this server now holds them. Never throws. */
    recover(): Promise<Array<{ event: unknown; entry: InboxEntry; arrived?: number }>>;
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
    options: { owner?: string; expected?: () => boolean; ttlSeconds?: number; beatEveryMs?: number; staleMs?: number; deadlineMs?: number; maxTries?: number; batch?: number; log?: (message: string, detail?: unknown) => void } = {}
): EventInbox {
    const owner = options.owner ?? randomUUID();
    /** Whether a shared store is expected for this server (it was set up): then a store that is not connected means events cannot be kept, and the transaction is refused. */
    const expected = options.expected ?? (() => false);
    /** A new token for each time this server holds an event: it names the acquisition, not the server. */
    const tokenOf = (): string => `${owner}:${randomUUID()}`;
    const ttlSeconds = options.ttlSeconds ?? EVENT_SEEN_SECONDS;
    const beatEveryMs = options.beatEveryMs ?? BEAT_EVERY_MS;
    const staleMs = options.staleMs ?? BEAT_STALE_MS;
    const deadlineMs = options.deadlineMs ?? INBOX_DEADLINE_MS;
    const maxTries = options.maxTries ?? MAX_TRIES;
    const batch = options.batch ?? RECOVER_BATCH;
    const say = options.log ?? ((message: string, detail?: unknown) => console.warn(`[MatrixInbox] ${message}`, detail instanceof Error ? detail.message : detail));
    /** An entry that holds nothing: the store is not connected, so the event is handled and nothing is remembered. */
    const nothing: InboxEntry = { done: async () => undefined, release: async () => undefined, undo: async () => undefined, paid: async () => undefined };

    const keysOf = (eventId: string) => [`${EVENT_SEEN_PREFIX}${eventId}`, INBOX_KEY, `${INBOX_EVENT_PREFIX}${eventId}`];
    /** Any single call to the store against the same deadline. */
    const within = async <T>(call: Promise<T>): Promise<T> => {
        let timer: NodeJS.Timeout | undefined;
        try {
            const late = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), deadlineMs);
                timer.unref?.();
            });
            return await Promise.race([call, late]);
        } finally {
            clearTimeout(timer);
        }
    };
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
    const entryOf = (redis: Client, eventId: string, token: string): InboxEntry => {
        const beat = setInterval(() => {
            void step(redis, BEAT, eventId, [token, String(ttlSeconds), String(Date.now()), eventId]).catch((error) => say('Could not say an event is still being handled:', error));
        }, beatEveryMs);
        beat.unref?.();
        let over = false;
        const end = async (script: string, args: string[], what: string): Promise<void> => {
            if (over) return;
            over = true;
            clearInterval(beat);
            await step(redis, script, eventId, args).catch((error) => say(`Could not mark an event as ${what}; it is taken up again by another server:`, error));
        };
        /**
         * Given back for another try. When the store does not take it, the entry keeps beating and the give-back is tried again (a few times, a beat apart) instead of being left: a paid mark
         * that the store wrote but never confirmed to this server stands on an entry whose work never began, and an entry that went quiet with that mark on it would be closed by another server
         * as paid work, and the person's message lost. Only a server that dies before the store takes it back leaves that mark standing.
         */
        const giveBack = async (): Promise<void> => {
            if (over) return;
            over = true;
            const attempt = (): Promise<boolean> =>
                step(redis, RELEASE, eventId, [token, String(ttlSeconds), String(maxTries), eventId]).then(
                    () => true,
                    (error) => {
                        say('Could not give an event back for another try:', error);
                        return false;
                    }
                );
            if (await attempt()) {
                clearInterval(beat);
                return;
            }
            let tried = 1;
            let running = false;
            const again = setInterval(() => {
                if (running) return;
                running = true;
                void attempt()
                    .then((given) => {
                        tried += 1;
                        if (given || tried >= GIVE_BACK_TRIES) {
                            clearInterval(again);
                            clearInterval(beat);
                            if (!given) say('Gave up giving an event back; it is taken up again by another server (or closed, if it carries a paid mark):', eventId);
                        }
                    })
                    .finally(() => {
                        running = false;
                    });
            }, beatEveryMs);
            again.unref?.();
        };
        return {
            done: () => end(DONE, [token, String(ttlSeconds), eventId], 'handled'),
            release: giveBack,
            undo: () => end(UNDO, [token, eventId], 'taken back'),
            // Awaited before the first paid call, and it must SUCCEED: when it does not (another server holds the event now, or the store did not answer) it throws, and nothing paid for
            // begins. The event then goes back for another try, as one that nothing was paid for
            paid: async () => {
                if (over) throw new PaidFenceError('The event had already ended here');
                let answer: unknown;
                try {
                    answer = await step(redis, PAID, eventId, [token, String(ttlSeconds)]);
                } catch (error) {
                    say('Could not write down that an event began paid work; it is not started:', error);
                    throw new PaidFenceError('The shared store did not confirm that paid work began');
                }
                if (answer !== 1 && answer !== '1') throw new PaidFenceError('Another server holds this event now');
            },
        };
    };

    return {
        owner,
        take: async (eventId, event) => {
            if (!eventId) return nothing;
            const redis = client();
            if (!redis) {
                // The store is expected (it is set up for this server) and not connected: the event is NOT acknowledged as kept. The router answers Matrix that the transaction must come
                // again, so nothing that this process then loses was ever promised
                if (expected()) throw new Error('The shared store is expected but not connected');
                return nothing;
            }
            const token = tokenOf();
            // What is written to the store holds no key: a key typed into the chat never reaches Redis, and the entry says only that one was there (the Brick refuses it as it would live)
            const kept = JSON.stringify({ arrived: arrivalOf(), event: withoutKeys(event) });
            const took = await step(redis, TAKE, eventId, [token, String(ttlSeconds), String(Date.now()), kept, eventId]);
            if (took === 0 || took === '0') return false;
            return entryOf(redis, eventId, token);
        },
        recover: async () => {
            const redis = client();
            if (!redis || !redis.zRangeByScore) return [];
            const found: Array<{ event: unknown; entry: InboxEntry; arrived?: number }> = [];
            try {
                const cutoff = Date.now() - staleMs;
                // The oldest beats first. The scan is bounded by the same deadline as every step: a store that accepts the call and never answers ends it, and the next look is a new one
                const stale = await within(redis.zRangeByScore(INBOX_KEY, 0, cutoff, { LIMIT: { offset: 0, count: batch } }));
                for (const eventId of stale) {
                    const token = tokenOf();
                    // eslint-disable-next-line no-await-in-loop
                    const payload = await step(redis, TAKEOVER, eventId, [token, String(ttlSeconds), String(Date.now()), eventId, String(cutoff), String(maxTries)]).catch((error) => {
                        say('Could not take over an event left by another server:', error);
                        return null;
                    });
                    if (typeof payload !== 'string') continue;
                    try {
                        const read = JSON.parse(payload) as { arrived?: unknown; event?: unknown };
                        // Entries are kept as `{ arrived, event }`; one kept bare (before that) is the event itself
                        const wrapped = typeof read === 'object' && read !== null && 'event' in read;
                        const arrived = wrapped && typeof read.arrived === 'number' ? read.arrived : undefined;
                        found.push({ event: wrapped ? read.event : read, entry: entryOf(redis, eventId, token), ...(arrived === undefined ? {} : { arrived }) });
                    } catch (error) {
                        say('An event left by another server could not be read; it is dropped:', error);
                        // eslint-disable-next-line no-await-in-loop
                        await step(redis, DONE, eventId, [token, String(ttlSeconds), eventId]).catch(() => undefined);
                    }
                }
            } catch (error) {
                say('Could not look for events left by another server:', error);
            }
            return found;
        },
    };
}
