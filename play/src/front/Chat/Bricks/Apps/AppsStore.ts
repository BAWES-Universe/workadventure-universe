import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { userIsConnected } from "../../../Stores/MenuStore";
import { parseMyApps, type MyApp } from "./Apps";

/**
 * The signed-in person's own apps (game #2001), as Orbit last said, for the Apps row of the Bricks page and the Apps page.
 * Undefined until Orbit answered once. A later failed read keeps what was known; the page says so and tries again the next
 * time it opens.
 */
const apps = writable<MyApp[] | undefined>(undefined);
export const myAppsStore: Readable<MyApp[] | undefined> = { subscribe: apps.subscribe };

/** True once the first read has ended, whether Orbit answered or not */
const settled = writable(false);
export const myAppsSettled: Readable<boolean> = { subscribe: settled.subscribe };

/** True when the last read failed */
const failed = writable(false);
export const myAppsFailed: Readable<boolean> = { subscribe: failed.subscribe };

let loading: Promise<void> | undefined;

function read(): Promise<void> {
    const reading: Promise<void> = botApiService
        .getMyApps()
        .then((answer) => {
            const parsed = parseMyApps(answer);
            if (parsed) apps.set(parsed.apps);
            failed.set(!parsed);
        })
        .catch((error: unknown) => {
            console.warn("Could not read your apps", error);
            failed.set(true);
        })
        .finally(() => {
            if (loading === reading) loading = undefined;
            settled.set(true);
        });
    loading = reading;
    return reading;
}

/**
 * Reads the person's apps. One request at a time; resolves either way. After a change the page made, `afterChange` reads
 * once more behind any read already on its way, because that one may have started before the change.
 */
export function loadMyApps(afterChange = false): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    if (!loading) return read();
    return afterChange ? loading.then(read) : loading;
}

/** Forgets what was read: when the person signs out, and for tests */
export function forgetMyApps(): void {
    apps.set(undefined);
    settled.set(false);
    failed.set(false);
    loading = undefined;
}
