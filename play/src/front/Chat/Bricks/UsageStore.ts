import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { userIsConnected } from "../../Stores/MenuStore";
import { parseUsage, type MyUsage } from "./Usage";

/**
 * The signed-in person's usage (game #1999), as Orbit last said. Undefined until it answered once. A later failed read
 * keeps what was known: the page says so, and tries again the next time it opens.
 */
const usage = writable<MyUsage | undefined>(undefined);
export const myUsageStore: Readable<MyUsage | undefined> = { subscribe: usage.subscribe };

/** True once the first read has ended, whether Orbit answered or not. */
const settled = writable(false);
export const myUsageSettled: Readable<boolean> = { subscribe: settled.subscribe };

/** True when the last read failed (Orbit could not be reached, or answered with something else). */
const failed = writable(false);
export const myUsageFailed: Readable<boolean> = { subscribe: failed.subscribe };

let loading: Promise<void> | undefined;
// Counts what changed the usage after it was read: a read that began before "Ask for more" went through must not undo it
let changes = 0;

/** Reads the person's usage. One request at a time; resolves either way. */
export function loadMyUsage(): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    if (!loading) {
        const startedAt = changes;
        loading = botApiService
            .getMyUsage()
            .then((answer) => {
                const parsed = parseUsage(answer);
                // Orbit's answer is older than what the person did meanwhile: keep what they did
                if (parsed && changes === startedAt) usage.set(parsed);
                failed.set(!parsed);
            })
            .catch((error: unknown) => {
                console.warn("Could not read your usage", error);
                failed.set(true);
            })
            .finally(() => {
                loading = undefined;
                settled.set(true);
            });
    }
    return loading;
}

/**
 * "Ask for more": a request to the Universe team, never a debt. The page says so at once when Orbit took it. False when
 * Orbit refused or could not be reached: nothing was sent.
 */
export async function askMyUsageForMore(): Promise<boolean> {
    try {
        await botApiService.askForMoreUsage();
    } catch (error) {
        console.warn("Could not ask for more", error);
        return false;
    }
    changes++;
    usage.update((current) =>
        current?.computer
            ? { ...current, computer: { ...current.computer, asked: true, canAskForMore: false } }
            : current
    );
    return true;
}

/** Forgets what was read: when the person signs out, and for tests. */
export function forgetMyUsage(): void {
    usage.set(undefined);
    settled.set(false);
    failed.set(false);
    loading = undefined;
    changes = 0;
}
