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
// The read that waits behind the one on its way, after a change: every caller that asks meanwhile shares it
let queued: Promise<void> | undefined;
// Counts sign-outs: a read asked for before the person signed out changes nothing when it ends.
let generation = 0;

function read(): Promise<void> {
    const asked = generation;
    const reading: Promise<void> = botApiService
        .getMyApps()
        .then((answer) => {
            if (asked !== generation) return;
            const parsed = parseMyApps(answer);
            if (parsed) apps.set(parsed.apps);
            failed.set(!parsed);
        })
        .catch((error: unknown) => {
            if (asked !== generation) return;
            console.warn("Could not read your apps", error);
            failed.set(true);
        })
        .finally(() => {
            if (loading === reading) loading = undefined;
            if (asked === generation) settled.set(true);
        });
    loading = reading;
    return reading;
}

/**
 * Reads the person's apps. One request at a time; resolves either way. After a change the page made, `afterChange` reads
 * once more behind any read already on its way, because that one may have started before the change. Changes that come
 * while that read waits share it: it starts after the last of them, so an older answer never lands over a newer one.
 */
export function loadMyApps(afterChange = false): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    if (!loading) return read();
    if (!afterChange) return loading;
    if (!queued) {
        const asked = generation;
        const waiting: Promise<void> = loading.then(() => {
            // Signed out while it waited: the next person's apps are not read for a change that was not theirs
            if (asked !== generation) return undefined;
            // It starts now: later changes ask for a read of their own
            if (queued === waiting) queued = undefined;
            return read();
        });
        queued = waiting;
    }
    return queued;
}

/** Forgets what was read: when the person signs out, and for tests */
export function forgetMyApps(): void {
    generation++;
    apps.set(undefined);
    settled.set(false);
    failed.set(false);
    loading = undefined;
    queued = undefined;
}
