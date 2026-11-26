import { writable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";

/**
 * The notes taken back in this session (mock "Brick reports inbox"), by id, so the line under the answer and its sheet agree. Orbit keeps
 * the truth: a note taken back on another device still shows "Sent" here, and Take it back again simply says it is taken back.
 */
export const takenBackReports = writable<ReadonlySet<string>>(new Set());

/** Takes a note back. "taken", "too_late" or "failed", as Orbit said. */
export async function takeBackReport(id: string, key: string): Promise<"taken" | "too_late" | "failed"> {
    const outcome = await botApiService.takeBackBrickReport(id, key);
    if (outcome === "taken") takenBackReports.update((now) => new Set([...now, id]));
    return outcome;
}
