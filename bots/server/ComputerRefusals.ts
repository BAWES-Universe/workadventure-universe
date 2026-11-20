/**
 * What the model relay refused for a job because of the person's side of the books (their computer allowance used up, or one of their
 * spending rules), noted for the runner that runs the same job in this process.
 *
 * A person's own provider, key or endpoint failing (their credit ran out, their key was revoked, the Brick's own key resting) and a call the
 * provider refused as wrong of the job's own request (moderation, a context too long) are noted the same way: not ours either.
 *
 * Why it exists: Hermes sees such a refusal only as a failed call, so a turn that ends because of it looks, to the runner, like any other
 * failed turn. A failed turn Universe is to blame for is given back to the person; one the person's own allowance or rules stopped is not.
 * The relay notes the refusal here and the runner asks, for the turn it just read, whether one came in during it.
 * It also notes how the job's model calls fared on Universe's side: a call that failed for a fault of ours (the AI did not answer, was busy,
 * was not reachable, a stream that broke) and a call that was answered. Hermes can end a turn as completed with the error as its words, or with
 * none, so the runner asks whether the turn ended on a fault of ours: the last call of the turn was ours to answer and was not.
 * Kept in memory only (ids and times, nothing anyone said) and forgotten after a while.
 */

/** How a model call of a job ended, as Orbit's fault record takes it. `answered` is never sent (an answer is no fault). */
export type CallKind = 'fault' | 'not_ours' | 'uncertain' | 'answered';
/**
 * Why. `fault` (a confirmed Universe fault no job's words can cause): relay_down, pool_busy, route_unknown, provider_key_ours.
 * `not_ours` (the person's, with evidence): allowance, rule, own_provider, field_job_set (what the job itself sent was refused).
 * `uncertain` (unresolved, for Orbit's bounded goodwill and reconciliation): provider_5xx, provider_429, stream_cut, timeout_no_output,
 * timeout_after_output, field_relay_set, fieldless_400.
 */
export type FaultReason =
    | 'relay_down'
    | 'pool_busy'
    | 'route_unknown'
    | 'provider_key_ours'
    | 'provider_5xx'
    | 'provider_429'
    | 'stream_cut'
    | 'timeout_no_output'
    | 'timeout_after_output'
    | 'field_relay_set'
    | 'field_job_set'
    | 'fieldless_400'
    | 'allowance'
    | 'rule'
    | 'own_provider';

/** One call's row for Orbit: ids, the reason, where the money came from and when. Nothing anyone said. */
export interface CallRow {
    /** The runner's turn the call was made in (0 when no turn was known). */
    turn: number;
    callId: string;
    kind: Exclude<CallKind, 'answered'>;
    reason: FaultReason;
    source: 'universe-ai' | 'own-key';
    /** `universe-ai:<providerId>`, or `own-key`; at most 80 characters. */
    route: string;
    providerStatus: number | null;
    /** ISO time. */
    at: string;
}

export type CallInput = Omit<CallRow, 'turn' | 'at' | 'kind'> & { kind: CallKind };

export interface RefusalNotes {
    /** The runner says which turn of this job it is on, so the rows of the calls made in it carry the number. */
    turn(jobId: string, turn: number): void;
    /**
     * How one model call of the job ended, noted for the runner of the same process AND queued for Orbit's durable fault record (best effort, with
     * retry): `fault` and `uncertain` count as a fault of Universe's for the runner, `not_ours` as the person's side, `answered` as an answer.
     */
    record(botId: string, jobId: string, call: CallInput): void;
    /** Sends what is queued for this job to Orbit, trying again for a moment; true when nothing is left unsent. Called before a job is ended. */
    flush(jobId: string): Promise<boolean>;
    /** Whether a confirmed Universe fault (kind `fault`) was recorded for this job at or after this moment (ms). */
    confirmedSince(jobId: string, sinceMs: number): boolean;
    /** The relay refused a call of this job for the person's allowance or a rule of theirs, or the person's own provider failed it. */
    note(jobId: string): void;
    /** Whether a refusal was noted for this job at or after this moment (ms). */
    sawSince(jobId: string, sinceMs: number): boolean;
    /** A model call of this job failed for a fault of Universe's (not the person's allowance or rules, not a call the agent got wrong). */
    fault(jobId: string): void;
    /** A model call of this job was answered whole. */
    answered(jobId: string): void;
    /** Whether the job's last call at or after this moment (ms) was a fault of ours that no later call made good. */
    endedOnFault(jobId: string, sinceMs: number): boolean;
}

/** A note older than this can no longer belong to a turn that is being read. */
export const REFUSAL_NOTE_KEEP_MS = 60 * 60 * 1000;

export interface RefusalOptions {
    /** Where rows go: Orbit's fault record. Resolves false when Orbit could not take them (they are kept and tried again). */
    sink?: (botId: string, jobId: string, rows: CallRow[]) => Promise<boolean>;
    /** How long to wait before each new try to send rows. */
    retryMs?: number[];
}

/** The most rows Orbit takes in one call. */
export const FAULT_ROWS_PER_CALL = 50;
const DEFAULT_RETRY_MS = [500, 2000, 8000];

export function createRefusalNotes(now: () => number = Date.now, options: RefusalOptions = {}): RefusalNotes {
    const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    const last = new Map<string, number>();
    // The order of events is kept by count, since two can land in the same millisecond
    let count = 0;
    const calls = new Map<string, { fault?: { at: number; order: number }; confirmed?: number; answered?: { at: number; order: number } }>();
    const turns = new Map<string, { turn: number; at: number }>();
    // Rows not yet taken by Orbit, per job. A row is sent again until Orbit takes it (Orbit keeps one per job and call).
    const queued = new Map<string, { botId: string; rows: Map<string, CallRow>; sending?: Promise<boolean>; at: number }>();
    const forget = () => {
        const cutoff = now() - REFUSAL_NOTE_KEEP_MS;
        for (const [jobId, at] of last) if (at < cutoff) last.delete(jobId);
        for (const [jobId, seen] of calls) if (Math.max(seen.fault?.at ?? 0, seen.answered?.at ?? 0) < cutoff) calls.delete(jobId);
        for (const [jobId, seen] of turns) if (seen.at < cutoff) turns.delete(jobId);
        for (const [jobId, entry] of queued) if (entry.at < cutoff && !entry.sending) queued.delete(jobId);
    };
    const mark = (jobId: string, kind: 'fault' | 'answered', confirmed = false) => {
        forget();
        const seen = calls.get(jobId) ?? {};
        seen[kind] = { at: now(), order: ++count };
        if (confirmed) seen.confirmed = now();
        calls.set(jobId, seen);
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    /** Sends the job's queued rows, a batch at a time; a batch Orbit did not take waits for the next try. One sender per job at a time. */
    const send = (jobId: string): Promise<boolean> => {
        const entry = queued.get(jobId);
        if (!entry || entry.rows.size === 0) return Promise.resolve(true);
        if (!options.sink) return Promise.resolve(true);
        if (entry.sending) return entry.sending;
        const sink = options.sink;
        entry.sending = (async () => {
            for (let attempt = 0; ; attempt++) {
                while (entry.rows.size > 0) {
                    const batch = [...entry.rows.values()].slice(0, FAULT_ROWS_PER_CALL);
                    let taken = false;
                    try {
                        taken = await sink(entry.botId, jobId, batch);
                    } catch {
                        taken = false;
                    }
                    if (!taken) break;
                    // A row that was changed while it was being sent (an upgrade) stays for the next batch
                    for (const row of batch) if (entry.rows.get(row.callId) === row) entry.rows.delete(row.callId);
                }
                if (entry.rows.size === 0) return true;
                if (attempt >= retryMs.length) return false;
                await sleep(retryMs[attempt]);
            }
        })().finally(() => {
            entry.sending = undefined;
        });
        return entry.sending;
    };

    return {
        turn(jobId, turn) {
            forget();
            turns.set(jobId, { turn, at: now() });
        },
        record(botId, jobId, call) {
            if (call.kind === 'answered') return mark(jobId, 'answered');
            if (call.kind === 'not_ours') {
                forget();
                last.set(jobId, now());
            } else {
                mark(jobId, 'fault', call.kind === 'fault');
            }
            if (!options.sink) return;
            const entry = queued.get(jobId) ?? { botId, rows: new Map<string, CallRow>(), at: now() };
            entry.at = now();
            // Orbit keeps ids up to 120 characters: the row is kept under the id it is sent with
            const callId = call.callId.slice(0, 120);
            entry.rows.set(callId, {
                turn: turns.get(jobId)?.turn ?? 0,
                callId,
                kind: call.kind,
                reason: call.reason,
                source: call.source,
                route: call.route.slice(0, 80),
                providerStatus: call.providerStatus,
                at: new Date(now()).toISOString(),
            });
            queued.set(jobId, entry);
            // Sent without waiting: the call that made the row is not held for Orbit
            void send(jobId);
        },
        flush(jobId) {
            const entry = queued.get(jobId);
            if (!entry) return Promise.resolve(true);
            // What is being sent now may leave rows behind (a failed batch, rows added meanwhile): look again when it is over
            const again = async (): Promise<boolean> => {
                if (entry.sending) await entry.sending.catch(() => false);
                return entry.rows.size === 0 ? true : send(jobId);
            };
            return again();
        },
        confirmedSince(jobId, sinceMs) {
            const at = calls.get(jobId)?.confirmed;
            return at !== undefined && at >= sinceMs;
        },
        note(jobId) {
            forget();
            last.set(jobId, now());
        },
        sawSince(jobId, sinceMs) {
            const at = last.get(jobId);
            return at !== undefined && at >= sinceMs;
        },
        fault: (jobId) => mark(jobId, 'fault'),
        answered: (jobId) => mark(jobId, 'answered'),
        endedOnFault(jobId, sinceMs) {
            const seen = calls.get(jobId);
            if (!seen?.fault || seen.fault.at < sinceMs) return false;
            return !seen.answered || seen.answered.order < seen.fault.order;
        },
    };
}
