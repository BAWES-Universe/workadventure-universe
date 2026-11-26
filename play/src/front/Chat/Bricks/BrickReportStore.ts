import { writable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";

/**
 * The notes taken back, and the words people sent with notes, in this session (mock "Brick reports inbox"), by id, so the line under the
 * answer and its sheet agree. Orbit keeps the truth: the sheet reads it when it opens, so a note taken back or words sent on another
 * device show here too.
 */
export const takenBackReports = writable<ReadonlySet<string>>(new Set());
export const sentReportWords = writable<ReadonlyMap<string, string>>(new Map());

const markTakenBack = (id: string) => takenBackReports.update((now) => new Set([...now, id]));
const markWords = (id: string, words: string) => sentReportWords.update((now) => new Map([...now, [id, words]]));

/** Takes a note back. "taken", "too_late" or "failed", as Orbit said. */
export async function takeBackReport(id: string, key: string): Promise<"taken" | "too_late" | "failed"> {
    const outcome = await botApiService.takeBackBrickReport(id, key);
    if (outcome === "taken") markTakenBack(id);
    return outcome;
}

/** Sends the person's own words with a note, exactly as shown. "sent", "too_late", "taken_back" or "failed". */
export async function sendReportWords(
    id: string,
    key: string,
    words: string
): Promise<"sent" | "too_late" | "taken_back" | "failed"> {
    const answer = await botApiService.addBrickReportWords(id, key, words);
    if (answer.outcome === "sent") markWords(id, answer.words);
    if (answer.outcome === "taken_back") markTakenBack(id);
    return answer.outcome;
}

/** Reads what became of a note from Orbit, so this device shows what another did. Nothing changes when Orbit can't say. */
export async function readReportStatus(id: string, key: string): Promise<void> {
    const status = await botApiService.brickReportStatus(id, key);
    if (status?.state === "taken_back") markTakenBack(id);
    else if (status?.state === "live" && status.words) markWords(id, status.words);
}
