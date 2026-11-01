/**
 * This class can create a lock by key
 * to prevent async issues
 */
export class LockByKey<T> {
    // The last caller in line for each key. Every new caller waits for the one before it, so callers run one at a time,
    // in the order they asked.
    private locks = new Map<T, Promise<void>>();

    public async waitForLock(key: T, callback: () => Promise<void>): Promise<void> {
        const previous = this.locks.get(key);

        const run = (async () => {
            try {
                if (previous) {
                    await previous;
                }
            } catch {
                /* The caller before failed: that is theirs to deal with, not ours. */
            }
            await callback();
        })();

        this.locks.set(key, run);

        try {
            await run;
        } finally {
            if (this.locks.get(key) === run) {
                this.locks.delete(key);
            }
        }
    }
}
