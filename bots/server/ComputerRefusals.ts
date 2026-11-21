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
 * Why. `fault` (a confirmed Universe fault no job's words can cause): relay_down (also: the machine could not reach the relay, or no call of a
 * turn ever did), pool_busy, route_unknown, provider_key_ours.
 * `not_ours` (the person's, with evidence): allowance, rule, own_provider, field_job_set (what the job itself sent was refused).
 * `uncertain` (unresolved, for Orbit's bounded goodwill and reconciliation): provider_5xx, provider_429, stream_cut, timeout_no_output,
 * timeout_after_output, field_relay_set, fieldless_400, provider_403.
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
    | 'provider_403'
    | 'allowance'
    | 'rule'
    | 'own_provider';

/** One call's row for Orbit: ids, the reason, where the money came from and when. Nothing anyone said. */
export interface CallRow {
    /**
     * The runner's turn the call was made in (0 when no turn was known on the server that runs the job). `null` when the server that saw the call does
     * not run the job's runner and could not tell which turn it was in (the shared record of the turns could not be read): Orbit reads a row with no turn
     * with every turn it judges, so a fault of ours seen on such a server is never missed for want of a turn number.
     */
    turn: number | null;
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

/**
 * Where the rows not yet taken by Orbit are kept so a restart of the bot server does not lose them (Redis, shared by every bot server). Rows are small
 * and hold ids, a reason and a time: nothing anyone said. A row is written when it is made, replaces the one under the same call id, and is removed when
 * Orbit has taken it.
 */
export interface EvidenceStore {
    /** Keeps one row (replacing the one with the same call id). Resolves false when it could not be kept. */
    save(botId: string, jobId: string, row: CallRow): Promise<boolean>;
    /**
     * Takes these rows out (Orbit has them), each only while the store still holds exactly the row that was taken: a newer row of the same call id (Orbit
     * has not taken it) stays. Never throws into the caller's way: a row left behind is only sent again, which is harmless.
     */
    drop(botId: string, jobId: string, rows: CallRow[]): Promise<void>;
    /** Every row kept and not yet taken, by job. Throws when the store cannot be reached (an empty store is an empty answer). */
    load(): Promise<Array<{ botId: string; jobId: string; rows: CallRow[] }>>;
    /**
     * Keeps a row Orbit refused ALONE while it took others (a dead letter): apart from the rows waiting for Orbit, for `DEAD_LETTER_KEEP_MS`, under the id it
     * had, never deleted by this server. Resolves false when it could not be kept (the row then stays where it is, and is sent again).
     */
    deadLetter?(botId: string, jobId: string, row: CallRow): Promise<boolean>;
    /** The dead letters kept, by job. Throws when the store cannot be reached. */
    loadDead?(): Promise<Array<{ botId: string; jobId: string; rows: CallRow[] }>>;
    /** Takes dead letters out once Orbit has TAKEN them (a replay worked), each only while it is still exactly the row that was sent. Never throws. */
    dropDead?(botId: string, jobId: string, rows: CallRow[]): Promise<void>;
}

/** A row Orbit refused alone is kept this long, apart, to be sent again once the cause is mended: 30 days. */
export const DEAD_LETTER_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Orbit has proved it takes rows when it took one within this long: a row refused alone then is the row's own fault, not Orbit's. */
export const ORBIT_TAKING_ROWS_MS = 10 * 60 * 1000;

export type CallInput = Omit<CallRow, 'turn' | 'run' | 'at' | 'kind'> & {
    kind: CallKind;
    /** The turn the call STARTED in (see `turnOf`): a call that ends after the runner moved on still belongs to the turn it began in. `null`: not known (see `CallRow`). */
    turn?: number | null;
    /** The run that turn was in (see `runOf`), read when the call started. */
    run?: string;
};

/**
 * Where a turn's window begins: a point in the order of events (from `mark`), or a moment in ms. A point in the order tells events of one millisecond apart,
 * which a moment cannot: what was noted before the mark is not in the window, whatever the clock said.
 */
export type Since = number | { order: number; at?: number };

/**
 * What the bot servers share about where a job's model calls arrive. A machine's calls (/v1/*) reach whichever bot server the load balancer picks (a
 * rolling deploy keeps the old one up while the new one takes traffic), while the runner of the job lives on one of them: its own notes know only the calls
 * that arrived at it.
 */
/** A turn of a job's runner as the bot servers tell each other: its number, its run, and when it began (ms). */
export interface SharedTurn {
    turn: number;
    run?: string;
    at: number;
    /**
     * The runner has put the turn in the list but has not yet told that it began (see `RefusalNotes.turnPublished`): `at` is only the moment it was noted. A call that
     * arrives at or after that moment may be of the turn before (which can still be making calls) or of this one: it is tied to neither.
     */
    pending?: true;
}

export interface SharedCalls {
    /** This server saw a call of the job reach the relay, at this moment (ms). Fire and forget: never held up for it. */
    noteCalled(jobId: string, at: number): Promise<void>;
    /**
     * This server could not record a call of the job (its two writes failed) and says so apart, so a runner on another server does not conclude that no
     * call arrived. Counts like a call, for the runner that reads it.
     */
    noteUnrecorded(jobId: string, at: number): Promise<void>;
    /** The latest moment (ms) another bot server saw a call of the job reach its relay (or could not record one), or null for none. Rejects when the shared store cannot be read. */
    lastCalledByOthers(jobId: string): Promise<number | null>;
    /**
     * This server's runner says which turns of the job it has been on (the latest few, each with the moment it began, ms) and PROMISES that the list is the
     * whole of it until `until` (ms, the runner server's clock): it renews the promise every few seconds while it works the job, and does not begin a turn that
     * is not yet in a published list before the promise it gave has run out. So a call that reaches ANOTHER server is tied to its turn only while a promise
     * covers it; its row is then found by Orbit when it judges that turn. Not an arrival.
     */
    noteTurn?(jobId: string, turns: SharedTurn[], until: number): Promise<void>;
    /** The lists of turns the other servers' runners said, each with its promise (see `noteTurn`), or an empty list for none. Rejects when the shared store cannot be read. */
    turnsByOthers?(jobId: string): Promise<SharedTurnList[]>;
    /**
     * This server took up a call of the job (the shared pool had room for it), at this moment (ms): `turn` is the turn (and run) the call began in, so the
     * runner of ANOTHER turn does not count it. Not an arrival: `lastCalledByOthers` does not read it. The write is awaited (bounded) before the call goes on.
     */
    noteAccepted?(jobId: string, at: number, turn?: CallTurn): Promise<void | boolean>;
    /**
     * The runner's server GIVES UP the turn (and run) it is on, as ONE step in the store: when no other server has written an acceptance for that turn since `from` (ms)
     * the turn is fenced and this answers true, and a `noteAccepted` made after that is refused (answers false), so a call can never be taken up for a turn that is
     * being given up, and a turn with a call taken up is never given up. False when an acceptance counts. Rejects when the store cannot be read or written.
     */
    closeTurn?(jobId: string, turn: CallTurn | undefined, from: number, at: number): Promise<boolean>;
    /**
     * Takes back the fence this server wrote for the turn (and run) at the moment `at` (the `at` of its `closeTurn`), as ONE step: it deletes the fence field only while
     * the field still holds exactly that moment, so a fence of a later close is never touched, and it is safe to say twice. Used when a close is not the give-up it was
     * made for (the store did not say whether it ran, or a call was taken up meanwhile): the turn goes on, and a fence that stays would have every other server
     * refuse the calls of a turn that is alive. Rejects when the store cannot be written.
     */
    retractFence?(jobId: string, turn: CallTurn | undefined, at: number): Promise<void>;
    /**
     * The latest moment (ms) another bot server took up a call of the job (of that turn and run, when given; a call whose turn was not known counts for every
     * turn), or null for none. Rejects when the shared store cannot be read.
     */
    lastAcceptedByOthers?(jobId: string, turn?: CallTurn): Promise<number | null>;
}

/** A runner's list of turns and how long it promises the list to be the whole of it (see `SharedCalls.noteTurn`). */
export interface SharedTurnList {
    turns: SharedTurn[];
    /** The runner server's clock, ms. */
    until: number;
}

/** How long a runner's promise that its list of turns is complete lasts, and how often it renews it while it works the job. */
export const SHARED_TURN_LEASE_MS = 6000;
export const SHARED_TURN_RENEW_MS = 2000;

/** How long the relay waits for the shared record of a call before it forwards the call anyway (each of its two tries). */
export const SHARED_WRITE_BOUND_MS = 1000;

/** The bot servers' clocks can differ a little: a call of another server counts for a turn that began up to this long after it. */
export const SHARED_CALL_SKEW_MS = 2000;

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
     * The turn (and run) a call that reached the relay at `arrived` belongs to. When the job's runner works on this server it is what `turnAt` says. When it works
     * on ANOTHER server (the machine's calls reach whichever server the load balancer picks) this server has no history of the job's turns, so the runner's
     * server is asked through the shared record: the turn that had begun by the time the call arrived. `turn: null` when that cannot be told (nothing was said,
     * the store cannot be read, or the call arrived within `SHARED_CALL_SKEW_MS` of a turn's beginning: the two servers' clocks may differ by that much): the row is then read by Orbit with every turn it judges. Never rejects.
     */
    turnOfCall(jobId: string, arrived?: { order: number; at: number }): Promise<{ turn: number | null; run?: string }>;
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
    /**
     * Brings back the rows that were kept (in the store) and not taken by Orbit before the bot server stopped, and sends them again under the ids they
     * had (the external action is never repeated: only the evidence is delivered). False when the store could not be read (ask again later); true
     * when it was read, or there is no store.
     */
    resume(): Promise<boolean>;
    /**
     * Puts the dead letters (rows Orbit refused alone while it took others) back among the rows waiting for Orbit, under the ids they had, and sends them (the
     * ones of one job, or all). A row Orbit takes leaves the dead letters; a row it refuses alone again stays there, with nothing told again; none is
     * deleted otherwise (they are kept `DEAD_LETTER_KEEP_MS`). Answers how many rows were put back, or null when the store could not be read.
     */
    replayDeadLetters(jobId?: string): Promise<number | null>;
    /** The point in the order of events from which a turn's window starts: what is noted after this call, and only that, is in the window. */
    mark(): { order: number; at: number };
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
    /** A call of this job REACHED the relay (its key was known to Orbit): whatever became of the call, the machine can reach the relay. */
    called(jobId: string, at?: CallTurn): void;
    /**
     * `called`, for a relay about to forward a call: the call is also recorded for the other bot servers and this WAITS for that (each of two tries bounded at
     * `SHARED_WRITE_BOUND_MS`, the same moment both times), so a runner on another server never reads "no call" for a call that did arrive. Resolves true
     * when it was recorded (and with no shared store). When both tries fail the operators are told once per job and: if this server's runner is working the
     * job NOW (`runsHere`) the call may go ahead, since the runner's own notes see it: the other servers are told apart that a call was not recorded
     * and it resolves false; if it is not (or nothing says so), no runner can ever see this call, so it must not be forwarded: resolves `'unservable'` (the relay answers 503
     * and records a fault of ours for the call through the sink, which does not rest on the shared store). Never rejects. `arrivedAt` is the moment the call ARRIVED
     * (from `mark`): the shared record carries that moment in both tries and in the marker of a call that could not be recorded, never the time the write happens to be made.
     */
    reached(jobId: string, at?: CallTurn, arrivedAt?: number): Promise<boolean | 'unservable'>;
    /** Whether any call of this job reached the relay since this point (or at or after this moment, ms), as THIS server saw it. */
    calledSince(jobId: string, since: Since): boolean;
    /**
     * Whether any call of this job reached any bot server's relay since this point: this server's own notes, and the other servers' through the shared
     * store. True when it cannot be told (the store cannot be read, or the point has no moment): a missing note must never become a confirmed fault of
     * ours. Without a shared store it is `calledSince`.
     */
    calledAnywhereSince(jobId: string, since: Since): Promise<boolean>;
    /**
     * A call of this job got past Orbit's room check (the shared pool had room for it): it was taken up, whatever became of it after. When the job's runner works
     * on this server the note is made at once (nothing is returned). When it works on ANOTHER server this returns the handoff of the acceptance (bounded, two
     * tries) for the relay to wait on BEFORE the provider is called: false when it could not be made, and the relay then releases the room and forwards nothing,
     * so the runner never reads "no call was taken up" while a call of the turn is in flight. False too when the turn was given up by its runner (here, or through
     * the store's fence): a call that our relay refuses is refused by us, whatever the reason, and the relay records it as a fault of ours.
     */
    accepted(jobId: string, at?: CallTurn): void | boolean | Promise<boolean>;
    /**
     * The runner GIVES UP the turn it is on (every call of it was refused for want of room): true only when no call of it was taken up on ANY bot server up to the
     * moment the turn is closed, and from then on no call is taken up for it (`accepted` refuses, on this server and, through the shared store, on the others). False
     * when a call was taken up, or when it cannot be told (the store cannot be read or written): the turn is then not given up. A turn closed that is not then given up
     * (it ended meanwhile) is no harm: nothing more is taken for it, and its job moves on to a turn of its own.
     */
    closeTurn(jobId: string, since: Since): Promise<boolean>;
    /** Waits until the turn the runner just began is in a list the other servers can read (bounded), or until the promise of the lists before it has run out. */
    turnPublished?(jobId: string): Promise<void>;
    /** Whether any call of this job was taken up since this point (or at or after this moment, ms): `0` asks whether one ever was. */
    acceptedSince(jobId: string, since: Since): boolean;
    /**
     * Whether a call of this job was taken up since this point on ANY bot server: this server's own notes, and the other servers' through the shared store
     * (their relays take the calls the machine sends them, the runner of the job lives on one). True when it cannot be told (the store cannot be read, or the
     * point has no moment): a turn is given up only on what is known. Without a shared store it is `acceptedSince`.
     */
    acceptedAnywhereSince(jobId: string, since: Since): Promise<boolean>;
    /**
     * Whether the calls of this job since this point were ALL refused for want of room in the shared pool: at least one was, CONFIRMED (kind `fault`), none was
     * taken up, and nothing else refused a call either (the person's allowance or a rule of theirs, a refusal that is theirs).
     */
    onlyPoolBusySince(jobId: string, since: Since): boolean;
}

/** The turn (and run) a call began in: what a call is tied to when the relay only learns who it is after the runner may have moved on. */
export interface CallTurn {
    turn: number;
    run?: string;
}

/** A note older than this can no longer belong to a turn that is being read. */
export const REFUSAL_NOTE_KEEP_MS = 60 * 60 * 1000;

export interface RefusalOptions {
    /**
     * Where rows go: Orbit's fault record. Resolves false when Orbit could not take them (they are kept and tried again), and `'rejected'` when Orbit
     * answered that it will not take THESE rows, whatever the time (its own 400): the batch is split to find the row that is refused. `'missing'` when
     * Orbit says it has no such job (its own "Job not found"): there is nothing to keep the rows for, so they are removed, but it is NOT proof that Orbit
     * accepts evidence (it did not read the rows), so it never counts as Orbit taking rows.
     */
    sink?: (botId: string, jobId: string, rows: CallRow[]) => Promise<boolean | 'rejected' | 'missing'>;
    /** How long to wait before each new try to send rows. */
    retryMs?: number[];
    /** How long to wait, after those tries all failed, before each later try in the background (rows are kept an hour in all). */
    laterMs?: number[];
    /** The most time a flush waits in all, across every try. */
    flushBudgetMs?: number;
    /** Where rows are kept until Orbit takes them, so they survive a restart. Without one they are kept in memory only. */
    store?: EvidenceStore;
    /**
     * Whether THIS process's runner is working the job right now (it is in the runner's active jobs this moment). Not what the notes remember: a server whose
     * runner stopped the job, or lost it to another server, no longer runs it, whatever turns its notes still hold. Without it nothing is run here.
     */
    runsHere?: (jobId: string) => boolean;
    /** Where the bot servers say to each other that a call of a job arrived, so a runner can tell "no call reached the relay" from "none reached this server". */
    shared?: SharedCalls;
    /** With a store: how long to wait between tries once the later ones are used up (rows are kept `EVIDENCE_KEEP_MS` in all). */
    storeLaterMs?: number;
    /**
     * Tells the operators (Sentry) once: `not_durable` when a row could not be kept in the store (once until a write succeeds again), `unacked` when
     * a row has waited for Orbit longer than `EVIDENCE_UNACKED_MS` (once per row), `dead_letter` when Orbit refused a row ALONE (its own 400) while it took
     * others: the row was moved to the dead letters (kept 30 days, never deleted, replayable under its id) and is no longer sent, `all_refused` when Orbit
     * refused a row and has taken none lately (a contract or version mismatch, or Orbit broken: the rows are kept and sent again like when Orbit is away;
     * once until Orbit takes a row again), `called_unrecorded` when the shared record of a call of a job could not be written twice (once per job: the call
     * may have gone ahead or been refused (503), that depends on whether the job's runner works here, so this says only that it was not recorded). Carries ids only (callId is empty for that one). Never throws into the caller's way.
     */
    report?: (what: 'not_durable' | 'unacked' | 'dead_letter' | 'all_refused' | 'called_unrecorded', info: { jobId: string; callId: string }) => void;
}

/**
 * What each thing `report` tells is called for the operators (Sentry). `called_unrecorded` claims nothing about what became of the call: with the job's runner
 * on this server it goes ahead, with the runner elsewhere the relay refuses it (503) without forwarding it.
 */
export const FAULT_EVIDENCE_MESSAGES = {
    not_durable: 'Fault evidence not durable',
    unacked: 'Fault evidence not acknowledged by Orbit for an hour',
    dead_letter: 'Fault evidence row refused by Orbit alone and set aside (kept 30 days)',
    all_refused: 'Orbit refuses every fault evidence row it is sent: kept and sent again',
    called_unrecorded: 'A computer model call could not be recorded for the other bot servers (the call may have been refused with a 503 or have gone ahead: the relay log of the job says which)',
} as const;

/** How many of the latest turns a runner tells the other servers (a call that began before the latest turn began is tied to the one before). */
const SHARED_TURNS = 6;

/** How long a row that Orbit has not taken is kept and sent again, in the store and in memory: 7 days. */
export const EVIDENCE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** A row Orbit has not taken after this long is told to the operators once. */
export const EVIDENCE_UNACKED_MS = 60 * 60 * 1000;
const DEFAULT_STORE_LATER_MS = 5 * 60 * 1000;

/** The most rows Orbit takes in one call. */
export const FAULT_ROWS_PER_CALL = 50;
const DEFAULT_RETRY_MS = [500, 2000, 8000];
/** Later tries in the background once the quick ones failed: Orbit may be back after the job has ended. Bounded; the rows are kept an hour. */
const DEFAULT_LATER_MS = [30_000, 120_000, 600_000];
/** A job is not held up longer than this to get its rows to Orbit before it ends. */
const DEFAULT_FLUSH_BUDGET_MS = 5000;

export function createRefusalNotes(now: () => number = Date.now, options: RefusalOptions = {}): RefusalNotes & { /** For tests: how many jobs the runner's publication bookkeeping holds. */ trackedPublications(): { attempted: number; publishing: number } } {
    const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    const laterMs = options.laterMs ?? DEFAULT_LATER_MS;
    const flushBudgetMs = options.flushBudgetMs ?? DEFAULT_FLUSH_BUDGET_MS;
    const store = options.store;
    const storeLaterMs = options.storeLaterMs ?? DEFAULT_STORE_LATER_MS;
    const last = new Map<string, { at: number; order: number }>();
    // The order of events is kept by count, since two can land in the same millisecond
    let count = 0;
    const calls = new Map<string, { fault?: { at: number; order: number }; confirmed?: { at: number; order: number }; answered?: { at: number; order: number }; called?: { at: number; order: number }; accepted?: { at: number; order: number }; pooled?: { at: number; order: number }; other?: { at: number; order: number } }>();
    /** Whether an event is inside a window that begins at `since`. */
    const within = (event: { at: number; order: number }, since: Since) => (typeof since === 'number' ? event.at >= since : event.order > since.order);
    // The turns the runner said it was on, newest last, each with its place in the order of events: a short history, so a call can be tied to the
    // turn that was current when it ARRIVED. It is kept short: a call only ever asks about a turn that has just changed
    // `begun`: the moment the runner went on to work the turn (it is in a list the others can read, or the promise of the lists before it ran out): a call of the machine
    // cannot be of the turn before that moment. Not set while the runner has not got that far (`turnPublished`)
    const turns = new Map<string, Array<{ turn: number; run?: string; at: number; order: number; begun?: number }>>();
    const TURN_HISTORY = 16;
    const lastTurn = (jobId: string) => turns.get(jobId)?.at(-1);
    /** A call that began in a turn (or a run) the runner has left says nothing of the turn it is on now. */
    const staleCall = (jobId: string, at: CallTurn | undefined) => {
        const active = lastTurn(jobId);
        return at !== undefined && active !== undefined && (active.turn !== at.turn || active.run !== at.run);
    };
    // Rows not yet taken by Orbit, per job. A row is sent again until Orbit takes it (Orbit keeps one per job and call).
    type Queue = {
        botId: string;
        rows: Map<string, CallRow>;
        sending?: Promise<boolean>;
        at: number;
        later?: ReturnType<typeof setTimeout>;
        laterTries: number;
        /** The writes to the store that have not ended, by call id (a later write or a removal of the same row waits for the one before it). */
        writes: Map<string, Promise<boolean>>;
        /** Rows the store could not keep: written again when the job is about to end, so what the money decision rests on is kept before it is final. */
        unsaved: Map<string, CallRow>;
        /** Rows put back from the dead letters by a replay (still kept there until Orbit takes them). */
        fromDead: Set<CallRow>;
    };
    const queued = new Map<string, Queue>();
    let notDurableTold = false;
    const unackedTold = new Set<string>();
    /** When Orbit last took a row (any job): a refusal of one row alone counts as the row's own only while Orbit is taking others. */
    let orbitTookAt: number | null = null;
    let allRefusedTold = false;
    /** Jobs whose call the shared record could not hold (told to the operators once each; forgotten with the notes). */
    const unrecordedTold = new Map<string, number>();
    /** Dead letters when there is no store to keep them in (kept as long as the process lives: never deleted). */
    const deadInMemory = new Map<string, { botId: string; jobId: string; row: CallRow }>();
    const tell = (what: 'not_durable' | 'unacked' | 'dead_letter' | 'all_refused' | 'called_unrecorded', jobId: string, callId: string) => {
        try {
            options.report?.(what, { jobId, callId });
        } catch {
            /* telling the operators never holds the evidence */
        }
    };
    /** Tells the operators once of each row Orbit has not taken for an hour. */
    const watchUnacked = (entry: Queue, jobId: string) => {
        for (const row of entry.rows.values()) {
            const key = `${jobId}|${row.callId}`;
            if (unackedTold.has(key)) continue;
            const since = Date.parse(row.at);
            if (Number.isFinite(since) && now() - since >= EVIDENCE_UNACKED_MS) {
                unackedTold.add(key);
                tell('unacked', jobId, row.callId);
            }
        }
    };
    const newQueue = (botId: string): Queue => ({ botId, rows: new Map(), at: now(), laterTries: 0, writes: new Map(), unsaved: new Map(), fromDead: new Set() });
    /** Keeps a row in the store; the write is tracked so a flush can wait for it and a removal can follow it. Never throws. */
    const keep = (entry: Queue, jobId: string, row: CallRow) => {
        if (!store) return;
        const before = entry.writes.get(row.callId) ?? Promise.resolve(true);
        const write = before
            .then(() => store.save(entry.botId, jobId, row))
            .catch(() => false)
            .then((kept) => {
                if (kept) {
                    notDurableTold = false;
                    if (entry.unsaved.get(row.callId) === row) entry.unsaved.delete(row.callId);
                } else {
                    // The row stays in memory and goes on being sent; the operators are told once for as long as the store keeps failing
                    if (!notDurableTold) {
                        notDurableTold = true;
                        tell('not_durable', jobId, row.callId);
                    }
                    if (entry.rows.get(row.callId) === row) entry.unsaved.set(row.callId, row);
                }
                return kept;
            });
        entry.writes.set(row.callId, write);
        void write.then(() => {
            if (entry.writes.get(row.callId) === write) entry.writes.delete(row.callId);
        });
    };
    /**
     * Takes rows Orbit has taken out of the store, after any write of them that is still going. Only the rows Orbit took: a row of the same call id that
     * was saved since (a newer one Orbit has not taken) is left where it is.
     */
    const release = (entry: Queue, jobId: string, rows: CallRow[]) => {
        if (!store || rows.length === 0) return;
        void Promise.all(rows.map((row) => entry.writes.get(row.callId) ?? true))
            .then(() => store.drop(entry.botId, jobId, rows))
            .catch(() => undefined);
    };
    const forget = () => {
        const cutoff = now() - REFUSAL_NOTE_KEEP_MS;
        for (const [jobId, seen] of last) if (seen.at < cutoff) last.delete(jobId);
        for (const [jobId, seen] of calls) if (Math.max(seen.fault?.at ?? 0, seen.answered?.at ?? 0, seen.called?.at ?? 0, seen.accepted?.at ?? 0, seen.pooled?.at ?? 0, seen.other?.at ?? 0) < cutoff) calls.delete(jobId);
        for (const [jobId, seen] of turns) if ((seen.at(-1)?.at ?? 0) < cutoff) turns.delete(jobId);
        for (const [jobId, at] of unrecordedTold) if (at < cutoff) unrecordedTold.delete(jobId);
        for (const [jobId, one] of closed) if (one.at < cutoff) closed.delete(jobId);
        // What the runner told of its turns is only read while a promise could still be read as covering: a promise that has lapsed says nothing (`turn()` copies
        // `before` by value, so dropping a lapsed one is safe), and a publication is kept while a `turnPublished` wait could still read it (its write is going, or
        // the promise of the lists before it still stands), and dropped with the job's turn history
        const present = now();
        for (const [jobId, until] of attempted) if (until < present) attempted.delete(jobId);
        for (const [jobId, entry] of publishing) if (!turns.has(jobId) || (entry.settled && entry.before <= present)) publishing.delete(jobId);
        // With a store, rows Orbit has not taken are kept (and sent again) as long as in the store
        const queueCutoff = store ? now() - EVIDENCE_KEEP_MS : cutoff;
        for (const [jobId, entry] of queued) {
            if (entry.at >= queueCutoff || entry.sending) continue;
            if (entry.later) clearTimeout(entry.later);
            for (const callId of entry.rows.keys()) unackedTold.delete(`${jobId}|${callId}`);
            queued.delete(jobId);
        }
    };
    // The other servers are told only when the caller says so (`tellOthers`), and only for an ARRIVAL: the one place that does is `called()`. Everything else
    // is how a call ended, which is local: a default of telling would publish the end of a call as a new arrival
    const mark = (jobId: string, kind: 'fault' | 'answered' | 'called' | 'accepted' | 'pooled' | 'other', confirmed = false, tellOthers = false) => {
        forget();
        const seen = calls.get(jobId) ?? {};
        seen[kind] = { at: now(), order: ++count };
        if (confirmed) seen.confirmed = { at: now(), order: count };
        // A call that ended in any way reached the relay
        if (kind !== 'called') seen.called = { at: now(), order: count };
        // The other bot servers are told of the ARRIVAL of a call, at its arrival (a call of a turn the runner here has left is not noted by anything above, so it
        // is not told either). How a call ended (an answer, a fault, a refusal) is local: told at its end it would be a new arrival at the time it ended, and a
        // call of turn 4 that finishes in turn 5 would hide a genuine no_call of turn 5 from the runner on another server
        if (options.shared && tellOthers && kind === 'called') {
            try {
                options.shared.noteCalled(jobId, now()).catch(() => undefined);
            } catch {
                /* telling the other servers never holds a call */
            }
        }
        // An answer was a call Orbit found room for
        if (kind === 'answered') seen.accepted = { at: now(), order: count };
        calls.set(jobId, seen);
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    /** Takes rows out of the queue once Orbit has dealt with them (took them, or refused one alone for good). A row that was changed meanwhile (an upgrade) stays. */
    const settle = (entry: Queue, jobId: string, rows: CallRow[]) => {
        for (const row of rows) {
            if (entry.rows.get(row.callId) !== row) continue;
            entry.rows.delete(row.callId);
            entry.unsaved.delete(row.callId);
            unackedTold.delete(`${jobId}|${row.callId}`);
        }
        // Every row Orbit dealt with leaves the store, a replaced one too: the store keeps the row only if it still holds exactly that one, so a replacement
        // whose write went through stays, and an older row left behind by a replacement whose write failed does not come back after a restart
        release(entry, jobId, rows);
    };

    /** Rows put back from the dead letters leave them once Orbit has TAKEN them (a refusal alone leaves them where they are). */
    const leaveDead = (entry: Queue, jobId: string, rows: CallRow[]) => {
        const back = rows.filter((row) => entry.fromDead.delete(row));
        if (back.length === 0) return;
        for (const row of back) deadInMemory.delete(`${jobId}|${row.callId}`);
        if (store?.dropDead) void store.dropDead(entry.botId, jobId, back).catch(() => undefined);
    };

    /**
     * Gets one batch to Orbit. True when every row of it was dealt with (taken, or refused alone: those wait in `pass.suspects`), false when Orbit could
     * not be reached or failed (the rest waits for the next try, with the same call ids). When Orbit refuses the batch for what is in it (a 400 rejects all of
     * a batch for one bad row), the batch is split in halves so the good rows get through.
     */
    const deliver = async (entry: Queue, jobId: string, batch: CallRow[], sink: NonNullable<RefusalOptions['sink']>, pass: { suspects: Set<CallRow> }): Promise<boolean> => {
        let answer: boolean | 'rejected' | 'missing' = false;
        try {
            answer = await sink(entry.botId, jobId, batch);
        } catch {
            answer = false;
        }
        if (answer === 'missing') {
            // Cleaned up like rows taken, but Orbit read none of them: `orbitTookAt` is for the times Orbit ACCEPTED evidence, which tells a refusal of one
            // row from a contract that no longer fits
            settle(entry, jobId, batch);
            leaveDead(entry, jobId, batch);
            return true;
        }
        if (answer === true) {
            orbitTookAt = now();
            allRefusedTold = false;
            settle(entry, jobId, batch);
            leaveDead(entry, jobId, batch);
            return true;
        }
        if (answer !== 'rejected') return false;
        if (batch.length === 1) {
            pass.suspects.add(batch[0]);
            return true;
        }
        const half = Math.ceil(batch.length / 2);
        return (await deliver(entry, jobId, batch.slice(0, half), sink, pass)) && (await deliver(entry, jobId, batch.slice(half), sink, pass));
    };

    /** Keeps a dead letter where it survives (the store, or memory without one). False when the store could not keep it. */
    const keepDead = async (botId: string, jobId: string, row: CallRow): Promise<boolean> => {
        if (!store?.deadLetter) {
            deadInMemory.set(`${jobId}|${row.callId}`, { botId, jobId, row });
            return true;
        }
        try {
            return await store.deadLetter(botId, jobId, row);
        } catch {
            return false;
        }
    };

    /**
     * What to do with the rows Orbit refused alone, once the pass is over. When Orbit has taken rows lately (in this pass or just before) the contract works
     * and the row is its own fault: it is moved to the dead letters (kept, never deleted, replayable under its id) and told once. When Orbit has taken none
     * it is treated like Orbit being away: the rows stay, are sent again with backoff, and the operators are told once. False while a row is left.
     */
    const resolveSuspects = async (entry: Queue, jobId: string, suspects: Set<CallRow>): Promise<boolean> => {
        if (suspects.size === 0) return true;
        if (orbitTookAt === null || now() - orbitTookAt > ORBIT_TAKING_ROWS_MS) {
            if (!allRefusedTold) {
                allRefusedTold = true;
                tell('all_refused', jobId, [...suspects][0].callId);
            }
            return false;
        }
        let all = true;
        for (const row of suspects) {
            // A row put back by a replay is still kept among the dead letters: refused alone again it goes back to waiting there, and nothing is told again
            if (entry.fromDead.delete(row)) {
                settle(entry, jobId, [row]);
                continue;
            }
            // Kept apart first: only then does the row leave the rows waiting for Orbit
            if (!(await keepDead(entry.botId, jobId, row))) {
                all = false;
                continue;
            }
            settle(entry, jobId, [row]);
            tell('dead_letter', jobId, row.callId);
        }
        return all;
    };

    /** Sends the job's queued rows, a batch at a time; a batch Orbit did not take waits for the next try. One sender per job at a time. */
    const send = (jobId: string): Promise<boolean> => {
        const entry = queued.get(jobId);
        if (!entry || entry.rows.size === 0) return Promise.resolve(true);
        if (!options.sink) return Promise.resolve(true);
        if (entry.sending) return entry.sending;
        const sink = options.sink;
        entry.sending = (async () => {
            for (let attempt = 0; ; attempt++) {
                // Rows the store could not keep are written again with each try, the later ones in the background included: Redis may be back while Orbit is
                // still away, and the row is the only copy that survives a restart (one Orbit has taken is not written again: it is no longer in `unsaved`)
                for (const row of [...entry.unsaved.values()]) if (entry.rows.get(row.callId) === row) keep(entry, jobId, row);
                // Rows Orbit refuses alone are set aside for this pass: the rows after them are sent
                const pass = { suspects: new Set<CallRow>() };
                let reached = true;
                for (;;) {
                    const batch = [...entry.rows.values()].filter((row) => !pass.suspects.has(row)).slice(0, FAULT_ROWS_PER_CALL);
                    if (batch.length === 0) break;
                    if (!(await deliver(entry, jobId, batch, sink, pass))) {
                        reached = false;
                        break;
                    }
                }
                if (reached && pass.suspects.size > 0) await resolveSuspects(entry, jobId, pass.suspects);
                if (entry.rows.size === 0) {
                    // Everything was taken: the budget of later tries starts again for rows that come next, and a try still waiting has nothing to send
                    entry.laterTries = 0;
                    if (entry.later) {
                        clearTimeout(entry.later);
                        entry.later = undefined;
                    }
                    return true;
                }
                watchUnacked(entry, jobId);
                if (attempt >= retryMs.length) return false;
                await sleep(retryMs[attempt]);
            }
        })().finally(() => {
            entry.sending = undefined;
        });
        void entry.sending.then((sent) => {
            if (!sent) later(jobId);
            // A row that was queued while the sender was going idle joined a sender that had already looked: it is sent now that the sender is gone
            // (a failed send stays on its own schedule)
            else if (entry.rows.size > 0 && queued.get(jobId) === entry) void send(jobId);
        });
        return entry.sending;
    };

    /** After the quick tries failed (the last flush before the job ended included), one more try is set for later, a few times, never more than one waiting. */
    const later = (jobId: string) => {
        const entry = queued.get(jobId);
        if (!entry || entry.later || entry.rows.size === 0) return;
        // With a store the tries go on, slowly, for as long as the rows are kept; without one they stop after the last of the later ones
        const delay = laterMs[entry.laterTries] ?? (store ? storeLaterMs : undefined);
        if (delay === undefined) return;
        const timer = setTimeout(() => {
            entry.later = undefined;
            entry.laterTries += 1;
            void send(jobId);
        }, delay);
        // A try for later never keeps the process alive
        timer.unref?.();
        entry.later = timer;
    };

    /** Whether this process's runner works the job right now (see `runsHere`). */
    const runnerHere = (jobId: string): boolean => {
        try {
            return options.runsHere?.(jobId) === true;
        } catch {
            return false;
        }
    };
    /** A write to the shared store, bounded: true when it was made, false when it failed or did not finish in time (it may still land). */
    const bounded = (work: () => Promise<void>) =>
        new Promise<boolean>((resolve) => {
            let promise: Promise<void>;
            try {
                promise = work();
            } catch {
                resolve(false);
                return;
            }
            const timer = setTimeout(() => resolve(false), SHARED_WRITE_BOUND_MS);
            timer.unref?.();
            promise.then(
                () => {
                    clearTimeout(timer);
                    resolve(true);
                },
                () => {
                    clearTimeout(timer);
                    resolve(false);
                }
            );
        });
    // The turn (and run) the runner here GAVE UP, by job: no call is taken up for it from the moment it is closed (see `closeTurn`). One per job: a job that is given
    // up is ended, and a later turn is another key
    const closed = new Map<string, { key: string; at: number }>();
    const keyOf = (turn: CallTurn | undefined): string => (turn ? `${turn.turn}|${turn.run ?? ''}` : '');
    /** A write to the shared store that answers whether it was made: `true`, `false` (the store refused it: final) or `'lost'` (it failed or did not finish in time: it may still land). */
    const boundedAnswer = (work: () => Promise<void | boolean>) =>
        new Promise<true | false | 'lost'>((resolve) => {
            let promise: Promise<void | boolean>;
            try {
                promise = work();
            } catch {
                resolve('lost');
                return;
            }
            const timer = setTimeout(() => resolve('lost'), SHARED_WRITE_BOUND_MS);
            timer.unref?.();
            promise.then(
                (answer) => {
                    clearTimeout(timer);
                    resolve(answer === false ? false : true);
                },
                () => {
                    clearTimeout(timer);
                    resolve('lost');
                }
            );
        });
    // What this runner has told the other servers of its turns. `attempted`: the latest promise (`until`) of any list it tried to publish, landed or not (a write that
    // timed out may still land), so it is never begun on a turn that no published list holds while such a promise could still be read as covering
    const attempted = new Map<string, number>();
    const publishing = new Map<string, { done: Promise<boolean>; before: number; settled: boolean }>();
    const beats = new Map<string, ReturnType<typeof setTimeout>>();
    const publishTurns = (jobId: string): Promise<boolean> => {
        const shared = options.shared;
        if (!shared?.noteTurn) return Promise.resolve(true);
        const history = turns.get(jobId) ?? [];
        const until = now() + SHARED_TURN_LEASE_MS;
        attempted.set(jobId, Math.max(until, attempted.get(jobId) ?? 0));
        // A turn the runner has not gone on to work is told as pending, from the moment it was noted; one it has is told from the moment it went on (what a call of
        // the machine can first be of this turn), which is never before the moment it was noted
        const list = history.slice(-SHARED_TURNS).map((one) => ({
            turn: one.turn,
            ...(one.run ? { run: one.run } : {}),
            at: one.begun ?? one.at,
            ...(one.begun === undefined ? { pending: true as const } : {}),
        }));
        return bounded(() => shared.noteTurn!(jobId, list, until));
    };
    /**
     * The fence of a turn written in the shared store (up to three tries, each bounded and all with the same moment, so a try that ran late writes what another did; the
     * script is idempotent): `fenced`
     * when it was written, `refused` when an acceptance counts (nothing written), `lost` when the store did not say. `maybeWritten`: a try did not answer, and it may have
     * run, so a fence of this moment may be there whatever the last answer was.
     */
    const closeOnStore = async (jobId: string, turn: CallTurn | undefined, from: number, at: number): Promise<{ state: 'fenced' | 'refused' | 'lost'; maybeWritten: boolean }> => {
        const shared = options.shared;
        if (!shared?.closeTurn) return { state: 'refused', maybeWritten: false };
        let maybeWritten = false;
        for (let tries = 0; tries < 3; tries++) {
            const answer = await boundedAnswer(() => shared.closeTurn!(jobId, turn, from, at));
            if (answer === 'lost') {
                maybeWritten = true;
                continue;
            }
            return { state: answer ? 'fenced' : 'refused', maybeWritten: maybeWritten || answer };
        }
        return { state: 'lost', maybeWritten };
    };
    /** Takes this server's fence of that moment back out of the store (three tries, each bounded): true when the store said it ran, false when it could not be confirmed. */
    const retractOnStore = async (jobId: string, turn: CallTurn | undefined, at: number): Promise<boolean> => {
        const shared = options.shared;
        if (!shared?.retractFence) return false;
        for (let tries = 0; tries < 3; tries++) {
            if ((await boundedAnswer(() => shared.retractFence!(jobId, turn, at))) !== 'lost') return true;
        }
        return false;
    };
    /** While the runner works the job its promise is renewed (the full list again), so a call well inside a turn is covered; it lapses when the runner stops. */
    const keepPromise = (jobId: string) => {
        if (beats.has(jobId)) return;
        const timer = setTimeout(() => {
            beats.delete(jobId);
            if (!runnerHere(jobId)) return;
            void publishTurns(jobId);
            keepPromise(jobId);
        }, SHARED_TURN_RENEW_MS);
        timer.unref?.();
        beats.set(jobId, timer);
    };

    return {
        trackedPublications: () => ({ attempted: attempted.size, publishing: publishing.size }),
        turn(jobId, turn, run) {
            forget();
            const history = turns.get(jobId) ?? [];
            // The same turn said again (a reconnect to it) is the same turn: it keeps the moment it began
            const latest = history.at(-1);
            if (!latest || latest.turn !== turn || latest.run !== run) {
                history.push({ turn, ...(run ? { run } : {}), at: now(), order: ++count });
                if (history.length > TURN_HISTORY) history.shift();
            }
            turns.set(jobId, history);
            // The other servers learn which turn the runner is on, for the calls of the machine that reach them (see `turnPublished`)
            if (options.shared?.noteTurn) {
                // The promise any earlier list of this job may still make, and that this one cannot see when it has none of its own (a job taken over from a runner on another
                // server, or after a restart): a list of THAT runner can cover a call for up to one lease more, so it is waited out when this one cannot be published
                const before = Math.max(attempted.get(jobId) ?? 0, attempted.has(jobId) ? 0 : now() + SHARED_TURN_LEASE_MS);
                const entry = { done: publishTurns(jobId), before, settled: false };
                void entry.done.then(() => (entry.settled = true));
                publishing.set(jobId, entry);
                keepPromise(jobId);
            }
        },
        async turnPublished(jobId) {
            const shared = options.shared;
            const entry = publishing.get(jobId);
            if (!shared?.noteTurn || !entry) return;
            let ok = await entry.done;
            // The turn is in no list the others can read. The lists before it still promise to be complete until `before`: a call that arrives while one covers it
            // would be put in the turn before, so this turn is not begun until those promises have run out (with the store failing, no list is read as covering
            // then). Tried again meanwhile; the wait is the length of one promise at most
            for (let tries = 0; !ok && now() < entry.before && tries < 2 * Math.ceil(SHARED_TURN_LEASE_MS / 250); tries++) {
                await sleep(250);
                ok = await publishTurns(jobId);
            }
            // The runner goes on to work the turn: from this moment a call of the machine can be of it, and one that arrived before it (after the turn was noted, while the
            // turn before could still be making its last calls) cannot. That is what the others are told next, in place of the moment the turn was noted
            const current = lastTurn(jobId);
            if (current && current.begun === undefined) {
                current.begun = Math.max(now(), current.at);
                void publishTurns(jobId);
            }
        },
        turnOf: (jobId) => lastTurn(jobId)?.turn ?? 0,
        async turnOfCall(jobId, arrived) {
            const here = (): { turn: number; run?: string } => {
                const at = arrived !== undefined ? this.turnAt(jobId, arrived) : undefined;
                const turn = at ? at.turn : lastTurn(jobId)?.turn ?? 0;
                const run = at ? at.run : lastTurn(jobId)?.run;
                return { turn, ...(run ? { run } : {}) };
            };
            // Without a shared store there is one server; and when the runner of the job works here, this server's own notes are the history of its turns
            const shared = options.shared;
            if (!shared?.turnsByOthers) return here();
            if (runnerHere(jobId)) return here();
            // The runner is on another server: the turn that had begun when the call arrived, by the moments the servers keep (this server's turns of the job, if
            // it ran it before, are old history and say nothing of now). Only from a list whose runner promises that it is the whole of its turns at that
            // moment: a successful read does not say the latest write was made, and a list from before a lost write would give a call the turn before its own
            try {
                const lists = await new Promise<SharedTurnList[]>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('slow')), SHARED_WRITE_BOUND_MS);
                    timer.unref?.();
                    shared.turnsByOthers!(jobId).then(
                        (found) => (clearTimeout(timer), resolve(found)),
                        (error) => (clearTimeout(timer), reject(error))
                    );
                });
                const arrivedAt = arrived?.at ?? now();
                // The promise is the runner server's clock and the arrival is this server's: the arrival must be inside the promise by more than the clocks can differ.
                // Exactly one runner's promise covers it: none (the runner stopped, the store lost its write) or two (a job taken over) cannot tell
                const covering = lists.filter((one) => Number.isFinite(one.until) && arrivedAt < one.until - SHARED_CALL_SKEW_MS);
                if (covering.length !== 1) return { turn: null };
                const said = covering[0].turns;
                // The turns' moments are the runner server's clock and the arrival is this server's: the clocks of two servers differ a little, so a call that arrived
                // near the moment ANY turn began could be put in the turn before or after the one it belongs to. Its turn cannot be told; the row is then read by
                // Orbit with every turn it judges
                if (said.some((one) => Math.abs(arrivedAt - one.at) <= SHARED_CALL_SKEW_MS)) return { turn: null };
                let chosen: SharedTurn | undefined;
                for (const one of said) if (one.at <= arrivedAt && (chosen === undefined || one.at > chosen.at)) chosen = one;
                // A turn the runner has not yet told that it went on to work: a call that arrived after the turn was noted may be of the turn before or of this one
                if (chosen?.pending) return { turn: null };
                return chosen ? { turn: chosen.turn, ...(chosen.run ? { run: chosen.run } : {}) } : { turn: null };
            } catch {
                return { turn: null };
            }
        },
        runOf: (jobId) => lastTurn(jobId)?.run,
        turnAt(jobId, at) {
            // The last turn said at or before that point (a turn said after it is a later one)
            const seen = [...(turns.get(jobId) ?? [])].reverse().find((one) => one.order <= at.order);
            return seen ? { turn: seen.turn, ...(seen.run ? { run: seen.run } : {}) } : { turn: 0 };
        },
        record(botId, jobId, call) {
            // A call that belongs to a turn (or a run) the runner has left says nothing of the turn it is on now: its row is still sent under its own
            // turn and run, but the notes the runner reads for the turn in progress are not changed by it
            const stale = staleCall(jobId, call.turn !== undefined && call.turn !== null ? { turn: call.turn, run: call.run } : undefined);
            if (call.kind === 'answered') return stale ? undefined : mark(jobId, 'answered');
            if (!stale) {
                if (call.kind === 'not_ours') {
                    forget();
                    last.set(jobId, { at: now(), order: ++count });
                    mark(jobId, 'called');
                } else {
                    mark(jobId, 'fault', call.kind === 'fault');
                    // Refused for want of room in the shared pool and CONFIRMED so (no room for even the smallest call, or none of the job's calls was ever taken
                    // up): the runner reads a turn of nothing but these as a machine to give up. A call refused for its own size (`uncertain`) is unresolved,
                    // so it neither starts the give-up nor ends a job as a confirmed fault of ours
                    if (call.reason === 'pool_busy' && call.kind === 'fault') mark(jobId, 'pooled');
                    // Any other way a call failed (the relay could not look up the route, a provider error, a key refused...) is no refusal for room: a turn that
                    // had one is no pool-only turn, whatever else it had
                    else if (call.reason !== 'pool_busy') mark(jobId, 'other');
                }
            }
            if (!options.sink && !store) return;
            const entry = queued.get(jobId) ?? newQueue(botId);
            entry.at = now();
            // Orbit keeps ids up to 120 characters: the row is kept under the id it is sent with
            const callId = call.callId.slice(0, 120);
            // A call that carries its turn carries that turn's run, and one that does not takes both from where the runner is now: never one of each
            const runOfRow = call.turn === undefined ? lastTurn(jobId)?.run : call.turn === null ? undefined : call.run;
            const row: CallRow = {
                turn: call.turn === null ? null : call.turn ?? lastTurn(jobId)?.turn ?? 0,
                ...(runOfRow ? { run: runOfRow } : {}),
                callId,
                kind: call.kind,
                reason: call.reason,
                source: call.source,
                route: call.route.slice(0, 80),
                providerStatus: call.providerStatus,
                at: new Date(now()).toISOString(),
            };
            entry.rows.set(callId, row);
            // An older row of this call that the store could not keep is no longer the one to keep: it is saved again only if the new one fails to be
            entry.unsaved.delete(callId);
            queued.set(jobId, entry);
            // Kept where a restart does not lose it, and sent without waiting: the call that made the row is not held for either
            keep(entry, jobId, row);
            void send(jobId);
        },
        flush(jobId) {
            const entry = queued.get(jobId);
            if (!entry) return Promise.resolve(true);
            // What is being sent now may leave rows behind (a failed batch, rows added meanwhile): look again when it is over
            const again = async (): Promise<boolean> => {
                // First what the money decision rests on is kept where a restart does not lose it (a write that failed is made again), then it is delivered
                if (store) {
                    // A write still going may end in a failure: wait for the writes first, then make again what did not stay (once, not for ever)
                    await Promise.all([...entry.writes.values()]).catch(() => undefined);
                    // Only a row that is still the current one: an older row saved over its replacement would bring the old outcome back after a restart
                    for (const row of [...entry.unsaved.values()]) if (entry.rows.get(row.callId) === row) keep(entry, jobId, row);
                    await Promise.all([...entry.writes.values()]).catch(() => undefined);
                }
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
        async resume() {
            if (!store) return true;
            let kept: Awaited<ReturnType<EvidenceStore['load']>>;
            try {
                kept = await store.load();
            } catch {
                return false;
            }
            for (const { botId, jobId, rows } of kept) {
                const entry = queued.get(jobId) ?? newQueue(botId);
                entry.at = now();
                // A row made in this process since the start is newer than the one that was kept: it stays
                for (const row of rows) if (!entry.rows.has(row.callId)) entry.rows.set(row.callId, row);
                if (entry.rows.size === 0) continue;
                queued.set(jobId, entry);
                void send(jobId);
            }
            return true;
        },
        async replayDeadLetters(onlyJob?: string) {
            let kept: Array<{ botId: string; jobId: string; rows: CallRow[] }>;
            try {
                kept = store?.loadDead ? await store.loadDead() : [];
            } catch {
                return null;
            }
            for (const one of deadInMemory.values()) {
                const found = kept.find((entry) => entry.jobId === one.jobId);
                if (found) {
                    if (!found.rows.some((row) => row.callId === one.row.callId)) found.rows.push(one.row);
                } else kept.push({ botId: one.botId, jobId: one.jobId, rows: [one.row] });
            }
            let put = 0;
            for (const { botId, jobId, rows } of kept) {
                if (onlyJob !== undefined && jobId !== onlyJob) continue;
                const entry = queued.get(jobId) ?? newQueue(botId);
                entry.at = now();
                for (const row of rows) {
                    // A row made in this process since is newer than the one that was kept: it stays. A row already back from the dead letters is not put twice.
                    if (entry.rows.has(row.callId)) continue;
                    entry.rows.set(row.callId, row);
                    // Not written to the pending store: the dead letter is the copy that survives (a restart replays it again, and Orbit keeps one row per call)
                    entry.fromDead.add(row);
                    put += 1;
                }
                if (entry.rows.size === 0) continue;
                queued.set(jobId, entry);
                void send(jobId);
            }
            return put;
        },
        mark: () => ({ order: count, at: now() }),
        confirmedSince(jobId, since) {
            const seen = calls.get(jobId);
            if (seen?.confirmed === undefined || !within(seen.confirmed, since)) return false;
            // A confirmed fault that a call answered after, in the same window, was recovered (the same rule as `endedOnFault`): the turn went on and the agent
            // got round it, so a streak of turns that then said nothing is the agent's and not ours
            return seen.answered === undefined || seen.answered.order < seen.confirmed.order;
        },
        note(jobId) {
            forget();
            last.set(jobId, { at: now(), order: ++count });
            // A refusal is the end of a call that arrived before: its arrival was told then
            mark(jobId, 'called', false, false);
        },
        sawSince(jobId, since) {
            const seen = last.get(jobId);
            return seen !== undefined && within(seen, since);
        },
        fault: (jobId) => mark(jobId, 'fault'),
        answered: (jobId) => mark(jobId, 'answered'),
        called(jobId, at) {
            if (!staleCall(jobId, at)) mark(jobId, 'called', false, true);
        },
        async reached(jobId, at, arrivedAt) {
            // A call of a turn the runner of THIS server has left says nothing of the turn it is on now. Only when the runner works here: a server that ran the job
            // before and no longer does holds an old history, which says nothing of a call that belongs to the runner on another server
            if (runnerHere(jobId) && staleCall(jobId, at)) return true;
            // The moment the call ARRIVED, in both tries and in the marker of a call that could not be recorded: a write made later must not look like a later arrival
            const moment = arrivedAt ?? now();
            mark(jobId, 'called');
            const shared = options.shared;
            if (!shared) return true;
            // Each try is bounded: the call it stands in front of is not held for a store that is slow. The same moment both times (the write keeps the
            // latest, so a try that did land after all is no harm)
            const attempt = (what: 'call' | 'unrecorded') => bounded(() => (what === 'call' ? shared.noteCalled(jobId, moment) : shared.noteUnrecorded(jobId, moment)));
            if ((await attempt('call')) || (await attempt('call'))) return true;
            if (!unrecordedTold.has(jobId)) {
                unrecordedTold.set(jobId, now());
                tell('called_unrecorded', jobId, '');
            }
            // The runner of the job is not working it here now (a turn in the notes proves nothing: the job may have been taken over by another server), so it can never see this call, and the record it would have read could
            // not be written: the call is not forwarded. Saying so apart would not help (the store is failing for this server, and the runner reads a store that
            // may be well): the refusal is the fact, and it is a fault of ours that Orbit hears of through the sink
            if (!runnerHere(jobId)) return 'unservable';
            // The runner is here: its own notes see the call. The other servers are told apart that a call was not recorded, all the same. Waiting for that
            // takes a moment, in which this process may stop the job: when the write failed too, whoever runs the job now has no way to see the call
            if (!(await attempt('unrecorded')) && !runnerHere(jobId)) return 'unservable';
            return false;
        },
        calledSince(jobId, since) {
            const seen = calls.get(jobId)?.called;
            return seen !== undefined && within(seen, since);
        },
        async calledAnywhereSince(jobId, since) {
            const seen = calls.get(jobId)?.called;
            if (seen !== undefined && within(seen, since)) return true;
            if (!options.shared) return false;
            const from = typeof since === 'number' ? since : since.at;
            // A window with no moment in it cannot be placed in the other servers' time: it is not said that no call arrived
            if (from === undefined) return true;
            try {
                const other = await options.shared.lastCalledByOthers(jobId);
                if (other !== null && other >= from - SHARED_CALL_SKEW_MS) return true;
                // The read excludes this process's own fields, and it took a moment: a call that reached THIS process meanwhile is not in what it returned
                const meanwhile = calls.get(jobId)?.called;
                return meanwhile !== undefined && within(meanwhile, since);
            } catch {
                return true;
            }
        },
        accepted(jobId, at) {
            const owner = runnerHere(jobId);
            // A turn the runner here gave up takes no call: refused, so nothing is forwarded for it, and the room goes back (see `closeTurn`)
            const shutAt = closed.get(jobId);
            if (shutAt !== undefined) {
                const going = lastTurn(jobId);
                if (shutAt.key === keyOf(at ?? (going ? { turn: going.turn, ...(going.run ? { run: going.run } : {}) } : undefined))) return false;
            }
            // Taken up in the turn that made the call: one taken up after the runner of THIS server moved on belongs to the turn it began in, not to the one that is
            // going now. (A server that no longer runs the job has an old history that says nothing of a call of the runner elsewhere.)
            if (owner && staleCall(jobId, at)) return;
            mark(jobId, 'accepted');
            const shared = options.shared;
            if (!shared?.noteAccepted) return;
            const moment = now();
            // The other servers are told, for the runner of the job that may live on one of them and judges the turn by what the pool answered: with the turn and
            // run the call began in, so a runner of ANOTHER turn does not count it
            if (owner) {
                try {
                    shared.noteAccepted(jobId, moment, at).catch(() => undefined);
                } catch {
                    /* telling the other servers never holds a call */
                }
                return;
            }
            // The runner is on another server: the relay waits for the handoff (two tries, each bounded) before the provider is called, so the runner never reads
            // "no call was taken up" while a call of the turn is in flight and gives the turn up on it
            // The store refuses an acceptance for a turn that was given up (the runner's fence): final, no second try
            return (async () => {
                for (let tries = 0; tries < 2; tries++) {
                    const answer = await boundedAnswer(() => shared.noteAccepted!(jobId, moment, at));
                    if (answer !== 'lost') return answer;
                }
                return false;
            })();
        },
        async closeTurn(jobId, since) {
            // What was taken up here is known at once; what another server took up is in the store, and the fence is written in the same step as the look at it
            const seen = calls.get(jobId)?.accepted;
            if (seen !== undefined && within(seen, since)) return false;
            const shared = options.shared;
            const current = lastTurn(jobId);
            const turn = current ? { turn: current.turn, ...(current.run ? { run: current.run } : {}) } : undefined;
            // From this moment a call of the turn that reaches the relay on this server is refused, and the check of what was taken up here before it has just been made,
            // with nothing between them
            const previous = closed.get(jobId);
            closed.set(jobId, { key: keyOf(turn), at: now() });
            let committed = false;
            try {
                if (!shared?.noteAccepted) {
                    committed = true;
                    return true;
                }
                // With other servers' relays about, the fence must be one step with the look at what they took up. A store that cannot do that gives nothing to rest a give-up on
                const from = typeof since === 'number' ? since : since.at;
                const fenceAt = now();
                const stored = shared.closeTurn && from !== undefined ? await closeOnStore(jobId, turn, from, fenceAt) : { state: 'refused' as const, maybeWritten: false };
                // A call taken up HERE while the store was asked is not in what it said
                const meanwhile = calls.get(jobId)?.accepted;
                if (stored.state === 'fenced' && !(meanwhile !== undefined && within(meanwhile, since))) {
                    committed = true;
                    return true;
                }
                // The turn is not given up and goes on. A fence that may be in the store (no try answered, or an acceptance was counted here meanwhile) is taken back
                // (HDEL of that exact fence, bounded tries) BEFORE the local close is rolled back. When that cannot be confirmed either the fence clears itself: it counts
                // for at most FENCE_LIFE_MS after its moment (see `NOTE_ACCEPTED_UNLESS_CLOSED`), so an orphan blocks a live turn for that long and no longer
                if (stored.maybeWritten && !(await retractOnStore(jobId, turn, fenceAt))) {
                    console.warn('[ComputerRefusals] A turn that was not given up may still be fenced in the shared store: the fence could not be taken back (it expires on its own).');
                }
                return false;
            } finally {
                if (!committed) {
                    if (previous) closed.set(jobId, previous);
                    else closed.delete(jobId);
                }
            }
        },
        async acceptedAnywhereSince(jobId, since) {
            const seen = calls.get(jobId)?.accepted;
            if (seen !== undefined && within(seen, since)) return true;
            if (!options.shared?.lastAcceptedByOthers) return false;
            const from = typeof since === 'number' ? since : since.at;
            if (from === undefined) return true;
            try {
                // Only an acceptance of the turn (and run) the runner is on now counts: one taken up for a call of an earlier turn is no room found for this one
                const current = lastTurn(jobId);
                const other = await options.shared.lastAcceptedByOthers(jobId, current ? { turn: current.turn, ...(current.run ? { run: current.run } : {}) } : undefined);
                if (other !== null && other >= from - SHARED_CALL_SKEW_MS) return true;
                // A call taken up HERE while the read was pending is not in what it returned
                const meanwhile = calls.get(jobId)?.accepted;
                return meanwhile !== undefined && within(meanwhile, since);
            } catch {
                return true;
            }
        },
        acceptedSince(jobId, since) {
            const seen = calls.get(jobId)?.accepted;
            return seen !== undefined && within(seen, since);
        },
        onlyPoolBusySince(jobId, since) {
            const seen = calls.get(jobId);
            if (seen?.pooled === undefined || !within(seen.pooled, since)) return false;
            if (seen.accepted !== undefined && within(seen.accepted, since)) return false;
            // The person's allowance or a rule of theirs refused a call of the turn too (a spending limit also stopped it), or a call of the turn failed some
            // other way of ours (a relay failure, a provider error): it is no pool-only turn
            const refused = last.get(jobId);
            if (refused !== undefined && within(refused, since)) return false;
            return !(seen.other !== undefined && within(seen.other, since));
        },
        endedOnFault(jobId, since) {
            const seen = calls.get(jobId);
            if (!seen?.fault || !within(seen.fault, since)) return false;
            return !seen.answered || seen.answered.order < seen.fault.order;
        },
    };
}
