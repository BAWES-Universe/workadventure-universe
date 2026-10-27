import type { Readable, Unsubscriber } from "svelte/store";

export function waitForStoreValue<T>(store: Readable<T | undefined | null>): Promise<T> {
    return new Promise((resolve) => {
        let found = false;
        let unsubscribe: Unsubscriber | undefined = undefined;
        unsubscribe = store.subscribe((value) => {
            if (value && !found) {
                found = true;
                resolve(value);
                unsubscribe?.();
            }
        });
        // A store that already has a value calls back inside subscribe(), before there is anything to unsubscribe.
        if (found) {
            unsubscribe();
        }
    });
}
