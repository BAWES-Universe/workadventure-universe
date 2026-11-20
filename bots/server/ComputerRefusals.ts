/**
 * What the model relay refused for a job because of the person's side of the books (their computer allowance used up, or one of their
 * spending rules), noted for the runner that runs the same job in this process.
 *
 * A person's own provider, key or endpoint failing (their credit ran out, their key was revoked) is noted the same way: it is their side too.
 *
 * Why it exists: Hermes sees such a refusal only as a failed call, so a turn that ends because of it looks, to the runner, like any other
 * failed turn. A failed turn Universe is to blame for is given back to the person; one the person's own allowance or rules stopped is not.
 * The relay notes the refusal here and the runner asks, for the turn it just read, whether one came in during it.
 * It also notes how the job's model calls fared on Universe's side: a call that failed for a fault of ours (the AI did not answer, was busy,
 * was not reachable, a stream that broke) and a call that was answered. Hermes can end a turn as completed with the error as its words, or with
 * none, so the runner asks whether the turn ended on a fault of ours: the last call of the turn was ours to answer and was not.
 * Kept in memory only (ids and times, nothing anyone said) and forgotten after a while.
 */
export interface RefusalNotes {
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

export function createRefusalNotes(now: () => number = Date.now): RefusalNotes {
    const last = new Map<string, number>();
    // The order of events is kept by count, since two can land in the same millisecond
    let count = 0;
    const calls = new Map<string, { fault?: { at: number; order: number }; answered?: { at: number; order: number } }>();
    const forget = () => {
        const cutoff = now() - REFUSAL_NOTE_KEEP_MS;
        for (const [jobId, at] of last) if (at < cutoff) last.delete(jobId);
        for (const [jobId, seen] of calls) if (Math.max(seen.fault?.at ?? 0, seen.answered?.at ?? 0) < cutoff) calls.delete(jobId);
    };
    const mark = (jobId: string, kind: 'fault' | 'answered') => {
        forget();
        const seen = calls.get(jobId) ?? {};
        seen[kind] = { at: now(), order: ++count };
        calls.set(jobId, seen);
    };
    return {
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
