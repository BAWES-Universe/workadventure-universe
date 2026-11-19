import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { parseNewAppId, type NewApp } from "./AddApp";

/**
 * Takes away an App that "Add your own app" made and nobody finished (game #2001). It lives beside the sheet, not in it: a sheet
 * that was closed (or went away) cannot be asked again, so the clean-up goes on by itself until Orbit says the App is gone, or
 * that there is no such App. Nothing here reads a store; the page only has to keep running.
 *
 * - `removeApp(id)`: an App whose id is known. Done when Orbit confirms the delete, or answers that it is not there (404).
 * - `findAndRemove(body)`: a try whose answer never came, so Orbit may have made the App. Asking again with the same key
 *   answers with that App (or makes it now); it is then removed. A refusal (a 4xx other than "try later") means nothing was made.
 * - `settledCleanups()`: ends when the first attempt of every clean-up in progress has ended, so a replacement App is never
 *   made before the one it replaces has been looked for. A clean-up that has to wait to try again does not hold it up.
 */

/** Waits between tries, in ms; the last one repeats */
const DEFAULT_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_TRIES = 30;

let delays = DEFAULT_DELAYS;
let nextJobId = 0;
/** Moves on when a test forgets every clean-up: a clean-up of an earlier epoch stops at its next wake */
let epoch = 0;

interface Job {
    /** Ends with the first attempt, however it went */
    first: Promise<void>;
}

const jobs = new Map<number, Job>();

function statusOf(error: unknown): number | undefined {
    return (error as { status?: number } | null)?.status;
}

/** Whether trying the same thing again later can help: no answer, an Orbit that failed, or "too many / too slow" */
function worthTryingAgain(error: unknown): boolean {
    const status = statusOf(error);
    return status === undefined || status >= 500 || status === 408 || status === 429;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function start(attempt: () => Promise<"over" | "again">, what: string): Promise<void> {
    const id = nextJobId++;
    let markFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
        markFirst = resolve;
    });
    const mine = epoch;
    const run = async () => {
        for (let tries = 0; tries < MAX_TRIES; tries++) {
            // eslint-disable-next-line no-await-in-loop
            if (tries > 0) await wait(delays[Math.min(tries - 1, delays.length - 1)]);
            if (mine !== epoch) return;
            let outcome: "over" | "again";
            try {
                // eslint-disable-next-line no-await-in-loop
                outcome = await attempt();
            } catch (error) {
                console.warn(`Could not ${what}`, error);
                outcome = worthTryingAgain(error) ? "again" : "over";
            }
            markFirst();
            if (outcome === "over") return;
        }
        console.warn(`Gave up trying to ${what}`);
    };
    const done = run().finally(() => {
        markFirst();
        jobs.delete(id);
    });
    jobs.set(id, { first });
    return done;
}

/** Takes away an App by its id. Never throws. */
export function removeApp(appId: string): Promise<void> {
    return start(async () => {
        try {
            await botApiService.disconnectMyApp(appId);
        } catch (error) {
            // Not there any more: that is what was wanted
            if (statusOf(error) === 404) return "over";
            throw error;
        }
        return "over";
    }, "drop the unfinished app");
}

/**
 * Finds the App an unanswered try may have made, with the try's own key, and takes it away. Never throws.
 * A key Orbit says was used for another App (409) or a refusal made nothing: there is nothing to take away.
 */
export function findAndRemove(body: NewApp): Promise<void> {
    // Found once, then only its removal is asked again
    const made: { id?: string } = {};
    return start(async () => {
        if (!made.id) {
            try {
                const answer = await botApiService.addMyApp(body);
                // eslint-disable-next-line require-atomic-updates
                made.id = parseNewAppId(answer);
            } catch (error) {
                if (statusOf(error) === 409) return "over";
                throw error;
            }
            if (!made.id) return "over";
        }
        try {
            await botApiService.disconnectMyApp(made.id);
        } catch (error) {
            if (statusOf(error) === 404) return "over";
            throw error;
        }
        return "over";
    }, "find out whether the earlier try made an app");
}

/** Ends when every clean-up in progress has made its first attempt */
export async function settledCleanups(): Promise<void> {
    await Promise.all([...jobs.values()].map((job) => job.first));
}

/** How many clean-ups are still going on */
export function cleanupsInProgress(): number {
    return jobs.size;
}

/** For tests: the waits between tries (none: the defaults) */
export function setCleanupDelaysForTests(next: number[] | undefined): void {
    delays = next ?? DEFAULT_DELAYS;
}

/** For tests: forgets every clean-up in progress (each stops at its next wake) and goes back to the usual waits */
export function resetCleanupsForTests(): void {
    epoch++;
    jobs.clear();
    delays = DEFAULT_DELAYS;
}
