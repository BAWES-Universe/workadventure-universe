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
    /**
     * The run of the runner the turn belongs to (see `turn`): turns are numbered from 1 in each run of a job, and a run starts again after a restart
     * of the bot server, so the turn alone names two turns. Left out when no run was known.
     */
    run?: string;
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

export type CallInput = Omit<CallRow, 'turn' | 'run' | 'at' | 'kind'> & {
    kind: CallKind;
    /** The turn the call STARTED in (see `turnOf`): a call that ends after the runner moved on still belongs to the turn it began in. */
    turn?: number;
    /** The run that turn was in (see `runOf`), read when the call started. */
    run?: string;
};

/**
 * Where a turn's window begins: a point in the order of events (from `mark`), or a moment in ms. A point in the order tells events of one millisecond apart,
 * which a moment cannot: what was noted before the mark is not in the window, whatever the clock said.
 */
export type Since = number | { order: number };

export interface RefusalNotes {
    /** The runner says which turn of this job it is on (and in which run of the runner), so the rows of the calls made in it carry both. */
    turn(jobId: string, turn: number, run?: string): void;
    /** The run the runner says this job's turns are in now (undefined when none is known): read when a call starts, like `turnOf`. */
    runOf(jobId: string): string | undefined;
    /**
     * The turn (and its run) that was current at a point in the order of events (from `mark`), for a call that arrived at that point and was
     * only tied to its job later (the relay knows the job after it has identified the caller, which can take longer than a turn change). Nothing
     * known of the job's turns before that point reads as turn 0, with no run.
     */
    turnAt(jobId: string, at: { order: number }): { turn: number; run?: string };
    /** The turn the runner says this job is on now (0 when none is known): read when a call starts, so its row names the turn it began in. */
    turnOf(jobId: string): number;
    /**
     * How one model call of the job ended, noted for the runner of the same process AND queued for Orbit's durable fault record (best effort, with
     * retry): `fault` and `uncertain` count as a fault of Universe's for the runner, `not_ours` as the person's side, `answered` as an answer.
     */
    record(botId: string, jobId: string, call: CallInput): void;
    /**
     * Sends what is queued for this job to Orbit, trying again for a moment, for at most one short time in all (`flushBudgetMs`); true when nothing is
     * left unsent. Called before a job is ended. Rows left over go on being sent in the background (later, a few times).
     */
    flush(jobId: string): Promise<boolean>;
    /** The point in the order of events from which a turn's window starts: what is noted after this call, and only that, is in the window. */
    mark(): { order: number };
    /** Whether a confirmed Universe fault (kind `fault`) was recorded for this job since this point (or at or after this moment, ms). */
    confirmedSince(jobId: string, since: Since): boolean;
    /** The relay refused a call of this job for the person's allowance or a rule of theirs, or the person's own provider failed it. */
    note(jobId: string): void;
    /** Whether a refusal was noted for this job since this point (or at or after this moment, ms). */
    sawSince(jobId: string, since: Since): boolean;
    /** A model call of this job failed for a fault of Universe's (not the person's allowance or rules, not a call the agent got wrong). */
    fault(jobId: string): void;
    /** A model call of this job was answered whole. */
    answered(jobId: string): void;
    /** Whether the job's last call since this point (or at or after this moment, ms) was a fault of ours that no later call made good. */
    endedOnFault(jobId: string, since: Since): boolean;
}

/** A note older than this can no longer belong to a turn that is being read. */
export const REFUSAL_NOTE_KEEP_MS = 60 * 60 * 1000;

export interface RefusalOptions {
    /** Where rows go: Orbit's fault record. Resolves false when Orbit could not take them (they are kept and tried again). */
    sink?: (botId: string, jobId: string, rows: CallRow[]) => Promise<boolean>;
    /** How long to wait before each new try to send rows. */
    retryMs?: number[];
    /** How long to wait, after those tries all failed, before each later try in the background (rows are kept an hour in all). */
    laterMs?: number[];
    /** The most time a flush waits in all, across every try. */
    flushBudgetMs?: number;
}

/** The most rows Orbit takes in one call. */
export const FAULT_ROWS_PER_CALL = 50;
const DEFAULT_RETRY_MS = [500, 2000, 8000];
/** Later tries in the background once the quick ones failed: Orbit may be back after the job has ended. Bounded; the rows are kept an hour. */
const DEFAULT_LATER_MS = [30_000, 120_000, 600_000];
/** A job is not held up longer than this to get its rows to Orbit before it ends. */
const DEFAULT_FLUSH_BUDGET_MS = 5000;

export function createRefusalNotes(now: () => number = Date.now, options: RefusalOptions = {}): RefusalNotes {
    const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    const laterMs = options.laterMs ?? DEFAULT_LATER_MS;
    const flushBudgetMs = options.flushBudgetMs ?? DEFAULT_FLUSH_BUDGET_MS;
    const last = new Map<string, { at: number; order: number }>();
    // The order of events is kept by count, since two can land in the same millisecond
    let count = 0;
    const calls = new Map<string, { fault?: { at: number; order: number }; confirmed?: { at: number; order: number }; answered?: { at: number; order: number } }>();
    /** Whether an event is inside a window that begins at `since`. */
    const within = (event: { at: number; order: number }, since: Since) => (typeof since === 'number' ? event.at >= since : event.order > since.order);
    // The turns the runner said it was on, newest last, each with its place in the order of events: a short history, so a call can be tied to the
    // turn that was current when it ARRIVED. It is kept short: a call only ever asks about a turn that has just changed
    const turns = new Map<string, Array<{ turn: number; run?: string; at: number; order: number }>>();
    const TURN_HISTORY = 16;
    const lastTurn = (jobId: string) => turns.get(jobId)?.at(-1);
    // Rows not yet taken by Orbit, per job. A row is sent again until Orbit takes it (Orbit keeps one per job and call).
    const queued = new Map<string, { botId: string; rows: Map<string, CallRow>; sending?: Promise<boolean>; at: number; later?: ReturnType<typeof setTimeout>; laterTries: number }>();
    const forget = () => {
        const cutoff = now() - REFUSAL_NOTE_KEEP_MS;
        for (const [jobId, seen] of last) if (seen.at < cutoff) last.delete(jobId);
        for (const [jobId, seen] of calls) if (Math.max(seen.fault?.at ?? 0, seen.answered?.at ?? 0) < cutoff) calls.delete(jobId);
        for (const [jobId, seen] of turns) if ((seen.at(-1)?.at ?? 0) < cutoff) turns.delete(jobId);
        for (const [jobId, entry] of queued) {
            if (entry.at >= cutoff || entry.sending) continue;
            if (entry.later) clearTimeout(entry.later);
            queued.delete(jobId);
        }
    };
    const mark = (jobId: string, kind: 'fault' | 'answered', confirmed = false) => {
        forget();
        const seen = calls.get(jobId) ?? {};
        seen[kind] = { at: now(), order: ++count };
        if (confirmed) seen.confirmed = { at: now(), order: count };
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
        void entry.sending.then((sent) => {
            if (!sent) later(jobId);
        });
        return entry.sending;
    };

    /** After the quick tries failed (the last flush before the job ended included), one more try is set for later, a few times, never more than one waiting. */
    const later = (jobId: string) => {
        const entry = queued.get(jobId);
        if (!entry || entry.later || entry.rows.size === 0 || entry.laterTries >= laterMs.length) return;
        const timer = setTimeout(() => {
            entry.later = undefined;
            entry.laterTries += 1;
            void send(jobId);
        }, laterMs[entry.laterTries]);
        // A try for later never keeps the process alive
        timer.unref?.();
        entry.later = timer;
    };

    return {
        turn(jobId, turn, run) {
            forget();
            const history = turns.get(jobId) ?? [];
            history.push({ turn, ...(run ? { run } : {}), at: now(), order: ++count });
            if (history.length > TURN_HISTORY) history.shift();
            turns.set(jobId, history);
        },
        turnOf: (jobId) => lastTurn(jobId)?.turn ?? 0,
        runOf: (jobId) => lastTurn(jobId)?.run,
        turnAt(jobId, at) {
            // The last turn said at or before that point (a turn said after it is a later one)
            const seen = [...(turns.get(jobId) ?? [])].reverse().find((one) => one.order <= at.order);
            return seen ? { turn: seen.turn, ...(seen.run ? { run: seen.run } : {}) } : { turn: 0 };
        },
        record(botId, jobId, call) {
            if (call.kind === 'answered') return mark(jobId, 'answered');
            if (call.kind === 'not_ours') {
                forget();
                last.set(jobId, { at: now(), order: ++count });
            } else {
                mark(jobId, 'fault', call.kind === 'fault');
            }
            if (!options.sink) return;
            const entry = queued.get(jobId) ?? { botId, rows: new Map<string, CallRow>(), at: now(), laterTries: 0 };
            entry.at = now();
            // Orbit keeps ids up to 120 characters: the row is kept under the id it is sent with
            const callId = call.callId.slice(0, 120);
            // A call that carries its turn carries that turn's run, and one that does not takes both from where the runner is now: never one of each
            const runOfRow = call.turn !== undefined ? call.run : lastTurn(jobId)?.run;
            entry.rows.set(callId, {
                turn: call.turn ?? lastTurn(jobId)?.turn ?? 0,
                ...(runOfRow ? { run: runOfRow } : {}),
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
            // One short time in all, across the sender already at work and the one this starts: the job is not held for Orbit longer than that, and what
            // is left goes on being sent in the background
            let timer: ReturnType<typeof setTimeout> | undefined;
            const budget = new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), flushBudgetMs);
                timer.unref?.();
            });
            return Promise.race([again(), budget]).finally(() => clearTimeout(timer));
        },
        mark: () => ({ order: count }),
        confirmedSince(jobId, since) {
            const seen = calls.get(jobId)?.confirmed;
            return seen !== undefined && within(seen, since);
        },
        note(jobId) {
            forget();
            last.set(jobId, { at: now(), order: ++count });
        },
        sawSince(jobId, since) {
            const seen = last.get(jobId);
            return seen !== undefined && within(seen, since);
        },
        fault: (jobId) => mark(jobId, 'fault'),
        answered: (jobId) => mark(jobId, 'answered'),
        endedOnFault(jobId, since) {
            const seen = calls.get(jobId);
            if (!seen?.fault || !within(seen.fault, since)) return false;
            return !seen.answered || seen.answered.order < seen.fault.order;
        },
    };
}
