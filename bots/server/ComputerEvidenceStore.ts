/**
 * The rows of Orbit's fault record that Orbit has not taken yet, kept in the bot servers' shared store (Redis) so a restart or a redeploy of the bot
 * server does not lose the evidence a failed computer job's money decision rests on (ComputerRefusals sends them again, under the ids they had).
 *
 * One hash per job, `computer:faults:pending:<jobId>`, one field per call (the call id) holding the bot and the row. The hash lives 7 days from its
 * last write. A row holds ids, a reason, a source, a route and times: nothing anyone said, no key. A damaged or foreign entry is skipped (and never
 * stops the bot server starting); an entry older than the time rows are kept is removed.
 */
import type { CallRow, CallTurn, EvidenceStore, SharedCalls, SharedTurn, SharedTurnList } from './ComputerRefusals';
import { DEAD_LETTER_KEEP_MS, EVIDENCE_KEEP_MS, REFUSAL_NOTE_KEEP_MS, SHARED_CALL_SKEW_MS } from './ComputerRefusals';

/** The few Redis commands used (a node-redis v4 client has them all). */
export interface EvidenceRedis {
    hGetAll(key: string): Promise<Record<string, string>>;
    hSet(key: string, field: string, value: string): Promise<unknown>;
    hDel(key: string, fields: string | string[]): Promise<unknown>;
    /** Runs a script in the store, so a comparison and the deletion that rests on it are one step (node-redis v4: `eval(script, { keys, arguments })`). */
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
    scan(cursor: number, options: { MATCH: string; COUNT: number }): Promise<{ cursor: number; keys: string[] }>;
}

export const EVIDENCE_PREFIX = 'computer:faults:pending:';
/** Rows Orbit refused alone while it took others, kept apart: same layout as the pending ones, 30 days from the last write, never deleted by this server. */
export const DEAD_PREFIX = 'computer:faults:dead:';
export const DEAD_TTL_SECONDS = Math.round(DEAD_LETTER_KEEP_MS / 1000);

/**
 * Deletes fields of the hash KEYS[1] only where each still holds the value it was given (ARGV: field, value, field, value...): a field that was written
 * again since (a newer row of the same call id, which Orbit has not taken) stays. Answers how many were deleted.
 */
export const DELETE_IF_UNCHANGED = `
local removed = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    removed = removed + redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return removed
`;

/**
 * Writes the field ARGV[1] = ARGV[2] of the hash KEYS[1] and renews its life to ARGV[3] seconds, as ONE step: a hash that ran out of life between a write and a
 * separate EXPIRE would take the field with it (EXPIRE answers 0 for a key that is gone) while the writer believed it was stored.
 */
export const SET_AND_RENEW = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/** A key of another kind that matches the prefix (Redis answers WRONGTYPE to a hash command on it): not ours, and no reason to stop reading the others. */
const wrongType = (error: unknown): boolean => error instanceof Error && /^WRONGTYPE\b/.test(error.message);
export const EVIDENCE_TTL_SECONDS = Math.round(EVIDENCE_KEEP_MS / 1000);

const KINDS = new Set(['fault', 'not_ours', 'uncertain', 'answered']);
const SOURCES = new Set(['universe-ai', 'own-key']);
const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A row read back from the store, or null when it is not one (a damaged or foreign entry). */
function validRow(value: unknown): CallRow | null {
    if (typeof value !== 'object' || value === null) return null;
    const row = value as Record<string, unknown>;
    if (!text(row.callId) || row.callId.length > 120 || !text(row.reason) || typeof row.kind !== 'string' || !KINDS.has(row.kind)) return null;
    // The route is text, except for the arrival row (`answered` / `relay_reached`: a call reached the relay, no route was looked at), which has none
    const arrival = row.kind === 'answered' && row.reason === 'relay_reached';
    if (typeof row.source !== 'string' || !SOURCES.has(row.source) || !(text(row.route) || (arrival && row.route === null)) || !text(row.at)) return null;
    // An `answered` row is no row but the arrival one: anything else of that kind is not ours
    if (row.kind === 'answered' && !arrival) return null;
    // A turn the server that saw the call could not tell is `null`: Orbit reads such a row with every turn it judges
    if (row.turn !== null && (typeof row.turn !== 'number' || !Number.isInteger(row.turn) || row.turn < 0)) return null;
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
            // The field and the new life of the hash (it starts again with each write) in one step
            await this.within(client.eval(SET_AND_RENEW, { keys: [key], arguments: [row.callId, JSON.stringify({ botId, row }), String(EVIDENCE_TTL_SECONDS)] }));
            return true;
        } catch {
            return false;
        }
    }

    async drop(botId: string, jobId: string, rows: CallRow[]): Promise<void> {
        if (rows.length === 0) return;
        try {
            // Each row only while it is the one in the store: a newer row of the same call id (written after the one Orbit took) is not Orbit's yet
            await this.deleteIfUnchanged(EVIDENCE_PREFIX + jobId, rows.map((row) => [row.callId, JSON.stringify({ botId, row })] as [string, string]));
        } catch {
            /* a row left behind is only sent again, and Orbit keeps one per job and call */
        }
    }

    async deadLetter(botId: string, jobId: string, row: CallRow): Promise<boolean> {
        try {
            const client = this.client();
            const key = DEAD_PREFIX + jobId;
            // Acknowledged only once the dead-letter copy and its life are both in the store: the pending copy is removed on this answer
            await this.within(client.eval(SET_AND_RENEW, { keys: [key], arguments: [row.callId, JSON.stringify({ botId, row }), String(DEAD_TTL_SECONDS)] }));
            return true;
        } catch {
            return false;
        }
    }

    async dropDead(botId: string, jobId: string, rows: CallRow[]): Promise<void> {
        if (rows.length === 0) return;
        try {
            await this.deleteIfUnchanged(DEAD_PREFIX + jobId, rows.map((row) => [row.callId, JSON.stringify({ botId, row })] as [string, string]));
        } catch {
            /* a dead letter left behind is only offered again, and Orbit keeps one row per job and call */
        }
    }

    async loadDead(): Promise<Array<{ botId: string; jobId: string; rows: CallRow[] }>> {
        const client = this.client();
        const keys = new Set<string>();
        let cursor = 0;
        do {
            const page = await this.within(client.scan(cursor, { MATCH: `${DEAD_PREFIX}*`, COUNT: 100 }));
            cursor = page.cursor;
            for (const key of page.keys) keys.add(key);
        } while (cursor !== 0);
        const jobs: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
        for (const key of keys) {
            const jobId = key.slice(DEAD_PREFIX.length);
            if (jobId === '') continue;
            let all: Record<string, string>;
            try {
                all = await this.within(client.hGetAll(key));
            } catch (error) {
                if (wrongType(error)) continue;
                throw error;
            }
            const rows: CallRow[] = [];
            let botId: string | undefined;
            for (const [field, value] of Object.entries(all)) {
                let entry: { botId?: unknown; row?: unknown } | null = null;
                try {
                    entry = JSON.parse(value) as { botId?: unknown; row?: unknown } | null;
                } catch {
                    entry = null;
                }
                const row = validRow(entry?.row);
                if (!entry || !row || !text(entry.botId) || row.callId !== field) continue;
                botId = entry.botId;
                rows.push(row);
            }
            if (botId && rows.length > 0) jobs.push({ botId, jobId, rows });
        }
        return jobs;
    }

    private async deleteIfUnchanged(key: string, fields: Array<[string, string]>): Promise<void> {
        await this.within(this.client().eval(DELETE_IF_UNCHANGED, { keys: [key], arguments: fields.flat() }));
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
            let all: Record<string, string>;
            try {
                all = await this.within(client.hGetAll(key));
            } catch (error) {
                // A foreign key that matches the prefix must not stop every job from coming back; a store that cannot be reached still does (it is asked again)
                if (wrongType(error)) continue;
                throw error;
            }
            const rows: CallRow[] = [];
            let botId: string | undefined;
            const stale: Array<[string, string]> = [];
            for (const [field, value] of Object.entries(all)) {
                let entry: { botId?: unknown; row?: unknown } | null = null;
                try {
                    entry = JSON.parse(value) as { botId?: unknown; row?: unknown } | null;
                } catch {
                    entry = null;
                }
                const row = validRow(entry?.row);
                if (!entry || !row || !text(entry.botId) || row.callId !== field) continue;
                const at = Date.parse(row.at);
                if (Number.isFinite(at) && at < this.now() - EVIDENCE_KEEP_MS) {
                    stale.push([field, value]);
                    continue;
                }
                botId = entry.botId;
                rows.push(row);
            }
            // An expired row is removed only if it is still the one that was read: another bot server may have written a newer one since
            if (stale.length > 0) await this.deleteIfUnchanged(key, stale).catch(() => undefined);
            if (botId && rows.length > 0) jobs.push({ botId, jobId, rows });
        }
        return jobs;
    }
}

export const CALLED_PREFIX = 'computer:called:';
/** The field a server writes when it could not record a call of a job: `unsure:<server>`. */
export const UNRECORDED_FIELD = 'unsure:';
/** The field a server writes when it took up a call of a job (the shared pool had room for it): `accepted:<server>`. Not a call's arrival: never read as one. */
export const ACCEPTED_FIELD = 'accepted:';
/** The field a server's runner writes to say which turns of a job it has been on: `turn:<server>`, a JSON list. Not a call's arrival: never read as one. */
export const TURN_FIELD = 'turn:';
/** Sets the field of the hash KEYS[1] (ARGV[1]) to the moment ARGV[2] unless it already holds a later one, and gives the hash a life of ARGV[3] seconds. */
export const KEEP_LATER = `
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]))
if current == nil or current < tonumber(ARGV[2]) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/** The field a runner's server writes when it GAVE UP a turn of a job: `fence:<turn>|<run>`, the moment (ms). Not a call's arrival: never read as one. */
export const FENCE_FIELD = 'fence:';
/**
 * How long a fence counts, whatever it is for (a known turn or not), from its moment (ms): a call whose moment is later than the fence's by more than this is taken up. A fence that a
 * runner could not take back (the close did not commit, and the retraction did not answer) clears itself, so an orphan blocks a live turn for this long and no longer.
 * About one give-up period.
 */
export const FENCE_LIFE_MS = 30_000;
/** The fence field of a turn (and run). */
export const fenceFieldOf = (turn: CallTurn): string => `${FENCE_FIELD}${turn.turn}|${turn.run ?? ''}`;
/**
 * What a COMMITTED fence's value ends with. A fence is written as the moment of its close (digits); when the runner goes on with the give-up (the close is no longer one that can
 * be taken back), `COMMIT_FENCE` writes the same moment followed by this. A committed fence of a turn (and run) refuses every call of that turn and run for as long as the hash
 * lives (a give-up whose cancel or finish takes longer than `FENCE_LIFE_MS` leaves no hole), is never retracted (`RETRACT_FENCE` compares the exact moment), and is taken back
 * by `RELEASE_FENCE` once Orbit has accepted the finish. A fence that is not committed (an abandoned close, a close of a turn that was not known) keeps `FENCE_LIFE_MS`.
 */
export const COMMITTED_MARK = 'c';

/**
 * The runner's server gives a turn up (a turn that was refused for want of room the whole time): as ONE step, with no acceptance written for the turn (and run) by
 * another server since ARGV[4] (ms) it writes the fence of the turn and answers 1; otherwise it writes nothing and answers 0. ARGV: this server's own id (its
 * own acceptances are in its own notes), the turn ('' when not known: an acceptance with no turn counts for every turn), the run, the earliest moment that
 * counts, the fence field, its moment, and the hash's life in seconds. Whatever is written after the fence is read by `NOTE_ACCEPTED_UNLESS_CLOSED`, which
 * refuses it, so a call can no longer be taken up for the turn that is being given up, and a call that was taken up is never given up on.
 */
export const CLOSE_TURN = `
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  local field = all[i]
  if string.sub(field, 1, 9) == 'accepted:' then
    local rest = string.sub(field, 10)
    local bar = string.find(rest, '|', 1, true)
    local instance = rest
    local counts = true
    if bar then
      instance = string.sub(rest, 1, bar - 1)
      if ARGV[2] ~= '' and string.sub(rest, bar + 1) ~= ARGV[2] .. '|' .. ARGV[3] then counts = false end
    end
    if instance ~= ARGV[1] and counts then
      local at = tonumber(all[i + 1])
      if at ~= nil and at >= tonumber(ARGV[4]) then return 0 end
    end
  end
end
local standing = redis.call('HGET', KEYS[1], ARGV[5])
if standing and string.sub(standing, -1) == 'c' then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7]))
  return 1
end
redis.call('HSET', KEYS[1], ARGV[5], ARGV[6])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7]))
return 1
`;

/**
 * Takes a fence back: deletes the field ARGV[1] only while it still holds exactly the moment ARGV[2] (the fence this very close wrote), so a fence of a later close of the
 * same turn is never touched. Answers 1 when it deleted it and 0 when there was nothing of that moment to delete (the same answer to say twice). The runner's server
 * uses it when a close it made did not become a give-up (its answer was lost after the script ran, or a call was taken up meanwhile): the turn goes on.
 */
export const RETRACT_FENCE = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

/**
 * COMMITS the fence this close wrote, as ONE step, when the runner goes on with the give-up: the field ARGV[1] holds exactly the moment ARGV[2] (or already holds it committed:
 * the same answer to say twice), and becomes that moment followed by `COMMITTED_MARK`, and the hash lives ARGV[3] seconds from now (the full keep, so the fence is there for
 * as long as the rest of the job's evidence). Answers 1 when the fence is committed, 0 when the field holds something else (it was taken back, it expired, a later close of
 * the turn wrote another moment): nothing is written, and the turn is not given up on this fence.
 */
export const COMMIT_FENCE = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current == ARGV[2] or current == ARGV[2] .. 'c' then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2] .. 'c')
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
  return 1
end
return 0
`;

/**
 * Takes a COMMITTED fence back once Orbit has accepted the finish of the job: deletes the field ARGV[1] only while it holds exactly the moment ARGV[2] committed, so a fence
 * of a later close is never touched. Answers 1 when it deleted it and 0 when there was nothing of that moment to delete (the same answer to say twice).
 */
export const RELEASE_FENCE = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] .. 'c' then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

/**
 * A server took up a call of the job (the same write as `KEEP_LATER`: the field ARGV[1] keeps the later moment ARGV[2], the hash lives ARGV[3] seconds) UNLESS
 * the turn it belongs to was given up: ARGV[4] is the fence field of the call's turn and run ('' when the turn is not known), and ARGV[5] the earliest moment of a
 * fence that counts (the call's moment minus FENCE_LIFE_MS: an older fence has cleared itself, known turn or not). A fence whose moment cannot be read counts, in
 * every branch. A call of a KNOWN turn is refused by the fence of its own turn and run, and by the fence of a close made when the runner's turn was not known
 * (`fence:|`, written by `closeTurn` with no turn: it may be a fence of any turn); a fence of a DIFFERENT known turn leaves it eligible. A call whose turn is not known is
 * refused by any fence. A fence COMMITTED for the call's own turn and run (`COMMIT_FENCE`) refuses the call whenever it arrives, for as long as the hash lives; a call whose turn is
 * not known, and a call of another turn, read it as any other fence (its moment, and ARGV[5]). Answers 1 when it was written, 0 when it was refused (nothing written).
 */
export const NOTE_ACCEPTED_UNLESS_CLOSED = `
if ARGV[4] ~= '' then
  for _, field in ipairs({ ARGV[4], 'fence:|' }) do
    local fenced = redis.call('HGET', KEYS[1], field)
    if fenced then
      local text = fenced
      local committed = string.sub(text, -1) == 'c'
      if committed then text = string.sub(text, 1, -2) end
      -- A fence COMMITTED for the call's own turn and run refuses it whenever it arrives (the give-up is going on, however long its cancel and its finish take). Only the
      -- fence of a known turn is ever committed, so the fence of an unknown turn is read by its moment alone
      if committed then return 0 end
      local at = tonumber(text)
      if at == nil or at >= tonumber(ARGV[5]) then return 0 end
    end
  end
else
  local all = redis.call('HGETALL', KEYS[1])
  for i = 1, #all, 2 do
    if string.sub(all[i], 1, 6) == 'fence:' then
      -- A call whose turn is not known keeps the life of a fence, committed or not
      local text = all[i + 1]
      if string.sub(text, -1) == 'c' then text = string.sub(text, 1, -2) end
      local at = tonumber(text)
      if at == nil or at >= tonumber(ARGV[5]) then return 0 end
    end
  end
end
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]))
if current == nil or current < tonumber(ARGV[2]) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/**
 * Where the bot servers say to each other that a call of a job reached their relay (the runner of a job lives on one server, its machine's calls may land on
 * another): one hash per job, `computer:called:<jobId>`, one field per bot server (its own random id) holding the latest moment (ms) it saw one. It lives an
 * hour from the last write, as long as the runner's own notes. Holds ids and times only.
 */
export class RedisSharedCalls implements SharedCalls {
    constructor(
        private readonly redis: () => EvidenceRedis | null,
        /** This server's id: what it wrote is not read back as another's (its own notes know exactly). */
        private readonly instanceId: string,
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

    async noteCalled(jobId: string, at: number): Promise<void> {
        await this.write(jobId, this.instanceId, at);
    }

    async noteUnrecorded(jobId: string, at: number): Promise<void> {
        await this.write(jobId, UNRECORDED_FIELD + this.instanceId, at);
    }

    async noteTurn(jobId: string, turns: SharedTurn[], until: number): Promise<void> {
        const client = this.client();
        // The list (with its promise) replaces the one before it (the runner's own latest few), with the hash's life renewed in the same step
        await this.within(client.eval(SET_AND_RENEW, { keys: [CALLED_PREFIX + jobId], arguments: [TURN_FIELD + this.instanceId, JSON.stringify({ turns, until }), String(Math.round(REFUSAL_NOTE_KEEP_MS / 1000))] }));
    }

    async turnsByOthers(jobId: string): Promise<SharedTurnList[]> {
        const all = await this.within(this.client().hGetAll(CALLED_PREFIX + jobId));
        const out: SharedTurnList[] = [];
        for (const [field, value] of Object.entries(all)) {
            if (!field.startsWith(TURN_FIELD) || field.slice(TURN_FIELD.length) === this.instanceId) continue;
            try {
                const said: unknown = JSON.parse(value);
                // A list with no promise (written before the promise existed, or damaged) covers nothing
                if (typeof said !== 'object' || said === null || Array.isArray(said)) continue;
                const { turns, until } = said as { turns?: unknown; until?: unknown };
                if (!Array.isArray(turns) || typeof until !== 'number' || !Number.isFinite(until)) continue;
                const list: SharedTurn[] = [];
                let readable = true;
                for (const one of turns) {
                    if (typeof one === 'object' && one !== null && Number.isInteger((one as SharedTurn).turn) && (one as SharedTurn).turn >= 0 && Number.isFinite((one as SharedTurn).at)) {
                        const run = (one as SharedTurn).run;
                        list.push({ turn: (one as SharedTurn).turn, ...(typeof run === 'string' && run !== '' ? { run } : {}), at: (one as SharedTurn).at, ...((one as SharedTurn).pending === true ? { pending: true as const } : {}) });
                    } else readable = false;
                }
                // A list with a turn that cannot be read is no list to attribute a call from: without the turn, the one before it would be taken for the turn a call
                // is in. It still holds its runner's promise (the runner IS there until then), so a call it covers is read as covered by it, and given no turn
                out.push({ turns: readable ? list : [], until });
            } catch {
                /* a damaged field is skipped */
            }
        }
        return out;
    }

    async noteAccepted(jobId: string, at: number, turn?: CallTurn): Promise<boolean> {
        // One field per server and turn (and run), so a call of an earlier turn taken up later never takes the place of the later turn's: a call whose turn was
        // not known is the field of the server alone, which counts for every turn. It is written in the same step that looks at whether the turn was given up: a
        // turn that was given up takes no more calls (false: the call is not to go on)
        const answer = await this.within(
            this.client().eval(NOTE_ACCEPTED_UNLESS_CLOSED, {
                keys: [CALLED_PREFIX + jobId],
                arguments: [ACCEPTED_FIELD + this.instanceId + (turn ? `|${turn.turn}|${turn.run ?? ''}` : ''), String(at), String(Math.round(REFUSAL_NOTE_KEEP_MS / 1000)), turn ? fenceFieldOf(turn) : '', String(at - FENCE_LIFE_MS)],
            })
        );
        return Number(answer) === 1;
    }

    async closeTurn(jobId: string, turn: CallTurn | undefined, from: number, at: number): Promise<boolean> {
        const answer = await this.within(
            this.client().eval(CLOSE_TURN, {
                keys: [CALLED_PREFIX + jobId],
                arguments: [this.instanceId, turn ? String(turn.turn) : '', turn?.run ?? '', String(from - SHARED_CALL_SKEW_MS), turn ? fenceFieldOf(turn) : FENCE_FIELD + '|', String(at), String(Math.round(REFUSAL_NOTE_KEEP_MS / 1000))],
            })
        );
        return Number(answer) === 1;
    }

    async retractFence(jobId: string, turn: CallTurn | undefined, at: number): Promise<void> {
        await this.within(
            this.client().eval(RETRACT_FENCE, {
                keys: [CALLED_PREFIX + jobId],
                arguments: [turn ? fenceFieldOf(turn) : FENCE_FIELD + '|', String(at)],
            })
        );
    }

    async commitFence(jobId: string, turn: CallTurn, at: number): Promise<boolean> {
        const answer = await this.within(this.client().eval(COMMIT_FENCE, { keys: [CALLED_PREFIX + jobId], arguments: [fenceFieldOf(turn), String(at), String(Math.round(REFUSAL_NOTE_KEEP_MS / 1000))] }));
        return Number(answer) === 1;
    }

    async releaseFence(jobId: string, turn: CallTurn, at: number): Promise<void> {
        await this.within(this.client().eval(RELEASE_FENCE, { keys: [CALLED_PREFIX + jobId], arguments: [fenceFieldOf(turn), String(at)] }));
    }

    async lastAcceptedByOthers(jobId: string, turn?: CallTurn): Promise<number | null> {
        const all = await this.within(this.client().hGetAll(CALLED_PREFIX + jobId));
        let latest: number | null = null;
        for (const [field, value] of Object.entries(all)) {
            if (!field.startsWith(ACCEPTED_FIELD)) continue;
            const rest = field.slice(ACCEPTED_FIELD.length);
            const bar = rest.indexOf('|');
            const instance = bar < 0 ? rest : rest.slice(0, bar);
            if (instance === this.instanceId) continue;
            // A field of a turn counts only for that turn and run (one with no turn counts for every turn: it is not known which it was)
            if (bar >= 0 && turn) {
                const [theTurn, ...theRun] = rest.slice(bar + 1).split('|');
                if (Number(theTurn) !== turn.turn || theRun.join('|') !== (turn.run ?? '')) continue;
            }
            const at = Number(value);
            if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
        }
        return latest;
    }

    /** Keeps the later of two moments, so the same moment written twice, or a late write, never takes a later one back. */
    private async write(jobId: string, field: string, at: number): Promise<void> {
        const client = this.client();
        const key = CALLED_PREFIX + jobId;
        await this.within(client.eval(KEEP_LATER, { keys: [key], arguments: [field, String(at), String(Math.round(REFUSAL_NOTE_KEEP_MS / 1000))] }));
    }

    async lastCalledByOthers(jobId: string): Promise<number | null> {
        const all = await this.within(this.client().hGetAll(CALLED_PREFIX + jobId));
        let latest: number | null = null;
        for (const [field, value] of Object.entries(all)) {
            // That a server took a call up, which turn its runner is on, or that it gave a turn up, is not that a call arrived
            if (field.startsWith(ACCEPTED_FIELD) || field.startsWith(TURN_FIELD) || field.startsWith(FENCE_FIELD)) continue;
            // A server's own writes are known to its own notes exactly; a call it could not record counts like one it did
            const instance = field.startsWith(UNRECORDED_FIELD) ? field.slice(UNRECORDED_FIELD.length) : field;
            if (instance === this.instanceId) continue;
            const at = Number(value);
            if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
        }
        return latest;
    }
}
