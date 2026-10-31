import { LockByKey } from "./LockByKey";

/** One edit at a time on a map: every edit of a map goes through the lock of its key. */
export const editionLocks = new LockByKey<string>();

/**
 * Deleting an upload everywhere changes many rooms of a world at once, so it takes the lock of each of them. Two of
 * those deletes in the same world wait for each other here first; otherwise two of them could each hold one room and
 * wait for the other's room forever.
 */
const wholeUploadDeleteLocks = new LockByKey<string>();

/** Runs `run` while holding the lock of every given map. The keys are taken in the same order every time. */
export async function withEditionLocks<T>(keys: string[], run: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    let result!: T;
    const acquire = async (index: number): Promise<void> => {
        if (index === sorted.length) {
            result = await run();
            return;
        }
        await editionLocks.waitForLock(sorted[index], () => acquire(index + 1));
    };
    await acquire(0);
    return result;
}

/** The locks an edit takes: a whole-upload delete waits its turn in its world before it takes any room's lock. */
export function editionLocksFor(wholeUploadDelete: boolean, worldKey: string): Pick<LockByKey<string>, "waitForLock"> {
    if (!wholeUploadDelete) {
        return editionLocks;
    }
    return {
        waitForLock: (key, callback) =>
            wholeUploadDeleteLocks.waitForLock(worldKey, () => editionLocks.waitForLock(key, callback)),
    };
}
