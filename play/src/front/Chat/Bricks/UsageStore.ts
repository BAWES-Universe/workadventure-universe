import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { userIsConnected } from "../../Stores/MenuStore";
import { parseUsage, type CreditCategory, type MyUsage } from "./Usage";

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

// The newest stamp this account's usage ever carried: an answer without a stamp in between does not make an older stamped one new
let highVersion: number | null = null;
// Moves on when the person signs out (or another signs in): what an earlier account's read or request did is not this one's
let account = 0;

/** Whether an answer carries an older stamp than the newest one seen: Orbit's own order, never the game's clock. */
function isOlder(answer: MyUsage): boolean {
    return answer.version !== null && highVersion !== null && answer.version < highVersion;
}

// Counts the reads that must not be believed any more: a read that began before it changed is ignored when it ends
let epoch = 0;
// The read waiting for the one in flight to end (see refreshMyUsage)
let queued: Promise<void> | undefined;

let watching = false;
/**
 * Forgets what was read when the account really changes: another account or Orbit in place (the game initialises again for it), or
 * the person signing out. Set up on the first read, so a page that never reads the usage watches nothing.
 */
function watchAccount(): void {
    if (watching) return;
    watching = true;
    botApiService.onIdentityChange(() => forgetMyUsage());
    let signedIn = get(userIsConnected);
    // Lives as long as the game: never stopped
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    userIsConnected.subscribe((now) => {
        if (signedIn && !now) forgetMyUsage();
        signedIn = now;
    });
}

function startRead(): Promise<void> {
    watchAccount();
    const startedAt = changes;
    const startedEpoch = epoch;
    const startedAccount = account;
    const read: Promise<void> = botApiService
        .getMyUsage()
        .then((answer) => {
            // A newer read was asked for while this one was out: this answer may be from before what that read is for
            if (startedEpoch !== epoch) return;
            const parsed = parseUsage(answer);
            // Orbit's answer is older than what the person did meanwhile: keep what they did
            if (parsed && changes === startedAt && !isOlder(parsed)) {
                if (parsed.version !== null) highVersion = Math.max(highVersion ?? parsed.version, parsed.version);
                usage.set(parsed);
            }
            failed.set(!parsed);
        })
        .catch((error: unknown) => {
            console.warn("Could not read your usage", error);
            if (startedEpoch === epoch) failed.set(true);
        })
        .finally(() => {
            if (loading === read) loading = undefined;
            // The first read of another account is the one that says this one is settled, not one an earlier account left out
            if (startedAccount === account) settled.set(true);
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
    if (queued) return queued;
    const mine = account;
    const entry: Promise<void> = loading.then(() => {
        // Another account since (or signed out): this read was for the one before
        if (queued === entry) queued = undefined;
        if (mine !== account || !get(userIsConnected)) return undefined;
        return startRead();
    });
    queued = entry;
    return entry;
}

/**
 * "Ask for more": a request to the Universe team, never a debt. The page says so at once when Orbit took it. False when
 * Orbit refused or could not be reached: nothing was sent. Without a category it is the computer's, as it always was.
 */
export async function askMyUsageForMore(category: CreditCategory = "computer"): Promise<boolean> {
    const askedBy = account;
    try {
        await botApiService.askForMoreUsage(category);
    } catch (error) {
        console.warn("Could not ask for more", error);
        return false;
    }
    // The person signed out (or another signed in) while it was out: it was taken for them, and says nothing of this account's usage
    if (askedBy !== account) return true;
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

/** Forgets what was read: when the person signs out, and for tests. */
export function forgetMyUsage(): void {
    usage.set(undefined);
    settled.set(false);
    failed.set(false);
    loading = undefined;
    queued = undefined;
    epoch++;
    changes = 0;
    highVersion = null;
    account++;
}
