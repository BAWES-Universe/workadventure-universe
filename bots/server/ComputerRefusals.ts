/**
 * What the model relay refused for a job because of the person's side of the books (their computer allowance used up, or one of their
 * spending rules), noted for the runner that runs the same job in this process.
 *
 * Why it exists: Hermes sees such a refusal only as a failed call, so a turn that ends because of it looks, to the runner, like any other
 * failed turn. A failed turn Universe is to blame for is given back to the person; one the person's own allowance or rules stopped is not.
 * The relay notes the refusal here and the runner asks, for the turn it just read, whether one came in during it.
 * Kept in memory only (ids and times, nothing anyone said) and forgotten after a while.
 */
export interface RefusalNotes {
    /** The relay refused a call of this job for the person's allowance or a rule of theirs. */
    note(jobId: string): void;
    /** Whether a refusal was noted for this job at or after this moment (ms). */
    sawSince(jobId: string, sinceMs: number): boolean;
}

/** A note older than this can no longer belong to a turn that is being read. */
export const REFUSAL_NOTE_KEEP_MS = 60 * 60 * 1000;

export function createRefusalNotes(now: () => number = Date.now): RefusalNotes {
    const last = new Map<string, number>();
    const forget = () => {
        const cutoff = now() - REFUSAL_NOTE_KEEP_MS;
        for (const [jobId, at] of last) if (at < cutoff) last.delete(jobId);
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
    };
}
