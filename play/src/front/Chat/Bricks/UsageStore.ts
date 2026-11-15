import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { userIsConnected } from "../../Stores/MenuStore";
import { parseUsage, type CreditCategory, type MyUsage, type ReportOutcome } from "./Usage";

/**
 * The signed-in person's usage (game #1999), as Orbit last said. Undefined until it answered once. A later failed read
 * keeps what was known: the page says so, and tries again the next time it opens. An answer older than the one held (by
 * Orbit's own stamp) never replaces it, so a slow read cannot bring back credit that was already spent.
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

/** Whether an answer carries an older stamp than the usage held: Orbit's own order, never the game's clock. */
function isOlder(answer: MyUsage, held: MyUsage | undefined): boolean {
    const heldVersion = held?.version ?? null;
    return answer.version !== null && heldVersion !== null && answer.version < heldVersion;
}

// Counts the reads that must not be believed any more: a read that began before it changed is ignored when it ends
let epoch = 0;
// The read waiting for the one in flight to end (see refreshMyUsage)
let queued: Promise<void> | undefined;

function startRead(): Promise<void> {
    const startedAt = changes;
    const startedEpoch = epoch;
    const read: Promise<void> = botApiService
        .getMyUsage()
        .then((answer) => {
            // A newer read was asked for while this one was out: this answer may be from before what that read is for
            if (startedEpoch !== epoch) return;
            const parsed = parseUsage(answer);
            // Orbit's answer is older than what the person did meanwhile: keep what they did
            if (parsed && changes === startedAt && !isOlder(parsed, get(usage))) usage.set(parsed);
            failed.set(!parsed);
        })
        .catch((error: unknown) => {
            console.warn("Could not read your usage", error);
            if (startedEpoch === epoch) failed.set(true);
        })
        .finally(() => {
            if (loading === read) loading = undefined;
            settled.set(true);
        });
    loading = read;
    return read;
}

/** Reads the person's usage. One request at a time; resolves either way. */
export function loadMyUsage(): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    return queued ?? loading ?? startRead();
}

/**
 * Reads the usage again, from a request that begins after this call: something has just changed it (a refund), so an
 * answer already on its way, which may be from before, is ignored. While one is out, one more waits for it to end.
 */
export function refreshMyUsage(): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    epoch++;
    if (!loading) return startRead();
    queued ??= loading.then(() => {
        queued = undefined;
        return startRead();
    });
    return queued;
}

/**
 * "Ask for more": a request to the Universe team, never a debt. The page says so at once when Orbit took it. False when
 * Orbit refused or could not be reached: nothing was sent. Without a category it is the computer's, as it always was.
 */
export async function askMyUsageForMore(category: CreditCategory = "computer"): Promise<boolean> {
    try {
        await botApiService.askForMoreUsage(category);
    } catch (error) {
        console.warn("Could not ask for more", error);
        return false;
    }
    changes++;
    usage.update((current) => {
        if (!current) return current;
        const asked = <T extends { asked: boolean; canAskForMore: boolean }>(item: T): T => ({
            ...item,
            asked: true,
            canAskForMore: false,
        });
        if (category === "apps") return current.apps ? { ...current, apps: asked(current.apps) } : current;
        if (!current.computer) return current;
        const { money } = current.computer;
        return { ...current, computer: { ...asked(current.computer), money: money ? asked(money) : null } };
    });
    return true;
}

const OUTCOMES: ReportOutcome[] = ["refunded", "redelivered", "retrying", "credit", "sent"];

/**
 * "Didn't work?" on one task: Orbit looks at it and answers what it came to. Anything it says that is not one of the
 * known outcomes reads as "sent". Undefined when Orbit refused or could not be reached: nothing was sent. What it changed
 * (a refund) shows the next time the usage is read, so the page reads it again.
 */
export async function reportMyActivity(activityId: string): Promise<ReportOutcome | undefined> {
    let answer: unknown;
    try {
        answer = await botApiService.reportActivityProblem(activityId);
    } catch (error) {
        console.warn("Could not send that", error);
        return undefined;
    }
    const outcome = (answer as { outcome?: unknown } | null | undefined)?.outcome;
    return OUTCOMES.find((known) => known === outcome) ?? "sent";
}

/** Forgets what was read: when the person signs out, and for tests. */
export function forgetMyUsage(): void {
    usage.set(undefined);
    settled.set(false);
    failed.set(false);
    loading = undefined;
    queued = undefined;
    epoch++;
    changes = 0;
}
