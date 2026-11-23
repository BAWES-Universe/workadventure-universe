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
 * - `matrix:event:<id>` holds its state: `p|<owner>|<tries>` while it is being handled (with NO expiry: unfinished work never lapses, GPT's seventh note G2), `d` once it is done (for a
 *   day, so a redelivery is not handled twice: only this completed record expires);
 * - `matrix:inbox` (a sorted set) holds the ids being handled, scored by the owner's last beat, so another server can find one whose owner went away;
 * - `matrix:inbox:<id>` holds the event itself, so the server that picks it up has what it needs (no expiry while the entry is unfinished; it goes when the entry ends);
 * - `matrix:room-order:<room>` (a sorted set) holds the unfinished events of one room, scored by a store-wide count taken when each was taken in (`matrix:inbox-seq`): a later event of
 *   the room is not handled while an earlier one is still unfinished, at this server or at any other (GPT's seventh note G1). Other rooms go on.
 *
 * Every step that changes an entry is one script, conditional on the owner it names: a server that comes back after its entry was taken can neither clear nor finish another server's work.
 */

/** How long a done event is remembered: Matrix sends a transaction again for far less, and a restart finds its events again within minutes. Only DONE records expire: an unfinished entry never does. */
export const EVENT_SEEN_SECONDS = 24 * 60 * 60;
export const EVENT_SEEN_PREFIX = 'matrix:event:';
export const INBOX_KEY = 'matrix:inbox';
export const INBOX_EVENT_PREFIX = 'matrix:inbox:';
/** The unfinished events of one room, in the order they were taken in (see the top of this file). */
export const ROOM_ORDER_PREFIX = 'matrix:room-order:';
/** The store-wide count that orders the events of a room as they were taken in, whichever server took them. */
export const INBOX_SEQ_KEY = 'matrix:inbox-seq';
/** How many earlier events of a room one look at its order goes through (a longer queue is looked at again). */
export const ROOM_LOOK = 50;
/**
 * Whether the transaction an event came in was kept whole (CodeRabbit on 24dea75c, findings 1 and 2): `0` from the take, `1` once ADMIT confirmed it. Never set by a lapse: a duplicate is
 * skipped only for an admitted entry, an UNDO never deletes one, and recovery never hands out one that is not. An entry with no such key was taken by an older server: its open mark says.
 */
export const INBOX_ADMITTED_PREFIX = 'matrix:inbox-admitted:';
/** The mark an UNDO leaves in the event's place in its room: Synapse sends the transaction again, and until then the later events of the room wait for it (a while at most). */
export const INBOX_RESEND_PREFIX = 'matrix:inbox-resend:';
export const RESEND_WAIT_SECONDS = 10 * 60;
/** The link from an event to the reply that answered it (see `ANSWERED`). */
export const INBOX_ANSWER_PREFIX = 'matrix:inbox-answer:';
/** An unfinished entry taken in longer ago than this is closed by the scan, never run late: the person is told to send it again (that is the fresh consent). */
export const UNFINISHED_MAX_MS = 24 * 60 * 60 * 1000;
/** How long an entry closed as UNANSWERED (`u`) is kept, with its event: the recoverable status of a DM nobody answered. */
export const UNANSWERED_SECONDS = 7 * 24 * 60 * 60;
/** The mark that the transaction an event came in is still being taken in (see `TAKE`). */
export const INBOX_OPEN_PREFIX = 'matrix:inbox-open:';
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
/** After how many calls that the store did not answer a give-back says (once) that it is still trying: it never stops while the process lives. */
export const GIVE_BACK_TRIES = 8;
/** How many stale entries one scan takes. */
export const RECOVER_BATCH = 50;

/**
 * Every script that changes an entry names the TOKEN of one acquisition (a new one each time a server takes an event in or takes it over, never the server's own name): a handle whose
 * entry was recovered (even by the same server) can neither beat it, mark it paid, finish it, give it back nor undo it. The token is matched whole, up to the bar that ends it.
 */
/**
 * Whether an entry is ADMITTED (its transaction was kept whole), as every script reads it: the admitted key says (`1` or `0`), and an entry that already ran (given back, or paid) is. An entry
 * with no admitted key was taken by a server of the version before: its open mark (KEYS[4]) says, as it did there.
 */
const ADM = `local function admitted(held)
  if string.sub(held, -2) == '|$' or string.sub(held, 1, 4) == 'p|-|' then
    return true
  end
  local mark = redis.call('GET', KEYS[8])
  if mark == '1' then
    return true
  end
  if mark == '0' then
    return false
  end
  return redis.call('EXISTS', KEYS[4]) == 0
end
`;
/**
 * Takes the event into the inbox, and gives it its place in its room when it has one (ARGV[7]). Answers:
 * - `0` when it was handled or closed, or is held and ADMITTED (its transaction was kept whole: KEYS[8]): a duplicate is skipped;
 * - `2` when it is held, NOT admitted, and its intake still beats (within the stale time, ARGV[8]): that intake can still fail and take it back out, so the duplicate must not be answered
 *   as kept (busy: the router answers 500 and Synapse sends it again);
 * - `1` when this server holds it now: a new event, or one held and not admitted whose intake went quiet (it is taken afresh under this token; the intake that went quiet can no longer
 *   admit it nor take it out).
 * Until it is admitted the entry lapses with the done records' time (ARGV[2]): Synapse never had a 200 for it and sends it again. ADMIT takes the expiry off (G2).
 * The OPEN mark (KEYS[4], ARGV[6] seconds) is still written for servers of the version before, which read it instead of the admitted key.
 */
const TAKE = `
${ADM}local held = redis.call('GET', KEYS[1])
if held then
  if held == 'd' or held == 'u' or admitted(held) then
    return 0
  end
  local beat = redis.call('ZSCORE', KEYS[2], ARGV[5])
  if beat and tonumber(beat) > tonumber(ARGV[8]) then
    return 2
  end
end
redis.call('SET', KEYS[1], 'p|' .. ARGV[1] .. '|1', 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[3], ARGV[4], 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[8], '0', 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[4], '1', 'EX', tonumber(ARGV[6]))
redis.call('DEL', KEYS[9])
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[5])
-- Its place in its room, after every event of the room taken in before it (anywhere). An event taken again after its transaction was refused keeps the place it had
if ARGV[7] == '1' and not redis.call('ZSCORE', KEYS[5], ARGV[5]) then
  redis.call('ZADD', KEYS[5], redis.call('INCR', KEYS[7]), ARGV[5])
end
return 1
`;
/**
 * The transaction this event came in has kept all its events: the entry is ADMITTED (for good, never by a lapse), its expiry is taken off (an unfinished entry never lapses, G2) and the open
 * mark goes. Only while the entry is still this acquisition's: `0` otherwise, and the caller must not answer Matrix as if the event were kept (CodeRabbit on 24dea75c, finding 3).
 */
const ADMIT = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
redis.call('SET', KEYS[8], '1')
redis.call('PERSIST', KEYS[1])
redis.call('PERSIST', KEYS[3])
redis.call('DEL', KEYS[4])
return 1
`;
/** Still working: the entry's score moves to now, only while it is still this server's. An admitted entry has no expiry (one an older server put on it is taken off). */
const BEAT = `
${ADM}local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
if admitted(held) then
  redis.call('PERSIST', KEYS[1])
  redis.call('PERSIST', KEYS[3])
end
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[4])
-- an intake that is still going keeps its open mark
if redis.call('EXISTS', KEYS[4]) == 1 then
  redis.call('EXPIRE', KEYS[4], tonumber(ARGV[5]))
end
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
redis.call('SET', KEYS[1], held .. '|$')
return 1
`;
/** Handled: the entry becomes `d` for a day and leaves the inbox and its room's order, only while it is still this server's. */
const DONE = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
redis.call('ZREM', KEYS[2], ARGV[3])
redis.call('ZREM', KEYS[5], ARGV[3])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
redis.call('DEL', KEYS[6])
redis.call('DEL', KEYS[8])
return 1
`;
/**
 * Given back for another try (nothing of it was paid for): the entry keeps its place in the inbox with no owner and the oldest score, so the next scan anywhere takes it. Once it has had
 * all its tries it becomes `d` instead: an event that throws every time must not go round for ever. It is only ever called for work that did NOT begin, so a paid mark on the entry
 * (`|$`: a write of the fence that the store did not confirm to this server, so the work was never started) is taken off with it, and the tries counted are kept.
 */
const RELEASE = `
local held = redis.call('GET', KEYS[1])
-- This acquisition's own earlier give-back already closed the entry (its answer was lost): said again as closed, so the caller can report it. The mark is left in the event's slot when it closes
if held == 'd' and redis.call('GET', KEYS[3]) == '!closed|' .. ARGV[1] then
  return 2
end
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
local tries = tonumber(string.match(held, '|(%d+)$')) or tonumber(string.match(held, '|(%d+)|%$$')) or 1
redis.call('DEL', KEYS[4])
if tries >= tonumber(ARGV[3]) then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('ZREM', KEYS[5], ARGV[4])
  redis.call('DEL', KEYS[6])
  redis.call('DEL', KEYS[8])
  -- the event itself goes; what stays (for as long as the done mark) is only who closed it
  redis.call('SET', KEYS[3], '!closed|' .. ARGV[1], 'EX', tonumber(ARGV[2]))
  return 2
end
-- Still unfinished: no expiry, and it keeps its place in its room (the later events of the room wait for it)
redis.call('SET', KEYS[1], 'p|-|' .. tostring(tries))
redis.call('PERSIST', KEYS[3])
redis.call('ZADD', KEYS[2], 0, ARGV[4])
return 1
`;
/**
 * Taken back out of the inbox as if it had never been taken (Opus G6R-1): the transaction it came with was refused (a later event could not be kept), so the transaction Synapse sends
 * again takes every event in afresh, in order. Only while the entry is still this acquisition's (`0` otherwise), and NEVER an admitted one (CodeRabbit on 24dea75c, finding 1): that one
 * answers `2` and nothing of it is deleted, so the router handles it (a duplicate of it is already skipped). The event keeps its place in its room with a mark that it is to come again
 * (ARGV[3] seconds at most): a later event of the room that was kept does not run ahead of it.
 */
const UNDO = `
${ADM}local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
if admitted(held) then
  return 2
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
redis.call('DEL', KEYS[6])
redis.call('DEL', KEYS[8])
if redis.call('ZSCORE', KEYS[5], ARGV[2]) then
  redis.call('SET', KEYS[9], '1', 'EX', tonumber(ARGV[3]))
end
return 1
`;
/**
 * Takes over an entry whose owner went away (it has no owner, or its last beat is older than the stale time): the event itself comes back with it, so this server can handle it. `nil`
 * when it is not there to take (it is done or closed, it already left the inbox, or its owner is alive). An entry it CLOSES instead answers `!<why>|<event>`:
 * - `answered`: work had begun and the person's answer is proved (the link to the reply that answers this event, KEYS[6]): done, quietly;
 * - `paid`: work had begun and no answer is proved (an unsure look counts as none): never handed out again (no second charge), closed as UNANSWERED;
 * - `tries`: it had all its tries; `stale`: it was taken in more than a day ago (ARGV[7]), so it is never run late (the person sending it again is the fresh consent);
 * - `lost`: its state or its event lapsed (an older server kept unfinished entries with an expiry): closed and said, never dropped in silence.
 * UNANSWERED (`u`) is a terminal state kept with its event for ARGV[8] seconds (GPT's seventh note G2: a recoverable status for an unanswered DM): a redelivery is not handled again, and
 * the person is told once, by whoever got this answer.
 */
const TAKEOVER = `
${ADM}local held = redis.call('GET', KEYS[1])
if held == 'd' or held == 'u' then
  -- A closed entry keeps what is in the event's slot: it is the mark of the acquisition whose give-back closed it, which a retry of that give-back (its first answer was lost) still has to find
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('DEL', KEYS[8])
  return nil
end
local function unanswered(gone)
  redis.call('SET', KEYS[1], 'u', 'EX', tonumber(ARGV[8]))
  redis.call('ZREM', KEYS[2], ARGV[4])
  redis.call('ZREM', KEYS[5], ARGV[4])
  redis.call('DEL', KEYS[4])
  redis.call('DEL', KEYS[6])
  redis.call('DEL', KEYS[8])
  if gone then
    redis.call('SET', KEYS[3], gone, 'EX', tonumber(ARGV[8]))
  else
    redis.call('DEL', KEYS[3])
  end
end
if not held then
  -- Gone from the index meanwhile (it ended between the look and this step): nothing to say
  if not redis.call('ZSCORE', KEYS[2], ARGV[4]) then
    return nil
  end
  -- In the index with no state: the state lapsed. Said, with the event when it is still there
  local gone = redis.call('GET', KEYS[3])
  -- A closed entry's own mark (left in the event's slot by the give-back that closed it) is not an event that was lost: it only leaves the index
  if gone and string.sub(gone, 1, 8) == '!closed|' then
    redis.call('ZREM', KEYS[2], ARGV[4])
    redis.call('ZREM', KEYS[5], ARGV[4])
    return nil
  end
  unanswered(gone)
  return '!lost|' .. (gone or '')
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
-- Never handed out unless its transaction was kept whole (CodeRabbit on 24dea75c): Synapse never had a 200 for it and sends it again, and that take finds it. It leaves the scan's list
-- (it lapses with the done records' time if nothing comes)
if not admitted(held) then
  redis.call('ZREM', KEYS[2], ARGV[4])
  return nil
end
redis.call('DEL', KEYS[4])
-- Something was paid for before its owner went away: it is closed, never handed out again (no second charge, no second answer). The caller is told it was closed, and with what event, so the loss is not silent
if paid then
  local gone = redis.call('GET', KEYS[3])
  if redis.call('EXISTS', KEYS[6]) == 1 then
    redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
    redis.call('ZREM', KEYS[2], ARGV[4])
    redis.call('ZREM', KEYS[5], ARGV[4])
    redis.call('DEL', KEYS[3])
    redis.call('DEL', KEYS[6])
    redis.call('DEL', KEYS[8])
    return '!answered|' .. (gone or '')
  end
  unanswered(gone)
  return '!paid|' .. (gone or '')
end
if tries >= tonumber(ARGV[6]) then
  local gone = redis.call('GET', KEYS[3])
  unanswered(gone)
  return '!tries|' .. (gone or '')
end
local payload = redis.call('GET', KEYS[3])
if not payload then
  unanswered(nil)
  return '!lost|'
end
-- When it was taken in: the stamp kept with the event (microseconds), or the time Matrix gave it (an entry kept bare)
local ok, read = pcall(cjson.decode, payload)
local at = nil
if ok and type(read) == 'table' then
  if type(read.arrived) == 'number' then
    at = read.arrived / 1000
  elseif type(read.event) == 'table' and type(read.event.origin_server_ts) == 'number' then
    at = read.event.origin_server_ts
  elseif type(read.origin_server_ts) == 'number' then
    at = read.origin_server_ts
  end
end
if at and at < tonumber(ARGV[7]) then
  unanswered(payload)
  return '!stale|' .. payload
end
redis.call('SET', KEYS[1], 'p|' .. ARGV[1] .. '|' .. tostring(tries + 1))
redis.call('PERSIST', KEYS[3])
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[4])
return payload
`;
/**
 * The person's answer is out (Matrix gave the reply an id): the link to it is kept beside the entry, only while the entry is still this acquisition's. A server that takes the entry over
 * after paid work began reads it as the proof that the person was answered (GPT's seventh note G2): no "couldn't answer" note then. Nothing else proves an answer.
 */
const ANSWERED = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 0
end
redis.call('SET', KEYS[6], ARGV[2])
return 1
`;
/**
 * The gate of a room (GPT's seventh note G1): `1` when no earlier event of this room is unfinished (at any server), so this one may run; `0` when one is (this one waits, still held and
 * beating, and that is not a try); `2` when this entry is no longer this acquisition's. A member of the room's order whose state is gone or ended is taken out as it is met. Reads the state of
 * the earlier events by name (ARGV[3] .. id): the shared store is one Redis, not a cluster.
 */
const TURN = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' then
  return 2
end
local mine = redis.call('ZSCORE', KEYS[5], ARGV[2])
if not mine then
  return 1
end
local earlier = redis.call('ZRANGEBYSCORE', KEYS[5], '-inf', '(' .. mine, 'LIMIT', 0, tonumber(ARGV[4]))
for _, id in ipairs(earlier) do
  local state = redis.call('GET', ARGV[3] .. id)
  if state and string.sub(state, 1, 2) == 'p|' then
    return 0
  end
  -- taken back out with its transaction, which Synapse sends again: it keeps its place a while
  if redis.call('EXISTS', ARGV[5] .. id) == 1 then
    return 0
  end
  redis.call('ZREM', KEYS[5], id)
end
if #earlier >= tonumber(ARGV[4]) then
  return 0
end
return 1
`;
/**
 * A waiting entry given back at shutdown (it never ran): no owner, the oldest score, and its count of tries one less, so the server that takes it over counts it back to where it was.
 * Waiting was never a try. Only while it is still this acquisition's and nothing was paid for.
 */
const YIELD = `
local held = redis.call('GET', KEYS[1])
if not held or string.sub(held, 1, 3 + string.len(ARGV[1])) ~= 'p|' .. ARGV[1] .. '|' or string.sub(held, -2) == '|$' then
  return 0
end
local tries = tonumber(string.match(held, '|(%d+)$')) or 1
redis.call('SET', KEYS[1], 'p|-|' .. tostring(math.max(tries - 1, 0)))
redis.call('DEL', KEYS[4])
redis.call('ZADD', KEYS[2], 0, ARGV[2])
return 1
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
    /**
     * Nothing of it was paid for and it threw: it goes back for another try, at most a few times. Answers `closed` when that was its last try (nobody will take it again), `again` when it
     * was given back (or is not this server's any more), and `unsure` when the store did not answer (the give-back is tried again; `onClosed` runs if that later finds it was the last try).
     */
    release(onClosed?: () => void): Promise<'again' | 'closed' | 'unsure'>;
    /** After `release` answered `unsure`: settles when the retries of that give-back are over (the store took it, or the tries ran out), after `onClosed` ran. Otherwise nothing is pending. */
    givingBack?(): Promise<void> | undefined;
    /** False for the entry that holds nothing (the store is not connected): there is no durable copy and no other try. Absent: durable. */
    readonly durable?: boolean;
    /** The transaction this event came in has kept all its events: from now on a duplicate of the event is skipped, where before it was told `busy`. Throws unless the store confirmed it. */
    admit(): Promise<void>;
    /**
     * The transaction this event came in was refused, so it is taken back out as if never taken and the resend takes it in afresh: `undone`. NEVER an admitted entry (its admit committed and
     * the answer was lost): `admitted`, nothing is taken out, the entry stays held, and the caller handles it. `gone`: not this acquisition's any more. `unsure`: the store did not answer
     * (it is left to be taken up again: by recovery when admitted, by Synapse's resend when not).
     */
    undo(): Promise<'undone' | 'admitted' | 'gone' | 'unsure'>;
    /** Something the person pays for is about to begin: written down BEFORE it does, so a server that dies in the middle never has it handled again by another. Throws `PaidFenceError` when it could not be written down (the event is another server's now, or the store did not answer): nothing paid for may begin then. */
    paid(): Promise<void>;
    /**
     * The gate of the event's room (GPT's seventh note G1): `go` when no earlier event of the room is unfinished anywhere, `wait` when one is (this entry stays held and beating; waiting is
     * not a try), `gone` when the entry is no longer this acquisition's (it ended here, and nothing of it is to run). Absent: there is no room order (the store is not connected).
     */
    turn?(): Promise<'go' | 'wait' | 'gone'>;
    /** The person's answer to this event is out (Matrix gave it `replyId`): kept beside the entry as the proof a server that takes it over reads (G2). Never throws. */
    answered?(replyId: string): Promise<void>;
    /** A waiting entry given back at shutdown: it never ran, so it does not count as a try, and another server takes it up at its next scan. Never throws. */
    yieldBack?(): Promise<void>;
}

/**
 * Why a scan closed an entry instead of handing it out:
 * - `paid`: work had begun when its owner went away and no answer to the person is proved, so it is never handed out again and the person is told (closed as UNANSWERED);
 * - `answered`: work had begun and the answer is proved (the reply's link was kept): closed quietly, only logged and reported;
 * - `tries`: it had all its tries; `stale`: it was taken in more than a day ago (never run late); `lost`: its state or its event lapsed (an entry an older server kept with an expiry).
 */
export type ClosedWhy = 'paid' | 'answered' | 'tries' | 'stale' | 'lost';
export interface ClosedEvent {
    why: ClosedWhy;
    eventId: string;
    /** The event, when the store still held it. */
    event?: unknown;
}
export type Recovered = Array<{ event: unknown; entry: InboxEntry; arrived?: number }> & { readonly closed?: ClosedEvent[] };

/** What the inbox answers when an event arrives: an entry when this server is to handle it, `false` when it is already held (and admitted) or was handled, `busy` when another server holds it and its transaction is still being taken in (it can still be taken back out: the duplicate must not be answered as kept). */
export type Taken = false | 'busy' | InboxEntry;

export interface EventInbox {
    /** Takes the event in before Matrix is answered. Throws only when the store could not be reached (the router then answers Matrix that it must send it again). */
    take(eventId: string, event: unknown): Promise<Taken>;
    /**
     * The entries whose owner went away, with the event each one holds and where it came in (`arrived`: kept with the event when it was taken, so events that share a time come back in the
     * order they arrived): this server now holds them. The entries this scan CLOSED instead (work had begun when the owner went away, or it had all its tries) are in `closed`, which is
     * not part of the list itself. Never throws.
     */
    recover(): Promise<Recovered>;
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
    options: {
        owner?: string;
        expected?: () => boolean;
        /** How long a DONE record is kept (the dedupe memory). An unfinished entry has no expiry. */
        ttlSeconds?: number;
        beatEveryMs?: number;
        staleMs?: number;
        deadlineMs?: number;
        maxTries?: number;
        batch?: number;
        /** An unfinished entry taken in longer ago than this is closed by the scan as UNANSWERED, never run (for the tests; `UNFINISHED_MAX_MS`). */
        unfinishedMaxMs?: number;
        /** How long an UNANSWERED entry is kept with its event (for the tests; `UNANSWERED_SECONDS`). */
        unansweredSeconds?: number;
        log?: (message: string, detail?: unknown) => void;
    } = {}
): EventInbox {
    const owner = options.owner ?? randomUUID();
    /** Whether a shared store is expected for this server (it was set up): then a store that is not connected means events cannot be kept, and the transaction is refused. */
    const expected = options.expected ?? (() => false);
    /** A new token for each time this server holds an event: it names the acquisition, not the server. */
    const tokenOf = (): string => `${owner}:${randomUUID()}`;
    const ttlSeconds = options.ttlSeconds ?? EVENT_SEEN_SECONDS;
    const beatEveryMs = options.beatEveryMs ?? BEAT_EVERY_MS;
    const staleMs = options.staleMs ?? BEAT_STALE_MS;
    /** How long the open mark of an intake lives without a beat: as long as an entry may be quiet before another server takes it over. */
    const openSeconds = Math.max(1, Math.ceil(staleMs / 1000));
    const deadlineMs = options.deadlineMs ?? INBOX_DEADLINE_MS;
    const maxTries = options.maxTries ?? MAX_TRIES;
    const batch = options.batch ?? RECOVER_BATCH;
    const unfinishedMaxMs = options.unfinishedMaxMs ?? UNFINISHED_MAX_MS;
    const unansweredSeconds = options.unansweredSeconds ?? UNANSWERED_SECONDS;
    const say = options.log ?? ((message: string, detail?: unknown) => console.warn(`[MatrixInbox] ${message}`, detail instanceof Error ? detail.message : detail));
    /** An entry that holds nothing: the store is not connected, so the event is handled and nothing is remembered. */
    const nothing: InboxEntry = { durable: false, admit: async () => undefined, done: async () => undefined, release: async () => 'closed', undo: async () => 'undone', paid: async () => undefined };

    /** The keys of an entry: its state, the inbox, its event, its open mark, its room's order (a key that holds nothing when the room is not known), its answer link, the store-wide count, its admitted mark, its resend mark. */
    const keysOf = (eventId: string, room?: string) => [
        `${EVENT_SEEN_PREFIX}${eventId}`,
        INBOX_KEY,
        `${INBOX_EVENT_PREFIX}${eventId}`,
        `${INBOX_OPEN_PREFIX}${eventId}`,
        `${ROOM_ORDER_PREFIX}${room ?? ''}`,
        `${INBOX_ANSWER_PREFIX}${eventId}`,
        INBOX_SEQ_KEY,
        `${INBOX_ADMITTED_PREFIX}${eventId}`,
        `${INBOX_RESEND_PREFIX}${eventId}`,
    ];
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
    const step = async (redis: Client, script: string, eventId: string, args: string[], room?: string): Promise<unknown> => {
        let timer: NodeJS.Timeout | undefined;
        try {
            const late = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), deadlineMs);
                timer.unref?.();
            });
            return await Promise.race([redis.eval(script, { keys: keysOf(eventId, room), arguments: args }), late]);
        } finally {
            clearTimeout(timer);
        }
    };

    /** An entry this server holds: it beats while it is held, and the beat stops when it ends. */
    const entryOf = (redis: Client, eventId: string, token: string, room?: string): InboxEntry => {
        const beat = setInterval(() => {
            void step(redis, BEAT, eventId, [token, String(ttlSeconds), String(Date.now()), eventId, String(openSeconds)], room).catch((error) => say('Could not say an event is still being handled:', error));
        }, beatEveryMs);
        beat.unref?.();
        let over = false;
        const end = async (script: string, args: string[], what: string): Promise<void> => {
            if (over) return;
            over = true;
            clearInterval(beat);
            await step(redis, script, eventId, args, room).catch((error) => say(`Could not mark an event as ${what}; it is taken up again by another server:`, error));
        };
        /**
         * Given back for another try. When the store does not take it, the entry keeps beating and the give-back is tried again (for as long as this process lives, with a back-off) instead of being left: a paid mark
         * that the store wrote but never confirmed to this server stands on an entry whose work never began, and an entry that went quiet with that mark on it would be closed by another server
         * as paid work, and the person's message lost. Only a server that dies before the store takes it back leaves that mark standing.
         */
        let retrying: Promise<void> | undefined;
        let retried: () => void = () => undefined;
        const giveBack = async (onClosed?: () => void): Promise<'again' | 'closed' | 'unsure'> => {
            if (over) return 'unsure';
            over = true;
            let attempts = 0;
            const attempt = (): Promise<'again' | 'closed' | undefined> => {
                // Every call counts, whether the store answered or not: a retry after a failed first call is a retry
                attempts += 1;
                return step(redis, RELEASE, eventId, [token, String(ttlSeconds), String(maxTries), eventId], room).then(
                    (answer) => {
                        if (answer === 2 || answer === '2') return 'closed' as const;
                        // Not this server's any more (taken by another, or finished): nothing is left to give back, and nothing of it is reported from here
                        if ((answer === 0 || answer === '0') && attempts > 1) say('A give-back that was tried again found the entry no longer this server\'s:', eventId);
                        return 'again' as const;
                    },
                    (error) => {
                        say('Could not give an event back for another try:', error);
                        return undefined;
                    }
                );
            };
            const first = await attempt();
            if (first) {
                clearInterval(beat);
                return first;
            }
            let tried = 1;
            // Whoever must wait for this server's work to be over (a shutdown) can wait for the retries too: they end when the store took the give-back (after `onClosed` ran, when it was the last try)
            retrying = new Promise<void>((resolve) => (retried = resolve));
            // The give-back is tried again for as long as this process lives, with a back-off (a beat apart, then twice that), and the entry KEEPS BEATING meanwhile: an entry that went quiet with
            // a paid mark on it would be closed by another server as paid work while this one is still running. Only a server that dies before the store takes it back leaves that mark standing
            let delay = beatEveryMs;
            const later = (): void => {
                const timer = setTimeout(() => {
                    void attempt().then((given) => {
                        tried += 1;
                        if (given) {
                            clearInterval(beat);
                            if (given === 'closed') onClosed?.();
                            retried();
                            return;
                        }
                        if (tried === GIVE_BACK_TRIES) say('The store still does not take an event back; it keeps beating and the give-back is tried again, so no other server closes it as paid work:', eventId);
                        delay = Math.min(delay * 2, beatEveryMs * 2);
                        later();
                    });
                }, delay);
                timer.unref?.();
            };
            later();
            return 'unsure';
        };
        return {
            done: () => end(DONE, [token, String(ttlSeconds), eventId], 'handled'),
            release: (onClosed) => giveBack(onClosed),
            givingBack: () => retrying,
            undo: async () => {
                if (over) return 'gone';
                let answer: unknown;
                try {
                    answer = await step(redis, UNDO, eventId, [token, eventId, String(RESEND_WAIT_SECONDS)], room);
                } catch (error) {
                    // The store did not answer: the entry is left as it is (it stops beating). Admitted, another server takes it up; not admitted, Synapse sends it again
                    say('Could not take an event back out; it is left to be taken up again:', error);
                    over = true;
                    clearInterval(beat);
                    return 'unsure';
                }
                // Admitted: its transaction was kept whole after all (the answer to an admit was lost), so it is NOT taken out: it stays this server's, still beating, to be handled here
                if (answer === 2 || answer === '2') return 'admitted';
                over = true;
                clearInterval(beat);
                return answer === 1 || answer === '1' ? 'undone' : 'gone';
            },
            // The transaction this event came in kept all its events: duplicates of it are skipped from now on. Throws when the store did not confirm it (the router then takes the transaction back)
            // Must be CONFIRMED (CodeRabbit on 24dea75c, finding 3): an entry that is not this acquisition's any more (its intake went quiet and another took it afresh) throws, and the
            // router then answers Matrix with a 500, never as kept
            admit: async () => {
                if (over) throw new Error('The entry had already ended here');
                const answer = await step(redis, ADMIT, eventId, [token], room);
                if (answer !== 1 && answer !== '1') throw new Error('The entry is not this server\'s any more, so its transaction is not kept here');
            },
            // Awaited before the first paid call, and it must SUCCEED: when it does not (another server holds the event now, or the store did not answer) it throws, and nothing paid for
            // begins. The event then goes back for another try, as one that nothing was paid for
            paid: async () => {
                if (over) throw new PaidFenceError('The event had already ended here');
                let answer: unknown;
                try {
                    answer = await step(redis, PAID, eventId, [token, String(ttlSeconds)], room);
                } catch (error) {
                    say('Could not write down that an event began paid work; it is not started:', error);
                    throw new PaidFenceError('The shared store did not confirm that paid work began');
                }
                if (answer !== 1 && answer !== '1') throw new PaidFenceError('Another server holds this event now');
            },
            // The gate of the room (G1). A store that does not answer is not a yes: the entry waits and asks again
            turn: async () => {
                if (over) return 'gone';
                const answer = await step(redis, TURN, eventId, [token, eventId, EVENT_SEEN_PREFIX, String(ROOM_LOOK), INBOX_RESEND_PREFIX], room);
                if (answer === 1 || answer === '1') return 'go';
                if (answer === 2 || answer === '2') {
                    // Not this acquisition's any more: it stops beating, and nothing of it runs here
                    over = true;
                    clearInterval(beat);
                    return 'gone';
                }
                return 'wait';
            },
            answered: async (replyId) => {
                if (over || !replyId) return;
                await step(redis, ANSWERED, eventId, [token, replyId], room).then(
                    (answer) => {
                        if (answer !== 1 && answer !== '1') say('The answer to an event could not be linked: it is not this server\'s any more:', eventId);
                    },
                    (error) => say('Could not keep the link to the answer of an event (a server that takes it over will tell the person it was not answered):', error)
                );
            },
            yieldBack: () => end(YIELD, [token, eventId], 'given back while it waited'),
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
            const room = roomOf(event);
            const took = await step(redis, TAKE, eventId, [token, String(ttlSeconds), String(Date.now()), kept, eventId, String(openSeconds), room ? '1' : '0', String(Date.now() - staleMs)], room);
            if (took === 0 || took === '0') return false;
            if (took === 2 || took === '2') return 'busy';
            return entryOf(redis, eventId, token, room);
        },
        recover: async () => {
            const redis = client();
            if (!redis || !redis.zRangeByScore) return recovered();
            const found = recovered();
            try {
                const cutoff = Date.now() - staleMs;
                // The oldest beats first. The scan is bounded by the same deadline as every step: a store that accepts the call and never answers ends it, and the next look is a new one
                const stale = await within(redis.zRangeByScore(INBOX_KEY, 0, cutoff, { LIMIT: { offset: 0, count: batch } }));
                for (const eventId of stale) {
                    const token = tokenOf();
                    // eslint-disable-next-line no-await-in-loop
                    const payload = await step(redis, TAKEOVER, eventId, [
                        token,
                        String(ttlSeconds),
                        String(Date.now()),
                        eventId,
                        String(cutoff),
                        String(maxTries),
                        String(Date.now() - unfinishedMaxMs),
                        String(unansweredSeconds),
                    ]).catch((error) => {
                        say('Could not take over an event left by another server:', error);
                        return null;
                    });
                    if (typeof payload !== 'string') continue;
                    // An entry the script closed (rather than handed out): told to the caller, with the event it held
                    const closure = /^!(paid|answered|tries|stale|lost)\|/.exec(payload);
                    if (closure) {
                        const body = payload.slice(closure[0].length);
                        let event: unknown;
                        try {
                            event = body ? unwrap(JSON.parse(body)) : undefined;
                        } catch {
                            event = undefined;
                        }
                        found.closed!.push({ why: closure[1] as ClosedWhy, eventId, ...(event === undefined ? {} : { event }) });
                        continue;
                    }
                    try {
                        const read = JSON.parse(payload) as { arrived?: unknown; event?: unknown };
                        // Entries are kept as `{ arrived, event }`; one kept bare (before that) is the event itself
                        const wrapped = typeof read === 'object' && read !== null && 'event' in read;
                        const arrived = wrapped && typeof read.arrived === 'number' ? read.arrived : undefined;
                        const event = wrapped ? read.event : read;
                        found.push({ event, entry: entryOf(redis, eventId, token, roomOf(event)), ...(arrived === undefined ? {} : { arrived }) });
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

/** The room an event belongs to, when it names one. */
function roomOf(event: unknown): string | undefined {
    const room = (event as { room_id?: unknown } | null)?.room_id;
    return typeof room === 'string' && room.length > 0 ? room : undefined;
}

/** The event of an entry as it was kept: `{ arrived, event }`, or the event itself when it was kept bare. */
function unwrap(read: unknown): unknown {
    return typeof read === 'object' && read !== null && 'event' in read ? (read as { event: unknown }).event : read;
}

/** An empty result of a scan, with the list of what it closed beside it (not an element of it, so a list compares as a list). */
function recovered(): Recovered {
    const list: Array<{ event: unknown; entry: InboxEntry; arrived?: number }> = [];
    Object.defineProperty(list, 'closed', { value: [] as ClosedEvent[], enumerable: false });
    return list as Recovered;
}
